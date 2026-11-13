//! Sampled contribution reviews, read from day buckets.
use crate::governance::*;
use crate::local;
use hdk::prelude::*;
use rai_integrity::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Claims older than this leave the open review queue.
pub const OPEN_REVIEW_DAYS: i64 = 30;

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedInput {
    pub community: ActionHash,
    /// First UTC day (micros, inclusive); none = the community's first day.
    pub from_us: Option<i64>,
    /// Last UTC day (micros, inclusive); none = today.
    pub to_us: Option<i64>,
}
/// Claims, account claims, reports, reviews and account attestations of a day range.
#[hdk_extern]
pub fn review_feed(input: FeedInput) -> ExternResult<Vec<EventView>> {
    local()?;
    let mut gov = Gov::load(&input.community)?;
    feed(&mut gov, input.from_us, input.to_us)
}
pub fn feed(
    gov: &mut Gov,
    from_us: Option<i64>,
    to_us: Option<i64>,
) -> ExternResult<Vec<EventView>> {
    let c = gov.hash.clone();
    let now = sys_time()?.as_micros();
    let first = from_us
        .unwrap_or(gov.created_us)
        .max(gov.created_us)
        .div_euclid(DAY_US);
    let last = to_us.unwrap_or(now).min(now).div_euclid(DAY_US);
    if last - first > 400 {
        return Err(fail("Ask for at most 400 days at a time"));
    }
    let mut bases = Vec::new();
    for d in first..=last {
        bases.push((
            review_base(&c, &day_of_us(d * DAY_US))?,
            LinkTypes::ReviewQueue,
        ));
    }
    let events = events_at(bases, &c)?;
    gov.lineage
        .ensure(&c, events.iter().map(|e| e.data.membership.clone()))?;
    Ok(filter_events(
        events,
        gov.founder(),
        &gov.lineage,
        &gov.grants,
        &gov.excluded.clone(),
    ))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReviewItem {
    pub claim: ActionHash,
    pub member_id: String,
    pub task_id: String,
    pub reviewer: Option<String>,
    pub reported: bool,
}
#[hdk_extern]
pub fn review_queue(c: ActionHash) -> ExternResult<Vec<ReviewItem>> {
    local()?;
    let mut gov = Gov::load(&c)?;
    queue_for(&mut gov)
}

/// One pass with hash maps instead of the 0.3 claim × event loop.
pub fn queue_for(gov: &mut Gov) -> ExternResult<Vec<ReviewItem>> {
    let now = sys_time()?.as_micros();
    let events = feed(gov, Some(now - OPEN_REVIEW_DAYS * DAY_US), None)?;
    let task_ids: BTreeSet<ActionHash> = events
        .iter()
        .filter_map(|e| match &e.data.body {
            Body::Claim { task, .. } => Some(task.clone()),
            _ => None,
        })
        .collect();
    let tasks: BTreeMap<ActionHash, String> = get_many(task_ids.into_iter().collect())?
        .iter()
        .filter_map(event_view)
        .filter_map(|t| match t.data.body {
            Body::Task { id, .. } => Some((t.hash, id)),
            _ => None,
        })
        .collect();
    let mut peers: BTreeSet<String> = BTreeSet::new();
    for e in &gov.events {
        if let Body::PeerRole { member_id, .. } = &e.data.body {
            if gov.role(member_id).is_some() && !gov.removed(member_id) {
                peers.insert(member_id.clone());
            }
        }
    }
    let author = |e: &EventView| {
        gov.lineage
            .member_of(&e.data.membership)
            .map(|m| m.data.member_id.clone())
    };
    let mut claims: BTreeMap<(String, String), Vec<&EventView>> = BTreeMap::new();
    let mut flagged: BTreeSet<ActionHash> = BTreeSet::new();
    let mut reviewed: BTreeMap<ActionHash, Vec<String>> = BTreeMap::new();
    for e in &events {
        match &e.data.body {
            Body::Claim { task, .. } => {
                let (Some(m), Some(id)) = (author(e), tasks.get(task)) else {
                    continue;
                };
                if !gov.removed(&m) {
                    claims.entry((m, id.clone())).or_default().push(e);
                }
            }
            Body::Flag { claim, .. } => {
                flagged.insert(claim.clone());
            }
            Body::Review { claim, role, .. } => {
                if let Some(m) = author(e) {
                    if gov.role(&m).as_ref() == Some(role) && !gov.removed(&m) {
                        reviewed.entry(claim.clone()).or_default().push(m);
                    }
                }
            }
            _ => {}
        }
    }
    let sampling: BTreeMap<ActionHash, u8> = gov
        .events
        .iter()
        .filter_map(|v| match v.data.body {
            Body::Sampling { percent } => Some((v.hash.clone(), percent)),
            _ => None,
        })
        .collect();
    let mut out = Vec::new();
    for ((member_id, task_id), versions) in claims {
        let first = versions[0];
        let claim = versions[versions.len() - 1];
        let percent = match &first.data.body {
            Body::Claim {
                sampling: Some(p), ..
            } => sampling.get(p).copied().unwrap_or(10),
            _ => 10,
        };
        let reported = versions.iter().any(|v| flagged.contains(&v.hash));
        if !reported && !sampled(&member_id, &task_id, percent) {
            continue;
        }
        let eligible: Vec<_> = peers.iter().filter(|p| *p != &member_id).cloned().collect();
        let digest = Sha256::digest(first.hash.get_raw_39());
        let reviewer = if eligible.is_empty() {
            None
        } else {
            Some(
                eligible[u16::from_be_bytes([digest[0], digest[1]]) as usize % eligible.len()]
                    .clone(),
            )
        };
        if reviewed
            .get(&claim.hash)
            .is_some_and(|by| by.iter().any(|m| Some(m) == reviewer.as_ref()))
        {
            continue;
        }
        out.push(ReviewItem {
            claim: claim.hash.clone(),
            member_id,
            task_id,
            reviewer,
            reported,
        });
    }
    Ok(out)
}
