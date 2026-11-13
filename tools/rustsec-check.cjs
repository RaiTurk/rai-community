// Minimal RustSec check: matches Cargo.lock packages against advisory-db
// (patched/unaffected semver ranges). Usage: node rustsec-check.cjs <Cargo.lock> <advisory-db/crates>
const fs = require('fs'), path = require('path');
const [lockFile, dbDir] = process.argv.slice(2);
const lock = fs.readFileSync(lockFile, 'utf8');
const pkgs = [...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].map(m => ({ name: m[1], version: m[2] }));
const parse = v => v.replace(/^[^0-9]*/, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
function satisfies(v, req) {
  // req like ">= 1.2.3, < 1.3" or "^0.4.1"
  return req.split(',').map(s => s.trim()).every(r => {
    const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(r); if (!m) return false;
    const op = m[1] || '^', t = parse(m[2]), c = cmp(v, t);
    if (op === '>=') return c >= 0; if (op === '>') return c > 0; if (op === '<') return c < 0; if (op === '<=') return c <= 0; if (op === '=') return c === 0;
    if (op === '~') return c >= 0 && v[0] === t[0] && v[1] === t[1];
    // caret
    if (c < 0) return false;
    if (t[0] > 0) return v[0] === t[0];
    if (t[1] > 0) return v[0] === 0 && v[1] === t[1];
    return v[0] === 0 && v[1] === 0 && v[2] === t[2];
  });
}
const list = s => { const m = s && /\[([\s\S]*?)\]/.exec(s); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : []; };
const found = [];
for (const p of pkgs) {
  const dir = path.join(dbDir, p.name);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/withdrawn\s*=/.test(text)) continue;
    const id = (/id = "([^"]+)"/.exec(text) || [])[1];
    const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || '';
    const informational = (/informational = "([^"]+)"/.exec(text) || [])[1] || '';
    const versions = /\[versions\]([\s\S]*?)(\n\[|\n```|$)/.exec(text)?.[1] || '';
    const patched = list(/patched\s*=\s*(\[[\s\S]*?\])/.exec(versions)?.[1]);
    const unaffected = list(/unaffected\s*=\s*(\[[\s\S]*?\])/.exec(versions)?.[1]);
    const v = parse(p.version);
    if (patched.some(r => satisfies(v, r)) || unaffected.some(r => satisfies(v, r))) continue;
    found.push({ crate: p.name, version: p.version, id, informational, title });
  }
}
console.log(JSON.stringify({ packages: pkgs.length, findings: found }, null, 2));
