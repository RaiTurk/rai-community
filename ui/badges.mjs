// Badge series (plan D3, C1, I). One definition for the profile and the "All badges" list.
import { ledger, hostingHours } from './raiunyt.mjs';
import { contributionGroups } from './core.mjs';

export const BADGES = [
  { series: 'contribution', thresholds: [1, 5, 15, 30, 60] },
  { series: 'hosting', thresholds: [10, 50, 100, 250, 500] },
  { series: 'memory', thresholds: [10, 50, 100, 250, 500] },
  { series: 'invites', thresholds: [1, 5, 15, 50] },
];

/** Counts behind every series for one member. */
export function badgeCounts(snapshot, memberId) {
  const entries = ledger(snapshot).filter(entry => entry.memberId === memberId);
  const contribution = entries.filter(entry => entry.kind === 'campaign' && entry.basis !== 'conflict').length;
  const hours = hostingHours(snapshot).filter(hour => hour.memberId === memberId);
  // An invitation counts when the invited member made a first valid contribution.
  const contributors = new Set(contributionGroups(snapshot).filter(group => !group.removed).map(group => group.memberId));
  const invites = (snapshot.joins ?? []).filter(join => join.invited_by === memberId && contributors.has(join.member_id)).length;
  return { contribution, hosting: hours.length, memory: hours.filter(hour => hour.fullCopy).length, invites };
}

/** Earned and next level per series. */
export function badgeProgress(counts) {
  return BADGES.map(({ series, thresholds }) => {
    const count = counts[series] ?? 0;
    return { series, count, thresholds, earned: thresholds.filter(t => count >= t), next: thresholds.find(t => count < t) ?? null };
  });
}
