use hdk::prelude::*;
use rai_integrity::*;

pub mod governance;
pub mod hosting;
pub mod invites;
pub mod messages;
pub mod reviews;
pub mod tasks;

use governance::*;

pub fn me() -> ExternResult<AgentPubKey> {
    Ok(agent_info()?.agent_initial_pubkey)
}
pub fn local() -> ExternResult<()> {
    match call_info()?.cap_grant {
        CapAccess::ChainAuthor(a) if a == me()? => Ok(()),
        CapAccess::RemoteAgent(g) if matches!(g.constraint, GrantConstraint::Assigned { .. }) => {
            Ok(())
        }
        _ => Err(fail("Local owner authorization required")),
    }
}
#[hdk_extern]
pub fn init(_: ()) -> ExternResult<InitCallbackResult> {
    let zome = zome_info()?.name;
    let functions = ["service_echo", "receive_attestation", "recv_remote_signal"]
        .into_iter()
        .map(|f| (zome.clone(), FunctionName::from(f)))
        .collect();
    create_cap_grant(CapGrant::new_zome_call_grant(
        "Hosting challenge, attestation hand-over and refresh hints".into(),
        GrantConstraint::Unrestricted,
        GrantedFunctions::Listed(functions),
    ))?;
    Ok(InitCallbackResult::Pass)
}
#[hdk_extern]
pub fn identity(_: ()) -> ExternResult<String> {
    local()?;
    Ok(me()?.to_string())
}

// Never enabled by the shipping build. Tests replace only their isolated
// coordinator to prove the integrity rules survive bypassing normal APIs.
#[cfg(feature = "adversarial-test")]
#[hdk_extern]
pub fn adversarial_write(entry: EntryTypes) -> ExternResult<ActionHash> {
    local()?;
    let now = sys_time()?;
    let (hash, links): (ActionHash, Vec<(AnyLinkableHash, LinkTypes)>) = match &entry {
        EntryTypes::Event(e) => {
            let hash = create_entry(entry.clone())?;
            let base = match event_index(&e.body) {
                Some(LinkTypes::Tasks) => tasks_base(&e.community)?,
                Some(LinkTypes::Goals) => goals_base(&e.community)?,
                Some(LinkTypes::HostOffers) => hosts_base(&e.community)?,
                Some(LinkTypes::ReviewQueue) => review_base(&e.community, &utc_day(now))?,
                Some(LinkTypes::MemberActivity) => member_base(
                    &e.community,
                    &load::<Member>(e.membership.clone(), MEMBER)?.0.member_id,
                )?,
                _ => governance_base(&e.community)?,
            };
            let kind = event_index(&e.body).unwrap_or(LinkTypes::Governance);
            (hash, vec![(base, kind)])
        }
        EntryTypes::Message(m) => {
            let hash = create_entry(entry.clone())?;
            (
                hash,
                vec![(
                    channel_base(&m.community, GENERAL, &utc_day(now))?,
                    LinkTypes::ChannelMessages,
                )],
            )
        }
        EntryTypes::Member(m) => {
            let hash = create_entry(entry.clone())?;
            (
                hash,
                vec![(m.community.clone().into(), LinkTypes::CommunityMembers)],
            )
        }
        EntryTypes::Invite(i) => {
            let hash = create_entry(entry.clone())?;
            let id = load::<Member>(i.membership.clone(), MEMBER)?.0.member_id;
            (
                hash,
                vec![(member_base(&i.community, &id)?, LinkTypes::MemberActivity)],
            )
        }
        EntryTypes::HostingSummary(s) => {
            let hash = create_entry(entry.clone())?;
            let id = load::<Member>(s.membership.clone(), MEMBER)?.0.member_id;
            (
                hash,
                vec![(
                    proof_base(&s.community, &id, &utc_month(now))?,
                    LinkTypes::HostingProofs,
                )],
            )
        }
        EntryTypes::Community(_) => (create_entry(entry.clone())?, vec![]),
    };
    for (base, kind) in links {
        create_link(base, hash.clone(), kind, ())?;
    }
    Ok(hash)
}

#[hdk_extern]
pub fn create_community(c: Community) -> ExternResult<ActionHash> {
    local()?;
    create_entry(EntryTypes::Community(c))
}
#[hdk_extern]
pub fn binding_challenge(m: Member) -> ExternResult<String> {
    local()?;
    Ok(binding_message(&m, &me()?))
}
#[hdk_extern]
pub fn bind_member(m: Member) -> ExternResult<ActionHash> {
    local()?;
    let (c, _) = load::<Community>(m.community.clone(), COMMUNITY)?;
    if let Some(i) = &m.invitation {
        let info = invites::invitation_info(i.clone())?;
        if info.community != m.community || !info.usable {
            return Err(fail("This invitation was already used, closed or expired / Bu davet kullanılmış, kapatılmış ya da süresi dolmuş"));
        }
    } else if m.gate.is_none() && m.previous.is_none() && m.member_id != c.founder {
        return Err(fail(
            "An invitation is required to join / Katılmak için davet gerekli",
        ));
    }
    if let Some(p) = &m.previous {
        let _ = load::<Member>(p.clone(), MEMBER)?;
    }
    let hash = create_entry(EntryTypes::Member(m.clone()))?;
    create_link(
        m.community.clone(),
        hash.clone(),
        LinkTypes::CommunityMembers,
        (),
    )?;
    create_link(
        ExternalHash::from_raw_32(hex::decode(&m.member_id).map_err(|_| fail("Invalid identity"))?),
        hash.clone(),
        LinkTypes::IdentityBindings,
        (),
    )?;
    if let Some(i) = m.invitation {
        create_link(i, hash.clone(), LinkTypes::InvitationUses, ())?;
    }
    Ok(hash)
}
#[hdk_extern]
pub fn locate_memberships(id: String) -> ExternResult<Vec<MemberView>> {
    local()?;
    if !valid_member_id(&id) {
        return Err(fail("Invalid member identity"));
    }
    let base = ExternalHash::from_raw_32(hex::decode(id).map_err(|_| fail("Invalid identity"))?);
    let links = links_many(vec![(base.into(), LinkTypes::IdentityBindings)])?;
    Ok(get_many(
        links
            .into_iter()
            .filter_map(|l| l.target.into_action_hash())
            .collect(),
    )?
    .iter()
    .filter_map(member_view)
    .collect())
}

/// The highest action sequence a device has published: the recovery cutoff for a new device.
#[hdk_extern]
pub fn device_chain_head(device: AgentPubKey) -> ExternResult<Option<u32>> {
    local()?;
    let mut best: Option<u32> = None;
    // Ask the local store first, then the network; take the highest answer.
    for options in [GetOptions::local(), GetOptions::network()] {
        let Ok(activity) = get_agent_activity(
            device.clone(),
            ChainQueryFilter::new(),
            ActivityRequest::Full,
            options,
        ) else {
            continue;
        };
        let head = match &activity.status {
            ChainStatus::Valid(h) => Some(h.action_seq),
            _ => None,
        };
        let observed = activity.highest_observed.as_ref().map(|h| h.action_seq);
        let listed = activity.valid_activity.iter().map(|(seq, _)| *seq).max();
        best = [best, head, observed, listed].into_iter().flatten().max();
    }
    Ok(best)
}
