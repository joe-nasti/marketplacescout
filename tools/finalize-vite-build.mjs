import { copyFile, cp, stat, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root=process.cwd();
const dist=join(root,'dist');
const targetHtml=join(dist,'index.html');
const build=process.env.GITHUB_SHA||'dev-local';
const revision=process.env.COLLECTISH_WEB_REVISION||(
  process.env.GITHUB_RUN_NUMBER?`r${process.env.GITHUB_RUN_NUMBER}`:'dev'
);
const revisionNumber=Number(String(revision).replace(/^r/,''))||null;
const deployedAt=new Date().toISOString();
const shellSource=await readFile(join(root,'src/core/shell.js'),'utf8').catch(()=> '');
const version=shellSource.match(/WEB_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]||'unknown';

for(const name of ['manifest.webmanifest','collectish-icon-192.png','sw.mjs']){
  const src=join(root,name),dst=join(dist,name);
  if(existsSync(src)&&!existsSync(dst))await copyFile(src,dst);
}

// The production app is a hashed Vite bundle, but older native/browser shells can briefly
// request the canonical /src module graph during a deploy transition. Publish that graph as
// a compatibility artifact and make it valid browser ESM. Vite accepts CSS imports from JS;
// browsers do not. Hoist those CSS imports into the raw compatibility stylesheet instead.
const rawSrc=join(dist,'src');
await cp(join(root,'src'),rawSrc,{recursive:true,force:true});

async function walkJs(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await walkJs(path));
    else if(entry.isFile()&&entry.name.endsWith('.js'))out.push(path);
  }
  return out;
}

const cssImports=new Set();
const staticCssImport=/^\s*import\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+\.css)['"]\s*;?\s*$/gm;
for(const jsPath of await walkJs(rawSrc)){
  let source=await readFile(jsPath,'utf8');
  let changed=false;
  source=source.replace(staticCssImport,(_line,spec)=>{
    if(!spec.startsWith('.'))throw new Error(`Raw compatibility graph has unsupported CSS import ${spec} in ${relative(rawSrc,jsPath)}`);
    const absolute=resolve(dirname(jsPath),spec);
    if(!existsSync(absolute))throw new Error(`Raw compatibility graph is missing CSS dependency ${spec} from ${relative(rawSrc,jsPath)}`);
    cssImports.add(absolute);
    changed=true;
    return '';
  });
  if(changed)await writeFile(jsPath,source);
}

const rawStyle=join(rawSrc,'styles/index.css');
let rawCss=await readFile(rawStyle,'utf8');
const hoisted=[...cssImports].map(path=>{
  let spec=relative(dirname(rawStyle),path).replaceAll('\\','/');
  if(!spec.startsWith('.'))spec=`./${spec}`;
  return `@import '${spec}';`;
});
if(hoisted.length)rawCss=`${hoisted.join('\n')}\n${rawCss}`;
await writeFile(rawStyle,rawCss);

// Fail the build if any JavaScript-to-CSS import survived the compatibility transform.
for(const jsPath of await walkJs(rawSrc)){
  const source=await readFile(jsPath,'utf8');
  if(staticCssImport.test(source))throw new Error(`Raw compatibility graph still contains a CSS module import in ${relative(rawSrc,jsPath)}`);
  staticCssImport.lastIndex=0;
}

let html=await readFile(targetHtml,'utf8');
const marker=`  <meta name="collectish-build" content="${build}">\n  <meta name="collectish-revision" content="${revision}">`;
if(!/name=["']collectish-build["']/.test(html)){
  if(/<\/head>/i.test(html))html=html.replace(/<\/head>/i,`${marker}\n</head>`);
  else throw new Error('Vite build index.html has no </head> for build metadata injection');
}
await writeFile(targetHtml,html);

// Deployment identity is a build artifact only. Keep a single canonical file in dist/
// rather than maintaining parallel build-version/web-version outputs or committing stamps.
await writeFile(join(dist,'web-version.json'),JSON.stringify({
  version,
  revision:revisionNumber,
  label:revision,
  build,
  deployed_at:deployedAt
})+'\n');

const out=await stat(targetHtml).catch(()=>null);
if(!out?.size)throw new Error('Vite build did not produce dist/index.html');
if(!existsSync(join(dist,'sw.mjs')))throw new Error('Vite build did not include sw.mjs');
if(!existsSync(join(rawSrc,'app.js')))throw new Error('Vite build did not include raw-module compatibility bridge');
if(!/name=["']collectish-revision["']/.test(html))throw new Error('Build metadata injection did not produce collectish-revision meta');
