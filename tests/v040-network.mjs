import test from 'node:test';
import assert from 'node:assert/strict';
import { startConductor, retry } from './conductor.mjs';
import { newRecovery } from '../ui/core.mjs';
import { bind, pub, post, str, wait, has } from './helpers04.mjs';

// 0.4 through the shipping coordinator: invitations and the gate, narrow reads,
// message rules, narrowed organizer powers, trial card, signed hosting hours.
test('0.4: invitations, narrow reads, message rules, permissions, hosting summary', { timeout: 600000 }, async () => {
  const run = await startConductor();
  try {
    const founder = await run.install('founder'), org = await run.install('organizer'), mem = await run.install('member'), stranger = await run.install('stranger');
    const fr = await newRecovery(), or = await newRecovery(), mr = await newRecovery(), sr = await newRecovery();
    const c = await founder.call('create_community', { name: 'Rai 0.4 isolated test', founder: fr.memberId });
    const fm = await bind(founder, c, fr, 'Founder');

    // Invitation gate (default: invitation required).
    await assert.rejects(bind(stranger, c, sr, 'Stranger'), /invitation is required/i);
    const invite = await founder.call('create_invite', { community: c, membership: fm });
    const om = await retry(() => bind(org, c, or, 'Organizer', { invitation: invite.invitation }), 60000);
    await assert.rejects(bind(mem, c, mr, 'Member', { invitation: invite.invitation }), /already used|kullanılmış/i, 'single use');
    const code = await pub(founder, c, fm, { type: 'campaign_code', max_uses: 2, expires_at_us: Date.now() * 1000 + 86400e6, active: true });
    const mm = await retry(() => bind(mem, c, mr, 'Member', { invitation: code }), 60000);
    const state = await retry(async () => {
      const s = await founder.call('governance_state', c);
      assert.equal(new Set(s.members.map(m => m.data.member_id)).size, 3);
      return s;
    }, 60000);
    assert.deepEqual(state.excluded_members, []);
    assert.equal(state.joins.length, 2, 'invitation tree has two valid joins');
    assert.ok(state.joins.every(j => j.invited_by === fr.memberId));

    // Narrowed permissions: a tasks organizer cannot write the trial card or a release.
    const grant = await pub(founder, c, fm, { type: 'admin_grant', member_id: or.memberId, permissions: ['tasks'] });
    await retry(async () => assert.ok(has((await org.call('governance_state', c)).events, grant)), 60000);
    const task = await pub(org, c, om, { type: 'task', id: 't1', title: 'Share', description: '', post_url: '', actions: ['done'], archived: false });
    await assert.rejects(pub(org, c, om, { type: 'trial_card', title_tr: 'x', title_en: 'x', target: 5, hidden: false }), /founder/i);
    await assert.rejects(pub(org, c, om, { type: 'module', module: 'community-ui', version: 1, kind: 'goal-status', payload: '{"id":"g"}', admin: true }), /permission/i);
    await assert.rejects(pub(founder, c, fm, { type: 'module', module: 'community-ui', version: 1, kind: 'windows-release', payload: JSON.stringify({ version: '0.4.1', url: 'https://example.org/x.exe' }), admin: true }), /SHA-256/i, 'release needs a hash');
    await pub(founder, c, fm, { type: 'trial_card', title_tr: '50 kişi denesin', title_en: '50 people try it', target: 50, hidden: false });
    const tasks = await retry(async () => { const t = await mem.call('tasks', c); assert.ok(has(t, task)); return t; }, 60000);
    assert.equal(tasks.length, 1, 'tasks read only the task index');

    // Messages: 400 characters, 60 s for new accounts, no links for new accounts.
    await assert.rejects(post(mem, c, mm, 'x'.repeat(401)), /400/);
    await assert.rejects(post(mem, c, mm, 'see example.com'), /links/i);
    const first = await retry(() => post(mem, c, mm, 'Merhaba'), 60000);
    await assert.rejects(post(mem, c, mm, 'Again'), /60 seconds/);
    const f1 = await post(founder, c, fm, 'Founder message');
    await assert.rejects(post(founder, c, fm, 'too soon'), /5 seconds/);
    await wait(5200);
    await post(founder, c, fm, 'Founder link https://holochain.org is fine');
    const page = await retry(async () => {
      const p = await founder.call('messages', { community: c, channel: null, before_us: null, since_us: null, limit: 50 });
      assert.equal(p.events.length, 3);
      return p;
    }, 60000);
    assert.ok(has(page.events, first) && has(page.events, f1));
    const since = await founder.call('messages', { community: c, channel: null, before_us: null, since_us: page.events[1].timestamp_us, limit: 50 });
    assert.equal(since.events.length, 1, 'incremental refresh returns only newer messages');

    // Claims go to member activity and the review bucket.
    const claim = await pub(mem, c, mm, { type: 'claim', task, x_verification: null, actions: ['done'], note: '' });
    await retry(async () => {
      const a = await founder.call('member_activity', { community: c, member_id: mr.memberId });
      assert.ok(has(a.events, claim));
      const feed = await founder.call('review_feed', { community: c, from_us: null, to_us: null });
      assert.ok(has(feed, claim));
    }, 60000);

    // Signed hosting: reviewer checks the member; the member publishes a summary.
    await pub(founder, c, fm, { type: 'peer_role', member_id: or.memberId, enabled: true });
    const offer = await mem.call('ensure_hosting', { community: c, membership: mm });
    assert.deepEqual(str(await mem.call('ensure_hosting', { community: c, membership: mm })), str(offer));
    await assert.rejects(mem.call('probe_host', { community: c, membership: mm, offer }), /measure hosting/);
    const result = await retry(async () => {
      const r = await org.call('probe_host', { community: c, membership: om, offer, storage: [task, grant, fm] });
      assert.equal(r.success, true, r.detail);
      return r;
    }, 90000);
    assert.equal(result.full_copy, true, 'a full node holds the shared records');
    const summary = await mem.call('publish_hosting_summary', { community: c, membership: mm, hours: [result.proof] });
    assert.equal(summary.length, 1);
    const month = new Date().toISOString().slice(0, 7);
    await retry(async () => {
      const s = await founder.call('hosting_summaries', { community: c, member_ids: [mr.memberId], months: [month] });
      assert.equal(s.length, 1);
      assert.equal(s[0].data.hours.length, 1);
      assert.equal(s[0].member_id, mr.memberId);
    }, 60000);
    // A tampered proof (flipped full-copy flag) is rejected by validation.
    const forged = { ...result.proof, full_copy: !result.proof.full_copy, hour_us: result.proof.hour_us };
    await assert.rejects(mem.call('publish_hosting_summary', { community: c, membership: mm, hours: [forged] }).then(r => { if (!r.length) throw Error('dropped'); }), /checker signature|dropped/i);

    // Members can invite only after their first week; organizers right away.
    await assert.rejects(mem.call('create_invite', { community: c, membership: mm }), /first week/);
    await pub(founder, c, fm, { type: 'admin_grant', member_id: or.memberId, permissions: ['tasks', 'membership'] });
    await retry(() => org.call('create_invite', { community: c, membership: om }), 60000);
    // Membership organizers turn member invitations off.
    await retry(() => pub(org, c, om, { type: 'invite_settings', members_can_invite: false, revoke_before_us: 0 }), 60000);
  } finally {
    await run.close();
  }
});
