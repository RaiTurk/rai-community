//! Hosting: offers, signed challenges, storage checks, attestations and summaries (plan B, C1, G1).
//!
//! A checker writes nothing to the shared network. It hands a signed hour
//! attestation to the host; the host's interface keeps it and publishes one
//! `HostingSummary` about every 6 hours.
use crate::governance::*;
use crate::messages::{hint, write_event};
use crate::{local, me};
use hdk::prelude::*;
use rai_integrity::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Debug, Serialize, Deserialize)]
pub struct HostingInput {
    pub community: ActionHash,
    pub membership: ActionHash,
}
#[hdk_extern]
pub fn ensure_hosting(input: HostingInput) -> ExternResult<ActionHash> {
    local()?;
    let mut gov = Gov::load(&input.community)?;
    gov.own(&input.membership)?;
    let mine = query(
        ChainQueryFilter::new()
            .include_entries(true)
            .entry_type(EntryType::App(AppEntryDef::new(
                EVENT.into(),
                0.into(),
                EntryVisibility::Public,
            ))),
    )?
    .iter()
    .rev()
    .find_map(|r| {
        entry_of::<AppEvent>(r)
            .ok()
            .filter(|e| e.community == input.community && matches!(e.body, Body::HostOffer { .. }))
            .map(|e| (r.action_address().clone(), e))
    });
    if let Some((hash, e)) = mine {
        if e.membership == input.membership && matches!(e.body, Body::HostOffer { enabled: true }) {
            return Ok(hash);
        }
    }
    let hash = write_event(&AppEvent {
        community: input.community.clone(),
        membership: input.membership,
        body: Body::HostOffer { enabled: true },
        authority: None,
    })?;
    hint(&input.community, "host")?;
    Ok(hash)
}

/// The device's current offer in a community, from its own chain.
fn own_offer(community: &ActionHash) -> ExternResult<Option<(ActionHash, AppEvent)>> {
    Ok(query(
        ChainQueryFilter::new()
            .include_entries(true)
            .entry_type(EntryType::App(AppEntryDef::new(
                EVENT.into(),
                0.into(),
                EntryVisibility::Public,
            ))),
    )?
    .iter()
    .rev()
    .find_map(|r| {
        entry_of::<AppEvent>(r)
            .ok()
            .filter(|v| &v.community == community && matches!(v.body, Body::HostOffer { .. }))
            .map(|v| (r.action_address().clone(), v))
    }))
}

