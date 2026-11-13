// Keep the published URL in the canonical form accepted by the existing DNA.
export function prepareXClaim(handle, postUrl, challenge, memberId) {
  handle = handle.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw Error('handle');
  let url;
  try { url = new URL(postUrl.trim()); } catch { throw Error('url'); }
  if (url.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(url.hostname) || url.username || url.password || url.port) throw Error('url');
  const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/.exec(url.pathname);
  if (!match) throw Error('url');
  if (match[1].toLowerCase() !== handle.toLowerCase()) throw Error('owner');
  if (!memberId || !challenge.startsWith('rai-' + memberId.slice(0, 12) + '-') || challenge.length > 160) throw Error('challenge');
  return {type:'x_claim', handle, post_url:`https://${url.hostname}/${match[1]}/status/${match[2]}`, challenge};
}
