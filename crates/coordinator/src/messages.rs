//! The write path, channel messages and refresh hints.
use crate::governance::*;
use crate::reviews::queue_for;
use crate::tasks::{claim_target, duplicate};
use crate::{local, me};
use hdk::prelude::*;
use rai_integrity::*;
use std::collections::BTreeSet;

#[hdk_extern]
pub fn publish(e: AppEvent) -> ExternResult<ActionHash> {
    publish_event(e)
}

/// The permission a body needs on the write path (mirrors integrity).
fn permission_for(body: &Body) -> Option<&'static str> {
    required_permission(body)
}

/// Writes the record and its indexes.
pub fn write_event(e: &AppEvent) -> ExternResult<ActionHash> {
    let hash = create_entry(EntryTypes::Event(e.clone()))?;
    let now = sys_time()?;
    let c = &e.community;
    match event_index(&e.body) {
        Some(LinkTypes::Governance) => {
            create_link(governance_base(c)?, hash.clone(), LinkTypes::Governance, ())?
        }
        Some(LinkTypes::Tasks) => create_link(tasks_base(c)?, hash.clone(), LinkTypes::Tasks, ())?,
        Some(LinkTypes::Goals) => create_link(goals_base(c)?, hash.clone(), LinkTypes::Goals, ())?,
        Some(LinkTypes::HostOffers) => {
            create_link(hosts_base(c)?, hash.clone(), LinkTypes::HostOffers, ())?
        }
        Some(LinkTypes::ReviewQueue) => create_link(
            review_base(c, &utc_day(now))?,
            hash.clone(),
            LinkTypes::ReviewQueue,
            (),
        )?,
        Some(LinkTypes::MemberActivity) => {
            let (m, _) = load::<Member>(e.membership.clone(), MEMBER)?;
            create_link(
                member_base(c, &m.member_id)?,
                hash.clone(),
                LinkTypes::MemberActivity,
                (),
            )?
        }
        _ => return Err(fail("Messages use post_message")),
    };
    if also_reviewed(&e.body) {
        create_link(
            review_base(c, &utc_day(now))?,
            hash.clone(),
            LinkTypes::ReviewQueue,
            (),
        )?;
    }
    Ok(hash)
}

pub fn publish_event(mut e: AppEvent) -> ExternResult<ActionHash> {
    local()?;
    if matches!(e.body, Body::Message { .. }) {
        return Err(fail("Use post_message"));
    }
    let mut gov = Gov::load(&e.community)?;
    let m = gov.own(&e.membership)?;
    if member_excluded(&mut gov, &m)? {
        return Err(fail(
            "This membership is not valid under the community's invitation rules",
        ));
    }
    let member_id = m.data.member_id.clone();
    e.authority = None;
    if let Body::Claim { sampling, .. } = &mut e.body {
        *sampling = gov
            .latest(|b| matches!(b, Body::Sampling { .. }))
            .map(|v| v.hash.clone());
    }
    if let Some(permission) = permission_for(&e.body) {
        e.authority = gov.authorize(&member_id, permission)?;
    }
    if let Body::Module {
        module,
        kind,
        version: 1,
        admin: true,
        payload,
    } = &e.body
    {
        if module == "community-ui" && kind == "windows-release-auto" {
            check_release_trigger(&gov, payload)?;
        }
    }
    match &e.body {
        Body::Decision {
            member_id: subject, ..
        }
        | Body::AdminGrant {
            member_id: subject, ..
        }
        | Body::InviteAccess {
            member_id: subject, ..
        } if subject == gov.founder() => {
            return Err(fail(
                "The founder's access cannot be changed / Kurucunun erişimi değiştirilemez",
            ))
        }
        Body::BulkDecision { member_ids, .. }
            if member_ids.iter().any(|id| id == gov.founder()) =>
        {
            return Err(fail(
                "The founder's access cannot be changed / Kurucunun erişimi değiştirilemez",
            ))
        }
        _ => {}
    }
    // Reviewer actions need a current role.
    if let Body::XVerify { role, .. } | Body::Review { role, .. } = &e.body {
        if gov.role(&member_id).as_ref() != Some(role) {
            return Err(fail("Reviewer authority is inactive or revoked"));
        }
    }
    if let Body::Review { claim, .. } = &e.body {
        let queue = queue_for(&mut gov)?;
        if !queue
            .iter()
            .any(|q| &q.claim == claim && q.reviewer.as_deref() == Some(&member_id))
        {
            return Err(fail("This review is not assigned to you"));
        }
    }
    if let Body::Claim {
        x_verification: Some(xv),
        ..
    } = &e.body
    {
        let (v, record) = load::<AppEvent>(xv.clone(), EVENT)?;
        gov.lineage.ensure(&e.community, [v.membership.clone()])?;
        let reviewer = gov
            .lineage
            .member_of(&v.membership)
            .map(|m| m.data.member_id.clone())
            .unwrap_or_default();
        let active = matches!(&v.body, Body::XVerify { role, .. } if gov.role(&reviewer).as_ref() == Some(role))
            && !gov.removed(&reviewer);
        if !active
            || !gov
                .lineage
                .accepts(&v.membership, record.action().action_seq())
        {
            return Err(fail("Account verification requires an active reviewer"));
        }
    }
    if let Body::Claim { .. } = &e.body {
        claim_target(&e)?;
    }
    if let Some(old) = duplicate(&gov, &e)? {
        return Ok(old);
    }
    write_event(&e)
}

