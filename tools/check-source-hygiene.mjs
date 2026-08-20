import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const root=process.cwd();
const ignoredTop=new Set(['.git','.github','android-agent','cloud-worker','docs','node_modules','dist','.vite','tools']);
const revisionStamped=/^(?:current-.+-r\d+|v\d{3,})\.(?:js|mjs|css)$/i;
const domScriptInjection=/(?:createElement\s*\(\s*['"]script['"]\s*\)|\.src\s*=\s*['"][^'"]+\.js|appendChild\s*\([^\n]*script)/i;
const mutationObserver=/\bMutationObserver\b/;
const offenders=new Set();
const scriptInjectors=new Set();
const mutationGuardians=new Set();

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
    const ext=extname(entry.name);
    if(!['.js','.mjs','.css'].includes(ext))continue;
    if(revisionStamped.test(entry.name))offenders.add(rel);
    if(!rootOnly&&['.js','.mjs'].includes(ext)){
      const source=await readFile(full,'utf8');
      if(domScriptInjection.test(source))scriptInjectors.add(rel);
      if(mutationObserver.test(source))mutationGuardians.add(rel);
    }
  }
}

await walk(join(root,'src'));
await walk(root,{rootOnly:true});

if(offenders.size||scriptInjectors.size||mutationGuardians.size){
  if(offenders.size){
    console.error('Revision-stamped web source files are not allowed. Keep stable source names and let Vite hash dist assets:');
    for(const file of [...offenders].sort())console.error(` - ${file}`);
  }
  if(scriptInjectors.size){
    console.error('Runtime DOM script injection is not allowed in src/. Use ESM imports or dynamic import() so Vite owns chunk loading:');
    for(const file of [...scriptInjectors].sort())console.error(` - ${file}`);
  }
  if(mutationGuardians.size){
    console.error('DOM guardian MutationObservers are not allowed in src/. Render from store/lifecycle state or explicit domain events instead:');
    for(const file of [...mutationGuardians].sort())console.error(` - ${file}`);
  }
  process.exit(1);
}

console.log('Source hygiene OK: stable filenames, ESM loading, and deterministic DOM lifecycle.');
