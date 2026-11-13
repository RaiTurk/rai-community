// 0.4 packaged desktop app, driven hidden through the DevTools protocol:
// founder creates a community, creates an invitation in Account, a second app
// joins with the code, chat crosses the two apps with HTML escaped, the trial
// card and the full-copy setting are present, and memory is measured (plan H5).
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { root, port, retry } from './conductor.mjs';
import { parseInvite } from '../ui/core.mjs';
import { once } from 'node:events';

const pause = ms => new Promise(r => setTimeout(r, ms));
const runDir = join(root, '.runtime', 'native-qa-' + Date.now());
await mkdir(runDir, { recursive: true });
const seed = 'rai-native-qa-' + Date.now();
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p?.reject(Error(m.error.message)) : p?.resolve(m.result); } }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); }); return new CDP(ws); }
  async call(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 25000); this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { if (process.env.RAI_TRACE) console.log('eval: ' + expression.slice(0, 90).replace(/s+/g, ' ')); const r = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description); return r.result.value; }
  async click(selector) { return this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing selector '+${JSON.stringify(selector)});if(el.disabled)throw Error('Disabled selector '+${JSON.stringify(selector)});el.click();return true;})()`); }
  async fill(selector, value) { return this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing input '+${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
  async check(selector) { return this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
  async has(selector) { return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`); }
  async text() { return this.eval('document.body.innerText'); }
  async wait(selector, timeout = 180000) { return retry(async () => { if (!await this.has(selector)) throw Error('Waiting for ' + selector + ' ' + await this.eval(`document.querySelector('#notice')?.textContent||''`)); return true; }, timeout); }
  async idle() { await pause(400); await retry(async () => { if (await this.eval(`!!document.querySelector('#refresh[disabled]')`)) throw Error('UI busy'); return true; }, 120000); const error = await this.eval(`document.querySelector('#notice')?.textContent||''`); if (error) throw Error('UI error: ' + error); }
  close() { this.ws.close(); }
}
// The test may run under Electron in Node mode; the app itself must not.
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE; delete cleanEnv.ELECTRON_NO_ASAR; delete cleanEnv.NODE_OPTIONS;
const apps = [];
const webview2 = process.env.RAI_TEST_WEBVIEW2 === '1';
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const password = 'Native-test-only-9347';
const exec = promisify(execFile);
let volunteer;
async function startVolunteer(invitation) {
  const kit = join(root, 'dist/node-kit-windows');
  const recovery = join(runDir, 'volunteer-test-recovery.txt');
  const env = {
    ...cleanEnv,
    RAI_NODE_DIR: join(runDir, 'volunteer'),
    RAI_NODE_PASSWORD: crypto.randomUUID(),
    RAI_NETWORK_SEED: seed,
    RAI_HC_BIN: join(kit, 'bins/hc.exe'),
    RAI_HOLOCHAIN_BIN: join(kit, 'bins/holochain.exe'),
    RAI_HAPP_PATH: join(kit, 'rai-community.happ'),
    RAI_ACK_RECOVERY_LOSS: 'YES',
    RAI_ACK_RESOURCE_USE: 'YES',
    RAI_FULL_COPY: '1',
  };
  const entry = join(kit, 'tools/rai-node.mjs');
  const cli = (...args) => exec(process.execPath, [entry, ...args], { env, windowsHide: true, timeout: 180000 });
  await cli('prepare', recovery);
  await retry(() => cli('join', invitation, recovery), 120000);
  await cli('offer');
  const status = JSON.parse((await cli('status')).stdout);
  assert.equal(status.community, 'Native QA community');
  assert.equal(status.members, 2);
  volunteer = spawn(process.execPath, [entry, 'run'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  volunteer.stderr.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Volunteer node did not start')), 60000);
    volunteer.once('exit', code => { clearTimeout(timer); reject(Error('Volunteer node exited: ' + code)); });
    volunteer.stdout.on('data', data => {
      if (data.toString().includes('Node running (full copy)')) { clearTimeout(timer); resolve(); }
    });
  });
}
async function openApp(name, { fullCopy = false, lightweight = webview2 } = {}) {
  const debugPort = await port(), data = join(runDir, name, 'appdata');
  const startupPort = lightweight ? await port() : debugPort;
  if (fullCopy) {
    // Same file the Account screen writes (Bu cihaz → Tam kopya).
    const conductor = join(data, '0.4.x', name, 'data', 'conductor');
    await mkdir(conductor, { recursive: true });
    await writeFile(join(conductor, 'rai-network.json'), JSON.stringify({ fullCopy: true, bootstrapUrl: '', relayUrl: '' }));
  }
  let logs = '';
  const executable = lightweight ? `dist/webview2-${version}/win-x64/RaiCommunity.exe` : '.tooling/kangaroo/dist/win-unpacked/org.raicommunity.next.exe';
  const child = spawn(join(root, executable), ['--profile', name, '--network-seed', seed], { cwd: root, env: { ...cleanEnv, RAI_RUNTIME_DATA: data, RAI_DEVTOOLS_PORT: String(debugPort), RAI_STARTUP_DEVTOOLS_PORT: String(startupPort), RAI_HIDDEN_TEST: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { logs = (logs + d).slice(-100000); });
  child.stderr.on('data', d => { logs = (logs + d).slice(-100000); });
  const app = { child, cdps: [], logs: () => logs };
  apps.push(app);
  async function target(match, targetPort = debugPort) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error(await readFile(join(data, 'webview-test-error.txt'), 'utf8').catch(() => 'The test app exited: ' + child.exitCode));
      const list = await fetch(`http://127.0.0.1:${targetPort}/json`).then(r => r.json()).catch(() => []);
      const t = list.find(match);
      if (t) {
        const c = await CDP.connect(t.webSocketDebuggerUrl);
        app.cdps.push(c);
        return c;
      }
      await pause(300);
    }
    throw Error('Timed out waiting for app window: ' + name);
  }
  if (lightweight) {
    const splash = await target(t => t.url === 'https://rai-start.local/index.html', startupPort);
    await splash.wait('#password-form:not([hidden])');
    assert.equal(await splash.eval(`document.querySelector('footer img').complete && document.querySelector('footer img').naturalWidth > 0`), true);
    assert.ok(await splash.eval(`document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth`), 'the startup page fits without scrolling');
    const fresh = await splash.has('#choose:not([hidden])');
    if (name === 'founder' || name === 'legacy') {
      const shot = await splash.call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(runDir, fresh ? 'startup-setup.png' : 'startup-unlock.png'), Buffer.from(shot.data, 'base64'));
    }
    const submit = () => splash.eval(`{document.querySelector('form').requestSubmit(); true;}`);
    if (fresh) {
      await splash.fill('#new-password', password);
      await splash.click('#continue'); await splash.wait('#confirm:not([hidden])');
      await splash.fill('#confirm-password', 'mismatched-test-password'); await submit();
      assert.match(await splash.text(), /Passwords must match/);
      await splash.fill('#confirm-password', password); await splash.check('#acknowledged');
    } else {
      assert.ok(await splash.has('#enter:not([hidden]) #recover'));
      await splash.fill('#password', password);
    }
    await submit();
  } else {
    const splash = await target(t => t.url.includes('setupPassword.html'));
    await splash.wait('#choose-password-input'); await splash.fill('#choose-password-input', password); await splash.click('#continue-btn'); await splash.fill('#confirm-password-input', password); await splash.check('#understood-checkbox'); await splash.click('#launch-btn');
  }
  const page = await target(t => lightweight ? t.url === 'https://rai-community.local/index.html' : t.url.startsWith('webhapp:'));
  app.page = page;
  await page.call('Page.setDownloadBehavior', { behavior: 'deny' });
  await page.wait('#terms-accept,#new-code,[data-page="account"]');
  if (await page.has('#terms-accept')) { await page.eval("document.querySelectorAll('.terms-checks input[type=checkbox]').forEach(el=>{el.checked=true;})"); // The screen re-renders while the app connects; tick and accept until it moves on.
    await retry(async () => { if (await page.has('#new-code')) return; await page.eval("document.querySelectorAll('.terms-checks input[type=checkbox]').forEach(el=>{el.checked=true;})"); await page.click('#terms-accept'); await pause(1500); if (!await page.has('#new-code')) throw Error('terms'); }, 180000); }
  return app;
}
/** New identity; the recovery code is hidden until asked for (J6). */
async function identity(page) {
  await page.wait('#toggle-secret');
  assert.equal(await page.has('.secret'), false, 'the recovery code is hidden by default');
  await page.click('#toggle-secret');
  await page.wait('.secret');
  const code = await page.eval(`document.querySelector('.secret').textContent`);
  assert.match(code, /^rai-recovery-v1\./);
  await page.fill('#confirm-code', code); await page.check('#loss-ack'); await page.click('#verify-backup');
  await page.wait('#join-name');
  return code;
}
const results = [];
const passed = message => { results.push(message); console.log('PASS ' + message); };
try {
  // Somebody must keep a full copy; two light clients alone hold no shared data.
  const founder = await openApp('founder', { fullCopy: !webview2 }), f = founder.page;
  if (webview2) {
    passed('Branded startup setup rejects mismatched passwords and opens with a confirmed password');
    const probe = join(runDir, 'windows-dpi.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await exec(compiler, ['/nologo', '/target:exe', '/platform:x64', '/reference:System.Drawing.dll', '/out:' + probe, join(root, 'tests/windows-dpi.cs')], { windowsHide: true });
    const artwork = join(root, `dist/webview2-${version}/win-x64/rai-community-hidpi.ico`);
    const dpi = await exec(probe, [String(founder.child.pid), artwork], { windowsHide: true });
    const nativeScale = Number(dpi.stdout.trim()) / 96;
    assert.ok(nativeScale >= 1);
    assert.ok(Math.abs(await f.eval('window.devicePixelRatio') - nativeScale) < 0.01);
    passed(`Windows reports Per-Monitor V2 and WebView2 uses the monitor's scale (${nativeScale * 100}%)`);
    passed('The running window reports the installed Rai icon to Windows');
  }
  await f.click('#new-organizer-code');
  await identity(f);
  await f.fill('#join-name', 'Native founder'); await f.fill('#new-community', 'Native QA community'); await f.click('#create-community');
  await f.wait('[data-page="account"]'); await f.idle();
  passed('Founder creates a community; the recovery code was hidden until requested');
  await f.click('[data-page="account"]');
  assert.ok(await f.has('#full-copy') || await f.has('#device-title') || !(await f.eval('!!window.raiShell')), 'the device section shows when the shell bridge exists');
  assert.ok(await f.eval('!!window.raiShell'), 'the desktop bridge is available');
  if (webview2) {
    const rejected = await f.eval(`Promise.all([
      window.raiShell.downloadUpdate('http://127.0.0.1/', '0'.repeat(64)),
      window.raiShell.openUpdate('unverified.exe'),
      window.raiShell.setNetwork({fullCopy:true, bootstrapUrl:'file:///tmp', relayUrl:''})
    ].map(call => call.then(() => false, () => true)))`);
    assert.deepEqual(rejected, [true, true, true]);
    passed('The WebView2 bridge rejects insecure update URLs, unverified executables and invalid network settings');
  }
  await f.wait('#full-copy');
  assert.equal(await f.eval(`document.querySelector('#full-copy').checked`), true, 'full copy is checked');
  if (webview2) {
    const config = await readFile(join(runDir, 'founder/appdata/0.4.x/founder/data/conductor/conductor-config.yaml'), 'utf8');
    assert.match(config, /target_arc_factor: 1\b/);
    const label = () => f.eval(`document.querySelector('#language').parentElement.firstChild.textContent.trim()`);
    assert.equal(await label(), 'Language/Dil');
    await f.fill('#language', 'en'); assert.equal(await label(), 'Language/Dil');
    await f.fill('#language', 'tr'); assert.equal(await label(), 'Language/Dil');
    passed('A new desktop uses full copy by default and the language label is the same in both languages');
  }
  assert.match(await f.text(), /All badges|Bütün rozetler/);
  const order = await f.eval(`(()=>{const t=document.body.innerText;return [t.indexOf('Membership ID'),t.indexOf('Public community address'),t.indexOf('Recovery code (private)')].concat([t.indexOf('Üyelik kimliği (paylaşılabilir)'),t.indexOf('Herkese açık topluluk adresi'),t.indexOf('Kurtarma kodu (gizli)')])})()`);
  const [a, b, c] = order[0] >= 0 ? order.slice(0, 3) : order.slice(3);
  assert.ok(a < b && b < c, 'membership ID, community address, then recovery code');
  await f.click('#create-invite'); await f.idle();
  const volunteerInvite = await f.eval(`document.querySelector('#invite-code').textContent`);
  assert.match(volunteerInvite, /^RAI-INVITE\.uhCkk/);
  passed('Account shows profile, all badges, light-client setting and creates an invitation code');
  await startVolunteer(volunteerInvite);
  passed('Packaged volunteer node enrolls, offers service, restarts and keeps a full copy');
  await f.click('#create-invite'); await f.idle();
  const invite = await f.eval(`document.querySelector('#invite-code').textContent`);
  assert.match(invite, /^RAI-INVITE\.uhCkk/);
  assert.notEqual(invite, volunteerInvite);

  const member = await openApp('member'), p = member.page;
  await p.fill('#entry-name', 'Native member');
  await p.fill('#entry-community', parseInvite(invite).community);
  await retry(async () => {
    await p.click('#new-code');
    await retry(async () => assert.match(await p.eval(`document.querySelector('#notice')?.textContent ?? ''`), /needs an invitation|davetle katılınıyor/i), 20000);
  }, 180000);
  await p.fill('#entry-community', invite);
  await retry(async () => { await p.click('#new-code'); await p.wait('#toggle-secret', 20000); }, 600000);
  await identity(p);
  await p.click('#join'); await p.wait('nav'); await p.idle();
  passed('A plain address is refused without an open gate; the invitation code joins');
  await p.click('[data-page="account"]'); await p.wait('#full-copy');
  assert.equal(await p.eval(`document.querySelector('#full-copy').checked`), webview2, 'the desktop shows its default');
  await p.click('#create-invite');
  assert.match(await p.eval(`document.querySelector('#invite-warning').textContent`), /member for 7 days|7 gün geçince/);
  assert.equal(await p.has('#invite-code'), false);
  assert.equal(await p.eval(`document.querySelector('#notice').textContent`), '');
  await retry(async () => assert.equal(await p.eval(`document.querySelector('#invite-warning').textContent`), ''), 15000);
  passed('The early invitation warning uses plain text and disappears without creating a code');

  await p.click('[data-page="chat"]');
  const chatText = 'Hello <img src=x onerror="window.chatInjected=true"> 🌍';
  assert.ok(await p.has('#chat-count'), '400-character counter');
  await p.fill('#chat-text', chatText);
  await p.eval(`document.querySelector('#chat-form').requestSubmit()`); await p.idle();
  await f.click('[data-page="chat"]');
  await retry(async () => { await f.click('#refresh'); await f.idle(); assert.ok((await f.text()).includes(chatText)); }, 120000);
  assert.equal(await f.eval('window.chatInjected===true'), false);
  const reply = 'Reply from the founder';
  await f.fill('#chat-text', reply);
  await f.eval(`document.querySelector('#chat-form').requestSubmit()`); await f.idle();
  await retry(async () => { await p.click('#refresh'); await p.idle(); assert.ok((await p.text()).includes(reply)); }, 120000);
  passed('Chat crosses the two apps in both directions and stays escaped');

  await f.click('[data-page="goals"]');
  assert.ok(await f.has('#trial-edit'), 'the founder can edit the trial card');
  await f.click('#trial-edit'); await f.fill('#trial-target', '50'); await f.eval(`document.querySelector('#trial-form').requestSubmit()`); await f.idle();
  assert.match(await f.text(), /\/ 50/);
  passed('Trial card target edited by the founder');
  await f.click('#add-goal');
  await f.fill('#goal-title-en', 'Bilingual test goal');
  await f.fill('#goal-context-en', 'English test description');
  await f.fill('#language', 'en');
  assert.equal(await f.eval(`document.querySelector('#goal-context-en').value`), 'English test description');
  await f.fill('#goal-title-tr', 'İki dilli deneme hedefi');
  await f.fill('#goal-context-tr', 'Türkçe deneme açıklaması');
  await f.fill('#goal-current', '0');
  await f.eval(`document.querySelector('#goal-edit').requestSubmit()`);
  await f.idle();
  assert.match(await f.text(), /Bilingual test goal[\s\S]*Current: 0[\s\S]*English test description/);
  await f.fill('#language', 'tr');
  assert.match(await f.text(), /İki dilli deneme hedefi[\s\S]*Mevcut: 0[\s\S]*Türkçe deneme açıklaması/);
  passed('The bilingual goal preserves drafts, saves zero, and displays the selected language');

  await f.click('[data-page="tasks"]');
  await f.click('#new-task');
  await f.fill('#task-title-en', 'Bilingual test task');
  await f.fill('#task-description-en', 'English task instructions');
  await f.fill('#task-title-tr', 'İki dilli deneme görevi');
  await f.fill('#language', 'en');
  assert.equal(await f.eval(`document.querySelector('#task-title-tr').value`), 'İki dilli deneme görevi');
  await f.fill('#task-description-tr', 'Türkçe görev açıklaması');
  await f.eval(`document.querySelector('#create-task').requestSubmit()`);
  await f.idle();
  const taskId = await f.eval(`[...document.querySelectorAll('[data-open-task]')].find(button=>button.textContent.includes('Bilingual test task')).dataset.openTask`);
  await f.click(`[data-open-task="${taskId}"]`);
  assert.match(await f.text(), /English task instructions/);
  await f.fill('#language', 'tr');
  assert.match(await f.text(), /Türkçe görev açıklaması/);
  await f.click('#edit-task');
  await f.fill('#task-description-tr', 'Güncellenen görev açıklaması');
  await f.eval(`document.querySelector('#create-task').requestSubmit()`);
  await f.idle();
  assert.match(await f.text(), /Güncellenen görev açıklaması/);
  assert.equal(await f.eval(`document.querySelectorAll('[data-open-task="${taskId}"]').length`), 1);
  passed('Bilingual task drafts, display language, and text edits work under one task ID');

  if (webview2) {
    const legacy = await openApp('legacy', { fullCopy: true, lightweight: false });
    const old = legacy.page;
    await old.click('#new-organizer-code'); await identity(old);
    await old.fill('#join-name', 'Migrating founder'); await old.fill('#new-community', 'Preserved community'); await old.click('#create-community');
    await old.wait('[data-page="account"]'); await old.idle();
    const priorAddress = await old.eval(`localStorage.getItem('rai.community')`);
    assert.match(priorAddress, /^uhCkk/);
    await old.click('[data-page="account"]'); await old.wait('[aria-labelledby="membership-id-label"]');
    const priorMember = await old.eval(`document.querySelector('[aria-labelledby="membership-id-label"]').textContent`);
    assert.match(priorMember, /^[a-f0-9]{64}$/);
    await old.eval(`localStorage.setItem('rai.language', 'en')`);
    await pause(2000);
    const exited = once(legacy.child, 'exit');
    await old.call('Browser.close').catch(() => {});
    await Promise.race([exited, pause(15000)]);
    if (legacy.child.exitCode === null) throw Error('The old app did not shut down.');
    const upgraded = await openApp('legacy', { lightweight: true });
    await upgraded.page.wait('[data-page="account"]');
    assert.equal(await upgraded.page.eval(`localStorage.getItem('rai.community')`), priorAddress);
    assert.equal(await upgraded.page.eval(`localStorage.getItem('rai.language')`), 'en');
    assert.match(await upgraded.page.text(), /Preserved community/);
    await upgraded.page.click('[data-page="account"]'); await upgraded.page.wait('[aria-labelledby="membership-id-label"]');
    assert.equal(await upgraded.page.eval(`document.querySelector('[aria-labelledby="membership-id-label"]').textContent`), priorMember);
    assert.equal((await upgraded.page.eval(`window.raiShell.getNetwork()`)).fullCopy, true);
    passed('0.4.0 Electron profile opens in WebView2 with the same identity, community, language and full-copy setting');

    await p.click('[data-page="account"]'); await p.wait('#full-copy');
    await p.eval(`document.querySelector('#full-copy').click()`);
    await p.eval(`window.raiShell.restart = () => Promise.resolve(); document.querySelector('#device-form').requestSubmit(); true;`);
    await retry(async () => assert.equal((await p.eval(`window.raiShell.getNetwork()`)).fullCopy, false));
    const stopped = once(member.child, 'exit');
    member.child.kill(); await stopped;
    const reopened = await openApp('member');
    await reopened.page.click('[data-page="account"]'); await reopened.page.wait('#full-copy');
    assert.equal(await reopened.page.eval(`document.querySelector('#full-copy').checked`), false);
    const config = await readFile(join(runDir, 'member/appdata/0.4.x/member/data/conductor/conductor-config.yaml'), 'utf8');
    assert.match(config, /target_arc_factor: 0\b/);
    passed('The user can turn off full copy and the unchecked choice survives reopening');
    await reopened.page.click('[data-page="hosting"]');
    assert.match(await reopened.page.eval(`document.querySelector('#hosting-status').textContent`), /Light mode|Hafif mod/);
    assert.equal(await reopened.page.eval(`document.querySelector('#hosting-session').textContent`), '—');
    await reopened.page.click('#hosting-session + details summary');
    assert.match(await reopened.page.text(), /timer is off|sayaç çalışmaz/);
    await reopened.page.click('#hosting-total + details summary');
    assert.match(await reopened.page.text(), /about every six hours|yaklaşık altı saatte bir/);
    await reopened.page.click('[data-page="raiunyt"]');
    await reopened.page.click('h2 + details summary');
    assert.match(await reopened.page.text(), /about every six hours|yaklaşık altı saatte bir/);
    await retry(async () => assert.equal(await reopened.page.eval(`JSON.parse(localStorage.getItem('rai.cache.v4.'+localStorage.getItem('rai.community'))).offers.some(event=>event.data.body.type==='host_offer'&&event.data.body.enabled===false)`), true), 30000);
    passed('Light mode stops the timer, withdraws hosting and explains the summary delay');
  }

  const memory = [];
  for (const app of [founder, member]) {
    if (app.child.exitCode !== null || app.child.signalCode !== null) continue;
    const script = `$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${app.child.pid}); do {$changed=$false; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed); $rows=Get-Process -Id @($ids) -ErrorAction SilentlyContinue | Select-Object ProcessName,WorkingSet64,PrivateMemorySize64; ConvertTo-Json -InputObject @($rows) -Compress`;
    const measured = spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
    if (measured.status === 0) {
      const rows = JSON.parse(measured.stdout);
      memory.push({ processes: rows, workingSetBytes: rows.reduce((s, r) => s + r.WorkingSet64, 0), privateBytes: rows.reduce((s, r) => s + r.PrivateMemorySize64, 0) });
    }
  }
  await writeFile(join(runDir, 'memory.json'), JSON.stringify({ method: 'Sum of own native process-tree working sets/private bytes; hidden windows, small test data.', apps: memory }, null, 2));
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log('Memory (working set, MB): ' + memory.map(m => Math.round(m.workingSetBytes / 1048576)).join(', '));
} catch (e) {
  for (const app of apps) console.error(app.logs().slice(-3000));
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ passed: false, results, error: String(e?.stack || e) }, null, 2));
  throw e;
} finally {
  if (volunteer?.pid && volunteer.exitCode === null) {
    spawnSync('C:/Windows/System32/taskkill.exe', ['/PID', String(volunteer.pid), '/T', '/F'], { windowsHide: true });
  }
  for (const app of apps) { for (const c of app.cdps) c.close(); app.child.kill(); }
}