fn check_release_trigger(gov: &Gov, payload: &str) -> ExternResult<()> {
    let plan = serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| value["plan"].as_str().map(str::to_owned))
        .ok_or(fail("A staged Windows release is required"))?;
    let founder = gov.founder().to_string();
    let current_plan = gov.events.iter().rev().find(|e| {
        gov.lineage
            .member_of(&e.data.membership)
            .is_some_and(|m| m.data.member_id == founder)
            && matches!(&e.data.body, Body::Module { module, kind, version: 1, admin: true, .. }
                if module == "community-ui" && kind == "windows-release-plan")
    });
    if current_plan.map(|event| event.hash.to_string()).as_deref() != Some(plan.as_str()) {
        return Err(fail("The staged Windows release has changed"));
    }
    Ok(())
}

// ---------------------------------------------------------------- messages

#[derive(Debug, Serialize, Deserialize)]
pub struct PostInput {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub channel: Option<ActionHash>,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hint {
    pub community: ActionHash,
    pub kind: String,
    pub at_us: i64,
}

/// Latest version of a channel by its stable id, from governance.
fn channel_latest<'a>(gov: &'a Gov, ch: &ActionHash) -> ExternResult<(&'a EventView, String)> {
    let id = gov
        .events
        .iter()
        .find_map(|v| match &v.data.body {
            Body::Channel { id, .. } if &v.hash == ch => Some(id.clone()),
            _ => None,
        })
        .ok_or(fail("Channel not synchronized"))?;
    let latest = gov
        .latest(|b| matches!(b, Body::Channel { id: x, .. } if x == &id))
        .ok_or(fail("Channel not synchronized"))?;
    Ok((latest, id))
}

#[hdk_extern]
pub fn post_message(input: PostInput) -> ExternResult<ActionHash> {
    local()?;
    let text = input.text.trim().to_string();
    if text.is_empty() || text.chars().count() > MESSAGE_CHARS {
        return Err(fail(
            "Write a message of 1–400 characters / 1–400 karakterlik bir mesaj yaz",
        ));
    }
    let mut gov = Gov::load(&input.community)?;
    let m = gov.own(&input.membership)?;
    if member_excluded(&mut gov, &m)? {
        return Err(fail(
            "This membership is not valid under the community's invitation rules",
        ));
    }
    let member_id = m.data.member_id.clone();
    let mut channel = None;
    let mut authority = None;
    let mut channel_id = GENERAL.to_string();
    if let Some(ch) = &input.channel {
        let (latest, id) = channel_latest(&gov, ch)?;
        let Body::Channel {
            admins_only,
            archived,
            ..
        } = latest.data.body.clone()
        else {
            unreachable!()
        };
        if archived {
            return Err(fail("This channel is closed / Bu kanal kapalı"));
        }
        if admins_only {
            authority = gov.authorize(&member_id, "admin").map_err(|_| {
                fail("Only organizers write in this channel / Bu kanala yalnız yöneticiler yazar")
            })?;
        }
        channel = Some(latest.hash.clone());
        channel_id = id;
    }
    // Same rules as integrity, checked first for a clear error.
    let now = sys_time()?.as_micros();
    let start = gov
        .lineage
        .by_id
        .get(&member_id)
        .into_iter()
        .flatten()
        .filter_map(|h| gov.lineage.by_hash.get(h))
        .map(|v| v.timestamp_us)
        .min()
        .unwrap_or(now);
    let fresh = member_id != gov.founder() && now - start < NEW_ACCOUNT_US;
    if fresh && contains_link(&text) {
        return Err(fail(
            "New accounts cannot post links for 3 days / Yeni hesaplar 3 gün bağlantı paylaşamaz",
        ));
    }
    let window = if fresh {
        NEW_ACCOUNT_MESSAGE_INTERVAL_US
    } else {
        MESSAGE_INTERVAL_US
    };
    let own_last = query(
        ChainQueryFilter::new().entry_type(EntryType::App(AppEntryDef::new(
            MESSAGE.into(),
            0.into(),
            EntryVisibility::Public,
        ))),
    )?
    .last()
    .map(|r| r.action().timestamp().as_micros());
    if own_last.is_some_and(|t| now - t < window) {
        return Err(fail(if fresh {
            "New accounts wait 60 seconds between messages / Yeni hesaplar mesajlar arasında 60 saniye bekler"
        } else {
            "Please wait 5 seconds between messages / Mesajlar arasında 5 saniye bekle"
        }));
    }
    let id = random_bytes(MESSAGE_ID_BYTES as u32)?.to_vec();
    let entry = MessageEntry {
        community: input.community.clone(),
        membership: input.membership,
        channel,
        id,
        text,
        authority,
    };
    let hash = create_entry(EntryTypes::Message(entry))?;
    create_link(
        channel_base(&input.community, &channel_id, &utc_day(sys_time()?))?,
        hash.clone(),
        LinkTypes::ChannelMessages,
        (),
    )?;
    hint(&input.community, "message")?;
    Ok(hash)
}

