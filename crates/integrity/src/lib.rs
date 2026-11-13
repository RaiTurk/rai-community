//! Rai Community 0.4 network rules.
//!
//! Every rule that would cause harm when bypassed by a modified client lives
//! here. Rules that need the *latest* community state (a later revocation, a
//! later gate change, the second use of a single-use invitation) cannot be
//! decided by immutable validation; the shared projection in the coordinator
//! and the interface applies them the same way for everyone.
use hdi::hash_path::path::Path;
use hdi::prelude::*;
use sha2::{Digest, Sha256};

pub mod time;
pub use time::*;

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Community {
    pub name: String,
    pub founder: String,
}

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Member {
    pub community: ActionHash,
    /// Ed25519 recovery public key, hex. Never a secret or a social handle.
    pub member_id: String,
    pub generation: u32,
    pub previous: Option<ActionHash>,
    /// Recovery signs the last accepted sequence of the prior device chain.
    pub previous_cutoff: Option<u32>,
    /// A personal `Invite` record or a founder's `CampaignCode` event.
    pub invitation: Option<ActionHash>,
    /// A founder's `Gate { open: true }` event when joining without an invitation.
    #[serde(default)]
    pub gate: Option<ActionHash>,
    pub name: String,
    pub recovery_signature: Vec<u8>,
}

/// Permissions the founder can grant to other members (0.4: eight).
pub const PERMISSIONS: [&str; 8] = [
    "tasks",
    "goals",
    "channels",
    "reviewers",
    "membership",
    "sampling",
    "hosting",
    "release",
];
pub const TASK_DESCRIPTION_CHARS: usize = 10_000;
pub const MESSAGE_CHARS: usize = 400;
pub const MESSAGE_ID_BYTES: usize = 16;
pub const MODULE_PAYLOAD_CHARS: usize = 16_000;
pub const MESSAGE_INTERVAL_US: i64 = 5_000_000;
pub const NEW_ACCOUNT_MESSAGE_INTERVAL_US: i64 = 60_000_000;
pub const NEW_ACCOUNT_US: i64 = 3 * DAY_US;
pub const INVITE_LIFETIME_US: i64 = 7 * DAY_US;
pub const CAMPAIGN_LIFETIME_US: i64 = 90 * DAY_US;
pub const DEFAULT_INVITE_WAIT_DAYS: u8 = 7;
pub const DEFAULT_INVITES_PER_WEEK: u16 = 3;
pub const DEFAULT_ORGANIZER_INVITES_PER_WEEK: u16 = 50;
pub const SUMMARY_MAX_HOURS: usize = 72;
pub const SUMMARY_GRACE_US: i64 = 3 * DAY_US;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Body {
    /// Read-only view of a `MessageEntry`; never valid inside an `AppEvent`.
    Message {
        id: Vec<u8>,
        text: String,
        #[serde(default)]
        channel: Option<ActionHash>,
    },
    /// Versioned by `id`; the latest version wins in projections.
    Channel {
        id: String,
        name: String,
        admins_only: bool,
        archived: bool,
    },
    /// Founder only. Empty `permissions` revokes every admin permission.
    AdminGrant {
        member_id: String,
        permissions: Vec<String>,
    },
    PeerRole {
        member_id: String,
        enabled: bool,
    },
    Sampling {
        percent: u8,
    },
    /// Empty `post_url` is a task without an X link; its only action is `done`.
    Task {
        id: String,
        title: String,
        description: String,
        post_url: String,
        actions: Vec<String>,
        archived: bool,
    },
    Goal {
        id: String,
        title: String,
        target: Option<u64>,
        current: Option<u64>,
        unit: String,
        context: String,
        archived: bool,
    },
    XClaim {
        handle: String,
        post_url: String,
        challenge: String,
    },
    XVerify {
        claim: ActionHash,
        role: ActionHash,
        note: String,
    },
    Claim {
        task: ActionHash,
        #[serde(default)]
        x_verification: Option<ActionHash>,
        actions: Vec<String>,
        #[serde(default)]
        sampling: Option<ActionHash>,
        #[serde(default)]
        note: String,
    },
    Flag {
        claim: ActionHash,
        reason: String,
    },
    Review {
        claim: ActionHash,
        role: ActionHash,
        outcome: String,
        note: String,
    },
    Decision {
        member_id: String,
        removed: bool,
        references: Vec<ActionHash>,
        reason: String,
    },
    /// One decision for a member and the members they invited (each listed and confirmed).
    BulkDecision {
        member_ids: Vec<String>,
        removed: bool,
        references: Vec<ActionHash>,
        reason: String,
    },
    /// 0.4: the member's display name comes from the membership record.
    HostOffer {
        enabled: bool,
    },
    /// Hourly hosting reward multipliers: index 0 applies when one host was reachable in the hour,
    /// index 1 when two were, and so on; any larger count earns ×1.
    HostingPolicy {
        multipliers: Vec<u8>,
    },
    /// Generic, versioned record; each admin kind is bound to one permission.
    Module {
        module: String,
        version: u16,
        kind: String,
        payload: String,
        admin: bool,
    },
    /// Founder only: the community trial card.
    TrialCard {
        title_tr: String,
        title_en: String,
        target: u64,
        hidden: bool,
    },
    /// Founder only: `open` lets people join without an invitation.
    Gate {
        open: bool,
    },
    /// Membership permission: member invitations on/off; invitations created before
    /// `revoke_before_us` stop counting.
    InviteSettings {
        members_can_invite: bool,
        revoke_before_us: i64,
    },
    /// Membership permission: one member's invitation right.
    InviteAccess {
        member_id: String,
        enabled: bool,
    },
    /// Founder only.
    InviteQuota {
        wait_days: u8,
        per_week: u16,
        organizer_per_week: u16,
    },
    /// Founder only: a multi-use campaign code.
    CampaignCode {
        max_uses: u32,
        expires_at_us: i64,
        active: bool,
    },
}

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct AppEvent {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub body: Body,
    /// The author's AdminGrant when acting with delegated authority. Founder actions leave it empty.
    #[serde(default)]
    pub authority: Option<ActionHash>,
}

/// A chat message: its own entry type so the network can rate-limit it from the author's chain.
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct MessageEntry {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub channel: Option<ActionHash>,
    /// 16 random bytes.
    pub id: Vec<u8>,
    pub text: String,
    #[serde(default)]
    pub authority: Option<ActionHash>,
}

