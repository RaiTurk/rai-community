//! Narrow reads and the shared community projection (0.4).
//!
//! `snapshot()` is gone. Every read touches one kind of index; record bodies
//! are fetched in one batched host call. The lineage and authority rules that
//! 0.3 applied to the whole history now apply to each narrow result.
use crate::{local, me};
use hdk::prelude::*;
use rai_integrity::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemberView {
    pub hash: ActionHash,
    pub data: Member,
    pub device: AgentPubKey,
    pub sequence: u32,
    pub timestamp_us: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventView {
    pub hash: ActionHash,
    pub data: AppEvent,
    pub sequence: u32,
    pub timestamp_us: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JoinView {
    pub member_id: String,
    pub invited_by: String,
    pub at_us: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GovState {
    pub community: Community,
    pub created_us: i64,
    pub members: Vec<MemberView>,
    /// Members whose join is not valid under the community's invitation rules.
    pub excluded_members: Vec<String>,
    /// Valid first joins: who invited whom (the invitation tree).
    pub joins: Vec<JoinView>,
    pub events: Vec<EventView>,
    pub excluded_event_count: usize,
    pub sample_percent: u8,
    pub raiunyt_enabled: bool,
}

// ---------------------------------------------------------------- batched reads

pub fn get_many(hashes: Vec<ActionHash>) -> ExternResult<Vec<Record>> {
    if hashes.is_empty() {
        return Ok(vec![]);
    }
    let inputs = hashes
        .into_iter()
        .map(|h| GetInput::new(h.into(), GetOptions::default()))
        .collect();
    Ok(HDK
        .with(|h| h.borrow().get(inputs))?
        .into_iter()
        .flatten()
        .collect())
}
pub fn links_many(bases: Vec<(AnyLinkableHash, LinkTypes)>) -> ExternResult<Vec<Link>> {
    if bases.is_empty() {
        return Ok(vec![]);
    }
    let mut inputs = Vec::new();
    for (base, kind) in bases {
        inputs.push(GetLinksInput::from_query(
            LinkQuery::try_new(base, kind)?,
            GetOptions::default(),
        ));
    }
    Ok(HDK
        .with(|h| h.borrow().get_links(inputs))?
        .into_iter()
        .flatten()
        .collect())
}
fn targets(links: Vec<Link>) -> Vec<ActionHash> {
    let mut seen = BTreeSet::new();
    links
        .into_iter()
        .filter_map(|l| l.target.into_action_hash())
        .filter(|h| seen.insert(h.clone()))
        .collect()
}
pub fn load<T: TryFrom<Entry>>(hash: ActionHash, index: u8) -> ExternResult<(T, Record)> {
    let record = get(hash, GetOptions::default())?.ok_or(fail(
        "Record is not available yet; wait for peer synchronization",
    ))?;
    if !has_type(&record, index) {
        return Err(fail("Wrong entry type"));
    }
    let value = entry_of::<T>(&record).map_err(|_| fail("Invalid public entry"))?;
    Ok((value, record))
}
pub fn event_view(r: &Record) -> Option<EventView> {
    if !has_type(r, EVENT) {
        return None;
    }
    let data: AppEvent = entry_of(r).ok()?;
    Some(EventView {
        hash: r.action_address().clone(),
        data,
        sequence: r.action().action_seq(),
        timestamp_us: r.action().timestamp().as_micros(),
    })
}
pub fn member_view(r: &Record) -> Option<MemberView> {
    if !has_type(r, MEMBER) {
        return None;
    }
    let data: Member = entry_of(r).ok()?;
    Some(MemberView {
        hash: r.action_address().clone(),
        data,
        device: r.action().author().clone(),
        sequence: r.action().action_seq(),
        timestamp_us: r.action().timestamp().as_micros(),
    })
}
/// Events behind `base`, in authored time order.
pub fn events_at(
    bases: Vec<(AnyLinkableHash, LinkTypes)>,
    c: &ActionHash,
) -> ExternResult<Vec<EventView>> {
    let mut out: Vec<EventView> = get_many(targets(links_many(bases)?))?
        .iter()
        .filter_map(event_view)
        .filter(|e| &e.data.community == c)
        .collect();
    out.sort_by_key(|e| (e.timestamp_us, e.hash.clone()));
    Ok(out)
}

// ---------------------------------------------------------------- lineage

/// Device bindings per member, loaded on demand from the identity index.
#[derive(Default)]
pub struct Lineage {
    pub by_hash: BTreeMap<ActionHash, MemberView>,
    pub by_id: BTreeMap<String, Vec<ActionHash>>,
    loaded: BTreeSet<String>,
}
impl Lineage {
    pub fn from_members(members: &[MemberView]) -> Self {
        let mut l = Lineage::default();
        for m in members {
            l.insert(m.clone());
            l.loaded.insert(m.data.member_id.clone());
        }
        l
    }
    fn insert(&mut self, m: MemberView) {
        let ids = self.by_id.entry(m.data.member_id.clone()).or_default();
        if !ids.contains(&m.hash) {
            ids.push(m.hash.clone());
        }
        self.by_hash.insert(m.hash.clone(), m);
    }
    /// Loads every binding of the authors of `memberships` (two batched calls).
    pub fn ensure(
        &mut self,
        c: &ActionHash,
        memberships: impl IntoIterator<Item = ActionHash>,
    ) -> ExternResult<()> {
        let missing: Vec<ActionHash> = memberships
            .into_iter()
            .filter(|h| !self.by_hash.contains_key(h))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        for r in get_many(missing)? {
            if let Some(m) = member_view(&r) {
                self.insert(m);
            }
        }
        let ids: Vec<String> = self
            .by_hash
            .values()
            .map(|m| m.data.member_id.clone())
            .filter(|id| !self.loaded.contains(id))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let mut bases = Vec::new();
        for id in &ids {
            if let Ok(raw) = hex::decode(id) {
                bases.push((
                    ExternalHash::from_raw_32(raw).into(),
                    LinkTypes::IdentityBindings,
                ));
            }
        }
        let known: BTreeSet<ActionHash> = self.by_hash.keys().cloned().collect();
        let fresh: Vec<ActionHash> = targets(links_many(bases)?)
            .into_iter()
            .filter(|h| !known.contains(h))
            .collect();
        for r in get_many(fresh)? {
            if let Some(m) = member_view(&r) {
                if &m.data.community == c {
                    self.insert(m);
                }
            }
        }
        self.loaded.extend(ids);
        Ok(())
    }
    pub fn current(&self, id: &str) -> Option<&MemberView> {
        self.by_id
            .get(id)?
            .iter()
            .filter_map(|h| self.by_hash.get(h))
            .max_by_key(|m| (m.data.generation, m.hash.clone()))
    }
    pub fn member_of(&self, membership: &ActionHash) -> Option<&MemberView> {
        self.by_hash.get(membership)
    }
    /// The 0.3 rule: a record counts when its binding is current, or an ancestor
    /// whose successor's recovery cutoff covers the record.
    pub fn accepts(&self, membership: &ActionHash, sequence: u32) -> bool {
        let Some(binding) = self.by_hash.get(membership) else {
            return false;
        };
        let Some(mut current) = self.current(&binding.data.member_id) else {
            return false;
        };
        if &current.hash == membership {
            return true;
        }
        for _ in 0..64 {
            let Some(parent) = &current.data.previous else {
                return false;
            };
            if parent == membership {
                return current.data.previous_cutoff.is_some_and(|n| sequence <= n);
            }
            let Some(next) = self.by_hash.get(parent) else {
                return false;
            };
            current = next;
        }
        false
    }
}

// ---------------------------------------------------------------- governance

/// Founder-issued grants: the current one per organizer and the full history,
/// so a delegated record counts when it used the grant that was latest *when it
/// was written* (the 0.3 rule: earlier organizer actions stay valid after a change).
#[derive(Default)]
pub struct Grants {
    pub current: BTreeMap<String, (ActionHash, Vec<String>)>,
    pub history: BTreeMap<String, Vec<(i64, ActionHash)>>,
}
impl Grants {
    pub fn get(&self, id: &str) -> Option<&(ActionHash, Vec<String>)> {
        self.current.get(id)
    }
    /// The grant that was latest for this organizer at the given moment.
    pub fn at(&self, id: &str, at_us: i64) -> Option<&ActionHash> {
        self.history
            .get(id)?
            .iter()
            .rev()
            .find(|(t, _)| *t <= at_us)
            .map(|(_, h)| h)
    }
}
pub fn grants_of(founder: &str, lineage: &Lineage, gov: &[EventView]) -> Grants {
    let mut grants = Grants::default();
    for e in gov {
        if lineage
            .member_of(&e.data.membership)
            .is_some_and(|m| m.data.member_id == founder)
        {
            if let Body::AdminGrant {
                member_id,
                permissions,
            } = &e.data.body
            {
                grants
                    .current
                    .insert(member_id.clone(), (e.hash.clone(), permissions.clone()));
                grants
                    .history
                    .entry(member_id.clone())
                    .or_default()
                    .push((e.timestamp_us, e.hash.clone()));
            }
        }
    }
    grants
}
/// Keeps records whose device binding and delegated authority are current.
pub fn filter_records<T>(
    items: Vec<T>,
    founder: &str,
    lineage: &Lineage,
    grants: &Grants,
    key: impl Fn(&T) -> (&ActionHash, u32, &Option<ActionHash>, i64),
    excluded: &BTreeSet<String>,
) -> Vec<T> {
    items
        .into_iter()
        .filter(|item| {
            let (membership, sequence, authority, at_us) = key(item);
            if !lineage.accepts(membership, sequence) {
                return false;
            }
            let Some(author) = lineage.member_of(membership) else {
                return false;
            };
            if excluded.contains(&author.data.member_id) {
                return false;
            }
            if author.data.member_id == founder {
                return true;
            }
            match authority {
                None => true,
                Some(a) => grants.at(&author.data.member_id, at_us) == Some(a),
            }
        })
        .collect()
}
pub fn filter_events(
    events: Vec<EventView>,
    founder: &str,
    lineage: &Lineage,
    grants: &Grants,
    excluded: &BTreeSet<String>,
) -> Vec<EventView> {
    filter_records(
        events,
        founder,
        lineage,
        grants,
        |e| {
            (
                &e.data.membership,
                e.sequence,
                &e.data.authority,
                e.timestamp_us,
            )
        },
        excluded,
    )
}

/// Governance records with their authors' lineage: the context of every write.
pub struct Gov {
    pub hash: ActionHash,
    pub community: Community,
    pub created_us: i64,
    pub lineage: Lineage,
    pub events: Vec<EventView>,
    pub grants: Grants,
    pub excluded: BTreeSet<String>,
}
impl Gov {
    pub fn load(c: &ActionHash) -> ExternResult<Gov> {
        let (community, record) = load::<Community>(c.clone(), COMMUNITY)?;
        let raw = events_at(vec![(governance_base(c)?, LinkTypes::Governance)], c)?;
        let mut lineage = Lineage::default();
        lineage.ensure(c, raw.iter().map(|e| e.data.membership.clone()))?;
        Ok(Gov::from_parts(
            c.clone(),
            community,
            record.action().timestamp().as_micros(),
            lineage,
            raw,
        ))
    }
    pub fn from_parts(
        hash: ActionHash,
        community: Community,
        created_us: i64,
        lineage: Lineage,
        raw: Vec<EventView>,
    ) -> Gov {
        let founder = community.founder.clone();
        // Grants are decided from founder records first, then applied to everything else.
        let founder_events: Vec<EventView> = raw
            .iter()
            .filter(|e| {
                lineage.accepts(&e.data.membership, e.sequence)
                    && lineage
                        .member_of(&e.data.membership)
                        .is_some_and(|m| m.data.member_id == founder)
            })
            .cloned()
            .collect();
        let grants = grants_of(&founder, &lineage, &founder_events);
        let events = filter_events(raw, &founder, &lineage, &grants, &BTreeSet::new());
        Gov {
            hash,
            community,
            created_us,
            lineage,
            events,
            grants,
            excluded: BTreeSet::new(),
        }
    }
    pub fn founder(&self) -> &str {
        &self.community.founder
    }
    pub fn latest<'a>(&'a self, pick: impl Fn(&Body) -> bool) -> Option<&'a EventView> {
        self.events.iter().rev().find(|e| pick(&e.data.body))
    }
    pub fn removed(&self, id: &str) -> bool {
        self.events
            .iter()
            .rev()
            .find_map(|e| match &e.data.body {
                Body::Decision {
                    member_id, removed, ..
                } if member_id == id => Some(*removed),
                Body::BulkDecision {
                    member_ids,
                    removed,
                    ..
                } if member_ids.iter().any(|m| m == id) => Some(*removed),
                _ => None,
            })
            .unwrap_or(false)
    }
    pub fn removed_at(&self, id: &str, before_us: i64) -> bool {
        self.events
            .iter()
            .rev()
            .filter(|e| e.timestamp_us < before_us)
            .find_map(|e| match &e.data.body {
                Body::Decision {
                    member_id, removed, ..
                } if member_id == id => Some(*removed),
                Body::BulkDecision {
                    member_ids,
                    removed,
                    ..
                } if member_ids.iter().any(|m| m == id) => Some(*removed),
                _ => None,
            })
            .unwrap_or(false)
    }
    pub fn role(&self, id: &str) -> Option<ActionHash> {
        self.events
            .iter()
            .rev()
            .find_map(|e| match &e.data.body {
                Body::PeerRole { member_id, enabled } if member_id == id => {
                    Some(if *enabled { Some(e.hash.clone()) } else { None })
                }
                _ => None,
            })
            .flatten()
    }
    pub fn grant(&self, id: &str) -> Option<&(ActionHash, Vec<String>)> {
        self.grants.get(id)
    }
    pub fn may(&self, id: &str, permission: &str) -> bool {
        if id == self.founder() {
            return true;
        }
        if permission == "founder" {
            return false;
        }
        self.grant(id).is_some_and(|(_, p)| {
            if permission == "admin" {
                !p.is_empty()
            } else {
                p.iter().any(|x| x == permission)
            }
        })
    }
    /// Fills `authority` for a delegated organizer, or fails when the member lacks the permission.
    pub fn authorize(&self, id: &str, permission: &str) -> ExternResult<Option<ActionHash>> {
        if id == self.founder() {
            return Ok(None);
        }
        if permission == "founder" {
            return Err(fail(
                "Only the founder can do this / Bunu yalnız kurucu yapabilir",
            ));
        }
        if self.may(id, permission) {
            Ok(self.grant(id).map(|g| g.0.clone()))
        } else {
            Err(fail(
                "Organizer permission required / Yönetici izni gerekli",
            ))
        }
    }
    /// The calling device's current, unrevoked membership.
    pub fn own(&mut self, membership: &ActionHash) -> ExternResult<MemberView> {
        self.lineage.ensure(&self.hash, [membership.clone()])?;
        let m = self
            .lineage
            .member_of(membership)
            .cloned()
            .ok_or(fail("Membership not synchronized"))?;
        if m.device != me()?
            || self.lineage.current(&m.data.member_id).map(|v| &v.hash) != Some(membership)
        {
            return Err(fail(
                "This device is not the current authorized member device",
            ));
        }
        if self.removed(&m.data.member_id) {
            return Err(fail("Community access is revoked"));
        }
        Ok(m)
    }
    pub fn sample_percent(&self) -> u8 {
        self.latest(|b| matches!(b, Body::Sampling { .. }))
            .and_then(|e| match e.data.body {
                Body::Sampling { percent } => Some(percent),
                _ => None,
            })
            .unwrap_or(10)
    }
    /// Who may measure hosting: the founder, reviewers and organizers with the hosting permission.
    pub fn checker_authority(&self, id: &str) -> Option<Option<ActionHash>> {
        if id == self.founder() {
            return Some(None);
        }
        if let Some(role) = self.role(id) {
            return Some(Some(role));
        }
        if self.may(id, "hosting") {
            return Some(self.grant(id).map(|g| g.0.clone()));
        }
        None
    }
}

// ---------------------------------------------------------------- invitations (projection)

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InviteView {
    pub hash: ActionHash,
    pub data: Invite,
    pub timestamp_us: i64,
}
pub fn invite_view(r: &Record) -> Option<InviteView> {
    if !has_type(r, INVITE) {
        return None;
    }
    Some(InviteView {
        hash: r.action_address().clone(),
        data: entry_of(r).ok()?,
        timestamp_us: r.action().timestamp().as_micros(),
    })
}

/// Whether `inviter` may invite at `at_us` under the latest settings recorded before then.
pub fn invite_right(
    gov: &Gov,
    joined: &BTreeMap<String, (String, i64)>,
    inviter: &str,
    at_us: i64,
) -> bool {
    if inviter == gov.founder() || gov.may(inviter, "membership") {
        return true;
    }
    let before = |e: &&EventView| e.timestamp_us < at_us;
    let global = gov
        .events
        .iter()
        .rev()
        .filter(before)
        .find_map(|e| match &e.data.body {
            Body::InviteSettings {
                members_can_invite, ..
            } => Some(*members_can_invite),
            _ => None,
        });
    if global == Some(false) {
        return false;
    }
    let personal = gov
        .events
        .iter()
        .rev()
        .filter(before)
        .find_map(|e| match &e.data.body {
            Body::InviteAccess { member_id, enabled } if member_id == inviter => {
                Some((*enabled, e.timestamp_us))
            }
            _ => None,
        });
    if personal.is_some_and(|(enabled, _)| !enabled) {
        return false;
    }
    // Two removed invitees pause the right until an organizer turns it back on.
    let reopened = personal
        .filter(|(enabled, _)| *enabled)
        .map(|(_, t)| t)
        .unwrap_or(i64::MIN);
    let removed = joined
        .iter()
        .filter(|(id, (by, _))| by == inviter && gov.removed_at(id, at_us))
        .filter(|(id, _)| {
            gov.events.iter().any(|e| {
                e.timestamp_us < at_us
                    && e.timestamp_us > reopened
                    && match &e.data.body {
                        Body::Decision {
                            member_id,
                            removed: true,
                            ..
                        } => &member_id == id,
                        Body::BulkDecision {
                            member_ids,
                            removed: true,
                            ..
                        } => member_ids.iter().any(|m| &m == id),
                        _ => false,
                    }
            })
        })
        .count();
    removed < 2
}

/// Decides which first-generation joins are valid; everyone recomputes the same result.
pub fn excluded_members(
    gov: &Gov,
    members: &[MemberView],
    invites: &BTreeMap<ActionHash, (Option<InviteView>, Option<EventView>)>,
) -> (BTreeSet<String>, BTreeMap<String, (String, i64)>) {
    let mut excluded = BTreeSet::new();
    let mut joined: BTreeMap<String, (String, i64)> = BTreeMap::new();
    let mut first: Vec<&MemberView> = members.iter().filter(|m| m.data.generation == 0).collect();
    first.sort_by_key(|m| (m.timestamp_us, m.hash.clone()));
    let mut uses: BTreeMap<ActionHash, u32> = BTreeMap::new();
    let gate_at = |at: i64| {
        gov.events
            .iter()
            .rev()
            .filter(|e| e.timestamp_us < at)
            .find_map(|e| match &e.data.body {
                Body::Gate { open } => Some(*open),
                _ => None,
            })
    };
    let revoked_before = |at: i64| {
        gov.events
            .iter()
            .rev()
            .filter(|e| e.timestamp_us < at)
            .find_map(|e| match &e.data.body {
                Body::InviteSettings {
                    revoke_before_us, ..
                } => Some(*revoke_before_us),
                _ => None,
            })
    };
    let campaign_state = |hash: &ActionHash, at: i64| {
        gov.events
            .iter()
            .find(|e| &e.hash == hash && e.timestamp_us < at)
            .cloned()
    };
    for m in first {
        let id = m.data.member_id.clone();
        if id == gov.founder() || joined.contains_key(&id) {
            continue;
        }
        let ok = match (&m.data.invitation, &m.data.gate) {
            (None, Some(_)) => gate_at(m.timestamp_us) == Some(true),
            (Some(i), None) => match invites.get(i) {
                Some((Some(inv), _)) => {
                    let n = uses.entry(i.clone()).or_default();
                    *n += 1;
                    let inviter = gov
                        .lineage
                        .member_of(&inv.data.membership)
                        .map(|v| v.data.member_id.clone())
                        .unwrap_or_default();
                    let ok = *n == 1
                        && m.timestamp_us <= inv.data.expires_at_us
                        && revoked_before(m.timestamp_us).is_none_or(|r| inv.timestamp_us >= r)
                        && !gov.removed_at(&inviter, inv.timestamp_us)
                        && invite_right(gov, &joined, &inviter, inv.timestamp_us);
                    if ok {
                        joined.insert(id.clone(), (inviter, m.timestamp_us));
                    }
                    ok
                }
                Some((None, Some(code))) => {
                    match (&code.data.body, campaign_state(&code.hash, m.timestamp_us)) {
                        (
                            Body::CampaignCode {
                                max_uses,
                                expires_at_us,
                                active: true,
                            },
                            Some(_),
                        ) => {
                            let n = uses.entry(i.clone()).or_default();
                            *n += 1;
                            let closed = gov.events.iter().any(|e| {
                            e.timestamp_us < m.timestamp_us
                                && e.timestamp_us > code.timestamp_us
                                && matches!(&e.data.body, Body::Module { module, kind, payload, .. }
                                    if module == "invites" && kind == "campaign-close" && payload == &code.hash.to_string())
                        });
                            let ok = *n <= *max_uses && m.timestamp_us <= *expires_at_us && !closed;
                            if ok {
                                joined.insert(
                                    id.clone(),
                                    (gov.founder().to_string(), m.timestamp_us),
                                );
                            }
                            ok
                        }
                        _ => false,
                    }
                }
                _ => false,
            },
            _ => false,
        };
        if !ok {
            excluded.insert(id);
        }
    }
    // A member stays valid once a valid first binding exists.
    for id in joined.keys() {
        excluded.remove(id);
    }
    (excluded, joined)
}

/// Members, invitation projection and governance records. The interface caches it.
#[hdk_extern]
pub fn governance_state(c: ActionHash) -> ExternResult<GovState> {
    local()?;
    let (community, record) = load::<Community>(c.clone(), COMMUNITY)?;
    let members: Vec<MemberView> = get_many(targets(links_many(vec![(
        c.clone().into(),
        LinkTypes::CommunityMembers,
    )])?))?
    .iter()
    .filter_map(member_view)
    .filter(|m| m.data.community == c)
    .collect();
    let lineage = Lineage::from_members(&members);
    let raw = events_at(vec![(governance_base(&c)?, LinkTypes::Governance)], &c)?;
    let before = raw.len();
    let mut gov = Gov::from_parts(
        c.clone(),
        community,
        record.action().timestamp().as_micros(),
        lineage,
        raw,
    );
    let invitation_hashes: Vec<ActionHash> = members
        .iter()
        .filter_map(|m| m.data.invitation.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut invites = BTreeMap::new();
    for r in get_many(invitation_hashes)? {
        invites.insert(
            r.action_address().clone(),
            (invite_view(&r), event_view(&r)),
        );
    }
    let inviters: Vec<ActionHash> = invites
        .values()
        .filter_map(|(i, _)| i.as_ref().map(|v| v.data.membership.clone()))
        .collect();
    gov.lineage.ensure(&c, inviters)?;
    let (excluded, joined) = excluded_members(&gov, &members, &invites);
    gov.excluded = excluded.clone();
    let joins = joined
        .into_iter()
        .map(|(member_id, (invited_by, at_us))| JoinView {
            member_id,
            invited_by,
            at_us,
        })
        .collect();
    let events = filter_events(
        gov.events.clone(),
        gov.founder(),
        &gov.lineage,
        &gov.grants,
        &excluded,
    );
    let sample_percent = gov.sample_percent();
    Ok(GovState {
        community: gov.community.clone(),
        created_us: gov.created_us,
        members,
        excluded_members: excluded.into_iter().collect(),
        joins,
        excluded_event_count: before - events.len(),
        events,
        sample_percent,
        raiunyt_enabled: true,
    })
}

/// Validity of one membership for the joining flow and the write path.
pub fn member_excluded(gov: &mut Gov, m: &MemberView) -> ExternResult<bool> {
    if m.data.member_id == gov.founder() {
        return Ok(false);
    }
    // Load the member's first binding and everyone else who used the same invitation.
    let first = {
        gov.lineage.ensure(&gov.hash.clone(), [m.hash.clone()])?;
        let ids = gov
            .lineage
            .by_id
            .get(&m.data.member_id)
            .cloned()
            .unwrap_or_default();
        ids.iter()
            .filter_map(|h| gov.lineage.by_hash.get(h))
            .filter(|v| v.data.generation == 0)
            .min_by_key(|v| (v.timestamp_us, v.hash.clone()))
            .cloned()
    };
    let Some(first) = first else { return Ok(true) };
    let mut members = vec![first.clone()];
    let mut invites = BTreeMap::new();
    if let Some(i) = &first.data.invitation {
        for r in get_many(vec![i.clone()])? {
            invites.insert(
                r.action_address().clone(),
                (invite_view(&r), event_view(&r)),
            );
        }
        for r in get_many(targets(links_many(vec![(
            i.clone().into(),
            LinkTypes::InvitationUses,
        )])?))? {
            if let Some(v) = member_view(&r) {
                if v.hash != first.hash && v.data.community == first.data.community {
                    members.push(v);
                }
            }
        }
        let inviters: Vec<ActionHash> = invites
            .values()
            .filter_map(|(i, _)| i.as_ref().map(|v| v.data.membership.clone()))
            .collect();
        gov.lineage.ensure(&gov.hash.clone(), inviters)?;
    }
    let (excluded, _) = excluded_members(gov, &members, &invites);
    Ok(excluded.contains(&m.data.member_id))
}
