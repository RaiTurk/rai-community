import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { startConductor, root, retry } from './conductor.mjs';
import { newRecovery, signRecovery } from '../ui/core.mjs';
import { bind, pub, post, str, wait, has } from './helpers04.mjs';

// A member replaces their own coordinator with one that writes raw records,
// skipping every coordinator check. Integrity must still refuse what matters (plan F, J1).
test('replaced coordinator: forged powers, proofs, invitations and messages are refused by integrity', { timeout: 400000 }, async () => {
  const built = spawnSync(process.execPath, ['tools/rust.mjs', 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'rai_community', '--features', 'adversarial-test'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const wasm = new Uint8Array(await readFile(join(root, '.build/wasm32-unknown-unknown/release/rai_community.wasm')));
  // Restore the shipping wasm for the other tests.
  spawnSync(process.execPath, ['tools/rust.mjs', 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'rai_community'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  const run = await startConductor();
  try {
    const owner = await run.install('owner'), member = await run.install('member'), next = await run.install('next'), org = await run.install('org'), outsider = await run.install('outsider');
    const o = await newRecovery(), u = await newRecovery(), g = await newRecovery(), x = await newRecovery();
    const c = await owner.call('create_community', { name: 'Adversarial isolated test', founder: o.memberId });
    const om = await bind(owner, c, o, 'Owner');
    const inv = await owner.call('create_invite', { community: c, membership: om });
    const inv2 = await owner.call('create_invite', { community: c, membership: om });
    const um = await bind(member, c, u, 'Member', { invitation: inv.invitation });
    const gm = await bind(org, c, g, 'Organizer', { invitation: inv2.invitation });
    const grant = await pub(owner, c, om, { type: 'admin_grant', member_id: g.memberId, permissions: ['tasks', 'membership'] });
    const role = await pub(owner, c, om, { type: 'peer_role', member_id: g.memberId, enabled: true });
    const oldEvent = await pub(member, c, um, { type: 'host_offer', enabled: true });
    const announce = await pub(owner, c, om, { type: 'channel', id: 'duyuru', name: 'Duyuru', admins_only: true, archived: false });
    const xTask = await pub(owner, c, om, { type: 'task', id: 'x-task', title: 'X task', description: '', post_url: 'https://x.com/RaiTurk_/status/1', actions: ['like'], archived: false });

    const event = (body, authority = null) => ({ type: 'Event', community: c, membership: um, body, authority });
    await assert.rejects(member.call('adversarial_write', event({ type: 'sampling', percent: 0 })), 'the shipping coordinator exposes no raw writer');
    const evil = { manifest: { zomes: [{ name: 'rai_community', path: 'evil.wasm', dependencies: [{ name: 'rai_integrity' }] }] }, resources: { 'evil.wasm': wasm } };
    await run.admin.updateCoordinators({ cell_id: member.cell, source: { type: 'bundle', value: evil } });
    await run.admin.updateCoordinators({ cell_id: org.cell, source: { type: 'bundle', value: evil } });
    const raw = entry => member.call('adversarial_write', entry);
    const rawOrg = entry => org.call('adversarial_write', entry);

    // Organizer powers cannot be self-issued.
    await assert.rejects(raw(event({ type: 'sampling', percent: 0 })), 'integrity blocks a non-organizer');
    await assert.rejects(raw(event({ type: 'peer_role', member_id: u.memberId, enabled: true })), 'no self-appointed reviewer');
    await assert.rejects(raw(event({ type: 'admin_grant', member_id: u.memberId, permissions: ['tasks'] })), 'only the founder grants');
    const linkless = { type: 'task', id: 'forged', title: 'Forged', description: '', post_url: '', actions: ['done'], archived: false };
    await assert.rejects(raw(event(linkless)), 'a task needs the tasks permission');
    await assert.rejects(raw(event(linkless, oldEvent)), 'an arbitrary record is not a grant');
    await assert.rejects(raw(event({ type: 'hosting_policy', multipliers: [10, 10] })), 'hosting settings need permission');
    await assert.rejects(raw(event({ type: 'claim', task: xTask, x_verification: null, actions: ['like'], sampling: null, note: '' })), 'an X task needs account verification');
    await raw(event({ type: 'module', module: 'poll', version: 1, kind: 'vote', payload: '{"choice":1}', admin: false }));

    // Narrowed organizer powers (D5): a tasks+membership organizer cannot write founder records.
    const asOrg = (body) => rawOrg({ type: 'Event', community: c, membership: gm, body, authority: grant });
    await assert.rejects(asOrg({ type: 'trial_card', title_tr: 'x', title_en: 'x', target: 1, hidden: false }), 'only the founder edits the trial card');
    await assert.rejects(asOrg({ type: 'campaign_code', max_uses: 1000, expires_at_us: Date.now() * 1000 + 86400e6, active: true }), 'only the founder creates campaign codes');
    await assert.rejects(asOrg({ type: 'gate', open: true }), 'only the founder opens the gate');
    await assert.rejects(asOrg({ type: 'module', module: 'community-ui', version: 1, kind: 'goal-status', payload: '{"id":"g"}', admin: true }), 'goal status needs the goals permission');
    await assert.rejects(asOrg({ type: 'module', module: 'community-ui', version: 1, kind: 'windows-release-auto', payload: '{"plan":"x"}', admin: true }), 'announcing needs the release permission');
    await assert.rejects(asOrg({ type: 'module', module: 'anything', version: 1, kind: 'question', payload: '{}', admin: true }), 'unknown admin modules are founder-only');
    await asOrg({ type: 'task', id: 'ok', title: 'Allowed', description: '', post_url: '', actions: ['done'], archived: false });
    await assert.rejects(raw(event({ type: 'module', module: 'community-ui', version: 1, kind: 'windows-release', payload: '{"version":"9.9.9","url":"https://x.test/a.exe"}', admin: true })), 'a release needs the founder');

    // Messages (J1): 400 characters, organizer-only channels, new-account links and pace.
    const msg = (text, channel = null) => ({ type: 'Message', community: c, membership: um, channel, id: Array(16).fill(7), text, authority: null });
    await assert.rejects(raw(msg('x'.repeat(401))), /400/);
    await assert.rejects(raw(msg('not an organizer', announce)), 'organizer-only channel');
    await assert.rejects(raw(msg('visit example.com today')), /links/i, 'new accounts cannot post links');
    await assert.rejects(raw({ ...msg('short id'), id: [1, 2] }), 'a message id is 16 bytes');
    await raw(msg('first'));
    await assert.rejects(raw(msg('second right away')), /60 seconds/, 'new accounts wait 60 seconds even with a replaced coordinator');

    // Hosting proofs (B1, G1): forged signatures and self-measurement are refused.
    const now = Date.now() * 1000, hour = now - (now % 3_600_000_000);
    const fakeProof = { hour_us: hour, nonce: Array(32).fill(1), host_signature: Array(64).fill(2), full_copy: true, observed_at_us: hour + 1, checker: gm, checker_authority: role, checker_signature: Array(64).fill(3) };
    await assert.rejects(raw({ type: 'HostingSummary', community: c, membership: um, offer: oldEvent, hours: [fakeProof] }), /signature/i, 'a forged proof is refused');
    await assert.rejects(raw({ type: 'HostingSummary', community: c, membership: um, offer: oldEvent, hours: [{ ...fakeProof, checker: um, checker_authority: null }] }), 'a member cannot check itself');
    // A real hour, then a tampered copy (full copy flag flipped).
    const real = await retry(async () => { const r = await owner.call('probe_host', { community: c, membership: om, offer: oldEvent, storage: [] }); assert.ok(r.success); return r; }, 60000);
    await raw({ type: 'HostingSummary', community: c, membership: um, offer: oldEvent, hours: [real.proof] });
    await assert.rejects(raw({ type: 'HostingSummary', community: c, membership: um, offer: oldEvent, hours: [{ ...real.proof, full_copy: !real.proof.full_copy }] }), /checker signature/i);
    await assert.rejects(raw({ type: 'HostingSummary', community: c, membership: um, offer: oldEvent, hours: [{ ...real.proof, hour_us: real.proof.hour_us - 3_600_000_000, observed_at_us: real.proof.observed_at_us - 3_600_000_000 }] }), /signature/i, 'a proof cannot be moved to another hour');

    // Invitations (I): a member invites only after a week; joining needs a valid invitation.
    await assert.rejects(raw({ type: 'Invite', community: c, membership: um, expires_at_us: now + 86400e6, settings: null, quota: null, authority: null }), /first week/i);
    await assert.rejects(raw({ type: 'Invite', community: c, membership: um, expires_at_us: now + 30 * 86400e6, settings: null, quota: null, authority: null }), /7 days/i);
    const member4 = (via, name = 'Intruder') => ({ community: c, member_id: x.memberId, generation: 0, previous: null, previous_cutoff: null, invitation: via.invitation ?? null, gate: via.gate ?? null, name, recovery_signature: [] });
    const signed = async (client, m) => ({ ...m, recovery_signature: await signRecovery(x.key, await client.call('binding_challenge', m)) });
    await run.admin.updateCoordinators({ cell_id: outsider.cell, source: { type: 'bundle', value: evil } });
    await assert.rejects(outsider.call('adversarial_write', { type: 'Member', ...(await signed(outsider, member4({}))) }), /invitation is required/i, 'no invitation, no membership');
    await assert.rejects(outsider.call('adversarial_write', { type: 'Member', ...(await signed(outsider, member4({ invitation: oldEvent }))) }), /invitation/i, 'an arbitrary record is not an invitation');
    const closedGate = await pub(owner, c, om, { type: 'gate', open: false });
    await assert.rejects(outsider.call('adversarial_write', { type: 'Member', ...(await signed(outsider, member4({ gate: closedGate }))) }), /open gate/i, 'a closed gate does not admit');
    // Reusing a used single-use invitation: integrity cannot see later uses, the shared projection excludes it.
    await outsider.call('adversarial_write', { type: 'Member', ...(await signed(outsider, member4({ invitation: inv.invitation }, 'Second use'))) });
    const state = await retry(async () => { const s = await owner.call('governance_state', c); assert.ok(s.excluded_members.includes(x.memberId)); return s; }, 60000);
    assert.equal(state.excluded_members.length, 1, 'only the second use is excluded');

    // Recovery cutoff (0.3 rule): the signed cutoff keeps history and excludes later old-device writes.
    const gov = await next.call('governance_state', c);
    const old = gov.members.find(m => str(m.hash) === str(um));
    const cutoff = await retry(async () => { const h = await next.call('device_chain_head', old.device); assert.ok(h !== null && h >= old.sequence); return h; }, 60000);
    const tampered = { community: c, member_id: u.memberId, name: 'Recovered', generation: 1, previous: um, previous_cutoff: cutoff, invitation: null, gate: null, recovery_signature: [] };
    tampered.recovery_signature = await signRecovery(u.key, await next.call('binding_challenge', tampered));
    await assert.rejects(next.call('bind_member', { ...tampered, previous_cutoff: cutoff + 1 }), 'the cutoff is covered by the recovery signature');
    await next.call('bind_member', tampered);
    const forged = await raw(event({ type: 'host_offer', enabled: false }));
    const offers = await retry(async () => { const v = await next.call('host_offers', c); assert.ok(has(v, oldEvent)); return v; }, 60000);
    assert.ok(!has(offers, forged), 'a write by the old device after the cutoff is excluded');
    assert.ok((await next.call('locate_memberships', u.memberId)).length >= 2);
    console.log('PASS raw writes: privileges, narrowed modules, message rules, forged proofs, forged invitations and recovery cutoff');
  } catch (e) { console.error(run.output().slice(-4000)); throw e; } finally { await run.close(); }
});
