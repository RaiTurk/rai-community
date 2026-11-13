import { latestById } from './core.mjs';

const permissions = {
  'task-star': 'tasks', 'task-pin': 'tasks', 'goal-status': 'goals',
  'windows-release': 'founder', 'windows-release-plan': 'founder',
  'windows-release-auto': 'release',
};

export function settingBody(kind, value) {
  const revision = kind === 'windows-release-auto' ? {} : { revision: crypto.randomUUID() };
  return {
    type: 'module', module: 'community-ui', kind, version: 1, admin: true,
    payload: JSON.stringify({ ...value, ...revision }),
  };
}

export function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version)) return null;
  return version.split('.').map(Number);
}

export function isNewer(version, installed) {
  const next = versionParts(version), current = versionParts(installed);
  if (!next || !current) return false;
  const difference = next.findIndex((part, i) => part !== current[i]);
  return difference >= 0 && next[difference] > current[difference];
}

export function releaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function communitySettings(snapshot) {
  /** @type {{tasks:Map<string,{starred:boolean,pinned:boolean}>,goals:Map<string,boolean>,release:{version:string,url:string,sha256:string}|null,releasePlan:{hash:string,version:string,url:string,sha256:string}|null,releaseAccess:Set<string>,trial:{title_tr:string,title_en:string,target:number,hidden:boolean},gateOpen:boolean,gateHash:string|null,invites:{membersCanInvite:boolean,revokeBeforeUs:number},inviteAccess:Map<string,boolean>,quota:{wait_days:number,per_week:number,organizer_per_week:number},campaigns:any[],closedCampaigns:Set<string>}} */
  const settings = { tasks: new Map(), goals: new Map(), release: null, releasePlan: null, releaseAccess: new Set(),
    trial: { title_tr: '10.000 kişi Rai Community’yi denesin', title_en: '10,000 people try Rai Community', target: 10_000, hidden: false },
    gateOpen: false, gateHash: null, invites: { membersCanInvite: true, revokeBeforeUs: 0 }, inviteAccess: new Map(),
    quota: { wait_days: 7, per_week: 3, organizer_per_week: 50 }, campaigns: [], closedCampaigns: new Set() };
  const members = new Map(snapshot.members.map(member => [member.hash, member.data.member_id]));
  const grants = new Map();
  const decisions = new Map();
  for (const event of snapshot.events) {
    const { body, membership, authority } = event.data;
    const author = members.get(membership);
    if (!author) continue;
    const founder = author === snapshot.community.founder;
    if (founder && body.type === 'admin_grant') {
      grants.set(body.member_id, event);
      if (body.permissions.includes('release')) settings.releaseAccess.add(body.member_id);
      else settings.releaseAccess.delete(body.member_id);
    }
    if (founder && body.type === 'trial_card') settings.trial = { title_tr: body.title_tr, title_en: body.title_en, target: body.target, hidden: body.hidden };
    if (founder && body.type === 'gate') { settings.gateOpen = body.open; settings.gateHash = body.open ? event.hash : null; }
    if (founder && body.type === 'invite_quota') settings.quota = { wait_days: body.wait_days, per_week: body.per_week, organizer_per_week: body.organizer_per_week };
    if (founder && body.type === 'campaign_code') settings.campaigns.push({ hash: event.hash, ...body, created: event.timestamp_us });
    if (founder && body.type === 'module' && body.module === 'invites' && body.kind === 'campaign-close') settings.closedCampaigns.add(body.payload);
    if (body.type === 'invite_settings') settings.invites = { membersCanInvite: body.members_can_invite, revokeBeforeUs: body.revoke_before_us };
    if (body.type === 'invite_access') settings.inviteAccess.set(body.member_id, body.enabled);
    if (body.type === 'decision') decisions.set(body.member_id, body.removed);
    if (body.type !== 'module' || body.module !== 'community-ui' || body.version !== 1 || body.admin !== true) continue;
    if (!Object.hasOwn(permissions, body.kind)) continue;
    const permission = permissions[body.kind];
    if (!founder) {
      const grant = grants.get(author);
      if (permission === 'founder' || !grant || grant.hash !== authority) continue;
      const allowed = grant.data.body.permissions;
      if (permission === 'admin' ? !allowed.length : !allowed.includes(permission)) continue;
    }
    let value;
    try { value = JSON.parse(body.payload); } catch { continue; }
    if (!value || typeof value !== 'object') continue;
    if (body.kind === 'windows-release' || body.kind === 'windows-release-plan') {
      const url = releaseUrl(value.url);
      if (!versionParts(value.version) || !url || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')) continue;
      const release = { version: value.version, url, sha256: value.sha256 };
      if (body.kind === 'windows-release') settings.release = release;
      else settings.releasePlan = { ...release, hash: event.hash };
    } else if (body.kind === 'windows-release-auto') {
      const plan = settings.releasePlan;
      if (!plan || plan.hash !== value.plan || decisions.get(author) || (!founder && !settings.releaseAccess.has(author))) continue;
      if (!settings.release || isNewer(plan.version, settings.release.version))
        settings.release = { version: plan.version, url: plan.url, sha256: plan.sha256 };
    } else if (typeof value.id === 'string' && value.id.length <= 80) {
      if ((body.kind === 'task-star' || body.kind === 'task-pin') && typeof value.enabled === 'boolean') {
        const display = settings.tasks.get(value.id) ?? { starred: false, pinned: false };
        display[body.kind === 'task-star' ? 'starred' : 'pinned'] = value.enabled;
        settings.tasks.set(value.id, display);
      }
      if (body.kind === 'goal-status' && typeof value.completed === 'boolean')
        settings.goals.set(value.id, value.completed);
    }
  }
  return settings;
}

/** @param {import('./api').Snapshot} snapshot
 * @param {ReturnType<typeof communitySettings>['tasks']} display
 * @returns {import('./api').EventView[]}
 */
export function orderedTasks(snapshot, display, archived = false) {
  if (archived) return latestById(snapshot, 'task', true).sort((a, b) => b.timestamp_us - a.timestamp_us);
  const created = new Map();
  for (const event of snapshot.events) {
    const body = event.data.body;
    if (body.type === 'task' && !created.has(body.id)) created.set(body.id, event.timestamp_us);
  }
  return latestById(snapshot, 'task').sort((a, b) =>
    Number(!!display.get(b.data.body.id)?.pinned) - Number(!!display.get(a.data.body.id)?.pinned)
      || created.get(a.data.body.id) - created.get(b.data.body.id));
}

export function autoReleasePlan(settings, installed, authorized) {
  const plan = settings.releasePlan;
  if (!authorized || !plan || installed !== plan.version) return null;
  return !settings.release || isNewer(plan.version, settings.release.version) ? plan : null;
}

/** @template T
 * @param {T[]} items
 * @param {number} index
 * @param {number} size
 */
export function pageOf(items, index, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(0, index), pages - 1);
  const start = page * size;
  return { page, pages, start, total: items.length, items: items.slice(start, start + size) };
}
