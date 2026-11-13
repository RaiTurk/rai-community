import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { AdminWebsocket, CellType, getNonceExpiration, randomNonce } from '@holochain/client';
import { encode } from '@msgpack/msgpack';
import { readLegacyStorage } from './storage.mjs';

const require = createRequire(import.meta.url);
const { ZomeCallSigner } = require('./signer.node');
const { parse, stringify } = require('yaml');
const [profile, seed] = process.argv.slice(2);
const assets = import.meta.dirname;
const appId = 'kangaroo.happ';
const appOrigin = 'https://rai-community.local';
const networkDefault = 'https://dev-test-bootstrap2.holochain.org/';
const data = join(profile, 'data');
const keystore = join(data, 'keystore');
const conductor = join(data, 'conductor');
const configPath = join(conductor, 'conductor-config.yaml');
const networkPath = join(conductor, 'rai-network.json');
const children = new Set();
const updates = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let admin, signer, cellId;
let closing = false;

function stop() {
  closing = true;
  admin?.client.socket.terminate?.();
  for (const child of [...children].reverse()) child.kill();
  process.exitCode = 0;
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function atomicWrite(path, content) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, content, { flag: 'wx' });
  try { await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('HTTPS address required.');
  return url;
}

async function getNetwork() {
  const saved = JSON.parse((await readOptional(networkPath)) ?? '{}');
  return {
    fullCopy: saved.fullCopy !== false,
    bootstrapUrl: saved.bootstrapUrl ?? '',
    relayUrl: saved.relayUrl ?? '',
    defaults: { bootstrapUrl: networkDefault, relayUrl: networkDefault },
  };
}

async function setNetwork(settings) {
  const { fullCopy, bootstrapUrl = '', relayUrl = '' } = settings;
  if (typeof fullCopy !== 'boolean' || typeof bootstrapUrl !== 'string' || typeof relayUrl !== 'string') throw Error('Invalid network settings.');
  for (const url of [bootstrapUrl, relayUrl]) if (url) httpsUrl(url);
  await atomicWrite(networkPath, JSON.stringify({ fullCopy, bootstrapUrl, relayUrl }, null, 2));
  return true;
}

function startProcess(name, args, cwd, password, ready, log) {
  if (closing) throw Error('The desktop shell is closing.');
  return new Promise((resolve, reject) => {
    const child = spawn(join(assets, name), args, { cwd, windowsHide: true,
      env: { ...process.env, RUST_LOG: 'warn,holochain::core::workflow::publish_dht_ops_workflow=error' } });
    children.add(child);
    const timer = setTimeout(() => { child.kill(); reject(Error(name + ' did not start in time.')); }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      children.delete(child);
      clearTimeout(timer);
      reject(Error(name + ' exited (' + code + ').'));
      if (!closing) log.write(name + ' exited (' + code + ').\n');
    });
    child.stdin.on('error', () => {});
    child.stdin.end(password);
    child.stderr.pipe(log, { end: false });
    const output = createInterface({ input: child.stdout });
    output.on('line', line => {
      const value = ready(line);
      if (value) { clearTimeout(timer); resolve(value); }
    });
  });
}

