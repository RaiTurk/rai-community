import test from 'node:test';
import assert from 'node:assert/strict';
import { autoReleasePlan, communitySettings, isNewer, orderedTasks, pageOf, settingBody } from '../ui/community-settings.mjs';

const event = (hash, timestamp_us, body, membership = 'founder-binding', authority = null) =>
  ({ hash, timestamp_us, data: { membership, body, authority } });
const record = (hash, time, id, archived = false) => event(hash, time, { type: 'task', id, archived });
const author = (hash, member_id) => ({ hash, data: { member_id } });

test('task presentation preserves creation order and updates stars and pins independently', () => {
  const snapshot = {
    community: { founder: 'founder' },
    members: [author('founder-binding','founder'), author('delegate','tasks-admin')],
    events: [
      record('a1', 1, 'A'), record('b', 2, 'B'), record('c', 3, 'C'), record('d', 4, 'D'),
      event('grant', 5, {type:'admin_grant',member_id:'tasks-admin',permissions:['tasks']}),
      event('star', 6, settingBody('task-star',{id:'C',enabled:true}), 'delegate','grant'),
      event('pin', 7, settingBody('task-pin',{id:'C',enabled:true})),
      record('a2', 8, 'A'), record('d2', 9, 'D', true),
    ],
  };
  const settings = communitySettings(snapshot);
  assert.deepEqual(settings.tasks.get('C'), {starred:true,pinned:true});
  assert.deepEqual(orderedTasks(snapshot,settings.tasks).map(task=>task.hash), ['c','a2','b']);
  assert.deepEqual(orderedTasks(snapshot,settings.tasks,true).map(task=>task.hash), ['d2']);
  snapshot.events.push(record('d3',10,'D'));
  assert.deepEqual(orderedTasks(snapshot,settings.tasks,true), []);
  assert.ok(orderedTasks(snapshot,settings.tasks).some(task=>task.hash==='d3'));
  snapshot.events.push(event('unpin',10,settingBody('task-pin',{id:'C',enabled:false})));
  assert.deepEqual(communitySettings(snapshot).tasks.get('C'),{starred:true,pinned:false});
});

const SHA = 'ab'.repeat(32);
test('automatic release announcements require the current founder plan and the release permission', () => {
  const organizer = 'a'.repeat(64);
  const version = '0.4.1', url = 'https://example.com/setup.exe';
  const snapshot = {
    community: { founder:'founder' },
    members: [author('founder-binding','founder'),author('delegate',organizer)],
    events: [
      event('grant',1,{type:'admin_grant',member_id:organizer,permissions:['tasks']}),
      event('plan',2,settingBody('windows-release-plan',{version,url,sha256:SHA})),
      event('early',3,settingBody('windows-release-auto',{plan:'plan'}),'delegate','grant'),
    ],
  };
  let settings = communitySettings(snapshot);
  assert.equal(settings.release,null,'tasks permission alone cannot announce');
  assert.equal(autoReleasePlan(settings,'0.4.0',true),null);
  assert.equal(autoReleasePlan(settings,version,false),null);
  assert.equal(autoReleasePlan(settings,version,true)?.hash,'plan');
  snapshot.events.push(
    event('release-grant',4,{type:'admin_grant',member_id:organizer,permissions:['tasks','release']}),
    event('new-plan',5,settingBody('windows-release-plan',{version,url,sha256:SHA})),
    event('stale',6,settingBody('windows-release-auto',{plan:'plan'}),'delegate','release-grant'),
  );
  assert.equal(communitySettings(snapshot).release,null,'a replaced plan is not announced');
  snapshot.events.push(event('announce',7,settingBody('windows-release-auto',{plan:'new-plan',url:'https://other.test/'}),'delegate','release-grant'));
  settings = communitySettings(snapshot);
  assert.deepEqual(settings.release,{version,url,sha256:SHA});
  assert.ok(settings.releaseAccess.has(organizer));
  assert.equal(autoReleasePlan(settings,version,true),null);
  snapshot.events.push(
    event('revoke',8,{type:'admin_grant',member_id:organizer,permissions:['tasks']}),
    event('later-plan',10,settingBody('windows-release-plan',{version:'0.4.2',url,sha256:SHA})),
    event('after-revoke',11,settingBody('windows-release-auto',{plan:'later-plan'}),'delegate','revoke'),
  );
  settings = communitySettings(snapshot);
  assert.equal(settings.releaseAccess.has(organizer),false);
  assert.deepEqual(settings.release,{version,url,sha256:SHA});
});

