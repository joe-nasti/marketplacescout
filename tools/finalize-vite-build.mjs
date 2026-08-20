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

for(const name of ['manifest.webmanifest','collectish-icon-192.png']){
  const src=join(root,name),dst=join(dist,name);
  if(existsSync(src)&&!existsSync(dst))await copyFile(src,dst);
}

let html=await readFile(targetHtml,'utf8');
const marker=`  <meta name="collectish-build" content="${build}">\n  <meta name="collectish-revision" content="${revision}">`;
html=html.replace('  <meta name="theme-color" content="#f5f8ff">',`  <meta name="theme-color" content="#f5f8ff">\n${marker}`);
await writeFile(targetHtml,html);

// Deployment identity is a build artifact only. Keep a single canonical file in dist/
// rather than maintaining parallel build-version/web-version outputs or committing stamps.
await writeFile(join(dist,'web-version.json'),JSON.stringify({
  version:'0.9.52',
  revision:revisionNumber,
  label:revision,
  build,
  deployed_at:deployedAt
})+'\n');

const out=await stat(targetHtml).catch(()=>null);
if(!out?.size)throw new Error('Vite build did not produce dist/index.html');
