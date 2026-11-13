// Rai Community volunteer node kit (0.4). Headless, full copy by default.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { encodeHashToBase64 as str, decodeHashFromBase64 as hash } from '@holochain/client';
import { newRecovery, readRecovery, signRecovery, recoveryWarning, parseInvite } from '../ui/core.mjs';
import { dueTargets, keepAttestation, summaryDue, limited, ACTIVE_MS } from '../ui/hosting-schedule.mjs';
import { startNode } from './runtime.mjs';

const [command, ...args] = process.argv.slice(2);
const plain = v => v instanceof Uint8Array ? (v.length === 39 ? str(v) : Array.from(v)) : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
const pause = ms => new Promise(r => setTimeout(r, ms));

if (command === 'prepare') {
  if (process.env.RAI_ACK_RECOVERY_LOSS !== 'YES') throw Error(recoveryWarning('en') + ' Set RAI_ACK_RECOVERY_LOSS=YES after understanding this.');
  if (!args[0]) throw Error('prepare requires a private recovery output path.');
  const file = resolve(args[0]);
  if (existsSync(file)) throw Error('Refusing to overwrite a recovery file.');
  const r = await newRecovery();
  await writeFile(file, r.code + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ type: 'rai-membership-request-v1', memberId: r.memberId }));
  console.log('Private recovery file written. Move a backup off this device; never publish it.');
} else if (['join', 'recover', 'offer', 'withdraw', 'run', 'status'].includes(command)) {
  const node = await startNode();
  let stop = false;
  const stateFile = join(node.dir, 'membership.json');
  const attestFile = join(node.dir, 'attestations.json');
  let state = existsSync(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : null;
  const cleanup = async () => { if (stop) return; stop = true; await node.close(); };
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());
  try {
    if (command === 'join' || command === 'recover') {
      if (process.env.RAI_ACK_RECOVERY_LOSS !== 'YES') throw Error('Acknowledge sole recovery-code responsibility with RAI_ACK_RECOVERY_LOSS=YES.');
      const recoveryFile = resolve(command === 'join' ? args[1] || '' : args[0] || '');
      const r = await readRecovery((await readFile(recoveryFile, 'utf8')).trim().split(/\r?\n/)[0]);
      let c, invitation = null, gate = null, previous = null, previous_cutoff = null, name = process.env.RAI_NODE_LABEL || 'Volunteer node';
      if (command === 'join') {
        // 0.4: join with an invitation code, or with the address when the founder opened the gate.
        let address = args[0] || '';
        try { const parsed = parseInvite(address); address = parsed.community; invitation = hash(parsed.invitation); } catch { /* plain address */ }
        if (!/^uhCkk[A-Za-z0-9_-]{48}$/.test(address)) throw Error('join needs an invitation code (RAI-INVITE.…) or the public community address.');
        c = hash(address);
        if (!invitation) {
          const gov = await node.call('governance_state', c);
          const gateEvent = gov.events.filter(e => e.data.body.type === 'gate' && gov.members.some(m => str(m.hash) === str(e.data.membership) && m.data.member_id === gov.community.founder)).at(-1);
          if (!gateEvent?.data.body.open) throw Error('This community needs an invitation. Ask a member for an invitation code.');
          gate = gateEvent.hash;
        }
      } else {
        const bindings = await node.call('locate_memberships', r.memberId);
        const communities = [...new Set(bindings.map(b => str(b.data.community)))];
        if (communities.length !== 1 && !args[1]) throw Error('Specify the public community address; discovery is not complete or is ambiguous.');
        c = hash(args[1] || communities[0]);
        const rows = bindings.filter(b => b.data.member_id === r.memberId && str(b.data.community) === str(c)).sort((a, b) => b.data.generation - a.data.generation || Buffer.compare(b.hash, a.hash));
        const old = rows[0];
        if (!old) throw Error('No previous membership found');
        const head = await node.call('device_chain_head', old.device);
        if (process.env.RAI_CONFIRM_HISTORY_READY !== 'YES') throw Error(`The previous device published ${head ?? old.sequence} actions. Set RAI_CONFIRM_HISTORY_READY=YES when ready to move the membership here.`);
        previous = old;
        previous_cutoff = Math.max(old.sequence, head ?? 0);
        name = old.data.name;
      }
      const m = { community: c, member_id: r.memberId, generation: previous ? previous.data.generation + 1 : 0, previous: previous?.hash ?? null, previous_cutoff, invitation, gate, name, recovery_signature: [] };
      m.recovery_signature = await signRecovery(r.key, await node.call('binding_challenge', m));
      const member = await node.call('bind_member', m);
      state = { community: str(c), membership: str(member), memberId: r.memberId };
      await writeFile(stateFile, JSON.stringify(state, null, 2));
      console.log('Membership bound. No recovery secret was written to the node profile.');
    } else {
      if (!state) throw Error('Join this node with an invitation code first.');
      const c = hash(state.community), m = hash(state.membership);
      if (command === 'offer') {
        if (process.env.RAI_ACK_RESOURCE_USE !== 'YES') throw Error('Offering this node consumes disk, bandwidth and energy while running. Set RAI_ACK_RESOURCE_USE=YES to opt in.');
        await node.call('ensure_hosting', { community: c, membership: m });
        console.log('Service offer published. Keep the node running to serve it.');
      } else if (command === 'withdraw') {
        await node.call('publish', { community: c, membership: m, body: { type: 'host_offer', enabled: false } });
        console.log('Service withdrawn.');
      } else if (command === 'status') {
        const s = await node.call('governance_state', c);
        console.log(JSON.stringify({ community: s.community.name, members: new Set(s.members.map(x => x.data.member_id)).size, governance_records: s.events.length, sample_percent: s.sample_percent }, null, 2));
      } else {
        console.log('Node running (full copy). Interfaces are loopback-only; no recovery code is needed during normal service.');
        let kept = existsSync(attestFile) ? JSON.parse(await readFile(attestFile, 'utf8')) : { hours: [], published: 0 };
        const covered = new Set(), done = new Set();
        node.client.on('signal', async signal => {
          const p = plain(signal?.value?.payload);
          if (p?.type === 'covered') covered.add(p.offer + '|' + p.hour_us / 1000);
          if (p?.type === 'attestation' && p.community === state.community) {
            kept.hours = keepAttestation(kept.hours, p.proof);
            await writeFile(attestFile, JSON.stringify(kept));
          }
        });
        const tick = Math.max(60, Number(process.env.RAI_CHECK_INTERVAL_SECONDS) || 60) * 1000;
        while (!stop) {
          try {
            // Publish kept hours about every 6 hours (plan G1).
            if (summaryDue(kept.hours, kept.published, Date.now())) {
              await node.call('publish_hosting_summary', { community: c, membership: m, hours: kept.hours.map(p => ({ ...p, checker: hash(p.checker), checker_authority: p.checker_authority ? hash(p.checker_authority) : null })) });
              kept = { hours: [], published: Date.now() };
              await writeFile(attestFile, JSON.stringify(kept));
              console.log(new Date().toISOString() + ' hosting summary published');
            }
            const gov = plain(await node.call('governance_state', c));
            const authorized = authorizedCheckers(gov);
            if (authorized.includes(state.memberId)) {
              const offers = plain(await node.call('host_offers', c));
              const byHash = new Map(gov.members.map(x => [x.hash, x.data.member_id]));
              const latest = new Map();
              for (const o of offers) { const id = byHash.get(o.data.membership); if (id) latest.set(id, o); }
              const hosts = [...latest].filter(([, o]) => o.data.body.enabled).map(([hostId, o]) => ({ hostId, offer: o.hash }));
              const month = new Date().toISOString().slice(0, 7);
              const summaries = plain(await node.call('hosting_summaries', { community: c, member_ids: hosts.map(h => h.hostId), months: [month] }));
              const recent = new Set();
              for (const s of summaries) for (const p of s.data.hours) if (Date.now() - p.observed_at_us / 1000 < ACTIVE_MS) recent.add(byHash.get(p.checker));
              const targets = await dueTargets({ me: state.memberId, nowMs: Date.now(), hosts, authorized, recent, covered, done });
              const storage = [...gov.events].filter(e => Date.now() * 1000 - e.timestamp_us > 86_400_000_000).slice(-3).map(e => hash(e.hash));
              await limited(targets, async t => {
                done.add(t.offer + '|' + t.hour);
                const result = await node.call('probe_host', { community: c, membership: m, offer: hash(t.offer), storage });
                console.log(new Date().toISOString() + ' check ' + (result.success ? 'ok' : 'no response') + (result.full_copy ? ' (full copy)' : ''));
              });
            }
          } catch (e) { console.error('Synchronization pending: ' + String(e.message || e).slice(0, 200)); }
          for (let n = 0; n < tick / 1000 && !stop; n++) await pause(1000);
        }
      }
    }
  } finally { await cleanup(); }
} else console.log('Commands: prepare <private-recovery-file> | join <invitation-code | public-community-address> <private-recovery-file> | recover <private-recovery-file> [public-community-address] | offer | withdraw | status | run');

/** Founder, reviewers and organizers with the hosting permission (latest records win). */
function authorizedCheckers(gov) {
  const founder = gov.community.founder;
  const roles = new Map(), grants = new Map();
  for (const e of gov.events) {
    const b = e.data.body;
    if (b.type === 'peer_role') roles.set(b.member_id, b.enabled);
    if (b.type === 'admin_grant') grants.set(b.member_id, b.permissions);
  }
  const out = new Set([founder]);
  for (const [id, on] of roles) if (on) out.add(id);
  for (const [id, p] of grants) if (p.includes('hosting')) out.add(id);
  return [...out].sort();
}
