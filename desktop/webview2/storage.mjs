import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');
const origin = Buffer.from('_webhapp://webhappwindow\0');

function decodeStorage(buffer) {
  if (buffer[0] === 0) return buffer.subarray(1).toString('utf16le');
  if (buffer[0] === 1) return buffer.subarray(1).toString('latin1');
  throw Error('Unrecognized Chromium storage encoding.');
}

export async function readLegacyStorage(profile) {
  const source = join(profile, 'chromium', 'Local Storage', 'leveldb');
  try { await stat(join(source, 'CURRENT')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  // Open a private snapshot because LevelDB can repair or compact files on open.
  const scratch = await mkdtemp(join(profile, 'rai-storage-import-'));
  let db;
  try {
    await cp(source, scratch, { recursive: true, filter: path => !path.endsWith('\\LOCK') });
    db = new ClassicLevel(scratch, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await db.open();
    const upper = Buffer.from(origin);
    upper[upper.length - 1] = 1;
    const values = Object.create(null);
    for await (const [key, value] of db.iterator({ gte: origin, lt: upper })) {
      const name = decodeStorage(key.subarray(origin.length));
      if (name.startsWith('rai.') || name.startsWith('rai-')) values[name] = decodeStorage(value);
    }
    return values;
  } finally {
    try { await db?.close(); }
    finally { await rm(scratch, { recursive: true, force: true }); }
  }
}