/// A single-use personal invitation, valid for 7 days.
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Invite {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub expires_at_us: i64,
    /// The `InviteSettings` the author relies on (none = default: members may invite).
    pub settings: Option<ActionHash>,
    /// The `InviteQuota` the author relies on (none = defaults).
    pub quota: Option<ActionHash>,
    #[serde(default)]
    pub authority: Option<ActionHash>,
}

/// One verified hosting hour, signed by the host device and an authorized checker.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HourProof {
    pub hour_us: i64,
    pub nonce: Vec<u8>,
    pub host_signature: Vec<u8>,
    pub full_copy: bool,
    pub observed_at_us: i64,
    /// The checker's membership record; its author is the signing device.
    pub checker: ActionHash,
    /// The checker's PeerRole, or a founder AdminGrant with `hosting`; none for the founder.
    pub checker_authority: Option<ActionHash>,
    pub checker_signature: Vec<u8>,
}

/// A host publishes its verified hours about every 6 hours (plan G1).
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct HostingSummary {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub offer: ActionHash,
    pub hours: Vec<HourProof>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    Community(Community),
    Member(Member),
    Event(AppEvent),
    Message(MessageEntry),
    Invite(Invite),
    HostingSummary(HostingSummary),
}
pub const COMMUNITY: u8 = 0;
pub const MEMBER: u8 = 1;
pub const EVENT: u8 = 2;
pub const MESSAGE: u8 = 3;
pub const INVITE: u8 = 4;
pub const SUMMARY: u8 = 5;

#[hdk_link_types]
pub enum LinkTypes {
    CommunityMembers,
    IdentityBindings,
    ChannelMessages,
    Governance,
    Tasks,
    Goals,
    MemberActivity,
    ReviewQueue,
    HostOffers,
    HostingProofs,
    InvitationUses,
}

// ---------------------------------------------------------------- indexes

pub const GENERAL: &str = "general";
fn path_hash(parts: &[&str]) -> ExternResult<AnyLinkableHash> {
    Ok(Path::from(format!("rai4.{}", parts.join(".")))
        .path_entry_hash()?
        .into())
}
pub fn channel_base(c: &ActionHash, channel_id: &str, day: &str) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "ch", channel_id, day])
}
pub fn governance_base(c: &ActionHash) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "gov"])
}
pub fn tasks_base(c: &ActionHash) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "tasks"])
}
pub fn goals_base(c: &ActionHash) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "goals"])
}
pub fn member_base(c: &ActionHash, member_id: &str) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "m", member_id])
}
pub fn review_base(c: &ActionHash, day: &str) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "reviews", day])
}
pub fn hosts_base(c: &ActionHash) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "hosts"])
}
pub fn proof_base(c: &ActionHash, member_id: &str, month: &str) -> ExternResult<AnyLinkableHash> {
    path_hash(&[&c.to_string(), "proof", member_id, month])
}

/// Which index a governance-like event belongs to.
pub fn event_index(body: &Body) -> Option<LinkTypes> {
    Some(match body {
        Body::Task { .. } => LinkTypes::Tasks,
        Body::Goal { .. } => LinkTypes::Goals,
        Body::HostOffer { .. } => LinkTypes::HostOffers,
        Body::Claim { .. } | Body::XClaim { .. } | Body::Flag { .. } => LinkTypes::MemberActivity,
        Body::Review { .. } | Body::XVerify { .. } => LinkTypes::ReviewQueue,
        Body::Message { .. } => return None,
        _ => LinkTypes::Governance,
    })
}
/// Claims, account claims and reports are also listed in the day's review bucket.
pub fn also_reviewed(body: &Body) -> bool {
    matches!(
        body,
        Body::Claim { .. } | Body::XClaim { .. } | Body::Flag { .. }
    )
}

// ---------------------------------------------------------------- permissions

