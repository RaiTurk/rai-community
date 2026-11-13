// Shared helpers for the 0.4 real-conductor tests.
import { encodeHashToBase64 } from '@holochain/client';
import { signRecovery } from '../ui/core.mjs';
export const str = encodeHashToBase64;
export const wait = ms => new Promise(r => setTimeout(r, ms));
/** Binds a device to a member identity. `via` is { invitation } or { gate } or {} (founder). */
export async function bind(client, community, recovery, name, via = {}, previous = null, cutoff = null) {
  const m = {
    community, member_id: recovery.memberId, generation: previous ? previous.data.generation + 1 : 0,
    previous: previous?.hash ?? null, previous_cutoff: cutoff, invitation: via.invitation ?? null,
    gate: via.gate ?? null, name, recovery_signature: [],
  };
  m.recovery_signature = await signRecovery(recovery.key, await client.call('binding_challenge', m));
  return client.call('bind_member', m);
}
export const pub = (client, c, m, body) => client.call('publish', { community: c, membership: m, body });
export const post = (client, c, m, text, channel = null) => client.call('post_message', { community: c, membership: m, channel, text });
export const has = (list, hash) => list.some(x => str(x.hash ?? x) === str(hash));
