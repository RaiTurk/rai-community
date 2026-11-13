import { contributionGroups, eligibleEvent } from './core.mjs';

export function personalContributions(snapshot, memberId, language) {
  const eventsByHash = new Map(snapshot.events.map(event => [event.hash, event]));
  const reviews = new Map();
  for (const event of snapshot.events) {
    const { body } = event.data;
    if (body.type === 'review' && eligibleEvent(snapshot, event)) {
      reviews.set(body.claim, body.outcome);
    }
  }

  return contributionGroups(snapshot, language)
    .filter(group => group.memberId === memberId)
    .map(group => {
      const latestReport = group.references.at(-1);
      return {
        ...group,
        reportedAt: eventsByHash.get(latestReport)?.timestamp_us ?? 0,
        review: reviews.get(latestReport) ?? null,
      };
    })
    .sort((first, second) => second.reportedAt - first.reportedAt);
}

export function latestDeviceOffer(snapshot, membership) {
  if (!snapshot || !membership) return undefined;
  return snapshot.events.findLast(event =>
    event.data.body.type === 'host_offer' && event.data.membership === membership.hash);
}