/// Which delegated permission an event needs. `Some("admin")` means any admin; `None` means any member.
pub fn required_permission(body: &Body) -> Option<&'static str> {
    match body {
        Body::Task { .. } => Some("tasks"),
        Body::Goal { .. } => Some("goals"),
        Body::Channel { .. } => Some("channels"),
        Body::PeerRole { .. } => Some("reviewers"),
        Body::Decision { .. } | Body::BulkDecision { .. } => Some("membership"),
        Body::InviteSettings { .. } | Body::InviteAccess { .. } => Some("membership"),
        Body::Sampling { .. } => Some("sampling"),
        Body::HostingPolicy { .. } => Some("hosting"),
        Body::AdminGrant { .. }
        | Body::TrialCard { .. }
        | Body::Gate { .. }
        | Body::InviteQuota { .. }
        | Body::CampaignCode { .. } => Some("founder"),
        Body::Module {
            module,
            kind,
            admin: true,
            ..
        } => Some(module_permission(module, kind)),
        _ => None,
    }
}
/// 0.4 narrows organizer modules: each admin kind needs one specific permission.
pub fn module_permission(module: &str, kind: &str) -> &'static str {
    match (module, kind) {
        ("community-ui", "task-star" | "task-pin") => "tasks",
        ("community-ui", "goal-status") => "goals",
        ("community-ui", "windows-release-auto") => "release",
        _ => "founder",
    }
}
pub fn valid_permissions(p: &[String]) -> bool {
    p.len() <= PERMISSIONS.len()
        && p.iter().all(|x| PERMISSIONS.contains(&x.as_str()))
        && p.iter().collect::<std::collections::BTreeSet<_>>().len() == p.len()
}
pub fn valid_slug(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

// ---------------------------------------------------------------- helpers

pub fn fail(s: impl Into<String>) -> WasmError {
    wasm_error!(WasmErrorInner::Guest(s.into()))
}
fn invalid(s: impl Into<String>) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(s.into()))
}
fn valid() -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn has_type(record: &Record, index: u8) -> bool {
    matches!(record.action().entry_type(),Some(EntryType::App(t)) if t.zome_index.0==0 && t.entry_index.0==index)
}
pub fn typed<T: TryFrom<Entry>>(hash: ActionHash, index: u8) -> ExternResult<(T, Record)> {
    let record = must_get_valid_record(hash)?;
    if !has_type(&record, index) {
        return Err(fail("Wrong referenced entry type"));
    }
    let entry = record
        .entry()
        .as_option()
        .cloned()
        .ok_or(fail("Missing public entry"))?;
    let data = T::try_from(entry).map_err(|_| fail("Invalid referenced data"))?;
    Ok((data, record))
}
pub fn community(hash: ActionHash) -> ExternResult<Community> {
    Ok(typed::<Community>(hash, COMMUNITY)?.0)
}
pub fn member(hash: ActionHash) -> ExternResult<(Member, Record)> {
    typed(hash, MEMBER)
}
pub fn event(hash: ActionHash) -> ExternResult<(AppEvent, Record)> {
    typed(hash, EVENT)
}
pub fn valid_member_id(s: &str) -> bool {
    s.len() == 64 && hex::decode(s).is_ok()
}
pub fn binding_message(m: &Member, device: &AgentPubKey) -> String {
    format!(
        "rai-community/member/v2\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        m.community,
        m.member_id,
        device,
        m.generation,
        m.previous
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default(),
        m.previous_cutoff.map(|n| n.to_string()).unwrap_or_default(),
        m.invitation
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default(),
        m.gate.as_ref().map(ToString::to_string).unwrap_or_default(),
        m.name
    )
}
/// What the host device signs when it answers a hosting challenge.
pub fn echo_message(offer: &ActionHash, nonce: &[u8], hour_us: i64) -> Vec<u8> {
    format!(
        "rai-community/echo/v1\n{offer}\n{}\n{hour_us}",
        hex::encode(nonce)
    )
    .into_bytes()
}
/// What the host device signs over the storage challenge (kept by the checker only).
pub fn storage_message(nonce: &[u8], digests: &[Vec<u8>]) -> Vec<u8> {
    let mut out = format!("rai-community/storage/v1\n{}\n", hex::encode(nonce)).into_bytes();
    for d in digests {
        out.extend_from_slice(hex::encode(d).as_bytes());
        out.push(b'\n');
    }
    out
}
/// What the checker device signs for one verified hour.
pub fn attest_message(c: &ActionHash, offer: &ActionHash, p: &HourProof) -> Vec<u8> {
    format!(
        "rai-community/attest/v1\n{c}\n{offer}\n{}\n{}\n{}\n{}\n{}",
        p.hour_us,
        hex::encode(&p.nonce),
        hex::encode(&p.host_signature),
        p.full_copy,
        p.observed_at_us
    )
    .into_bytes()
}
pub fn sampled(member_id: &str, task_id: &str, percent: u8) -> bool {
    let hash =
        Sha256::digest(format!("rai-community/sample/v1\n{member_id}\n{task_id}").as_bytes());
    u16::from_be_bytes([hash[0], hash[1]]) % 100 < percent as u16
}
pub fn post_url(s: &str) -> bool {
    let Some(path) = s
        .strip_prefix("https://x.com/")
        .or_else(|| s.strip_prefix("https://twitter.com/"))
    else {
        return false;
    };
    let parts: Vec<_> = path.split('/').collect();
    parts.len() == 3
        && !parts[0].is_empty()
        && parts[0].len() <= 15
        && parts[0]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        && parts[1] == "status"
        && !parts[2].is_empty()
        && parts[2].chars().all(|c| c.is_ascii_digit())
}
pub fn valid_actions(actions: &[String]) -> bool {
    !actions.is_empty()
        && actions.len() <= 4
        && actions
            .iter()
            .all(|a| ["like", "repost", "quote", "reply"].contains(&a.as_str()))
        && actions
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            == actions.len()
}
/// A task with an X link uses X actions; a task without a link has the single action `done`.
pub fn valid_task_actions(url: &str, actions: &[String]) -> bool {
    if url.is_empty() {
        actions.len() == 1 && actions[0] == "done"
    } else {
        post_url(url) && valid_actions(actions)
    }
}
/// New accounts may not post links: a scheme, `www.` or a `name.tld` token.
pub fn contains_link(text: &str) -> bool {
    let lower = text.to_lowercase();
    if lower.contains("://") || lower.contains("www.") {
        return true;
    }
    lower
        .split(|c: char| c.is_whitespace() || "()[]<>\"'«»,;!?".contains(c))
        .any(|token| {
            let token = token
                .split('/')
                .next()
                .unwrap_or_default()
                .trim_end_matches('.');
            let Some((head, tld)) = token.rsplit_once('.') else {
                return false;
            };
            !head.is_empty()
                && head
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '.' || c == '/')
                && (2..=24).contains(&tld.len())
                && tld.chars().all(|c| c.is_ascii_alphabetic())
        })
}

fn scoped_event(hash: ActionHash, c: &ActionHash) -> ExternResult<AppEvent> {
    let (e, _) = event(hash)?;
    if &e.community != c {
        return Err(fail("Cross-community reference"));
    }
    Ok(e)
}
/// Founder always qualifies. Others must reference a founder-issued AdminGrant for themselves that
/// contains `permission` ("admin" accepts any non-empty grant). Whether that grant was later revoked
/// is decided by the shared projection, not by immutable validation.
fn authorized_with(
    c: &Community,
    community_hash: &ActionHash,
    authority: &Option<ActionHash>,
    who: &Member,
    permission: &str,
) -> ExternResult<bool> {
    if who.member_id == c.founder {
        return Ok(true);
    }
    if permission == "founder" {
        return Ok(false);
    }
    let Some(grant) = authority.clone() else {
        return Ok(false);
    };
    let g = scoped_event(grant, community_hash)?;
    let (issuer, _) = member(g.membership)?;
    if issuer.member_id != c.founder {
        return Ok(false);
    }
    Ok(match g.body {
        Body::AdminGrant {
            member_id,
            permissions,
        } => {
            member_id == who.member_id
                && if permission == "admin" {
                    !permissions.is_empty()
                } else {
                    permissions.iter().any(|p| p == permission)
                }
        }
        _ => false,
    })
}
fn check_role(role: ActionHash, who: &Member) -> ExternResult<()> {
    let (grant, _) = event(role)?;
    if grant.community != who.community {
        return Err(fail("Role belongs to another community"));
    }
    let (issuer, _) = member(grant.membership.clone())?;
    let c = community(grant.community.clone())?;
    if !authorized_with(&c, &grant.community, &grant.authority, &issuer, "reviewers")? {
        return Err(fail("Role was not granted by an authorized organizer"));
    }
    match grant.body {
        Body::PeerRole {
            member_id,
            enabled: true,
        } if member_id == who.member_id => Ok(()),
        _ => Err(fail("Wrong reviewer role")),
    }
}
/// Timestamp of the member's first device binding (account age survives recovery).
fn account_start(m: &Member, record: &Record) -> ExternResult<Timestamp> {
    let mut ts = record.action().timestamp();
    let mut previous = m.previous.clone();
    for _ in 0..32 {
        let Some(p) = previous else { break };
        let (old, old_record) = member(p)?;
        ts = old_record.action().timestamp();
        previous = old.previous;
    }
    Ok(ts)
}
/// Creates of `entry_index` the author wrote in the `window_us` before `action`.
fn recent_of_type(action: &Action, entry_index: u8, window_us: i64) -> ExternResult<usize> {
    let Some(prev) = action.prev_action().cloned() else {
        return Ok(0);
    };
    let threshold = Timestamp::from_micros(action.timestamp().as_micros() - window_us);
    let previous = must_get_action(prev.clone())?;
    if previous.action().timestamp() < threshold {
        return Ok(0);
    }
    let activity = must_get_agent_activity(
        action.author().clone(),
        ChainFilter::until_timestamp(prev, threshold),
    )?;
    Ok(activity
        .iter()
        .filter(|a| {
            let act = &a.action.hashed.content;
            act.timestamp() >= threshold
                && act.action_type() == ActionType::Create
                && matches!(act.entry_type(), Some(EntryType::App(t)) if t.zome_index.0 == 0 && t.entry_index.0 == entry_index)
        })
        .count())
}

