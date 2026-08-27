import { copyFile, stat, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
if(!/name=["']collectish-revision["']/.test(html))throw new Error('Build metadata injection did not produce collectish-revision meta');
