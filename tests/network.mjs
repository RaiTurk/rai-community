import test from 'node:test';
import assert from 'node:assert/strict';
import { startConductor, retry } from './conductor.mjs';
import { newRecovery, readRecovery } from '../ui/core.mjs';
import { hostingHours } from '../ui/raiunyt.mjs';
import { bind, pub, post, str, has } from './helpers04.mjs';

// Ported from 0.3: joining (now by invitation), chat, recovery proof, account
// attestation, claims, roles and hosting hours that survive recovery.
const month = () => new Date().toISOString().slice(0, 7);
async function verifiedHours(client, c, id) {
  const gov = await client.call('governance_state', c);
  const summaries = await client.call('hosting_summaries', { community: c, member_ids: [id], months: [month()] });
  const view = {
    community: gov.community,
    members: gov.members.map(m => ({ ...m, hash: str(m.hash) })),
    events: gov.events.map(e => ({ ...e, hash: str(e.hash), data: { ...e.data, membership: str(e.data.membership) } })),
    summaries: summaries.map(s => ({ ...s, data: { ...s.data, hours: s.data.hours.map(p => ({ ...p, checker: str(p.checker) })) } })),
  };
  return hostingHours(view).filter(h => h.memberId === id);
}

test('real hApp: invitation joining, chat, recovery proof, account attestation, claims and roles', { timeout: 300000 }, async () => {
  const run = await startConductor();
  try {
    const admin = await run.install('organizer'), a = await run.install('member'), b = await run.install('reviewer'), recovered = await run.install('recovered');
    const ar = await newRecovery(), ur = await newRecovery(), br = await newRecovery();
    const c = await admin.call('create_community', { name: 'Rai isolated test', founder: ar.memberId });
    const am = await bind(admin, c, ar, 'Organizer');
    const p = (client, m, body) => pub(client, c, m, body);
    const i1 = await admin.call('create_invite', { community: c, membership: am });
    const i2 = await admin.call('create_invite', { community: c, membership: am });
    const um = await bind(a, c, ur, 'Alice', { invitation: i1.invitation });
    const bm = await bind(b, c, br, 'Reviewer', { invitation: i2.invitation });

    const toggleHosting = enabled => p(a, um, { type: 'host_offer', enabled });
    const start = await toggleHosting(true);
    assert.deepEqual(await toggleHosting(true), start, 'retrying the active offer reuses its record');
    const stop = await toggleHosting(false);
    assert.notDeepEqual(await toggleHosting(true), start, 'starting again records a new offer');
    const secondStop = await toggleHosting(false);
    assert.notDeepEqual(secondStop, stop, 'stopping again records a new withdrawal');
    assert.deepEqual(await toggleHosting(false), secondStop, 'retrying the withdrawal reuses its record');
    assert.deepEqual((await a.call('host_offers', c)).map(e => e.data.body.enabled), [true, false, true, false]);
    const visible = await admin.call('governance_state', c);
    assert.ok(visible.members.some(m => m.data.member_id === ur.memberId), 'an invited join appears in the member list');

    const text = 'Hello <script>world</script> — merhaba 🌍';
    const chatHash = await post(a, c, um, text);
    await assert.rejects(post(a, c, um, 'too fast'), /60 seconds/, 'new-account cooldown');
    await assert.rejects(post(b, c, bm, '  '));
    await assert.rejects(post(b, c, bm, 'x'.repeat(401)));
    const seen = await retry(async () => {
      const page = await b.call('messages', { community: c, channel: null, before_us: null, since_us: null, limit: 50 });
      assert.ok(has(page.events, chatHash));
      return page;
    }, 60000);
    assert.equal(seen.events.find(e => str(e.hash) === str(chatHash)).data.body.text, text, 'the other peer sees the exact message');

    const bogus = { community: c, member_id: ur.memberId, generation: 0, previous: null, previous_cutoff: null, invitation: i1.invitation, gate: null, name: 'Impersonator', recovery_signature: Array(64).fill(0) };
    await assert.rejects(b.call('bind_member', bogus));
    await assert.rejects(p(a, um, { type: 'sampling', percent: 100 }));
    const grant = await p(admin, am, { type: 'peer_role', member_id: br.memberId, enabled: true });
    const challenge = 'rai-' + ur.memberId.slice(0, 12) + '-public-test';
    const xc = await p(a, um, { type: 'x_claim', handle: 'alice_example', post_url: 'https://x.com/alice_example/status/123', challenge });
    const xv = await retry(() => p(b, bm, { type: 'x_verify', claim: xc, role: grant, note: 'Read the public post, handle and challenge.' }), 60000);
    const task = await p(admin, am, { type: 'task', id: 'outreach-one', title: 'Share an explainer', description: 'Voluntary genuine support', post_url: 'https://x.com/RaiTurk_/status/123', actions: ['like', 'repost', 'quote', 'reply'], archived: false });
    await p(admin, am, { type: 'sampling', percent: 100 });
    const claim = { type: 'claim', task, x_verification: xv, actions: ['like', 'repost', 'quote', 'reply'], note: '' };
    const ch = await retry(() => p(a, um, claim), 60000);
    assert.equal(str(await p(a, um, claim)), str(ch), 'identical retries do not append');
    await p(admin, am, { type: 'sampling', percent: 0 });
    let queue = await retry(async () => { const q = await admin.call('review_queue', c); assert.equal(q.length, 1); return q; }, 60000);
    assert.equal(queue[0].reviewer, br.memberId, 'a policy change does not alter earlier sampling');
    await assert.rejects(p(a, um, { type: 'review', claim: ch, role: grant, outcome: 'supported', note: 'Self review is invalid' }));
    await retry(() => p(b, bm, { type: 'review', claim: ch, role: grant, outcome: 'supported', note: 'Compared named actions with the public contribution.' }), 60000);
    await retry(async () => assert.equal((await admin.call('review_queue', c)).length, 0), 60000);
    const revision = await p(a, um, { ...claim, actions: ['reply'] });
    await p(a, um, { type: 'flag', claim: revision, reason: 'Synthetic discrepancy for later claim revision test.' });
    queue = await retry(async () => { const q = await admin.call('review_queue', c); assert.equal(q.length, 1); return q; }, 60000);
    assert.equal(str(queue[0].claim), str(revision));
    assert.equal(queue[0].reported, true, 'a flag on a later report reaches the grouped campaign');

    // Signed hosting hour, then recovery on a new device.
    const offer = await a.call('ensure_hosting', { community: c, membership: um });
    const checked = await retry(async () => { const r = await admin.call('probe_host', { community: c, membership: am, offer, storage: [] }); assert.ok(r.success); return r; }, 60000);
    await retry(() => a.call('publish_hosting_summary', { community: c, membership: um, hours: [checked.proof] }), 60000);
    await p(admin, am, { type: 'peer_role', member_id: br.memberId, enabled: false });
    await retry(() => assert.rejects(p(b, bm, { type: 'x_verify', claim: xc, role: grant, note: 'Cannot use a revoked reviewer role' })), 60000);
    const beforeHours = await retry(async () => { const h = await verifiedHours(admin, c, ur.memberId); assert.equal(h.length, 1); return h; }, 60000);

    const gov = await admin.call('governance_state', c);
    const old = gov.members.find(m => str(m.hash) === str(um));
    const head = await recovered.call('device_chain_head', old.device);
    assert.ok(head >= old.sequence, 'the previous device chain head is readable');
    const restored = await readRecovery(ur.code);
    const newM = await bind(recovered, c, restored, 'Alice recovered', {}, old, head);
    await assert.rejects(p(a, um, claim), 'the old device is no longer authorized');
    const activity = await retry(async () => { const v = await recovered.call('member_activity', { community: c, member_id: ur.memberId }); assert.ok(has(v.events, ch)); return v; }, 60000);
    assert.ok(has(activity.events, xc), 'contribution history survives new-device binding');
    const history = await recovered.call('messages', { community: c, channel: null, before_us: null, since_us: null, limit: 50 });
    assert.ok(has(history.events, chatHash), 'chat history survives recovery');
    assert.deepEqual((await verifiedHours(recovered, c, ur.memberId)).map(h => h.hour), beforeHours.map(h => h.hour), 'verified hosting hours survive recovery');
    await assert.rejects(post(a, c, um, 'old device'));
    const restoredMessage = await post(recovered, c, newM, 'New device works');
    await p(admin, am, { type: 'decision', member_id: ur.memberId, removed: true, references: [restoredMessage], reason: 'Synthetic membership revocation for the isolated test.' });
    await retry(() => assert.rejects(post(recovered, c, newM, 'revoked member'), /revoked/i), 60000);
    console.log('PASS 0.4 invitations, signatures, role checks, one campaign, signed hours, recovery and retained history');
  } catch (e) { console.error(run.output().slice(-3500)); throw e; } finally { await run.close(); }
});