// ---------------------------------------------------------------- entries

fn validate_member(m: Member, a: &Action) -> ExternResult<ValidateCallbackResult> {
    let c = community(m.community.clone())?;
    if !valid_member_id(&m.member_id)
        || m.name.trim().is_empty()
        || m.name.len() > 100
        || m.recovery_signature.len() != 64
    {
        return invalid("Invalid membership or recovery proof");
    }
    let raw = hex::decode(&m.member_id).map_err(|_| fail("Bad recovery key"))?;
    let sig: [u8; 64] = m
        .recovery_signature
        .clone()
        .try_into()
        .map_err(|_| fail("Bad signature length"))?;
    if !verify_signature_raw(
        AgentPubKey::from_raw_32(raw),
        Signature(sig),
        binding_message(&m, a.author()).as_bytes().to_vec(),
    )? {
        return invalid("Recovery signature does not authorize this device");
    }
    if m.generation == 0 {
        if m.previous.is_some() || m.previous_cutoff.is_some() {
            return invalid("Initial membership has no previous device");
        }
        match (&m.invitation, &m.gate) {
            (Some(i), None) => {
                if let Err(e) = validate_invitation(i.clone(), &m, a) {
                    return invalid(format!("{e:?}"));
                }
            }
            (None, Some(g)) => {
                let gate = scoped_event(g.clone(), &m.community)?;
                let (issuer, _) = member(gate.membership)?;
                if issuer.member_id != c.founder || !matches!(gate.body, Body::Gate { open: true })
                {
                    return invalid("Joining without an invitation needs the founder's open gate");
                }
            }
            (None, None) if m.member_id == c.founder => {}
            (None, None) => {
                return invalid("An invitation is required to join / Katılmak için davet gerekli")
            }
            (Some(_), Some(_)) => return invalid("Use either an invitation or the open gate"),
        }
    } else {
        let Some(previous) = m.previous.clone() else {
            return invalid("Recovery needs a previous membership");
        };
        let (old, old_record) = member(previous)?;
        if old.community != m.community
            || old.member_id != m.member_id
            || old.generation.checked_add(1) != Some(m.generation)
            || m.invitation.is_some()
            || m.gate.is_some()
            || m.previous_cutoff
                .is_none_or(|n| n < old_record.action().action_seq())
        {
            return invalid("Invalid device recovery lineage");
        }
    }
    valid()
}
fn validate_invitation(i: ActionHash, m: &Member, a: &Action) -> ExternResult<()> {
    let record = must_get_valid_record(i)?;
    let ts = a.timestamp().as_micros();
    if has_type(&record, INVITE) {
        let invite: Invite = entry_of(&record)?;
        let (inviter, _) = member(invite.membership.clone())?;
        if invite.community != m.community
            || ts > invite.expires_at_us
            || inviter.member_id == m.member_id
        {
            return Err(fail(
                "The invitation is expired or belongs to another community",
            ));
        }
        return Ok(());
    }
    if has_type(&record, EVENT) {
        let e: AppEvent = entry_of(&record)?;
        if let Body::CampaignCode {
            expires_at_us,
            active: true,
            ..
        } = e.body
        {
            let c = community(e.community.clone())?;
            let (issuer, _) = member(e.membership)?;
            if e.community == m.community && issuer.member_id == c.founder && ts <= expires_at_us {
                return Ok(());
            }
        }
    }
    Err(fail("Invalid invitation"))
}

fn validate_message(msg: MessageEntry, a: &Action) -> ExternResult<ValidateCallbackResult> {
    let c = community(msg.community.clone())?;
    let (m, record) = member(msg.membership.clone())?;
    if m.community != msg.community || record.action().author() != a.author() {
        return invalid("Only the authorized device can act for this member");
    }
    if msg.authority.is_some() && m.member_id == c.founder {
        return invalid("The founder acts without a delegated grant");
    }
    if msg.id.len() != MESSAGE_ID_BYTES
        || msg.text.trim().is_empty()
        || msg.text.chars().count() > MESSAGE_CHARS
    {
        return invalid("A message needs 1–400 characters / Mesaj 1–400 karakter olmalı");
    }
    if let Some(ch) = msg.channel.clone() {
        let Body::Channel {
            admins_only,
            archived,
            ..
        } = scoped_event(ch, &msg.community)?.body
        else {
            return invalid("Not a channel");
        };
        if archived {
            return invalid("This channel is closed");
        }
        if admins_only && !authorized_with(&c, &msg.community, &msg.authority, &m, "admin")? {
            return invalid("Only organizers can write in this channel");
        }
    }
    let fresh = m.member_id != c.founder
        && a.timestamp().as_micros() - account_start(&m, &record)?.as_micros() < NEW_ACCOUNT_US;
    if fresh && contains_link(&msg.text) {
        return invalid(
            "New accounts cannot post links for 3 days / Yeni hesaplar 3 gün bağlantı paylaşamaz",
        );
    }
    let window = if fresh {
        NEW_ACCOUNT_MESSAGE_INTERVAL_US
    } else {
        MESSAGE_INTERVAL_US
    };
    if recent_of_type(a, MESSAGE, window)? > 0 {
        return invalid(if fresh {
            "New accounts wait 60 seconds between messages / Yeni hesaplar mesajlar arasında 60 saniye bekler"
        } else {
            "Please wait 5 seconds between messages / Mesajlar arasında 5 saniye bekle"
        });
    }
    valid()
}

