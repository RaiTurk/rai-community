//! Tasks, goals, member activity and type-specific write checks.
use crate::governance::*;
use crate::local;
use hdk::prelude::*;
use rai_integrity::*;
use std::collections::BTreeSet;

fn filtered(
    c: &ActionHash,
    kind: LinkTypes,
    base: AnyLinkableHash,
) -> ExternResult<Vec<EventView>> {
    let mut gov = Gov::load(c)?;
    let events = events_at(vec![(base, kind)], c)?;
    gov.lineage
        .ensure(c, events.iter().map(|e| e.data.membership.clone()))?;
    Ok(filter_events(
        events,
        gov.founder(),
        &gov.lineage,
        &gov.grants,
        &BTreeSet::new(),
    ))
}
/// Every version of every task (the interface keeps the latest per id).
#[hdk_extern]
pub fn tasks(c: ActionHash) -> ExternResult<Vec<EventView>> {
    local()?;
    filtered(&c, LinkTypes::Tasks, tasks_base(&c)?)
}
#[hdk_extern]
pub fn goals(c: ActionHash) -> ExternResult<Vec<EventView>> {
    local()?;
    filtered(&c, LinkTypes::Goals, goals_base(&c)?)
}
#[hdk_extern]
pub fn host_offers(c: ActionHash) -> ExternResult<Vec<EventView>> {
    local()?;
    filtered(&c, LinkTypes::HostOffers, hosts_base(&c)?)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityInput {
    pub community: ActionHash,
    pub member_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Activity {
    pub events: Vec<EventView>,
    pub invites: Vec<InviteView>,
}
/// One member's contribution reports, account claims, reports and invitations.
#[hdk_extern]
pub fn member_activity(input: ActivityInput) -> ExternResult<Activity> {
    local()?;
    let c = &input.community;
    if !valid_member_id(&input.member_id) {
        return Err(fail("Invalid member identity"));
    }
    let mut gov = Gov::load(c)?;
    let records = get_many(
        links_many(vec![(
            member_base(c, &input.member_id)?,
            LinkTypes::MemberActivity,
        )])?
        .into_iter()
        .filter_map(|l| l.target.into_action_hash())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect(),
    )?;
    let mut events: Vec<EventView> = records
        .iter()
        .filter_map(event_view)
        .filter(|e| &e.data.community == c)
        .collect();
    let mut invites: Vec<InviteView> = records
        .iter()
        .filter_map(invite_view)
        .filter(|i| &i.data.community == c)
        .collect();
    gov.lineage.ensure(
        c,
        events
            .iter()
            .map(|e| e.data.membership.clone())
            .chain(invites.iter().map(|i| i.data.membership.clone())),
    )?;
    events = filter_events(
        events,
        gov.founder(),
        &gov.lineage,
        &gov.grants,
        &BTreeSet::new(),
    );
    invites.retain(|i| {
        gov.lineage
            .member_of(&i.data.membership)
            .is_some_and(|m| m.data.member_id == input.member_id)
    });
    events.sort_by_key(|e| (e.timestamp_us, e.hash.clone()));
    invites.sort_by_key(|i| i.timestamp_us);
    Ok(Activity { events, invites })
}

/// Contributions can only target a task whose latest version is active.
pub fn claim_target(e: &AppEvent) -> ExternResult<()> {
    let Body::Claim { task, .. } = &e.body else {
        return Ok(());
    };
    let (t, _) = load::<AppEvent>(task.clone(), EVENT)?;
    let Body::Task { id, .. } = &t.body else {
        return Err(fail("Not a task"));
    };
    let all = events_at(
        vec![(tasks_base(&e.community)?, LinkTypes::Tasks)],
        &e.community,
    )?;
    let archived = all.iter().rev().find_map(|v| match &v.data.body {
        Body::Task {
            id: x, archived, ..
        } if x == id => Some(*archived),
        _ => None,
    });
    if archived == Some(true) {
        return Err(fail("This task is archived / Bu görev arşivlendi"));
    }
    Ok(())
}

/// Which governance item a record versions.
pub fn gov_key(b: &Body) -> String {
    match b {
        Body::Channel { id, .. } => format!("channel:{id}"),
        Body::AdminGrant { member_id, .. } => format!("grant:{member_id}"),
        Body::PeerRole { member_id, .. } => format!("role:{member_id}"),
        Body::Decision { member_id, .. } => format!("decision:{member_id}"),
        Body::InviteAccess { member_id, .. } => format!("invite-access:{member_id}"),
        Body::Module {
            module,
            kind,
            payload,
            ..
        } => {
            let id = serde_json::from_str::<serde_json::Value>(payload)
                .ok()
                .and_then(|v| v["id"].as_str().map(str::to_owned))
                .unwrap_or_default();
            format!("module:{module}:{kind}:{id}")
        }
        Body::BulkDecision { member_ids, .. } => format!("bulk:{}", member_ids.join(",")),
        other => serde_json::to_value(other)
            .ok()
            .and_then(|v| v["type"].as_str().map(str::to_owned))
            .unwrap_or_default(),
    }
}

/// An identical retry returns the existing record. The check reads only the
/// index of that record type, or the author's own chain.
pub fn duplicate(gov: &Gov, e: &AppEvent) -> ExternResult<Option<ActionHash>> {
    let same = |v: &EventView| &v.data == e;
    Ok(match &e.body {
        Body::Task { id, .. } => events_at(
            vec![(tasks_base(&e.community)?, LinkTypes::Tasks)],
            &e.community,
        )?
        .into_iter()
        .rev()
        .find(|v| matches!(&v.data.body, Body::Task { id: x, .. } if x == id))
        .filter(same)
        .map(|v| v.hash),
        // Retrying the current offer is idempotent; an offer after a withdrawal is new.
        Body::HostOffer { .. } => events_at(
            vec![(hosts_base(&e.community)?, LinkTypes::HostOffers)],
            &e.community,
        )?
        .into_iter()
        .rev()
        .find(|v| v.data.membership == e.membership)
        .filter(same)
        .map(|v| v.hash),
        Body::AdminGrant { member_id, .. } => gov
            .events
            .iter()
            .rev()
            .find(
                |v| matches!(&v.data.body, Body::AdminGrant { member_id: x, .. } if x == member_id),
            )
            .filter(|v| same(v))
            .map(|v| v.hash.clone()),
        // Versioned settings: only the current version of the same item can make a duplicate,
        // so closing and reopening a channel writes a new version.
        b if event_index(b) == Some(LinkTypes::Governance) => {
            let key = gov_key(b);
            gov.events
                .iter()
                .rev()
                .find(|v| gov_key(&v.data.body) == key)
                .filter(|v| same(v))
                .map(|v| v.hash.clone())
        }
        _ => query(
            ChainQueryFilter::new()
                .include_entries(true)
                .entry_type(EntryType::App(AppEntryDef::new(
                    EVENT.into(),
                    0.into(),
                    EntryVisibility::Public,
                ))),
        )?
        .iter()
        .find(|r| entry_of::<AppEvent>(r).is_ok_and(|v| &v == e))
        .map(|r| r.action_address().clone()),
    })
}
