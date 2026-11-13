import{readdir,readFile,writeFile}from'node:fs/promises';import{join,relative,resolve}from'node:path';
const root=resolve(import.meta.dirname,'../ui-dist'),local=[],central=[];let offset=0,count=0;
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
async function walk(dir){for(const d of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,d.name);if(d.isDirectory()){await walk(p);continue}if(!d.isFile())continue;
const name=Buffer.from(relative(root,p).replaceAll('\\','/')),data=await readFile(p),crc=crc32(data),h=Buffer.alloc(30),c=Buffer.alloc(46);
h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
local.push(h,name,data);central.push(c,name);offset+=h.length+name.length+data.length;count++}}
await walk(root);const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
await writeFile(resolve(root,'../workdir/ui.zip'),Buffer.concat([...local,centralBytes,end]));
