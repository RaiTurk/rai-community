import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHostingClock } from '../ui/hosting-clock.mjs';

test('hosting time survives restart and skips offline time, sleep and other devices', ({ mock }) => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  let monotonicTime = 0;
  mock.method(performance, 'now', () => monotonicTime);
  let online = true;
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const clock = createHostingClock(storage, () => online, () => {});
  const tick = milliseconds => {
    monotonicTime += milliseconds;
    mock.timers.tick(milliseconds);
  };

  clock.select('community/member/device');
  clock.observe(true);
  tick(5_000);
  assert.equal(clock.read().sessionMs, 5_000);
  online = false;
  clock.connectionChanged();
  tick(10_000);
  assert.equal(clock.read().totalMs, 5_000);
  online = true;
  clock.connectionChanged();
  monotonicTime += 60_000;
  mock.timers.setTime(75_000);
  mock.timers.tick(5_000);
  assert.equal(clock.read().totalMs, 5_000);
  tick(5_000);
  assert.equal(clock.read().totalMs, 10_000);
  clock.observe(false);

  const restarted = createHostingClock(storage, () => online, () => {});
  restarted.select('community/member/device');
  assert.equal(restarted.read().sessionMs, 0);
  assert.equal(restarted.read().totalMs, 10_000);
  restarted.select('community/member/other-device');
  assert.equal(restarted.read().totalMs, 0);
});