/// `sha256(nonce || action hash || entry bytes)` from the local store only.
fn storage_digest(nonce: &[u8], hash: &ActionHash, strategy: GetOptions) -> ExternResult<Vec<u8>> {
    let Some(record) = get(hash.clone(), strategy)? else {
        return Ok(vec![]);
    };
    let Some(entry) = record.entry().as_option() else {
        return Ok(vec![]);
    };
    let bytes = SerializedBytes::try_from(entry.clone()).map_err(|e| fail(e.to_string()))?;
    let mut h = Sha256::new();
    h.update(nonce);
    h.update(hash.get_raw_39());
    h.update(bytes.bytes());
    Ok(h.finalize().to_vec())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EchoInput {
    pub offer: ActionHash,
    pub nonce: Vec<u8>,
    pub hour_us: i64,
    /// Up to three shared records the host must read from its own store.
    pub storage: Vec<ActionHash>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EchoReply {
    pub device: AgentPubKey,
    pub host_signature: Vec<u8>,
    pub digests: Vec<Vec<u8>>,
    pub storage_signature: Vec<u8>,
    pub version: String,
}
#[hdk_extern]
pub fn service_echo(input: EchoInput) -> ExternResult<EchoReply> {
    if input.nonce.len() != 32 || input.storage.len() > 3 {
        return Err(fail("Invalid service challenge"));
    }
    let now = sys_time()?.as_micros();
    let hour = now - now.rem_euclid(HOUR_US);
    // Allow the previous hour for a challenge started just before the boundary.
    if input.hour_us != hour && !(input.hour_us == hour - HOUR_US && now - hour < 120_000_000) {
        return Err(fail("The challenge hour is not current"));
    }
    let (e, r) = load::<AppEvent>(input.offer.clone(), EVENT)?;
    if r.action().author() != &me()? || !matches!(e.body, Body::HostOffer { enabled: true }) {
        return Err(fail("This device has not offered the requested service"));
    }
    if !own_offer(&e.community)?.is_some_and(|(h, v)| {
        h == input.offer && matches!(v.body, Body::HostOffer { enabled: true })
    }) {
        return Err(fail("This device withdrew or replaced its service offer"));
    }
    let me = me()?;
    let host_signature = sign_raw(
        me.clone(),
        echo_message(&input.offer, &input.nonce, input.hour_us),
    )?
    .0
    .to_vec();
    let mut digests = Vec::new();
    for h in &input.storage {
        digests.push(storage_digest(&input.nonce, h, GetOptions::local())?);
    }
    let storage_signature = sign_raw(me.clone(), storage_message(&input.nonce, &digests))?
        .0
        .to_vec();
    Ok(EchoReply {
        device: me,
        host_signature,
        digests,
        storage_signature,
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProbeInput {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub offer: ActionHash,
    /// Shared records at least a day old, from different indexes (chosen by the interface).
    #[serde(default)]
    pub storage: Vec<ActionHash>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProbeResult {
    pub success: bool,
    pub full_copy: bool,
    pub delivered: bool,
    pub proof: Option<HourProof>,
    pub detail: String,
    pub elapsed_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Covered {
    pub offer: ActionHash,
    pub hour_us: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationInput {
    pub community: ActionHash,
    pub offer: ActionHash,
    pub proof: HourProof,
}

/// Measures one host. Writes nothing to the shared network.
#[hdk_extern]
pub fn probe_host(input: ProbeInput) -> ExternResult<ProbeResult> {
    local()?;
    let mut gov = Gov::load(&input.community)?;
    let m = gov.own(&input.membership)?;
    let authority = gov.checker_authority(&m.data.member_id).ok_or(fail(
        "Only the founder, reviewers and organizers with the hosting permission measure hosting",
    ))?;
    let (target, record) = load::<AppEvent>(input.offer.clone(), EVENT)?;
    if target.community != input.community
        || !matches!(target.body, Body::HostOffer { enabled: true })
    {
        return Err(fail("Not an active offer in this community"));
    }
    gov.lineage
        .ensure(&input.community, [target.membership.clone()])?;
    let owner = gov
        .lineage
        .member_of(&target.membership)
        .cloned()
        .ok_or(fail("Host membership not synchronized"))?;
    if owner.data.member_id == m.data.member_id
        || gov.removed(&owner.data.member_id)
        || gov.lineage.current(&owner.data.member_id).map(|v| &v.hash) != Some(&target.membership)
    {
        return Err(fail("The host must be another active member/device"));
    }
    let host = record.action().author().clone();
    let nonce = random_bytes(32)?.to_vec();
    let start = sys_time()?.as_micros();
    let hour_us = start - start.rem_euclid(HOUR_US);
    let storage: Vec<ActionHash> = input.storage.iter().take(3).cloned().collect();
    let response = call_remote(
        host.clone(),
        zome_info()?.name,
        "service_echo".into(),
        None,
        EchoInput {
            offer: input.offer.clone(),
            nonce: nonce.clone(),
            hour_us,
            storage: storage.clone(),
        },
    );
    let elapsed_ms = ((sys_time()?.as_micros() - start).max(0) / 1000) as u64;
    let reply = match response {
        Ok(ZomeCallResponse::Ok(bytes)) => bytes.decode::<EchoReply>().ok(),
        _ => None,
    };
    let Some(reply) = reply.filter(|r| r.device == host) else {
        return Ok(ProbeResult {
            success: false,
            full_copy: false,
            delivered: false,
            proof: None,
            detail: "Device did not respond".into(),
            elapsed_ms,
        });
    };
    let sig = |v: &[u8]| -> Option<Signature> { <[u8; 64]>::try_from(v).ok().map(Signature) };
    let host_ok = sig(&reply.host_signature)
        .map(|s| verify_signature_raw(host.clone(), s, echo_message(&input.offer, &nonce, hour_us)))
        .transpose()?
        .unwrap_or(false);
    if !host_ok {
        return Ok(ProbeResult {
            success: false,
            full_copy: false,
            delivered: false,
            proof: None,
            detail: "Invalid host signature".into(),
            elapsed_ms,
        });
    }
    // Storage check: the host's digests must match this device's own copies.
    let mut full_copy = storage.len() == 3 && reply.digests.len() == 3;
    if full_copy {
        let storage_ok = sig(&reply.storage_signature)
            .map(|s| verify_signature_raw(host.clone(), s, storage_message(&nonce, &reply.digests)))
            .transpose()?
            .unwrap_or(false);
        full_copy = storage_ok;
        for (h, theirs) in storage.iter().zip(&reply.digests) {
            let ours = storage_digest(&nonce, h, GetOptions::default())?;
            if ours.is_empty() || &ours != theirs {
                full_copy = false;
            }
        }
    }
    let mut proof = HourProof {
        hour_us,
        nonce,
        host_signature: reply.host_signature,
        full_copy,
        observed_at_us: start,
        checker: input.membership.clone(),
        checker_authority: authority,
        checker_signature: vec![],
    };
    proof.checker_signature = sign_raw(
        me()?,
        attest_message(&input.community, &input.offer, &proof),
    )?
    .0
    .to_vec();
    let delivered = matches!(
        call_remote(
            host,
            zome_info()?.name,
            "receive_attestation".into(),
            None,
            AttestationInput {
                community: input.community.clone(),
                offer: input.offer.clone(),
                proof: proof.clone()
            },
        ),
        Ok(ZomeCallResponse::Ok(_))
    );
    // Tell the other checkers this host is covered for the hour (no shared record).
    let others: Vec<AgentPubKey> = gov
        .events
        .iter()
        .filter_map(|e| match &e.data.body {
            Body::PeerRole {
                member_id,
                enabled: true,
            } => Some(member_id.clone()),
            Body::AdminGrant { member_id, .. } => Some(member_id.clone()),
            _ => None,
        })
        .chain(std::iter::once(gov.founder().to_string()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|id| id != &m.data.member_id && gov.checker_authority(id).is_some())
        .filter_map(|id| gov.lineage.current(&id).map(|v| v.device.clone()))
        .collect();
    if !others.is_empty() {
        let _ = send_remote_signal(
            Covered {
                offer: input.offer.clone(),
                hour_us,
            },
            others,
        );
    }
    Ok(ProbeResult {
        success: true,
        full_copy,
        delivered,
        proof: Some(proof),
        detail: if full_copy {
            "Device responded; full copy verified"
        } else {
            "Device responded"
        }
        .into(),
        elapsed_ms,
    })
}

/// A checker hands this device a signed hour. It is checked and passed to the
/// local interface, which keeps it until the next summary.
#[hdk_extern]
pub fn receive_attestation(input: AttestationInput) -> ExternResult<()> {
    let p = &input.proof;
    let (offer, record) = load::<AppEvent>(input.offer.clone(), EVENT)?;
    if record.action().author() != &me()? || offer.community != input.community {
        return Err(fail("Not this device's offer"));
    }
    let host_sig =
        <[u8; 64]>::try_from(p.host_signature.as_slice()).map_err(|_| fail("Bad signature"))?;
    if !verify_signature_raw(
        me()?,
        Signature(host_sig),
        echo_message(&input.offer, &p.nonce, p.hour_us),
    )? {
        return Err(fail("This device did not sign the challenge"));
    }
    let (_, checker_record) = load::<Member>(p.checker.clone(), MEMBER)?;
    let sig =
        <[u8; 64]>::try_from(p.checker_signature.as_slice()).map_err(|_| fail("Bad signature"))?;
    if !verify_signature_raw(
        checker_record.action().author().clone(),
        Signature(sig),
        attest_message(&input.community, &input.offer, p),
    )? {
        return Err(fail("Invalid checker signature"));
    }
    emit_signal(crate::messages::UiSignal {
        kind: "attestation".into(),
        community: Some(input.community.clone()),
        offer: Some(input.offer.clone()),
        proof: Some(p.clone()),
        ..Default::default()
    })?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SummaryInput {
    pub community: ActionHash,
    pub membership: ActionHash,
    pub hours: Vec<HourProof>,
}
/// Publishes the kept hours (one record per 72 hours of attestations).
#[hdk_extern]
pub fn publish_hosting_summary(input: SummaryInput) -> ExternResult<Vec<ActionHash>> {
    local()?;
    let mut gov = Gov::load(&input.community)?;
    let m = gov.own(&input.membership)?;
    let (offer, _) = own_offer(&input.community)?
        .filter(|(_, v)| matches!(v.body, Body::HostOffer { enabled: true }))
        .ok_or(fail("No active hosting offer"))?;
    let now = sys_time()?.as_micros();
    let mut hours: Vec<HourProof> = input
        .hours
        .into_iter()
        .filter(|p| now - p.hour_us <= SUMMARY_GRACE_US && p.observed_at_us <= now)
        .collect();
    hours.sort_by_key(|p| (p.hour_us, std::cmp::Reverse(p.full_copy)));
    hours.dedup_by_key(|p| p.hour_us);
    // Keep only proofs for this offer (signatures cover the offer).
    let c = input.community.clone();
    hours.retain(|p| {
        <[u8; 64]>::try_from(p.host_signature.as_slice())
            .ok()
            .and_then(|s| {
                verify_signature_raw(
                    me().ok()?,
                    Signature(s),
                    echo_message(&offer, &p.nonce, p.hour_us),
                )
                .ok()
            })
            .unwrap_or(false)
    });
    let mut out = Vec::new();
    for chunk in hours.chunks(SUMMARY_MAX_HOURS) {
        let hash = create_entry(EntryTypes::HostingSummary(HostingSummary {
            community: c.clone(),
            membership: input.membership.clone(),
            offer: offer.clone(),
            hours: chunk.to_vec(),
        }))?;
        create_link(
            proof_base(&c, &m.data.member_id, &utc_month(sys_time()?))?,
            hash.clone(),
            LinkTypes::HostingProofs,
            (),
        )?;
        out.push(hash);
    }
    Ok(out)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SummaryView {
    pub hash: ActionHash,
    pub member_id: String,
    pub data: HostingSummary,
    pub timestamp_us: i64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct SummariesInput {
    pub community: ActionHash,
    pub member_ids: Vec<String>,
    /// UTC months, `YYYY-MM`.
    pub months: Vec<String>,
}
/// Hosting summaries of the given members and months.
#[hdk_extern]
pub fn hosting_summaries(input: SummariesInput) -> ExternResult<Vec<SummaryView>> {
    local()?;
    if input.member_ids.len() * input.months.len() > 2_000 {
        return Err(fail("Ask for fewer members or months"));
    }
    let mut gov = Gov::load(&input.community)?;
    let mut bases = Vec::new();
    for id in input.member_ids.iter().filter(|id| valid_member_id(id)) {
        for month in &input.months {
            bases.push((
                proof_base(&input.community, id, month)?,
                LinkTypes::HostingProofs,
            ));
        }
    }
    let links = links_many(bases)?;
    let records = get_many(
        links
            .into_iter()
            .filter_map(|l| l.target.into_action_hash())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
    )?;
    let mut out: Vec<SummaryView> = records
        .iter()
        .filter(|r| has_type(r, SUMMARY))
        .filter_map(|r| {
            Some((
                r.action_address().clone(),
                entry_of::<HostingSummary>(r).ok()?,
                r.action().action_seq(),
                r.action().timestamp().as_micros(),
            ))
        })
        .filter(|(_, s, _, _)| s.community == input.community)
        .map(|(hash, data, seq, ts)| (hash, data, seq, ts))
        .collect::<Vec<_>>()
        .into_iter()
        .map(|(hash, data, seq, ts)| {
            (
                SummaryView {
                    hash,
                    member_id: String::new(),
                    data,
                    timestamp_us: ts,
                },
                seq,
            )
        })
        .collect::<Vec<_>>()
        .into_iter()
        .filter_map(|(mut v, seq)| {
            gov.lineage
                .ensure(&input.community, [v.data.membership.clone()])
                .ok()?;
            if !gov.lineage.accepts(&v.data.membership, seq) {
                return None;
            }
            v.member_id = gov
                .lineage
                .member_of(&v.data.membership)?
                .data
                .member_id
                .clone();
            Some(v)
        })
        .collect();
    out.sort_by_key(|s| s.timestamp_us);
    Ok(out)
}
