import test from 'node:test';
import assert from 'node:assert/strict';
import { startConductor, retry } from './conductor.mjs';
import { newRecovery } from '../ui/core.mjs';
import { bind, pub, post, has, wait } from './helpers04.mjs';

// Plan C/F: a light client (target_arc_factor 0) with three full nodes.
// It joins, writes, reads older messages, keeps working with one full node
// down, cannot earn full-copy credit, and later switches to a full copy.
test('light client with three full nodes: join, write, read history, failover, storage check, switch to full copy', { timeout: 600000 }, async () => {
  const runs = [];
  try {
    const seed = 'rai-light-' + crypto.randomUUID();
    for (let i = 0; i < 3; i++) runs.push(await startConductor(seed));
    runs.push(await startConductor(seed, { arc: 0 }));
    const [f1, f2, f3, lightRun] = runs;
    const founder = await f1.install('founder'), full2 = await f2.install('full2'), full3 = await f3.install('full3');
    let light = await lightRun.install('light');
    const exchange = async () => {
      const infos = await retry(async () => { const rows = await Promise.all(runs.filter(r => !r.closed).map(r => r.admin.agentInfo({ dna_hashes: null }))); assert.ok(rows.every(r => r.length)); return rows.flat(); });
      await Promise.all(runs.filter(r => !r.closed).map(r => r.admin.addAgentInfo({ agent_infos: infos })));
    };
    await Promise.all([founder, full2, full3, light].map(c => c.call('identity')));
    await exchange();
    const fr = await newRecovery(), r2 = await newRecovery(), r3 = await newRecovery(), lr = await newRecovery();
    const c = await founder.call('create_community', { name: 'Light client test', founder: fr.memberId });
    const fm = await bind(founder, c, fr, 'Founder');
    const invite = async () => (await founder.call('create_invite', { community: c, membership: fm })).invitation;
    const m2 = await retry(async () => bind(full2, c, r2, 'Full two', { invitation: await invite() }), 90000);
    const m3 = await retry(async () => bind(full3, c, r3, 'Full three', { invitation: await invite() }), 90000);
    const early = await post(founder, c, fm, 'Before the light client joined');
    const lm = await retry(async () => bind(light, c, lr, 'Light', { invitation: await invite() }), 120000);

    const lightMessage = await retry(() => post(light, c, lm, 'Hello from a light client'), 90000);
    await retry(async () => {
      const page = await full2.call('messages', { community: c, channel: null, before_us: null, since_us: null, limit: 50 });
      assert.ok(has(page.events, lightMessage), 'a full node received the light client message');
    }, 120000);
    await retry(async () => {
      const page = await light.call('messages', { community: c, channel: null, before_us: null, since_us: null, limit: 50 });
      assert.ok(has(page.events, early), 'the light client reads messages written before it joined');
    }, 120000);

    // One full node goes away; the light client keeps reading and writing.
    await f3.close(); f3.closed = true;
    const goal = await pub(founder, c, fm, { type: 'goal', id: 'g1', title: 'After a node left', target: 1, current: null, unit: '', context: '', archived: false });
    await retry(async () => assert.ok(has(await light.call('goals', c), goal)), 120000);
    await wait(61_000); // a new account waits 60 seconds between messages
    await retry(() => post(light, c, lm, 'Still here with one full node down'), 120000);

    // Storage check: records the light client never read are not in its store.
    const unseen = [];
    for (const id of ['s1', 's2', 's3']) unseen.push(await pub(founder, c, fm, { type: 'task', id, title: 'Unseen ' + id, description: '', post_url: '', actions: ['done'], archived: false }));
    const offer = await retry(() => light.call('ensure_hosting', { community: c, membership: lm }), 90000);
    const lightCheck = await retry(async () => { const r = await founder.call('probe_host', { community: c, membership: fm, offer, storage: unseen }); assert.ok(r.success, r.detail); return r; }, 120000);
    assert.equal(lightCheck.full_copy, false, 'a device without the copy cannot earn full-copy credit');
    const fullOffer = await full2.call('ensure_hosting', { community: c, membership: m2 });
    const fullCheck = await retry(async () => { const r = await founder.call('probe_host', { community: c, membership: fm, offer: fullOffer, storage: unseen }); assert.ok(r.full_copy, r.detail); return r; }, 180000);
    assert.equal(fullCheck.success, true, 'a full node passes the storage check');

    // Switch the light client to a full copy (same data, new setting).
    await lightRun.restart({ arc: 1 });
    light = await lightRun.reconnect('light');
    await exchange();
    await retry(async () => { const r = await founder.call('probe_host', { community: c, membership: fm, offer, storage: unseen }); assert.ok(r.full_copy, r.detail); }, 300000);
    console.log('PASS light client joined, wrote, read history, survived a node leaving, failed the storage check, then passed it as a full copy');
  } catch (e) { for (const r of runs) console.error(r.output().slice(-2000)); throw e; } finally { for (const r of runs) { try { await r.close(); } catch { /* already closed */ } } }
});
