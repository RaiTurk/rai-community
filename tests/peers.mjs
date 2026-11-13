import test from 'node:test';
import assert from 'node:assert/strict';
import { startConductor, retry } from './conductor.mjs';
import { newRecovery } from '../ui/core.mjs';
import { hostingHours, balanceOf, ledger } from '../ui/raiunyt.mjs';
import { bind, pub, str, has } from './helpers04.mjs';

const month = () => new Date().toISOString().slice(0, 7);
const view = async (client, c, ids) => {
  const gov = await client.call('governance_state', c);
  const summaries = await client.call('hosting_summaries', { community: c, member_ids: ids, months: [month()] });
  return {
    community: gov.community,
    members: gov.members.map(m => ({ ...m, hash: str(m.hash) })),
    events: gov.events.map(e => ({ ...e, hash: str(e.hash), data: { ...e.data, membership: str(e.data.membership) } })),
    summaries: summaries.map(s => ({ ...s, data: { ...s.data, hours: s.data.hours.map(p => ({ ...p, checker: str(p.checker) })) } })),
  };
};

test('three independent conductor processes: signed hours handed to the host, summary, withdrawal', { timeout: 400000 }, async () => {
  const runs = [];
  try {
    const seed = 'rai-peers-' + crypto.randomUUID();
    for (let i = 0; i < 3; i++) runs.push(await startConductor(seed));
    const owner = await runs[0].install('owner'), host = await runs[1].install('host'), observer = await runs[2].install('observer');
    await Promise.all([owner, host, observer].map(c => c.call('identity')));
    const infos = await retry(async () => { const rows = await Promise.all(runs.map(r => r.admin.agentInfo({ dna_hashes: null }))); assert.ok(rows.every(r => r.length)); return rows.flat(); });
    await Promise.all(runs.map(r => r.admin.addAgentInfo({ agent_infos: infos })));
    const a = await newRecovery(), h = await newRecovery(), o = await newRecovery();
    const c = await owner.call('create_community', { name: 'Separate service test', founder: a.memberId });
    const am = await bind(owner, c, a, 'Owner');
    const i1 = await owner.call('create_invite', { community: c, membership: am });
    const i2 = await owner.call('create_invite', { community: c, membership: am });
    const hm = await retry(() => bind(host, c, h, 'Host', { invitation: i1.invitation }), 90000);
    const om = await retry(() => bind(observer, c, o, 'Observer', { invitation: i2.invitation }), 90000);
    const role = await pub(owner, c, am, { type: 'peer_role', member_id: o.memberId, enabled: true });
    const shared = await pub(owner, c, am, { type: 'task', id: 'shared', title: 'Shared record', description: '', post_url: '', actions: ['done'], archived: false });
    const automaticOffer = () => host.call('ensure_hosting', { community: c, membership: hm });
    const offer = await retry(automaticOffer, 90000);
    assert.deepEqual(await automaticOffer(), offer, 'automatic registration does not publish duplicates');
    await assert.rejects(host.call('probe_host', { community: c, membership: hm, offer, storage: [] }), /measure hosting/);

    // Collect what the host's interface receives.
    const received = [];
    host.app.on('signal', s => { if (s?.value?.payload?.type === 'attestation') received.push(s.value.payload.proof); });
    await retry(async () => assert.ok(has(await observer.call('governance_state', c).then(s => s.events), role)), 90000);
    const observed = await retry(async () => { const r = await observer.call('probe_host', { community: c, membership: om, offer, storage: [shared, role, am] }); assert.ok(r.success, r.detail); return r; }, 120000);
    assert.equal(observed.delivered, true, 'the attestation reached the host');
    assert.equal(observed.proof.nonce.length, 32);
    await retry(async () => assert.equal(received.length, 1), 30000);
    assert.equal(received[0].full_copy, observed.full_copy);
    const ownCheck = await retry(async () => { const r = await owner.call('probe_host', { community: c, membership: am, offer, storage: [] }); assert.ok(r.success); return r; }, 90000);
    assert.equal(ownCheck.full_copy, false, 'no storage challenge, no full-copy credit');
    // The founder measures without a reviewer role; both hand-overs stay with the host until the summary.
    await retry(async () => assert.equal(received.length, 2), 30000);
    const published = await retry(() => host.call('publish_hosting_summary', { community: c, membership: hm, hours: received }), 120000);
    assert.equal(published.length, 1);
    const v = await retry(async () => { const x = await view(owner, c, [h.memberId]); assert.equal(x.summaries.length, 1); return x; }, 90000);
    const hours = hostingHours(v).filter(x => x.memberId === h.memberId);
    assert.equal(hours.length, 1, 'two checks in one hour count once');
    assert.ok(hours.every(x => x.hosts === 1 && x.multiplier === 3), 'the sole reachable host gets the ×3 scarcity bonus');
    assert.equal(balanceOf(ledger(v), h.memberId, 'hosting'), 3);
    console.log('PASS checks across separate processes; attestations reached the host; one summary carries the hour.');

    // Withdrawal stops challenges; a later automatic start is a new offer.
    await pub(host, c, hm, { type: 'host_offer', enabled: false });
    const hour = Date.now() * 1000 - (Date.now() * 1000) % 3_600_000_000;
    await assert.rejects(host.call('service_echo', { offer, nonce: Array(32).fill(1), hour_us: hour, storage: [] }));
    const failed = await observer.call('probe_host', { community: c, membership: om, offer, storage: [] }).catch(e => ({ success: false, detail: String(e) }));
    assert.equal(failed.success, false, 'a withdrawn offer is not checked successfully');
    const restarted = await automaticOffer();
    assert.notDeepEqual(restarted, offer, 'automatic startup resumes after a withdrawal');
    await retry(async () => assert.ok(has(await observer.call('host_offers', c), restarted)), 90000);
    runs[1].child.kill();
    const after = await retry(async () => { const x = await view(observer, c, [h.memberId]); assert.equal(x.summaries.length, 1); return x; }, 90000);
    assert.equal(hostingHours(after).filter(x => x.memberId === h.memberId).length, 1);
    console.log('PASS opt-out stops challenges; the signed summary stayed readable after the host process stopped.');
  } catch (e) { for (const r of runs) console.error(r.output().slice(-2200)); throw e; } finally { for (const r of runs) await r.close(); }
});