fn validate_invite(inv: Invite, a: &Action) -> ExternResult<ValidateCallbackResult> {
    let c = community(inv.community.clone())?;
    let (m, record) = member(inv.membership.clone())?;
    if m.community != inv.community || record.action().author() != a.author() {
        return invalid("Only the authorized device can act for this member");
    }
    let now = a.timestamp().as_micros();
    if inv.expires_at_us <= now || inv.expires_at_us > now + INVITE_LIFETIME_US + 60_000_000 {
        return invalid("An invitation is valid for up to 7 days");
    }
    if m.member_id == c.founder {
        return valid();
    }
    let organizer = authorized_with(&c, &inv.community, &inv.authority, &m, "admin")?;
    let moderator = authorized_with(&c, &inv.community, &inv.authority, &m, "membership")?;
    if let Some(s) = inv.settings.clone() {
        let e = scoped_event(s, &inv.community)?;
        let (issuer, _) = member(e.membership.clone())?;
        let Body::InviteSettings {
            members_can_invite, ..
        } = e.body
        else {
            return invalid("Not invitation settings");
        };
        if !authorized_with(&c, &inv.community, &e.authority, &issuer, "membership")? {
            return invalid("Invitation settings need the membership permission");
        }
        if !members_can_invite && !moderator {
            return invalid("Member invitations are turned off / Üye davetleri kapalı");
        }
    }
    let (mut wait_days, mut per_week, mut organizer_per_week) = (
        DEFAULT_INVITE_WAIT_DAYS,
        DEFAULT_INVITES_PER_WEEK,
        DEFAULT_ORGANIZER_INVITES_PER_WEEK,
    );
    if let Some(q) = inv.quota.clone() {
        let e = scoped_event(q, &inv.community)?;
        let (issuer, _) = member(e.membership)?;
        let Body::InviteQuota {
            wait_days: w,
            per_week: p,
            organizer_per_week: o,
        } = e.body
        else {
            return invalid("Not an invitation quota");
        };
        if issuer.member_id != c.founder {
            return invalid("Only the founder sets invitation quotas");
        }
        (wait_days, per_week, organizer_per_week) = (w, p, o);
    }
    if !organizer && now - account_start(&m, &record)?.as_micros() < wait_days as i64 * DAY_US {
        return invalid(
            "New members invite after their first week / Yeni üyeler ilk haftadan sonra davet eder",
        );
    }
    let limit = if organizer {
        organizer_per_week
    } else {
        per_week
    } as usize;
    if recent_of_type(a, INVITE, 7 * DAY_US)? >= limit {
        return invalid("Weekly invitation limit reached / Haftalık davet sınırı doldu");
    }
    valid()
}

fn validate_summary(s: HostingSummary, a: &Action) -> ExternResult<ValidateCallbackResult> {
    let c = community(s.community.clone())?;
    let (host, record) = member(s.membership.clone())?;
    if host.community != s.community || record.action().author() != a.author() {
        return invalid("Only the host device can publish its hosting summary");
    }
    let (offer, offer_record) = event(s.offer.clone())?;
    if offer.community != s.community
        || offer_record.action().author() != a.author()
        || !matches!(offer.body, Body::HostOffer { enabled: true })
    {
        return invalid("The summary needs this device's active hosting offer");
    }
    if s.hours.is_empty() || s.hours.len() > SUMMARY_MAX_HOURS {
        return invalid("A summary holds 1–72 hours");
    }
    let now = a.timestamp().as_micros();
    let mut previous = i64::MIN;
    let mut checkers: std::collections::BTreeMap<(ActionHash, Option<ActionHash>), AgentPubKey> =
        Default::default();
    for p in &s.hours {
        if p.hour_us % HOUR_US != 0
            || p.hour_us <= previous
            || p.observed_at_us < p.hour_us
            || p.observed_at_us >= p.hour_us + HOUR_US
            || p.observed_at_us > now
            || now - p.hour_us > SUMMARY_GRACE_US + HOUR_US
            || p.nonce.len() != 32
            || p.host_signature.len() != 64
            || p.checker_signature.len() != 64
        {
            return invalid("Invalid hosting hour");
        }
        previous = p.hour_us;
        let host_sig: [u8; 64] = p
            .host_signature
            .clone()
            .try_into()
            .map_err(|_| fail("Bad signature"))?;
        if !verify_signature_raw(
            a.author().clone(),
            Signature(host_sig),
            echo_message(&s.offer, &p.nonce, p.hour_us),
        )? {
            return invalid("The host signature does not match this device");
        }
        let key = (p.checker.clone(), p.checker_authority.clone());
        let device = match checkers.get(&key) {
            Some(d) => d.clone(),
            None => {
                let (checker, checker_record) = member(p.checker.clone())?;
                if checker.community != s.community || checker.member_id == host.member_id {
                    return invalid("A checker cannot measure their own hosting");
                }
                let allowed = checker.member_id == c.founder
                    || match &p.checker_authority {
                        Some(r) => {
                            check_role(r.clone(), &checker).is_ok()
                                || authorized_with(
                                    &c,
                                    &s.community,
                                    &p.checker_authority,
                                    &checker,
                                    "hosting",
                                )?
                        }
                        None => false,
                    };
                if !allowed {
                    return invalid("The checker is not authorized to measure hosting");
                }
                let d = checker_record.action().author().clone();
                checkers.insert(key, d.clone());
                d
            }
        };
        let sig: [u8; 64] = p
            .checker_signature
            .clone()
            .try_into()
            .map_err(|_| fail("Bad signature"))?;
        if !verify_signature_raw(
            device,
            Signature(sig),
            attest_message(&s.community, &s.offer, p),
        )? {
            return invalid("The checker signature does not match");
        }
    }
    valid()
}