async function startup(password, setup) {
  await mkdir(keystore, { recursive: true });
  await mkdir(conductor, { recursive: true });
  const logs = join(profile, 'logs');
  await mkdir(logs, { recursive: true });
  const log = (await open(join(logs, 'webview-runtime.log'), 'a')).createWriteStream();
  log.on('error', () => {});
  const lairConfig = join(keystore, 'lair-keystore-config.yaml');
  if (!(await readOptional(lairConfig))) {
    if (!setup || password.length < 8) throw Error('Set a local password of at least eight characters.');
    await startProcess('lair-keystore.exe', ['init', '-p'], keystore, password, line => line.includes('# lair-keystore init config'), log);
  }
  const lairUrl = await startProcess('lair-keystore.exe', ['server', '-p'], keystore, password,
    line => line.match(/^# lair-keystore connection_url #\s*(.*?)\s*#/)?.[1], log);
  signer = await ZomeCallSigner.connect(lairUrl, password);
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const network = await getNetwork();
  const config = parse((await readOptional(configPath)) ?? '{}');
  config.data_root_path = conductor;
  config.keystore = { type: 'lair_server', connection_url: lairUrl };
  config.admin_interfaces = [{ driver: { type: 'websocket', port, allowed_origins: 'rai-native-admin' } }];
  config.network = { ...config.network, request_timeout_s: 60, bootstrap_url: network.bootstrapUrl || networkDefault,
    relay_url: network.relayUrl || networkDefault, target_arc_factor: network.fullCopy ? 1 : 0 };
  config.db_sync_level ??= 'Normal';
  await atomicWrite(configPath, stringify(config));
  await startProcess('holochain.exe', ['-c', configPath, '-p'], conductor, password, line => line.includes('Conductor ready.'), log);
  admin = await AdminWebsocket.connect({ url: new URL(`ws://127.0.0.1:${port}`), wsClientOptions: { origin: 'rai-native-admin' } });
  let app = (await admin.listApps({})).find(item => item.installed_app_id === appId);
  if (!app) {
    app = await admin.installApp({ source: { type: 'path', value: join(assets, 'rai-community.happ') }, installed_app_id: appId,
      agent_key: await admin.generateAgentPubKey(), network_seed: seed });
  }
  await admin.enableApp({ installed_app_id: appId });
  cellId = app.cell_info.community.find(entry => entry.type === CellType.Provisioned).value.cell_id;
  const interfaces = await admin.listAppInterfaces();
  const appInterface = interfaces.find(entry => entry.allowed_origins === appOrigin && entry.installed_app_id === appId)
    ?? await admin.attachAppInterface({ allowed_origins: appOrigin, installed_app_id: appId });
  const { token } = await admin.issueAppAuthenticationToken({ installed_app_id: appId, single_use: false, expiry_seconds: 0 });
  const { port: appPort } = appInterface;
  return { appPort, token: Array.from(token), appId, storage: await readLegacyStorage(profile) };
}

async function sign(request) {
  const { provenance, cell_id, zome_name, fn_name, payload } = request;
  if (!Buffer.from(provenance).equals(Buffer.from(cellId[1])) || !cell_id.every((hash, index) => Buffer.from(hash).equals(Buffer.from(cellId[index]))) ||
      cell_id.length !== 2 || zome_name !== 'rai_community' || typeof fn_name !== 'string') throw Error('Invalid signing request.');
  const bytes = encode({ cell_id, zome_name, fn_name, payload: encode(payload), provenance,
    nonce: await randomNonce(), expires_at: getNonceExpiration() });
  const hash = createHash('sha512').update(bytes).digest();
  const signature = await signer.signZomeCall(Array.from(hash), Array.from(provenance));
  return { bytes: Array.from(bytes), signature };
}

async function downloadUpdate({ url, sha256 }) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw Error('Invalid SHA-256.');
  const controller = AbortSignal.timeout(300000);
  let target = httpsUrl(url), response;
  for (let hop = 0; hop < 6; hop++) {
    response = await fetch(target, { redirect: 'manual', signal: controller });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = response.headers.get('location');
    await response.body?.cancel();
    if (!next) throw Error('Update redirect has no destination.');
    target = httpsUrl(new URL(next, target));
  }
  if (!response.ok || !response.body) throw Error('Update download failed (' + response.status + ').');
  const directory = join(profile, 'verified-updates');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'Rai-Community-' + randomUUID() + '-setup.exe');
  const temp = file + '.part';
  const handle = await open(temp, 'wx');
  const hash = createHash('sha256');
  let size = 0;
  try {
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 512 * 1024 * 1024) throw Error('Update exceeds 512 MB.');
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    const actual = hash.digest('hex');
    if (actual !== sha256.toLowerCase()) return { ok: false, actual };
    await rename(temp, file);
    updates.set(file, actual);
    return { ok: true, actual, file };
  } finally { await rm(temp, { force: true }); }
}

async function openUpdate(file) {
  const expected = updates.get(file);
  if (!expected) throw Error('Unknown verified update.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw Error('The verified update file has changed.');
  const child = spawn(file, [], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return '';
}

const methods = { getNetwork, setNetwork, sign, downloadUpdate, openUpdate };
const input = createInterface({ input: process.stdin });
input.on('close', stop);
input.on('line', async line => {
  let request;
  try {
    request = JSON.parse(line, (_, value) => value?.$bytes ? Uint8Array.from(value.$bytes) : value);
    if (request.method === 'startup' && !signer) {
      send({ id: request.id, value: await startup(request.value.password, request.value.setup) });
    } else if (signer && Object.hasOwn(methods, request.method)) {
      send({ id: request.id, value: await methods[request.method](request.value) });
    } else throw Error('Unknown shell operation.');
  } catch (error) {
    if (request?.method === 'startup') process.stderr.write(String(error.stack || error) + '\n');
    send({ id: request?.id, error: request?.method === 'startup' ? 'Could not unlock or start this device. Check the local password and runtime log. / Yerel parolayı ve çalışma günlüğünü kontrol et.' : error.message });
    if (request?.method === 'startup') { stop(); input.close(); }
  }
});
