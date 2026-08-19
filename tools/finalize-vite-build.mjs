import { copyFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root=process.cwd();
const dist=join(root,'dist');
const sourceHtml=join(dist,'vite-index.html');
const targetHtml=join(dist,'index.html');

if(existsSync(sourceHtml))await rename(sourceHtml,targetHtml);

for(const name of ['manifest.webmanifest','collectish-icon-192.png','build-version.json','web-version.json']){
  const src=join(root,name),dst=join(dist,name);
  if(existsSync(src)&&!existsSync(dst))await copyFile(src,dst);
}

const out=await stat(targetHtml).catch(()=>null);
if(!out?.size)throw new Error('Vite build did not produce dist/index.html');
