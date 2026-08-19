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

await writeFile(join(dist,'build-version.json'),JSON.stringify({
  build,
  revision:revisionNumber,
  label:revision,
  deployed_at:deployedAt
})+'\n');
await writeFile(join(dist,'web-version.json'),JSON.stringify({
  version:'0.9.52',
  revision:revisionNumber,
  label:revision,
  build,
  deployed_at:deployedAt
})+'\n');

const out=await stat(targetHtml).catch(()=>null);
if(!out?.size)throw new Error('Vite build did not produce dist/index.html');