fn validate_event(e: AppEvent, a: &Action) -> ExternResult<ValidateCallbackResult> {
    let c = community(e.community.clone())?;
    let (m, record) = member(e.membership.clone())?;
    if m.community != e.community || record.action().author() != a.author() {
        return invalid("Only the authorized device can act for this member");
    }
    if let Some(permission) = required_permission(&e.body) {
        if !authorized_with(&c, &e.community, &e.authority, &m, permission)? {
            return invalid("Organizer authority required");
        }
    }
    if e.authority.is_some() && m.member_id == c.founder {
        return invalid("The founder acts without a delegated grant");
    }
    let subject_ok = |id: &str| valid_member_id(id) && id != c.founder;
    match e.body.clone() {
        Body::Message { .. } => return invalid("Messages use the message record"),
        Body::Channel { id, name, .. } => {
            if !valid_slug(&id, 80)
                || id == GENERAL
                || name.trim().is_empty()
                || name.chars().count() > 60
            {
                return invalid("Invalid channel");
            }
        }
        Body::AdminGrant {
            member_id,
            permissions,
        } => {
            if !subject_ok(&member_id) || !valid_permissions(&permissions) {
                return invalid("Invalid admin permissions");
            }
        }
        Body::PeerRole { member_id, .. } => {
            if !valid_member_id(&member_id) {
                return invalid("Invalid subject member ID");
            }
        }
        Body::Sampling { percent } => {
            if percent > 100 {
                return invalid("Sample rate must be between zero and one hundred");
            }
        }
        Body::HostingPolicy { multipliers } => {
            if multipliers.len() > 5
                || multipliers.iter().any(|x| *x < 1 || *x > 10)
                || multipliers.windows(2).any(|w| w[0] < w[1])
            {
                return invalid(
                    "Hosting multipliers must be 1–10 and must not increase with more hosts",
                );
            }
        }
        Body::Module {
            module,
            kind,
            payload,
            ..
        } => {
            if !valid_slug(&module, 40)
                || !valid_slug(&kind, 40)
                || payload.chars().count() > MODULE_PAYLOAD_CHARS
            {
                return invalid("Invalid module record");
            }
            if module == "community-ui"
                && (kind == "windows-release" || kind == "windows-release-plan")
            {
                let v: serde_json::Value =
                    serde_json::from_str(&payload).map_err(|_| fail("Invalid release"))?;
                let sha = v["sha256"].as_str().unwrap_or_default();
                let url = v["url"].as_str().unwrap_or_default();
                if sha.len() != 64
                    || hex::decode(sha).is_err()
                    || !url.starts_with("https://")
                    || url.len() > 500
                {
                    return invalid(
                        "A Windows release needs an HTTPS link and the installer SHA-256",
                    );
                }
            }
        }
        Body::Task {
            id,
            title,
            description,
            post_url: url,
            actions,
            ..
        } => {
            if id.is_empty()
                || id.len() > 80
                || title.trim().is_empty()
                || title.chars().count() > 200
                || description.chars().count() > TASK_DESCRIPTION_CHARS
                || !valid_task_actions(&url, &actions)
            {
                return invalid("Invalid task");
            }
        }
        Body::Goal {
            id,
            title,
            unit,
            context,
            ..
        } => {
            if id.is_empty()
                || id.len() > 80
                || title.trim().is_empty()
                || title.len() > 200
                || unit.len() > 100
                || context.len() > 2000
            {
                return invalid("Invalid goal");
            }
        }
        Body::XClaim {
            handle,
            post_url: url,
            challenge,
        } => {
            if handle.is_empty()
                || handle.len() > 15
                || !handle
                    .chars()
                    .all(|x| x.is_ascii_alphanumeric() || x == '_')
                || !post_url(&url)
                || !url
                    .to_ascii_lowercase()
                    .contains(&format!("/{}/status/", handle.to_ascii_lowercase()))
                || !challenge.starts_with(&format!("rai-{}-", &m.member_id[..12]))
                || challenge.len() > 160
            {
                return invalid("Invalid public X account challenge");
            }
        }
        Body::XVerify { claim, role, note } => {
            check_role(role, &m)?;
            let x = scoped_event(claim, &e.community)?;
            let (owner, _) = member(x.membership)?;
            if owner.member_id == m.member_id
                || !matches!(x.body, Body::XClaim { .. })
                || note.trim().len() < 4
                || note.len() > 2000
            {
                return invalid("An independent reviewer must attest the public verification post");
            }
        }
        Body::Claim {
            task,
            x_verification,
            actions,
            sampling,
            note,
        } => {
            if note.chars().count() > 1000 {
                return invalid("A contribution note is at most 1000 characters");
            }
            if let Some(policy) = sampling {
                if !matches!(
                    scoped_event(policy, &e.community)?.body,
                    Body::Sampling { .. }
                ) {
                    return invalid("Invalid sampling policy reference");
                }
            }
            let task = scoped_event(task, &e.community)?;
            let Body::Task {
                actions: allowed,
                post_url: url,
                ..
            } = task.body
            else {
                return invalid("Not a task");
            };
            if !valid_task_actions(&url, &actions) || !actions.iter().all(|v| allowed.contains(v)) {
                return invalid("Invalid contribution actions");
            }
            match (url.is_empty(), x_verification) {
                (true, None) => {}
                (false, Some(xv)) => {
                    let verified = scoped_event(xv, &e.community)?;
                    let Body::XVerify { claim, .. } = verified.body else {
                        return invalid("Account verification required");
                    };
                    let x = scoped_event(claim, &e.community)?;
                    let (owner, _) = member(x.membership)?;
                    if owner.member_id != m.member_id {
                        return invalid("Account verification belongs to another member");
                    }
                }
                (false, None) => return invalid("Account verification required for an X task"),
                (true, Some(_)) => return invalid("A task without a link takes no X verification"),
            }
        }
        Body::Flag { claim, reason } => {
            if !matches!(scoped_event(claim, &e.community)?.body, Body::Claim { .. })
                || reason.trim().len() < 8
                || reason.len() > 2000
            {
                return invalid("A report needs an existing claim and a reason");
            }
        }
        Body::Review {
            claim,
            role,
            outcome,
            note,
        } => {
            check_role(role, &m)?;
            let target = scoped_event(claim, &e.community)?;
            let (owner, _) = member(target.membership)?;
            if owner.member_id == m.member_id
                || !matches!(target.body, Body::Claim { .. })
                || !["supported", "unavailable", "conflict"].contains(&outcome.as_str())
                || note.trim().len() < 4
                || note.len() > 2000
            {
                return invalid("Invalid independent peer review");
            }
        }
        Body::Decision {
            member_id,
            references,
            reason,
            ..
        } => {
            if !subject_ok(&member_id)
                || reason.trim().len() < 16
                || reason.len() > 2000
                || references.is_empty()
                || references.len() > 10
            {
                return invalid("Membership decisions require reason and evidence references");
            }
            for reference in references {
                must_get_valid_record(reference)?;
            }
        }
        Body::BulkDecision {
            member_ids,
            references,
            reason,
            ..
        } => {
            let unique: std::collections::BTreeSet<_> = member_ids.iter().collect();
            if member_ids.is_empty()
                || member_ids.len() > 50
                || unique.len() != member_ids.len()
                || !member_ids.iter().all(|id| subject_ok(id))
                || reason.trim().len() < 16
                || reason.len() > 2000
                || references.is_empty()
                || references.len() > 10
            {
                return invalid("A combined decision lists 1–50 members, a reason and evidence");
            }
            for reference in references {
                must_get_valid_record(reference)?;
            }
        }
        Body::HostOffer { .. } => {}
        Body::TrialCard {
            title_tr,
            title_en,
            target,
            ..
        } => {
            let ok = |s: &str| !s.trim().is_empty() && s.chars().count() <= 120;
            if !ok(&title_tr) || !ok(&title_en) || target == 0 || target > 100_000_000 {
                return invalid("Invalid trial card");
            }
        }
        Body::Gate { .. } => {}
        Body::InviteSettings {
            revoke_before_us, ..
        } => {
            if revoke_before_us < 0 || revoke_before_us > a.timestamp().as_micros() {
                return invalid("Invalid invitation settings");
            }
        }
        Body::InviteAccess { member_id, .. } => {
            if !subject_ok(&member_id) {
                return invalid("Invalid subject member ID");
            }
        }
        Body::InviteQuota {
            wait_days,
            per_week,
            organizer_per_week,
        } => {
            if wait_days > 60 || per_week > 100 || organizer_per_week > 1000 {
                return invalid("Invalid invitation quota");
            }
        }
        Body::CampaignCode {
            max_uses,
            expires_at_us,
            ..
        } => {
            let now = a.timestamp().as_micros();
            if max_uses == 0
                || max_uses > 10_000
                || expires_at_us <= now
                || expires_at_us > now + CAMPAIGN_LIFETIME_US
            {
                return invalid("A campaign code allows 1–10,000 uses for up to 90 days");
            }
        }
    }
    valid()
}