/// Tells known peers that something new exists. Carries no content.
pub fn hint(c: &ActionHash, kind: &str) -> ExternResult<()> {
    let me = me()?;
    let peers: Vec<AgentPubKey> =
        get_many(targets_of(vec![(hosts_base(c)?, LinkTypes::HostOffers)])?)?
            .iter()
            .map(|r| r.action().author().clone())
            .filter(|a| a != &me)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(64)
            .collect();
    if !peers.is_empty() {
        let _ = send_remote_signal(
            Hint {
                community: c.clone(),
                kind: kind.into(),
                at_us: sys_time()?.as_micros(),
            },
            peers,
        );
    }
    Ok(())
}
fn targets_of(bases: Vec<(AnyLinkableHash, LinkTypes)>) -> ExternResult<Vec<ActionHash>> {
    let links = links_many(bases)?;
    let mut seen = BTreeSet::new();
    Ok(links
        .into_iter()
        .filter_map(|l| l.target.into_action_hash())
        .filter(|h| seen.insert(h.clone()))
        .collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessagesInput {
    pub community: ActionHash,
    /// A channel's stable id; none for the general channel.
    pub channel: Option<String>,
    /// Only messages older than this (paging backwards); none = now.
    pub before_us: Option<i64>,
    /// Only messages newer than this (incremental refresh).
    pub since_us: Option<i64>,
    pub limit: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MessagePage {
    pub events: Vec<EventView>,
    /// True when older messages may exist before the oldest returned one.
    pub more: bool,
}

fn message_view(r: &Record) -> Option<EventView> {
    if !has_type(r, MESSAGE) {
        return None;
    }
    let m: MessageEntry = entry_of(r).ok()?;
    Some(EventView {
        hash: r.action_address().clone(),
        data: AppEvent {
            community: m.community,
            membership: m.membership,
            body: Body::Message {
                id: m.id,
                text: m.text,
                channel: m.channel,
            },
            authority: m.authority,
        },
        sequence: r.action().action_seq(),
        timestamp_us: r.action().timestamp().as_micros(),
    })
}

/// Day buckets backwards until `limit` messages are found (or the community's first day).
#[hdk_extern]
pub fn messages(input: MessagesInput) -> ExternResult<MessagePage> {
    local()?;
    let c = &input.community;
    let mut gov = Gov::load(c)?;
    let channel = input.channel.clone().unwrap_or_else(|| GENERAL.to_string());
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let now = sys_time()?.as_micros();
    let before = input.before_us.unwrap_or(now + 1);
    let since = input.since_us.unwrap_or(i64::MIN);
    let first_day = gov.created_us.div_euclid(DAY_US);
    let mut day = (before - 1).div_euclid(DAY_US);
    let mut found: Vec<Link> = Vec::new();
    // Read up to two weeks of buckets per host call.
    while day >= first_day && day >= since.div_euclid(DAY_US) && found.len() < limit {
        let mut bases = Vec::new();
        for d in (day - 13).max(first_day)..=day {
            bases.push((
                channel_base(c, &channel, &day_of_us(d * DAY_US))?,
                LinkTypes::ChannelMessages,
            ));
        }
        for l in links_many(bases)? {
            let t = l.timestamp.as_micros();
            // The index link is written just after the message; allow for that gap.
            if t < before.saturating_add(10_000_000) && t > since.saturating_sub(10_000_000) {
                found.push(l);
            }
        }
        day -= 14;
    }
    found.sort_by_key(|l| std::cmp::Reverse(l.timestamp));
    let more = found.len() > limit || (day >= first_day && input.since_us.is_none());
    found.truncate(limit);
    let mut events: Vec<EventView> = get_many(
        found
            .into_iter()
            .filter_map(|l| l.target.into_action_hash())
            .collect(),
    )?
    .iter()
    .filter_map(message_view)
    .filter(|e| &e.data.community == c && e.timestamp_us < before && e.timestamp_us > since)
    .collect();
    gov.lineage
        .ensure(c, events.iter().map(|e| e.data.membership.clone()))?;
    events = filter_events(
        events,
        gov.founder(),
        &gov.lineage,
        &gov.grants,
        &BTreeSet::new(),
    );
    events.sort_by_key(|e| (e.timestamp_us, e.hash.clone()));
    Ok(MessagePage { events, more })
}

/// What the local interface receives. Hashes stay binary on the wire.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UiSignal {
    #[serde(rename = "type")]
    pub kind: String,
    pub community: Option<ActionHash>,
    pub offer: Option<ActionHash>,
    pub hint: Option<String>,
    pub hour_us: Option<i64>,
    pub at_us: Option<i64>,
    pub proof: Option<HourProof>,
}

/// Forwards a peer's refresh hint to the local interface.
#[hdk_extern]
pub fn recv_remote_signal(signal: ExternIO) -> ExternResult<()> {
    if let Ok(hint) = signal.decode::<Hint>() {
        if hint.kind.len() <= 32 {
            emit_signal(UiSignal {
                kind: "hint".into(),
                community: Some(hint.community),
                hint: Some(hint.kind),
                at_us: Some(hint.at_us),
                ..Default::default()
            })?;
        }
        return Ok(());
    }
    if let Ok(covered) = signal.decode::<crate::hosting::Covered>() {
        emit_signal(UiSignal {
            kind: "covered".into(),
            offer: Some(covered.offer),
            hour_us: Some(covered.hour_us),
            ..Default::default()
        })?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdatesInput {
    pub community: ActionHash,
    pub since_us: i64,
}
/// New messages in every channel since a moment (at most two weeks back), in one call.
#[hdk_extern]
pub fn channel_updates(input: UpdatesInput) -> ExternResult<Vec<EventView>> {
    local()?;
    let c = &input.community;
    let mut gov = Gov::load(c)?;
    let now = sys_time()?.as_micros();
    let since = input
        .since_us
        .max(now - 14 * DAY_US)
        .max(gov.created_us - DAY_US);
    let mut channels: Vec<String> = vec![GENERAL.to_string()];
    for e in &gov.events {
        if let Body::Channel { id, .. } = &e.data.body {
            if !channels.contains(id) {
                channels.push(id.clone());
            }
        }
    }
    let mut bases = Vec::new();
    for d in since.div_euclid(DAY_US)..=now.div_euclid(DAY_US) {
        for ch in &channels {
            bases.push((
                channel_base(c, ch, &day_of_us(d * DAY_US))?,
                LinkTypes::ChannelMessages,
            ));
        }
    }
    let hashes: Vec<ActionHash> = links_many(bases)?
        .into_iter()
        .filter(|l| l.timestamp.as_micros() > since.saturating_sub(10_000_000))
        .filter_map(|l| l.target.into_action_hash())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut events: Vec<EventView> = get_many(hashes)?
        .iter()
        .filter_map(message_view)
        .filter(|e| &e.data.community == c && e.timestamp_us > input.since_us)
        .collect();
    gov.lineage
        .ensure(c, events.iter().map(|e| e.data.membership.clone()))?;
    events = filter_events(
        events,
        gov.founder(),
        &gov.lineage,
        &gov.grants,
        &BTreeSet::new(),
    );
    events.sort_by_key(|e| (e.timestamp_us, e.hash.clone()));
    Ok(events)
}