test('trial card, gate, invitation settings and campaign codes come from the founder', () => {
  const snapshot = {
    community: { founder: 'founder' },
    members: [author('founder-binding','founder'), author('delegate','org')],
    events: [
      event('grant', 1, {type:'admin_grant',member_id:'org',permissions:['membership']}),
      event('spoof', 2, {type:'trial_card',title_tr:'x',title_en:'x',target:1,hidden:true},'delegate','grant'),
      event('card', 3, {type:'trial_card',title_tr:'50 kişi',title_en:'50 people',target:50,hidden:false}),
      event('gate', 4, {type:'gate',open:true}),
      event('off', 5, {type:'invite_settings',members_can_invite:false,revoke_before_us:0},'delegate','grant'),
      event('pause', 6, {type:'invite_access',member_id:'m1',enabled:false},'delegate','grant'),
      event('code', 7, {type:'campaign_code',max_uses:200,expires_at_us:99,active:true}),
      event('close', 8, {type:'module',module:'invites',version:1,kind:'campaign-close',admin:true,payload:'code'}),
    ],
  };
  const s = communitySettings(snapshot);
  assert.deepEqual(s.trial,{title_tr:'50 kişi',title_en:'50 people',target:50,hidden:false});
  assert.equal(s.gateOpen,true);
  assert.equal(s.gateHash,'gate');
  assert.equal(s.invites.membersCanInvite,false);
  assert.equal(s.inviteAccess.get('m1'),false);
  assert.equal(s.campaigns.length,1);
  assert.ok(s.closedCampaigns.has('code'));
});

test('goals and release notices require their corresponding permissions', () => {
  const snapshot = {
    community: { founder: 'founder' },
    members: [author('founder-binding','founder'), author('delegate','tasks-admin')],
    events: [
      event('grant', 1, {type:'admin_grant',member_id:'tasks-admin',permissions:['tasks']}),
      event('spoof', 2, settingBody('goal-status',{id:'A',completed:true}),'delegate','grant'),
      event('complete', 3, settingBody('goal-status',{id:'B',completed:true})),
      event('reopen', 4, settingBody('goal-status',{id:'B',completed:false})),
      event('good', 5, settingBody('windows-release',{version:'0.3.10',url:'https://example.com/setup.exe',sha256:SHA})),
      event('spoof2', 6, settingBody('windows-release',{version:'99.1.0',url:'https://example.com/other.exe',sha256:SHA}),'delegate','grant'),
      event('bad-url', 7, settingBody('windows-release',{version:'0.4.0',url:'javascript:alert(1)',sha256:SHA})),
      event('no-hash', 8, settingBody('windows-release',{version:'0.4.1',url:'https://example.com/setup.exe'})),
    ],
  };
  const settings = communitySettings(snapshot);
  assert.equal(settings.goals.get('A'),undefined);
  assert.equal(settings.goals.get('B'),false);
  assert.deepEqual(settings.release,{version:'0.3.10',url:'https://example.com/setup.exe',sha256:SHA},'a release without SHA-256 is ignored');
  assert.equal(isNewer(settings.release.version,'0.3.3'),true);
  assert.equal(isNewer('0.3.10','0.3.10'),false);
  assert.equal(isNewer('0.3.9','0.3.10'),false);
  assert.equal(isNewer('0.3.4-preview','0.3.3'),false);
});

test('pagination caps rendered items and handles empty or shrinking lists', () => {
  const members = Array.from({length:2537},(_,i)=>i);
  assert.deepEqual(pageOf(members,200,12).items,members.slice(2400,2412));
  assert.deepEqual(pageOf(members,999,12).items,members.slice(2532));
  assert.equal(pageOf([],999,12).page,0);
});
