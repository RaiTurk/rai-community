import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareXClaim} from '../ui/x-account.mjs';
const member = '0123456789abcdef', challenge = 'rai-0123456789ab-public';
test('X share links become canonical URLs without changing the published challenge', () => {
  for (const host of ['x.com', 'twitter.com']) {
    const claim = prepareXClaim(' @RaiTurk_ ', `https://${host}/RaiTurk_/status/123/?s=20&t=tracking#fragment`, challenge, member);
    assert.equal(claim.post_url, `https://${host}/RaiTurk_/status/123`);
    assert.equal(claim.handle, 'RaiTurk_');
    assert.equal(claim.challenge, challenge);
  }
});
test('wrong author, profile links, foreign hosts and stale codes stay rejected', () => {
  for (const [url, code, reason] of [
    ['https://x.com/other/status/123', challenge, 'owner'],
    ['https://x.com/RaiTurk_', challenge, 'url'],
    ['https://x.com.evil.test/RaiTurk_/status/123', challenge, 'url'],
    ['https://user@x.com/RaiTurk_/status/123', challenge, 'url'],
    ['https://x.com/RaiTurk_/status/123', 'rai-other-public', 'challenge'],
  ]) assert.throws(() => prepareXClaim('RaiTurk_', url, code, member), new RegExp(reason));
});
