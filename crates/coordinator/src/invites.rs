//! Personal invitations and campaign codes (plan I).
use crate::governance::*;
use crate::local;
use hdk::prelude::*;
use rai_integrity::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct InviteInput {
    pub community: ActionHash,
    pub membership: ActionHash,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InviteToken {
    pub community: ActionHash,
    pub invitation: ActionHash,
    pub expires_at_us: i64,
}

#[hdk_extern]
pub fn create_invite(input: InviteInput) -> ExternResult<InviteToken> {
    local()?;
    let mut gov = Gov::load(&input.community)?;
    let m = gov.own(&input.membership)?;
    if member_excluded(&mut gov, &m)? {
        return Err(fail(
            "This membership is not valid under the community's invitation rules",
        ));
    }
    let id = m.data.member_id.clone();
    let now = sys_time()?.as_micros();
    let founder = id == gov.founder();
    let organizer = gov.may(&id, "admin");
    if !founder {
        // Settings, personal access and the invitation-tree pause (projection rules).
        let (_, joined) = {
            let state = governance_state_inner(&mut gov)?;
            state
        };
        if !invite_right(&gov, &joined, &id, now) {
            return Err(fail("Your invitation right is paused or member invitations are off / Davet hakkın durdurulmuş ya da üye davetleri kapalı"));
        }
    }
    let settings = gov
        .latest(|b| matches!(b, Body::InviteSettings { .. }))
        .map(|e| e.hash.clone());
    let quota_event = gov
        .latest(|b| matches!(b, Body::InviteQuota { .. }))
        .cloned();
    let (wait_days, per_week, organizer_per_week) = match quota_event.as_ref().map(|e| &e.data.body)
    {
        Some(Body::InviteQuota {
            wait_days,
            per_week,
            organizer_per_week,
        }) => (*wait_days, *per_week, *organizer_per_week),
        _ => (
            DEFAULT_INVITE_WAIT_DAYS,
            DEFAULT_INVITES_PER_WEEK,
            DEFAULT_ORGANIZER_INVITES_PER_WEEK,
        ),
    };
    if !founder {
        let start = gov
            .lineage
            .by_id
            .get(&id)
            .into_iter()
            .flatten()
            .filter_map(|h| gov.lineage.by_hash.get(h))
            .map(|v| v.timestamp_us)
            .min()
            .unwrap_or(now);
        if !organizer && now - start < wait_days as i64 * DAY_US {
            return Err(fail("New members invite after their first week / Yeni üyeler ilk haftadan sonra davet eder"));
        }
        let recent = query(
            ChainQueryFilter::new().entry_type(EntryType::App(AppEntryDef::new(
                INVITE.into(),
                0.into(),
                EntryVisibility::Public,
            ))),
        )?
        .iter()
        .filter(|r| now - r.action().timestamp().as_micros() < 7 * DAY_US)
        .count();
        let limit = if organizer {
            organizer_per_week
        } else {
            per_week
        } as usize;
        if recent >= limit {
            return Err(fail(
                "Weekly invitation limit reached / Haftalık davet sınırı doldu",
            ));
        }
    }
    let authority = if founder {
        None
    } else {
        gov.grant(&id)
            .filter(|(_, p)| !p.is_empty())
            .map(|g| g.0.clone())
    };
    let expires_at_us = now + INVITE_LIFETIME_US;
    let invite = Invite {
        community: input.community.clone(),
        membership: input.membership,
        expires_at_us,
        settings,
        quota: quota_event.map(|e| e.hash),
        authority,
    };
    let hash = create_entry(EntryTypes::Invite(invite))?;
    create_link(
        member_base(&input.community, &id)?,
        hash.clone(),
        LinkTypes::MemberActivity,
        (),
    )?;
    Ok(InviteToken {
        community: input.community,
        invitation: hash,
        expires_at_us,
    })
}

fn governance_state_inner(
    gov: &mut Gov,
) -> ExternResult<(
    std::collections::BTreeSet<String>,
    std::collections::BTreeMap<String, (String, i64)>,
)> {
    let members: Vec<MemberView> = get_many(
        links_many(vec![(gov.hash.clone().into(), LinkTypes::CommunityMembers)])?
            .into_iter()
            .filter_map(|l| l.target.into_action_hash())
            .collect(),
    )?
    .iter()
    .filter_map(member_view)
    .collect();
    for m in &members {
        gov.lineage.ensure(&gov.hash.clone(), [m.hash.clone()])?;
    }
    let mut invites = std::collections::BTreeMap::new();
    for r in get_many(
        members
            .iter()
            .filter_map(|m| m.data.invitation.clone())
            .collect(),
    )? {
        invites.insert(
            r.action_address().clone(),
            (invite_view(&r), event_view(&r)),
        );
    }
    let inviters: Vec<ActionHash> = invites
        .values()
        .filter_map(|(i, _)| i.as_ref().map(|v| v.data.membership.clone()))
        .collect();
    gov.lineage.ensure(&gov.hash.clone(), inviters)?;
    Ok(excluded_members(gov, &members, &invites))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InvitationInfo {
    pub community: ActionHash,
    pub kind: String,
    pub expires_at_us: i64,
    pub uses: u32,
    pub max_uses: u32,
    pub usable: bool,
}
/// What a joining device needs to know about an invitation before binding.
#[hdk_extern]
pub fn invitation_info(invitation: ActionHash) -> ExternResult<InvitationInfo> {
    local()?;
    let record = get(invitation.clone(), GetOptions::default())?.ok_or(fail(
        "Invitation not found yet; try again when a member is online",
    ))?;
    let uses = links_many(vec![(invitation.clone().into(), LinkTypes::InvitationUses)])?
        .iter()
        .filter_map(|l| l.target.clone().into_action_hash())
        .collect::<std::collections::BTreeSet<_>>()
        .len() as u32;
    let now = sys_time()?.as_micros();
    if let Some(i) = invite_view(&record) {
        return Ok(InvitationInfo {
            community: i.data.community,
            kind: "personal".into(),
            expires_at_us: i.data.expires_at_us,
            uses,
            max_uses: 1,
            usable: uses == 0 && now <= i.data.expires_at_us,
        });
    }
    if let Some(e) = event_view(&record) {
        if let Body::CampaignCode {
            max_uses,
            expires_at_us,
            active,
        } = e.data.body
        {
            let gov = Gov::load(&e.data.community)?;
            let closed = gov.events.iter().any(|v| matches!(&v.data.body, Body::Module { module, kind, payload, .. }
                if module == "invites" && kind == "campaign-close" && payload == &invitation.to_string()));
            return Ok(InvitationInfo {
                community: e.data.community,
                kind: "campaign".into(),
                expires_at_us,
                uses,
                max_uses,
                usable: active && !closed && uses < max_uses && now <= expires_at_us,
            });
        }
    }
    Err(fail("Invalid invitation"))
}
