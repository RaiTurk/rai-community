// One-off local measurement (plan F): 1,000 members and a month of review
// buckets, then the interface's opening reads and a message send are timed.
// Not an acceptance threshold; the base for the deferred thresholds.
// Holochain stamps records when written, so all synthetic records land in
// today's buckets; the 30-day read still walks 30 day buckets.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startConductor, root } from './conductor.mjs';
import { newRecovery } from '../ui/core.mjs';
import { bind, pub, post } from './helpers04.mjs';

const MEMBERS = Number(process.env.RAI_SYNTHETIC_MEMBERS || 1000);
const MESSAGES = Number(process.env.RAI_SYNTHETIC_MESSAGES || 60);
const time = async (label, fn, out) => { const t = performance.now(); const v = await fn(); out[label] = Math.round(performance.now() - t); return v; };

const run = await startConductor();
const result = { members: MEMBERS, messages: MESSAGES, claims: 0, ms: {} };
try {
  const founder = await run.install('founder'), reader = await run.install('reader');
  const fr = await newRecovery();
  const c = await founder.call('create_community', { name: 'Synthetic load', founder: fr.memberId });
  const fm = await bind(founder, c, fr, 'Founder');
  const gate = await pub(founder, c, fm, { type: 'gate', open: true });
  const task = await pub(founder, c, fm, { type: 'task', id: 'load', title: 'Load task', description: '', post_url: '', actions: ['done'], archived: false });
  for (let i = 0; i < 20; i++) await pub(founder, c, fm, { type: 'goal', id: 'g' + i, title: 'Goal ' + i, target: 10, current: null, unit: '', context: '', archived: false });
  // One device binds many synthetic identities (integrity allows it; real members use their own devices).
  const started = performance.now();
  const memberships = [];
  for (let i = 0; i < MEMBERS; i++) {
    const r = await newRecovery();
    const m = await bind(reader, c, r, 'Member ' + i, { gate });
    memberships.push(m);
    if (i % 2 === 0) { await pub(reader, c, m, { type: 'claim', task, x_verification: null, actions: ['done'], note: '' }); result.claims++; }
    if (i % 100 === 99) console.log(`${i + 1} members…`);
  }
  result.ms.setup = Math.round(performance.now() - started);
  for (let i = 0; i < MESSAGES; i++) {
    await post(founder, c, fm, 'Synthetic message ' + i);
    await new Promise(r => setTimeout(r, 5100));
  }
  const day = 86_400_000_000, now = Date.now() * 1000;
  const open = {};
  await time('total', async () => {
    await Promise.all([
      time('governance_state', () => reader.call('governance_state', c), open),
      time('tasks', () => reader.call('tasks', c), open),
      time('goals', () => reader.call('goals', c), open),
      time('host_offers', () => reader.call('host_offers', c), open),
      time('messages_50', () => reader.call('messages', { community: c, channel: null, before_us: null, since_us: null, limit: 50 }), open),
      time('review_feed_30_days', () => reader.call('review_feed', { community: c, from_us: now - 30 * day, to_us: null }), open),
    ]);
  }, open);
  result.ms.open = open;
  result.ms.post_message = await (async () => { const t = performance.now(); await post(founder, c, fm, 'Timed message'); return Math.round(performance.now() - t); })();
  result.ms.review_queue = await (async () => { const t = performance.now(); await founder.call('review_queue', c); return Math.round(performance.now() - t); })();
  result.measuredAt = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
  await writeFile(join(root, '..', 'synthetic-load-0.4.0.json'), JSON.stringify(result, null, 2) + '\n');
} finally {
  await run.close();
}
