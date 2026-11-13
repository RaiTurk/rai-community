const SAMPLE_INTERVAL_MS = 5_000;
const MAX_SAMPLE_GAP_MS = 15_000;
const SAVE_INTERVAL_MS = 30_000;

export function createHostingClock(storage, canMeasure, onTick) {
  let key = '';
  let timer;
  let lastSample = null;
  let lastWallTime = null;
  let sessionMs = 0;
  let totalMs = 0;
  let savedMs = 0;

  function save() {
    if (!key || totalMs === savedMs) return;
    storage.setItem(key, String(Math.floor(totalMs)));
    savedMs = totalMs;
  }

  function sample() {
    const now = performance.now();
    const wallTime = Date.now();
    const active = !!key && canMeasure();
    const elapsed = lastSample === null ? 0 : now - lastSample;
    const wallElapsed = lastWallTime === null ? 0 : wallTime - lastWallTime;
    if (active && elapsed > 0 && elapsed <= MAX_SAMPLE_GAP_MS && wallElapsed > 0 && wallElapsed <= MAX_SAMPLE_GAP_MS) {
      sessionMs += elapsed;
      totalMs += elapsed;
    }
    lastSample = active ? now : null;
    lastWallTime = active ? wallTime : null;
    if (!active || totalMs - savedMs >= SAVE_INTERVAL_MS) save();
    onTick();
  }

  return {
    select(nextKey) {
      if (key === nextKey) return;
      save();
      clearInterval(timer);
      timer = undefined;
      key = nextKey;
      lastSample = null;
      lastWallTime = null;
      sessionMs = 0;
      const stored = key ? Number(storage.getItem(key)) : 0;
      totalMs = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
      savedMs = totalMs;
    },
    observe(enabled) {
      if (!enabled || !key) {
        lastSample = null;
        lastWallTime = null;
        clearInterval(timer);
        timer = undefined;
        save();
        return;
      }
      if (timer !== undefined) return;
      sessionMs = 0;
      timer = setInterval(sample, SAMPLE_INTERVAL_MS);
      sample();
    },
    connectionChanged() {
      if (timer === undefined) return;
      lastSample = null;
      lastWallTime = null;
      sample();
    },
    read() {
      const active = timer !== undefined && canMeasure();
      const elapsed = lastSample === null ? 0 : performance.now() - lastSample;
      const wallElapsed = lastWallTime === null ? 0 : Date.now() - lastWallTime;
      const currentMs = active && elapsed <= MAX_SAMPLE_GAP_MS && wallElapsed >= 0 && wallElapsed <= MAX_SAMPLE_GAP_MS ? elapsed : 0;
      return { active, sessionMs: sessionMs + currentMs, totalMs: totalMs + currentMs };
    },
    save,
  };
}

export function formatHostingDuration(milliseconds, language) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remaining = seconds % 60;
  return language === 'tr'
    ? `${hours} sa ${minutes} dk ${remaining} sn`
    : `${hours}h ${minutes}m ${remaining}s`;
}
