import { memberCurrent, removed } from './core.mjs';

// Display names are not unique on the network. The member ID (recovery public
// key) is the identity; a short suffix keeps equal names apart on screen.
export const normalizeName = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
/** @param {{ members: { data: { member_id: string } }[] } | null} snapshot */
export function shortId(memberId, snapshot = null) {
  const id = String(memberId ?? '');
  let length = 4;
  while (length < id.length && snapshot?.members.some(({ data }) =>
    data.member_id !== id && data.member_id.startsWith(id.slice(0, length)))) length += 1;
  return '#' + id.slice(0, length);
}

export function currentMembers(snapshot) {
  if (!snapshot) return [];
  const ids = [...new Set(snapshot.members.map(m => m.data.member_id))];
  return ids.map(id => memberCurrent(snapshot, id)).filter(Boolean);
}

export function nameTaken(snapshot, name, memberId) {
  const wanted = normalizeName(name);
  if (!wanted) return false;
  return currentMembers(snapshot).some(m =>
    m.data.member_id !== memberId && !removed(snapshot, m.data.member_id) && normalizeName(m.data.name) === wanted);
}

export function displayName(snapshot, memberId, fallback = '') {
  const member = snapshot && memberId ? memberCurrent(snapshot, memberId) : undefined;
  if (!member) return fallback || (memberId ? shortId(memberId, snapshot) : '');
  const duplicate = currentMembers(snapshot).some(m =>
    m.data.member_id !== memberId && normalizeName(m.data.name) === normalizeName(member.data.name));
  return duplicate ? `${member.data.name} (${shortId(memberId, snapshot)})` : member.data.name;
}
