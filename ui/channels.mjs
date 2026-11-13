import { latestById } from './core.mjs';

// 0.3 network: a channel is its own record type, versioned by `id`.
// The latest version decides name, write mode and whether it is closed.
// Messages point at a channel version; `channel: null` is the general channel.
export const GENERAL = 'general';

export function channelList(snapshot, { includeClosed = false } = {}) {
  const latest = new Map(), first = new Map(), versions = new Map();
  for (const event of snapshot.events) {
    const body = event.data.body;
    if (body.type !== 'channel') continue;
    latest.set(body.id, event);
    if (!first.has(body.id)) first.set(body.id, event.timestamp_us);
    versions.set(body.id, [...(versions.get(body.id) ?? []), event.hash]);
  }
  return [...latest.values()]
    .filter(event => includeClosed || !event.data.body.archived)
    .map(event => ({
      id: event.data.body.id,
      name: event.data.body.name,
      adminsOnly: !!event.data.body.admins_only,
      closed: !!event.data.body.archived,
      created: first.get(event.data.body.id),
      hash: event.hash,
      versions: versions.get(event.data.body.id),
    }))
    .sort((a, b) => a.created - b.created);
}

/** Returns a function mapping a message body to its channel id. */
export function messageChannels(snapshot) {
  const byHash = new Map();
  for (const event of snapshot.events) if (event.data.body.type === 'channel') byHash.set(event.hash, event.data.body.id);
  return body => (body?.channel && byHash.get(body.channel)) || GENERAL;
}

export function channelBody(id, name, adminsOnly, archived) {
  name = String(name ?? '').trim();
  if (!name || Array.from(name).length > 60) throw Error('channel-name');
  return { type: 'channel', id, name, admins_only: !!adminsOnly, archived: !!archived };
}

export function newChannelBody(name, adminsOnly) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(5)), x => x.toString(16).padStart(2, '0')).join('');
  return channelBody(id, name, adminsOnly, false);
}

export const visibleGoals = snapshot => latestById(snapshot, 'goal');
