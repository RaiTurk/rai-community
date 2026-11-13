import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
export function customizeShell(dir){
 const cli=join(dir,'src/main/cli.ts');let cliSource=readFileSync(cli,'utf8');
 // 0.4 starts a fresh network again (0.3.x data is not carried over). The seed is pinned so a later
 // product-name change cannot split the network; works on fresh and already patched templates.
 const seedLine="let networkSeed = 'Rai Community-0.4.x'; // RAI_STABLE_NETWORK_SEED";
 cliSource=cliSource.replace('let networkSeed = `${KANGAROO_CONFIG.productName}-${breakingAppVersion()}`;',seedLine).replace(/let networkSeed = '[^']*'; \/\/ RAI_STABLE_NETWORK_SEED/,seedLine);writeFileSync(cli,cliSource);
 const manager=join(dir,'src/main/holochainManager.ts');
 let managerSource=readFileSync(manager,'utf8');
 if(!managerSource.includes('RAI_COORDINATOR_UPDATE')){
  const existingApp='if (installedApps.map((appInfo) => appInfo.installed_app_id).includes(HAPP_APP_ID)) return;';
  if(!managerSource.includes(existingApp))throw Error('Cannot locate the installed hApp check.');
  managerSource=managerSource.replace("import fs from 'fs';", "import fs from 'fs';\nimport path from 'node:path';")
   .replace('AdminWebsocket, AppAuthenticationToken, AppInfo', 'AdminWebsocket, AppAuthenticationToken, AppInfo, CellType')
   .replace(existingApp,`// RAI_COORDINATOR_UPDATE: update local behavior without replacing the cell or its records.
    const installed = installedApps.find((appInfo) => appInfo.installed_app_id === HAPP_APP_ID);
    if (installed) {
      const cell = installed.cell_info.community?.find((entry) => entry.type === CellType.Provisioned);
      if (cell?.type !== CellType.Provisioned) throw new Error('Rai Community cell is missing.');
      const cellId = cell.value.cell_id;
      const dir = path.dirname(HAPP_PATH);
      const wasmFile = 'rai_community.wasm';
      const expected = fs.readFileSync(path.join(dir, 'rai_community.blake2b'), 'utf8').trim();
      const definition = await this.adminWebsocket.getDnaDefinition(cellId);
      const coordinator = definition.coordinator_zomes.find(([name]) => name === 'rai_community')?.[1] as
        { Wasm?: { wasm_hash: Uint8Array } } | undefined;
      const hash = coordinator?.Wasm?.wasm_hash;
      if (hash && Buffer.from(hash.subarray(3, 35)).toString('hex') === expected) return;
      await this.adminWebsocket.updateCoordinators({
        cell_id: cellId,
        source: { type: 'bundle', value: {
          manifest: { zomes: [{ name: 'rai_community', path: wasmFile, dependencies: [{ name: 'rai_integrity' }] }] },
          resources: { [wasmFile]: new Uint8Array(fs.readFileSync(path.join(dir, wasmFile))) },
        } },
      });
      return;
    }`);
  writeFileSync(manager,managerSource);
 }
 const main=join(dir,'src/main/index.ts');let source=readFileSync(main,'utf8');
 if(!source.includes('rai:new-profile')){source=source.replace('// Read CLI options',`// RAI_NEW_PROFILE: keep the old encrypted profile; never reset membership authority.\nipcMain.handle('rai:new-profile', async (event) => {\n  if (!event.sender.getURL().includes('enterPassword.html')) throw new Error('Startup context required');\n  const answer = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancel / Vazgeç', 'New device profile / Yeni cihaz profili'], defaultId: 0, cancelId: 0, message: 'Your old profile will be kept. You will need your private recovery code to resume the same membership. / Eski profil korunacak. Aynı üyeliğe devam etmek için gizli kurtarma kodun gerekecek.' });\n  if (answer.response !== 1) return;\n  const args: string[] = []; const oldArgs = process.argv.slice(1);\n  for (let i = 0; i < oldArgs.length; i++) { if (oldArgs[i] === '--profile' || oldArgs[i] === '-p') { i++; continue; } if (!oldArgs[i].startsWith('--profile=')) args.push(oldArgs[i]); }\n  args.push('--profile', 'recovery-' + Date.now().toString(36)); app.relaunch({ args }); app.exit(0);\n});\n// Read CLI options`);writeFileSync(main,source);}
 const preload=join(dir,'src/preload/splashscreen.ts');source=readFileSync(preload,'utf8');if(!source.includes('newDeviceProfile:'))source=source.replace("  exit: () => ipcRenderer.invoke('exit'),","  newDeviceProfile: () => ipcRenderer.invoke('rai:new-profile'),\n  exit: () => ipcRenderer.invoke('exit'),");writeFileSync(preload,source);
 source=readFileSync(main,'utf8');
 if(!source.includes('RAI_PROFILE_ROOT')){
  source=source.replace('// RAI_NEW_PROFILE:',"const RAI_PROFILE_ROOT = app.getPath('userData');\n// RAI_NEW_PROFILE:");
  source=source.replace("args.push('--profile', 'recovery-' + Date.now().toString(36));", "const profile = 'recovery-' + Date.now().toString(36);\n  require('node:fs').writeFileSync(require('node:path').join(RAI_PROFILE_ROOT, 'rai-active-profile.txt'), profile);\n  args.push('--profile', profile);");
  source=source.replace('const RUN_OPTIONS = validateArgs(kangarooCli.opts());',`const RUN_OPTIONS = validateArgs(kangarooCli.opts());\nif (!RUN_OPTIONS.profile) {\n  try { const saved = require('node:fs').readFileSync(require('node:path').join(RAI_PROFILE_ROOT, 'rai-active-profile.txt'), 'utf8').trim(); if (/^recovery-[a-z0-9]+$/.test(saved)) RUN_OPTIONS.profile = saved; } catch {}\n}`);
  writeFileSync(main,source);
 }
 for(const file of['setupPassword.html','enterPassword.html']){
  const p=join(dir,'src/renderer',file);let html=readFileSync(p,'utf8');
  for(const[a,b]of[['Choose a password','Choose a local device password / Yerel cihaz parolası seç'],['Confirm password','Confirm password / Parolayı doğrula'],['Enter password','Local device password / Yerel cihaz parolası'],['>Continue<','>Continue / Devam<'],['>Launch<','>Launch / Başlat<'],['Wrong Password.','Wrong local password / Yerel parola hatalı.']])if(!html.includes(b))html=html.replaceAll(a,b);
  if(!html.includes('rai-password-note'))html=html.replace('<div class="content column">',`<div class="content column"><p id="rai-password-note" style="max-width:460px;text-align:center;font-size:14px">This local password protects this device. Your separate membership recovery code is essential if you lose device access.<br>Bu yerel parola cihazı korur. Cihaz erişimini kaybedersen ayrı üyelik kurtarma kodun gerekir.</p>`);
  if(file==='enterPassword.html'&&!html.includes('rai-new-device')){html=html.replace('<div class="warning" id="warning-1"></div>','<div class="warning" id="warning-1"></div><button id="rai-new-device" style="margin:14px">Use recovery code on a new profile / Yeni profilde kurtarma kodu kullan</button>');html=html.replace('// TODO add event listener',"document.getElementById('rai-new-device').onclick = () => window.electronAPI.newDeviceProfile();\n      // TODO add event listener");}
  writeFileSync(p,html);
 }
 // RAI_NETWORK_SETTINGS (0.4): light client by default, optional full copy, and
 // bootstrap/relay addresses read from one settings file next to the conductor
 // config, so they can change without a new release (plan C, H1).
 managerSource=readFileSync(manager,'utf8');
 if(!managerSource.includes('RAI_NETWORK_SETTINGS')){
  const relayLine='conductorConfig.network.relay_url = relayUrl ? relayUrl : KANGAROO_CONFIG.relayUrl;';
  if(!managerSource.includes(relayLine))throw Error('Cannot locate the relay setting.');
  managerSource=managerSource.replace(relayLine,relayLine+`
    // RAI_NETWORK_SETTINGS: target_arc_factor 0 = light client, 1 = full copy.
    conductorConfig.network.target_arc_factor = 0;
    try {
      const raiNetwork = JSON.parse(fs.readFileSync(path.join(path.dirname(configPath), 'rai-network.json'), 'utf8'));
      conductorConfig.network.target_arc_factor = raiNetwork.fullCopy === true ? 1 : 0;
      if (typeof raiNetwork.bootstrapUrl === 'string' && /^https:\\/\\/\\S+$/.test(raiNetwork.bootstrapUrl) && !bootstrapUrl) conductorConfig.network.bootstrap_url = raiNetwork.bootstrapUrl;
      if (typeof raiNetwork.relayUrl === 'string' && /^https:\\/\\/\\S+$/.test(raiNetwork.relayUrl) && !relayUrl) conductorConfig.network.relay_url = raiNetwork.relayUrl;
    } catch {}`);
  if(!managerSource.includes("import path from 'node:path';"))managerSource=managerSource.replace("import fs from 'fs';","import fs from 'fs';\nimport path from 'node:path';");
  writeFileSync(manager,managerSource);
 }
 // RAI_SHELL_IPC (0.4): network settings, restart and a verified update download (plan J2).
 source=readFileSync(main,'utf8');
 if(!source.includes('RAI_SHELL_IPC')){
  const anchor="ipcMain.handle('sign-zome-call', handleSignZomeCall);";
  if(!source.includes(anchor))throw Error('Cannot locate the IPC handlers.');
  source=source.replace(anchor,anchor+`
  // RAI_SHELL_IPC
  const raiFs = require('node:fs'), raiPath = require('node:path'), raiCrypto = require('node:crypto'), raiOs = require('node:os');
  const raiNetworkFile = () => raiPath.join(KANGAROO_FILESYSTEM.conductorDir, 'rai-network.json');
  const raiDownloads = raiPath.join(raiOs.tmpdir(), 'rai-community-updates');
  const raiHttps = (v: unknown) => v === '' || (typeof v === 'string' && v.length <= 300 && /^https:\\/\\/\\S+$/.test(v));
  const raiDefaults = { bootstrapUrl: KANGAROO_CONFIG.bootstrapUrl, relayUrl: KANGAROO_CONFIG.relayUrl };
  ipcMain.handle('rai:network-get', () => {
    try { return { fullCopy: false, bootstrapUrl: '', relayUrl: '', ...JSON.parse(raiFs.readFileSync(raiNetworkFile(), 'utf8')), defaults: raiDefaults }; }
    catch { return { fullCopy: false, bootstrapUrl: '', relayUrl: '', defaults: raiDefaults }; }
  });
  ipcMain.handle('rai:network-set', (_e, value) => {
    if (!value || typeof value.fullCopy !== 'boolean' || !raiHttps(value.bootstrapUrl ?? '') || !raiHttps(value.relayUrl ?? '')) throw new Error('Invalid network settings');
    raiFs.writeFileSync(raiNetworkFile(), JSON.stringify({ fullCopy: value.fullCopy, bootstrapUrl: value.bootstrapUrl ?? '', relayUrl: value.relayUrl ?? '' }, null, 2));
    return true;
  });
  ipcMain.handle('rai:restart', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('rai:update-download', async (_e, input) => {
    const url = String(input?.url ?? ''), expected = String(input?.sha256 ?? '').toLowerCase();
    if (!/^https:\\/\\/\\S+$/.test(url) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid update');
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.url.startsWith('https://')) throw new Error('Download failed: ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = raiCrypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) return { ok: false, actual };
    raiFs.mkdirSync(raiDownloads, { recursive: true });
    let name = raiPath.basename(new URL(response.url).pathname).replace(/[^A-Za-z0-9._-]/g, '') || 'rai-community-setup';
    if (!/\\.exe$/i.test(name)) name += '.exe';
    const file = raiPath.join(raiDownloads, name);
    raiFs.writeFileSync(file, bytes);
    return { ok: true, actual, file };
  });
  ipcMain.handle('rai:update-open', async (_e, file) => {
    const resolved = raiPath.resolve(String(file ?? ''));
    if (!resolved.startsWith(raiDownloads + raiPath.sep) || !raiFs.existsSync(resolved)) throw new Error('Unknown file');
    return require('electron').shell.openPath(resolved);
  });`);
  writeFileSync(main,source);
 }
 const happPreload=join(dir,'src/preload/happ.ts');let happSource=readFileSync(happPreload,'utf8');
 if(!happSource.includes('raiShell')){
  happSource+=`
// RAI_SHELL_IPC: a narrow bridge for the Rai Community interface.
contextBridge.exposeInMainWorld('raiShell', {
  getNetwork: () => ipcRenderer.invoke('rai:network-get'),
  setNetwork: (value: unknown) => ipcRenderer.invoke('rai:network-set', value),
  restart: () => ipcRenderer.invoke('rai:restart'),
  downloadUpdate: (url: string, sha256: string) => ipcRenderer.invoke('rai:update-download', { url, sha256 }),
  openUpdate: (file: string) => ipcRenderer.invoke('rai:update-open', file),
});
`;
  writeFileSync(happPreload,happSource);
 }
}
// RAI_ELECTRON_LANGUAGES (0.4, plan H5): ship only the Chromium locales the app uses (about 47 MB less).
export function trimLocales(dir){
 const yml=join(dir,'electron-builder.yml');let text=readFileSync(yml,'utf8');
 if(!text.includes('electronLanguages:')){text+='\nelectronLanguages:\n  - en-US\n  - tr\n';writeFileSync(yml,text);}
}
