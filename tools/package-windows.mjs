import{spawnSync}from'node:child_process';import{mkdirSync,existsSync,copyFileSync,readFileSync,writeFileSync,symlinkSync}from'node:fs';import{join}from'node:path';import{createHash}from'node:crypto';import{root,tooling}from'./env.mjs';
import{customizeShell,trimLocales}from'./customize-shell.mjs';
import{createRequire}from'node:module';
const source=join(tooling,'kangaroo'),base=join(root,'.tooling'),target=join(base,'kangaroo');const pin='0498122a56641de9fe0779fa8cab0b585a4ecb98';
function run(command,args,cwd=target){const r=spawnSync(command,args,{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',ELECTRON_BUILDER_CACHE:join(tooling,'electron-builder-cache')}});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
if(process.platform!=='win32')throw Error('Windows packaging requires Windows.');
const gitHead=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true});
// Without git on PATH, read the detached HEAD of the reviewed checkout directly.
const actual=(gitHead.stdout||'').trim()||(()=>{try{return readFileSync(join(source,'.git/HEAD'),'utf8').trim();}catch{return '';}})();if(actual!==pin)throw Error('Kangaroo revision differs from reviewed pin.');
mkdirSync(target,{recursive:true});if(!existsSync(join(target,'src/main/index.ts'))){const tar=join(base,'kangaroo-source.tar');run('git',['archive','--format=tar',pin,'-o',tar],source);run('tar',['-xf',tar,'-C',target],root);writeFileSync(join(target,'PINNED_COMMIT'),pin+'\n');}
if(!existsSync(join(target,'node_modules')))symlinkSync(join(source,'node_modules'),join(target,'node_modules'),'junction');
// Only a separately extracted, task-owned template is modified.
let index=readFileSync(join(target,'src/main/index.ts'),'utf8');if(!index.includes('RAI_RUNTIME_DATA'))index=index.replace('// Read CLI options',`// Task-owned portable data override and explicit local test debugging.\nif (process.env.RAI_RUNTIME_DATA) {\n  const fs = require('node:fs'); const path = require('node:path');\n  const dir = path.resolve(process.env.RAI_RUNTIME_DATA); fs.mkdirSync(dir, { recursive: true });\n  const logs = path.join(dir, 'initial-logs'); fs.mkdirSync(logs, { recursive: true });\n  app.setPath('userData', dir); app.setPath('logs', logs);\n}\nif (/^\\d{4,5}$/.test(process.env.RAI_DEVTOOLS_PORT || '')) app.commandLine.appendSwitch('remote-debugging-port', process.env.RAI_DEVTOOLS_PORT);\n// Read CLI options`);writeFileSync(join(target,'src/main/index.ts'),index);
if(!index.includes('RAI_HIDDEN_TEST')){index=index.replace('// Read CLI options',"if (process.env.RAI_HIDDEN_TEST === '1') app.on('browser-window-created', (_, window) => { window.hide(); window.on('show', () => window.hide()); });\n// Read CLI options");writeFileSync(join(target,'src/main/index.ts'),index);}
customizeShell(target);copyFileSync(join(root,'desktop/kangaroo.config.ts'),join(target,'kangaroo.config.ts'));mkdirSync(join(target,'pouch'),{recursive:true});copyFileSync(join(root,'workdir/rai-community.webhapp'),join(target,'pouch/rai-community.webhapp'));mkdirSync(join(target,'resources/bins'),{recursive:true});
for(const[name,out,hash]of[['holochain','holochain-v0.7.1-org.raicom.exe','59261119a3ad3e51cd33d996be3110d39a5c4d1cc7c34c173a28efec137bb5b1'],['lair-keystore','lair-keystore-org.raicom.exe','16750b08e5ddd50a04f493142bc85b33cc6bfaf0ef7c7fe9cb215129787a923f']]){const src=join(tooling,'bin',name+'.exe');if(createHash('sha256').update(readFileSync(src)).digest('hex')!==hash)throw Error('Official runtime checksum mismatch: '+name);copyFileSync(src,join(target,'resources/bins',out));}
for (const script of ['scripts/write-configs.js', 'scripts/unpack-pouch.js', 'scripts/create-icons.js']) run(process.execPath, [script]);
// write-configs.js rewrites electron-builder.yml, so the locale trim comes after it.
trimLocales(target);
// Ship the same coordinator separately for existing cells. Holochain uses a
// Blake2b-256 hash of the raw WASM bytes, with a type prefix and location suffix.
const blake2b = createRequire(import.meta.resolve('@holochain/client'))('@bitgo/blake2b');
const coordinator = readFileSync(join(root, 'workdir/zomes/rai_community.wasm'));
writeFileSync(join(target, 'resources/rai_community.wasm'), coordinator);
writeFileSync(join(target, 'resources/rai_community.blake2b'), Buffer.from(blake2b(32).update(coordinator).digest()).toString('hex') + '\n');
run(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build']);
const electronDir = join(target, 'node_modules/electron/dist');
const electronVersion = JSON.parse(readFileSync(join(target, 'node_modules/electron/package.json'), 'utf8')).version;
const useLocalElectron = existsSync(join(electronDir, 'electron.exe'))
  && existsSync(join(electronDir, 'version'))
  && readFileSync(join(electronDir, 'version'), 'utf8').trim() === electronVersion;
const buildArgs = ['node_modules/electron-builder/cli.js', '--win', process.argv.includes('--dir') ? '--dir' : 'nsis', '--x64', '--config.win.signAndEditExecutable=false'];
if (useLocalElectron) buildArgs.push(`--config.electronDist=${electronDir}`);
run(process.execPath, buildArgs);
if (process.argv.includes('--dir')) process.exit(0);
const { name: appId, version } = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
mkdirSync(join(root, 'dist'), { recursive: true });
const file = `${appId}-${version}-setup.exe`;
const installer = join(root, 'dist', file);
copyFileSync(join(target, 'dist', file), installer);
const checksum = createHash('sha256').update(readFileSync(installer)).digest('hex');
writeFileSync(join(root, 'dist', `SHA256SUMS-${version}.txt`), `${checksum}  ${file}\n`);
console.log('Windows installer built: ' + file);