// ---------------------------------------------------------------- links

pub fn entry_of<T: TryFrom<Entry>>(r: &Record) -> ExternResult<T> {
    let entry = r
        .entry()
        .as_option()
        .cloned()
        .ok_or(fail("Missing public entry"))?;
    T::try_from(entry).map_err(|_| fail("Invalid entry"))
}
fn author_member_id(membership: ActionHash) -> ExternResult<String> {
    Ok(member(membership)?.0.member_id)
}
fn validate_link(l: &CreateLinkData, author: &AgentPubKey) -> ExternResult<ValidateCallbackResult> {
    let target = l
        .target_address
        .clone()
        .into_action_hash()
        .ok_or(fail("Index target must be an action"))?;
    let r = must_get_valid_record(target)?;
    if r.action().author() != author {
        return invalid("Only the author can index a record");
    }
    let Some(kind) = LinkTypes::from_type(l.zome_index, l.link_type)? else {
        return invalid("Unknown index type");
    };
    let ts = r.action().timestamp();
    let expected: Vec<AnyLinkableHash> = match kind {
        LinkTypes::IdentityBindings => {
            if !has_type(&r, MEMBER) {
                return invalid("Identity index requires membership");
            }
            let m: Member = entry_of(&r)?;
            vec![ExternalHash::from_raw_32(
                hex::decode(m.member_id).map_err(|_| fail("Invalid identity"))?,
            )
            .into()]
        }
        LinkTypes::CommunityMembers => {
            if !has_type(&r, MEMBER) {
                return invalid("Wrong community index");
            }
            let m: Member = entry_of(&r)?;
            vec![m.community.into()]
        }
        LinkTypes::InvitationUses => {
            if !has_type(&r, MEMBER) {
                return invalid("Invitation index requires membership");
            }
            let m: Member = entry_of(&r)?;
            let Some(i) = m.invitation else {
                return invalid("No invitation");
            };
            vec![i.into()]
        }
        LinkTypes::ChannelMessages => {
            if !has_type(&r, MESSAGE) {
                return invalid("Channel index requires a message");
            }
            let msg: MessageEntry = entry_of(&r)?;
            let id = match msg.channel {
                Some(ch) => match scoped_event(ch, &msg.community)?.body {
                    Body::Channel { id, .. } => id,
                    _ => return invalid("Not a channel"),
                },
                None => GENERAL.to_string(),
            };
            vec![channel_base(&msg.community, &id, &utc_day(ts))?]
        }
        LinkTypes::HostingProofs => {
            if !has_type(&r, SUMMARY) {
                return invalid("Proof index requires a hosting summary");
            }
            let s: HostingSummary = entry_of(&r)?;
            vec![proof_base(
                &s.community,
                &author_member_id(s.membership)?,
                &utc_month(ts),
            )?]
        }
        LinkTypes::MemberActivity if has_type(&r, INVITE) => {
            let i: Invite = entry_of(&r)?;
            vec![member_base(&i.community, &author_member_id(i.membership)?)?]
        }
        _ => {
            if !has_type(&r, EVENT) {
                return invalid("Wrong index for this record");
            }
            let e: AppEvent = entry_of(&r)?;
            let c = &e.community;
            let primary = event_index(&e.body);
            match kind {
                LinkTypes::Governance if primary == Some(LinkTypes::Governance) => {
                    vec![governance_base(c)?]
                }
                LinkTypes::Tasks if primary == Some(LinkTypes::Tasks) => vec![tasks_base(c)?],
                LinkTypes::Goals if primary == Some(LinkTypes::Goals) => vec![goals_base(c)?],
                LinkTypes::HostOffers if primary == Some(LinkTypes::HostOffers) => {
                    vec![hosts_base(c)?]
                }
                LinkTypes::MemberActivity if primary == Some(LinkTypes::MemberActivity) => {
                    vec![member_base(c, &author_member_id(e.membership)?)?]
                }
                LinkTypes::ReviewQueue
                    if primary == Some(LinkTypes::ReviewQueue) || also_reviewed(&e.body) =>
                {
                    vec![review_base(c, &utc_day(ts))?]
                }
                _ => return invalid("Wrong index for this record"),
            }
        }
    };
    if expected.contains(&l.base_address) {
        valid()
    } else {
        invalid("Wrong community index")
    }
}

