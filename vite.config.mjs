import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
export default defineConfig({define:{__APP_VERSION__:JSON.stringify(version)},root:'ui',base:'./',build:{outDir:'../ui-dist',emptyOutDir:true},server:{host:'127.0.0.1',port:5174}});
