import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { root, tooling } from './env.mjs';
import { writeWindowsIcon } from './icon.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows x64 packaging requires Windows x64.');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const source = join(root, 'desktop/webview2');
const tools = join(root, '.tooling/webview2');
const sdk = join(tools, 'sdk');
const staging = join(root, 'dist', 'webview2-' + version, 'win-x64');
const installer = join(root, 'dist', `org.raicommunity.next-${version}-setup.exe`);
const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const node = process.env.RAI_WINDOWS_NODE ?? join(tooling, 'node-portable/node-v24.22.3-win-x64/node.exe');
const signer = process.env.RAI_WINDOWS_SIGNER ?? join(tooling, 'kangaroo/node_modules/.pnpm',
  '@holochain+hc-spin-rust-utils-win32-x64-msvc@0.700.1/node_modules/@holochain/hc-spin-rust-utils-win32-x64-msvc/hc-spin-rust-utils.win32-x64-msvc.node');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited with ${result.status}.`);
}

const archive = join(tools, '1.0.4314.35.nupkg');
if (sha(archive) !== '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4') throw Error('WebView2 SDK checksum mismatch.');
if (!existsSync(sdk)) {
  mkdirSync(sdk, { recursive: true });
  run('tar.exe', ['-xf', archive, '-C', sdk]);
}
const packages = join(tools, 'node_modules');
mkdirSync(staging, { recursive: true });
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
await build({ configFile: false, resolve: { alias: { '@msgpack/msgpack': join(packages, '@msgpack/msgpack/dist.esm/index.mjs') } },
  ssr: { noExternal: true }, build: { ssr: join(source, 'runtime.mjs'), outDir: staging, emptyOutDir: false,
    rollupOptions: { external: ['bufferutil', 'utf-8-validate'], output: { entryFileNames: 'runtime.mjs' } } } });

const libraries = ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll'];
const binaries = [
  [join(tooling, 'bin/holochain.exe'), 'holochain.exe', '59261119a3ad3e51cd33d996be3110d39a5c4d1cc7c34c173a28efec137bb5b1'],
  [join(tooling, 'bin/lair-keystore.exe'), 'lair-keystore.exe', '16750b08e5ddd50a04f493142bc85b33cc6bfaf0ef7c7fe9cb215129787a923f'],
  [node, 'node.exe', '86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6'], [signer, 'signer.node'],
  [join(dirname(node), 'LICENSE'), 'Node-LICENSE.txt'],
  [join(sdk, 'LICENSE.txt'), 'WebView2-LICENSE.txt'], [join(sdk, 'NOTICE.txt'), 'WebView2-NOTICE.txt'],
  [join(sdk, 'build/native/x64/WebView2Loader.dll'), 'WebView2Loader.dll'],
  ...libraries.map(name => [join(sdk, 'lib/net462', name), name]),
  [join(source, 'bridge.js'), 'bridge.js'], [join(root, 'workdir/rai-community.happ'), 'rai-community.happ'],
  [join(source, 'RaiCommunity.exe.config'), 'RaiCommunity.exe.config'],
];
for (const [file, name, expected] of binaries) {
  if (expected && sha(file) !== expected) throw Error('Runtime checksum mismatch: ' + name);
  cpSync(file, join(staging, name));
}
cpSync(packages, join(staging, 'node_modules'), { recursive: true,
  filter: path => !/[\\/]prebuilds[\\/](?!win32-x64(?:[\\/]|$))|[\\/]\.bin(?:[\\/]|$)/.test(path) });
cpSync(join(root, 'ui-dist'), join(staging, 'ui'), { recursive: true });
cpSync(join(source, 'startup'), join(staging, 'startup'), { recursive: true });
const startupPage = join(staging, 'startup/index.html');
writeFileSync(startupPage, readFileSync(startupPage, 'utf8').replace('{{VERSION}}', version));
const png = join(staging, 'ui/icon.png');
cpSync(png, join(staging, 'startup/icon.png'));
const icon = join(staging, 'rai-community-hidpi.ico');
writeWindowsIcon(icon, png);
run(compiler, ['/nologo', '/codepage:65001', '/target:winexe', '/platform:x64', '/optimize+',
  '/win32icon:' + icon, '/win32manifest:' + join(source, 'app.manifest'),
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
  '/reference:System.IO.Compression.dll',
  ...libraries.map(name => '/reference:' + join(staging, name)), '/out:' + join(staging, 'RaiCommunity.exe'), join(source, 'Program.cs')]);

if (!process.argv.includes('--dir')) {
  const nsisRoot = join(tooling, 'electron-builder-cache/nsis-3.0.4.1');
  const nsis = process.env.RAI_MAKENSIS ?? readdirSync(nsisRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => join(nsisRoot, entry.name, 'Bin', 'makensis.exe')).find(existsSync);
  if (!nsis) throw Error('Set RAI_MAKENSIS to the path of makensis.exe.');
  run(nsis, ['/DVERSION=' + version, '/DAPP_FILES=' + staging, '/DINSTALLER=' + installer, '/DAPP_ICON=' + icon, join(source, 'installer.nsi')]);
  writeFileSync(join(root, 'dist', `SHA256SUMS-${version}.txt`), `${sha(installer)}  ${installer.split(/[\\/]/).at(-1)}\n`);
  console.log('Windows installer built: ' + installer);
}