fn op_action(op: &Op) -> &Action {
    match op {
        Op::CreateRecord(v) => v.record.action(),
        Op::CreateEntry(v) => &v.action.hashed.content,
        Op::Update(v) => &v.update.hashed.content,
        Op::Delete(v) => &v.delete.hashed.content,
        Op::AgentActivity(v) => &v.action.hashed.content,
        Op::CreateLink(v) => &v.create_link.hashed.content,
        Op::DeleteLink(v) => &v.delete_link.hashed.content,
    }
}
#[hdk_extern]
pub fn validate(op: Op) -> ExternResult<ValidateCallbackResult> {
    let a = op_action(&op);
    match &a.data {
        ActionData::Update(_) if matches!(a.entry_type(), Some(EntryType::App(_))) => {
            return invalid("Append a versioned event; do not overwrite history")
        }
        ActionData::Delete(d) => {
            let original = must_get_action(d.deletes_address.clone())?;
            if matches!(original.action().entry_type(), Some(EntryType::App(_))) {
                return invalid("Application history cannot be deleted");
            }
        }
        ActionData::DeleteLink(_) => return invalid("Application indexes cannot be deleted"),
        ActionData::CreateLink(l) => return validate_link(l, a.author()),
        _ => {}
    }
    let entry = match &op {
        Op::CreateEntry(v) => Some(&v.entry),
        Op::CreateRecord(v) => v.record.entry().as_option(),
        _ => None,
    };
    if let (Some(entry), Some(EntryType::App(t))) = (entry, a.entry_type()) {
        if let Some(value) = EntryTypes::deserialize_from_type(t.zome_index, t.entry_index, entry)?
        {
            return match value {
                EntryTypes::Community(c) => {
                    if c.name.trim().is_empty()
                        || c.name.len() > 120
                        || !valid_member_id(&c.founder)
                    {
                        invalid("Invalid community")
                    } else {
                        valid()
                    }
                }
                EntryTypes::Member(m) => validate_member(m, a),
                EntryTypes::Event(e) => validate_event(e, a),
                EntryTypes::Message(m) => validate_message(m, a),
                EntryTypes::Invite(i) => validate_invite(i, a),
                EntryTypes::HostingSummary(s) => validate_summary(s, a),
            };
        }
    }
    valid()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_posts_only() {
        assert!(post_url("https://x.com/test/status/123"));
        assert!(!post_url("https://evil.test/test/status/123"));
        assert!(!post_url("https://x.com/test/status/123?x=1"));
    }
    #[test]
    fn actions_are_unique() {
        assert!(valid_actions(&vec!["like".into(), "quote".into()]));
        assert!(!valid_actions(&vec!["like".into(), "like".into()]));
    }
    #[test]
    fn linkless_tasks_use_done() {
        assert!(valid_task_actions("", &vec!["done".into()]));
        assert!(!valid_task_actions("", &vec!["like".into()]));
        assert!(!valid_task_actions(
            "https://x.com/a/status/1",
            &vec!["done".into()]
        ));
        assert!(valid_task_actions(
            "https://x.com/a/status/1",
            &vec!["like".into()]
        ));
    }
    #[test]
    fn permissions_are_known_and_unique() {
        assert!(valid_permissions(&vec![
            "tasks".into(),
            "hosting".into(),
            "release".into()
        ]));
        assert!(valid_permissions(&vec![]));
        assert!(!valid_permissions(&vec!["tasks".into(), "tasks".into()]));
        assert!(!valid_permissions(&vec!["founder".into()]));
    }
    #[test]
    fn permission_map() {
        assert_eq!(
            required_permission(&Body::Sampling { percent: 1 }),
            Some("sampling")
        );
        assert_eq!(
            required_permission(&Body::HostOffer { enabled: true }),
            None
        );
        assert_eq!(
            required_permission(&Body::TrialCard {
                title_tr: "a".into(),
                title_en: "a".into(),
                target: 1,
                hidden: false
            }),
            Some("founder")
        );
        assert_eq!(
            required_permission(&Body::Gate { open: true }),
            Some("founder")
        );
        assert_eq!(
            required_permission(&Body::CampaignCode {
                max_uses: 1,
                expires_at_us: 1,
                active: true
            }),
            Some("founder")
        );
        assert_eq!(
            required_permission(&Body::InviteAccess {
                member_id: String::new(),
                enabled: true
            }),
            Some("membership")
        );
    }
    #[test]
    fn modules_are_narrowed() {
        let m = |kind: &str, admin| Body::Module {
            module: "community-ui".into(),
            version: 1,
            kind: kind.into(),
            payload: String::new(),
            admin,
        };
        assert_eq!(required_permission(&m("task-star", true)), Some("tasks"));
        assert_eq!(required_permission(&m("goal-status", true)), Some("goals"));
        assert_eq!(
            required_permission(&m("windows-release-auto", true)),
            Some("release")
        );
        assert_eq!(
            required_permission(&m("windows-release", true)),
            Some("founder")
        );
        assert_eq!(
            required_permission(&m("anything-new", true)),
            Some("founder")
        );
        assert_eq!(required_permission(&m("monthly-target", false)), None);
    }
    #[test]
    fn sampling_is_stable() {
        assert_eq!(sampled("member", "task", 10), sampled("member", "task", 10));
        assert!(!sampled("member", "task", 0));
        assert!(sampled("member", "task", 100));
    }
    #[test]
    fn link_detection() {
        for text in [
            "see https://a.b",
            "www.example.org",
            "go to example.com now",
            "EXAMPLE.ORG",
            "http://x",
            "rai.community/join",
        ] {
            assert!(contains_link(text), "{text}");
        }
        for text in [
            "Merhaba!",
            "e.g. this",
            "saat 10.30",
            "1.000 kişi",
            "Bitti.",
            "a. b",
        ] {
            assert!(!contains_link(text), "{text}");
        }
    }
    #[test]
    fn indexes_by_kind() {
        let task = Body::Task {
            id: String::new(),
            title: String::new(),
            description: String::new(),
            post_url: String::new(),
            actions: vec![],
            archived: false,
        };
        assert!(matches!(event_index(&task), Some(LinkTypes::Tasks)));
        assert!(matches!(
            event_index(&Body::Gate { open: true }),
            Some(LinkTypes::Governance)
        ));
        assert!(also_reviewed(&Body::XClaim {
            handle: String::new(),
            post_url: String::new(),
            challenge: String::new()
        }));
    }
}
