import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const root=process.cwd();
const scanRoots=['src','.'];
const ignoredTop=new Set(['.git','.github','android-agent','cloud-worker','docs','node_modules','dist','.vite','tools']);
const revisionStamped=/^(?:current-.+-r\d+|v\d{3,})\.(?:js|mjs|css)$/i;
const offenders=new Set();

async function walk(dir,{rootOnly=false}={}){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.name.startsWith('.')&&entry.name!=='.')continue;
    const full=join(dir,entry.name);
    const rel=relative(root,full).replaceAll('\\','/');
    if(entry.isDirectory()){
      if(rootOnly||ignoredTop.has(entry.name))continue;
      await walk(full);
      continue;
    }
    if(!['.js','.mjs','.css'].includes(extname(entry.name)))continue;
    if(revisionStamped.test(entry.name))offenders.add(rel);
  }
}

await walk(join(root,'src'));
await walk(root,{rootOnly:true});

if(offenders.size){
  console.error('Revision-stamped web source files are not allowed. Keep stable source names and let Vite hash dist assets:');
  for(const file of [...offenders].sort())console.error(` - ${file}`);
  process.exit(1);
}

console.log('Source hygiene OK: no revision-stamped web source files.');
