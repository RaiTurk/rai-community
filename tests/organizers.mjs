import { settingBody } from '../ui/community-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startConductor, retry } from './conductor.mjs';
import { newRecovery } from '../ui/core.mjs';
import { bind, pub, post, str, wait, has } from './helpers04.mjs';

const SHA = 'cd'.repeat(32);
// 0.4 rules through the real coordinator: delegated and narrowed permissions,
// revocation, organizer-only channels, linkless tasks, hosting policy, modules.
test('0.4: delegated organizers, narrowed modules, revocation, channels, linkless tasks, hosting policy', { timeout: 300000 }, async () => {
  const run = await startConductor();
  try {
    const founder = await run.install('founder'), org = await run.install('organizer'), mem = await run.install('member');
    const fr = await newRecovery(), or = await newRecovery(), mr = await newRecovery();
    const c = await founder.call('create_community', { name: 'Rai 0.4 organizer test', founder: fr.memberId });
    const fm = await bind(founder, c, fr, 'Founder');
    // The founder opens the gate: joining without an invitation is then allowed.
    const gate = await pub(founder, c, fm, { type: 'gate', open: true });
    const om = await bind(org, c, or, 'Organizer', { gate });
    const mm = await bind(mem, c, mr, 'Member', { gate });
    const p = (client, m, body) => pub(client, c, m, body);

    await assert.rejects(p(org, om, { type: 'task', id: 't0', title: 'No', description: '', post_url: '', actions: ['done'], archived: false }), 'no grant yet');
    const grant = await p(founder, fm, { type: 'admin_grant', member_id: or.memberId, permissions: ['tasks', 'channels'] });
    await assert.rejects(p(org, om, { type: 'admin_grant', member_id: mr.memberId, permissions: ['tasks'] }), 'organizers cannot make organizers');
    await assert.rejects(p(founder, fm, { type: 'admin_grant', member_id: fr.memberId, permissions: [] }), 'the founder cannot be changed');
    await assert.rejects(org.call('probe_host', { community: c, membership: om, offer: grant, storage: [] }), /measure hosting/, 'tasks and channels do not include measuring');

    const long = 'ğ'.repeat(10000);
    const task = await retry(() => p(org, om, { type: 'task', id: 't1', title: 'Okul sunumu', description: long, post_url: '', actions: ['done'], archived: false }), 60000);
    await assert.rejects(p(org, om, { type: 'task', id: 't2', title: 'Too long', description: long + 'ğ', post_url: '', actions: ['done'], archived: false }));
    await assert.rejects(p(org, om, { type: 'sampling', percent: 50 }), 'no sampling permission');
    const taskEvent = await retry(async () => { const v = (await founder.call('tasks', c)).find(e => str(e.hash) === str(task)); assert.ok(v); return v; }, 60000);
    assert.equal(str(taskEvent.data.authority), str(grant), 'the coordinator attached the grant');

    await retry(() => p(mem, mm, { type: 'claim', task, x_verification: null, actions: ['done'], note: 'Sınıfta anlattım' }), 60000);
    await assert.rejects(p(mem, mm, { type: 'claim', task, x_verification: null, actions: ['like'], note: '' }));
    const archived = await p(org, om, { ...taskEvent.data.body, archived: true });
    await retry(() => assert.rejects(p(mem, mm, { type: 'claim', task, x_verification: null, actions: ['done'], note: 'While archived' }), /task is archived/), 60000);
    const restored = await p(org, om, taskEvent.data.body);
    assert.notEqual(str(restored), str(task), 'restoring creates an active version');
    assert.notEqual(str(restored), str(archived));
    await retry(() => p(mem, mm, { type: 'claim', task: restored, x_verification: null, actions: ['done'], note: 'After restoring' }), 60000);

    // Organizer-only channel: the organizer writes, the member cannot; closing blocks everyone.
    const ch = await p(org, om, { type: 'channel', id: 'duyuru', name: 'Duyurular', admins_only: true, archived: false });
    await retry(() => post(org, c, om, 'Hoş geldiniz', ch), 60000);
    await retry(() => assert.rejects(post(mem, c, mm, 'Ben de yazayım', ch), /organizers/i), 60000);
    await post(mem, c, mm, 'Genel kanalda');
    const open = await p(org, om, { type: 'channel', id: 'duyuru', name: 'Duyurular', admins_only: false, archived: false });
    await wait(61000); // new accounts wait 60 seconds between messages
    const m4 = await retry(() => post(mem, c, mm, 'Artık herkes yazar', ch), 60000);
    const page = await retry(async () => { const v = await founder.call('messages', { community: c, channel: 'duyuru', before_us: null, since_us: null, limit: 50 }); assert.ok(has(v.events, m4)); return v; }, 60000);
    assert.equal(str(page.events.find(e => str(e.hash) === str(m4)).data.body.channel), str(open), 'a message goes to the latest channel version');
    const closed = await p(org, om, { type: 'channel', id: 'duyuru', name: 'Duyurular', admins_only: false, archived: true });
    assert.notEqual(str(closed), str(ch));
    const reopened = await p(org, om, { type: 'channel', id: 'duyuru', name: 'Duyurular', admins_only: false, archived: false });
    assert.notEqual(str(reopened), str(open), 'reopening writes a new version (0.3 reused the old record)');
    await p(org, om, { type: 'channel', id: 'duyuru', name: 'Duyurular', admins_only: false, archived: true });
    await wait(61000);
    await retry(() => assert.rejects(post(mem, c, mm, 'Kapalı', ch), /closed/i), 60000);

    // Hosting policy: founder here; multipliers must not increase with more hosts.
    await assert.rejects(p(org, om, { type: 'hosting_policy', multipliers: [4, 2] }), 'no hosting permission');
    await assert.rejects(p(founder, fm, { type: 'hosting_policy', multipliers: [2, 3] }));
    await p(founder, fm, { type: 'hosting_policy', multipliers: [4, 2] });

    // Modules: member modules stay open; 0.4 binds each admin module to one permission.
    await p(mem, mm, { type: 'module', module: 'poll', version: 1, kind: 'vote', payload: '{"choice":2}', admin: false });
    await assert.rejects(p(mem, mm, { type: 'module', module: 'poll', version: 1, kind: 'question', payload: '{}', admin: true }));
    await assert.rejects(p(org, om, { type: 'module', module: 'poll', version: 1, kind: 'question', payload: '{"q":"?"}', admin: true }), /permission|founder/i, 'unknown admin modules are founder-only now');
    await p(founder, fm, { type: 'module', module: 'poll', version: 1, kind: 'question', payload: '{"q":"?"}', admin: true });

    const star = settingBody('task-star', { id: 't1', enabled: true });
    const pin = settingBody('task-pin', { id: 't1', enabled: true });
    const completed = settingBody('goal-status', { id: 'g1', completed: true });
    const release = settingBody('windows-release', { version: '0.4.0', url: 'https://example.com/installer.exe', sha256: SHA });
    await assert.rejects(p(mem, mm, star));
    await p(org, om, star);
    await p(org, om, pin);
    await assert.rejects(p(org, om, completed));
    await assert.rejects(p(org, om, release));
    await p(founder, fm, completed);
    await p(founder, fm, release);
    const plan = await p(founder, fm, settingBody('windows-release-plan', { version: '0.4.1', url: 'https://example.com/next.exe', sha256: SHA }));
    const trigger = settingBody('windows-release-auto', { plan: str(plan) });
    await assert.rejects(p(org, om, trigger), /permission/i, 'announcing needs the release permission');
    const releaseGrant = await p(founder, fm, { type: 'admin_grant', member_id: or.memberId, permissions: ['tasks', 'channels', 'release'] });
    await retry(async () => assert.ok(has((await org.call('governance_state', c)).events, releaseGrant)), 60000);
    const announced = await p(org, om, trigger);
    assert.equal(str(await p(org, om, trigger)), str(announced), 'retrying a trigger is idempotent');
    const later = await p(founder, fm, settingBody('windows-release-plan', { version: '0.4.2', url: 'https://example.com/later.exe', sha256: SHA }));
    await retry(() => assert.rejects(p(org, om, trigger), /staged Windows release has changed/), 60000);
    await p(founder, fm, { type: 'admin_grant', member_id: or.memberId, permissions: ['tasks', 'channels'] });
    await retry(() => assert.rejects(p(org, om, settingBody('windows-release-auto', { plan: str(later) })), /permission/i), 60000);

    // Revocation: earlier organizer actions stay, later ones are refused.
    await p(founder, fm, { type: 'admin_grant', member_id: or.memberId, permissions: [] });
    await retry(() => assert.rejects(p(org, om, { type: 'task', id: 't3', title: 'After revocation', description: '', post_url: '', actions: ['done'], archived: false })), 60000);
    const tasks = await mem.call('tasks', c);
    assert.ok(has(tasks, task), 'a task created before revocation remains');
    assert.ok((await mem.call('governance_state', c)).events.some(e => e.data.body.type === 'hosting_policy'));
    console.log('PASS delegated and narrowed permissions, founder protection, revocation, organizer-only channels, linkless tasks, hosting policy and module records');
  } catch (e) { console.error(run.output().slice(-3500)); throw e; } finally { await run.close(); }
});
