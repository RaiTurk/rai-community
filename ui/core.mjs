import { displayedTask } from './tasks.mjs';

const enc=new TextEncoder();
export const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function newRecovery(){const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);const raw=await crypto.subtle.exportKey('pkcs8',pair.privateKey);return{code:'rai-recovery-v1.'+b64(raw),key:pair.privateKey,memberId:hex(await crypto.subtle.exportKey('raw',pair.publicKey))};}
export async function readRecovery(code){code=code.trim().split(/\r?\n/)[0];if(!/^rai-recovery-v1\.[A-Za-z0-9_-]{60,100}$/.test(code))throw Error('Invalid recovery code');const raw=unb64(code.slice('rai-recovery-v1.'.length));const key=await crypto.subtle.importKey('pkcs8',raw,{name:'Ed25519'},true,['sign']);const jwk=await crypto.subtle.exportKey('jwk',key);if(!jwk.x)throw Error('Recovery public key missing');return{code,key,memberId:hex(unb64(jwk.x))};}
export async function signRecovery(key,message){return Array.from(new Uint8Array(await crypto.subtle.sign('Ed25519',key,enc.encode(message))));}
function compareHash(a,b){
  if (a.length!==53 || b.length!==53) return a.localeCompare(b);
  const x=unb64(a.slice(1)),y=unb64(b.slice(1));
  for(let i=0;i<x.length;i++) if(x[i]!==y[i]) return x[i]-y[i];
  return 0;
}
const snapshotIndexes = new WeakMap();
function indexesFor(snapshot) {
  const { members, events } = snapshot;
  const cached = snapshotIndexes.get(snapshot);
  if (cached?.members === members && cached?.events === events
    && cached.memberCount === members.length && cached.eventCount === events.length) return cached;
  const byHash = new Map(), current = new Map(), decisions = new Map(), roles = new Map(), grants = new Map();
  for (const member of members) {
    byHash.set(member.hash, member);
    const { member_id: id, generation } = member.data;
    const old = current.get(id);
    if (!old || generation > old.data.generation
      || (generation === old.data.generation && compareHash(member.hash, old.hash) > 0)) current.set(id, member);
  }
  for (const event of events) {
    const { body } = event.data;
    if (body.type === 'decision') decisions.set(body.member_id, body.removed);
    if (body.type === 'bulk_decision') for (const id of body.member_ids) decisions.set(id, body.removed);
    if (body.type === 'peer_role') roles.set(body.member_id, body.enabled ? event.hash : null);
    if (body.type === 'admin_grant') grants.set(body.member_id, body.permissions);
  }
  const index = { members, events, memberCount: members.length, eventCount: events.length, byHash, current, decisions, roles, grants };
  snapshotIndexes.set(snapshot, index);
  return index;
}
export function memberCurrent(snapshot,id){return indexesFor(snapshot).current.get(id);}
export function memberFor(snapshot,event){return event?indexesFor(snapshot).byHash.get(event.data.membership):undefined;}
export function removed(snapshot,id){return indexesFor(snapshot).decisions.get(id)??false;}
// Organizer permissions (0.4: eight). The founder holds every permission; others hold what their latest grant lists.
export const PERMISSIONS=['tasks','goals','channels','reviewers','membership','sampling','hosting','release'];
export function adminPermissions(snapshot,id){if(!snapshot||!id)return[];if(snapshot.community.founder===id)return[...PERMISSIONS];return indexesFor(snapshot).grants.get(id)??[];}
export function can(snapshot,id,permission){const p=adminPermissions(snapshot,id);return permission==='admin'?p.length>0:p.includes(permission);}
export function currentRole(snapshot,id){return indexesFor(snapshot).roles.get(id)??null;}
export function eligibleEvent(snapshot,e){const m=memberFor(snapshot,e);if(!m||removed(snapshot,m.data.member_id))return false;if(['review','x_verify','service_check'].includes(e.data.body.type))return currentRole(snapshot,m.data.member_id)===e.data.body.role;return true;}
export function latestById(snapshot, type, archived = false) {
  const latest = new Map();
  for (const event of snapshot.events) {
    const body = event.data.body;
    if (body.type === type) latest.set(body.id, event);
  }
  return [...latest.values()].filter(event => !!event.data.body.archived === archived);
}

export function contributionGroups(snapshot, language) {
  const { byHash, decisions } = indexesFor(snapshot);
  const tasks = new Map(), currentTasks = new Map();
  for (const { hash, data: { body } } of snapshot.events) {
    if (body.type === 'task') {
      tasks.set(hash, body);
      if (language) currentTasks.set(body.id, body);
    }
  }
  const groups = new Map();
  for (const event of snapshot.events) {
    const { body, membership } = event.data;
    if (body.type !== 'claim') continue;
    const memberId = byHash.get(membership)?.data.member_id;
    const task = tasks.get(body.task);
    if (!memberId || !task) continue;
    const key = memberId + ':' + task.id;
    const group = groups.get(key);
    if (group) {
      group.actions = [...new Set([...group.actions, ...body.actions])];
      group.references.push(event.hash);
    } else {
      groups.set(key, {
        memberId, taskId: task.id, title: language ? displayedTask(currentTasks.get(task.id), language).title : task.title,
        actions: [...body.actions],
        references: [event.hash], removed: decisions.get(memberId) ?? false,
      });
    }
  }
  return [...groups.values()];
}
// 0.4 invitation code: RAI-INVITE.<community>.<invitation> (both public addresses).
export function formatInvite(community,invitation){return 'RAI-INVITE.'+community+'.'+invitation;}
export function parseInvite(text){const m=/RAI-INVITE\.(uhCkk[A-Za-z0-9_-]{48})\.(uhCkk[A-Za-z0-9_-]{48})/.exec(String(text??'').trim());if(!m)throw Error('Invalid invitation');return{community:m[1],invitation:m[2]};}
export function recoveryWarning(language='en'){return language==='tr'?'Cihazını ve kurtarma kodunu birlikte kaybedersen hesabını yönetici dahil kimse geri getiremez. Bu kodu bilen biri hesabını devralabilir. Kodu paylaşma.':'If you lose both your device and recovery code, nobody—including an organizer—can recover your account. Anyone with this code can take over your membership. Keep it secret.';}
