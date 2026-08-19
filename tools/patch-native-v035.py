from pathlib import Path

p = Path('android-agent/app/src/main/java/com/collectish/agent/ReadOnlyProbeBridge.kt')
s = p.read_text()

old = """                    const html=/<!doctype html|<html/i.test(text.slice(0,700));\n                    const loginHtml=html&&(/sign[ -]?in|login|account\\/login/i.test(text.slice(0,12000))||/login/i.test(response.url||''));\n                    if(response.ok&&!loginHtml){let parsed=null;if(mode==='fetch_json'){try{parsed=JSON.parse(text)}catch(e){}}send({ok:true,status:response.status,statusText:response.statusText,url:response.url||url,method,contentType:response.headers.get('content-type')||'',elapsedMs:Date.now()-started,attempt,body:parsed===null?text:parsed,checkedAt:new Date().toISOString()});return;}\n                    if(loginHtml){send({error:'TCGplayer login appears to be required',status:response.status,url:response.url||url,method,checkedAt:new Date().toISOString()});return;}\n"""
new = """                    const html=/<!doctype html|<html/i.test(text.slice(0,700));\n                    const finalUrl=response.url||url;let finalHost='',finalPath='';try{const u=new URL(finalUrl);finalHost=u.host;finalPath=u.pathname}catch(e){}\n                    const loginByUrl=/login|signin|account\\/login/i.test(finalUrl);\n                    const loginByBody=html&&/sign[ -]?in|log[ -]?in|forgot password|account\\/login/i.test(text.slice(0,12000));\n                    const loginHtml=loginByUrl||loginByBody;\n                    if(response.ok&&!loginHtml){let parsed=null;if(mode==='fetch_json'){try{parsed=JSON.parse(text)}catch(e){}}send({ok:true,status:response.status,statusText:response.statusText,url:finalUrl,requestedUrl:url,finalHost,finalPath,loginByUrl:false,loginByBody:false,method,contentType:response.headers.get('content-type')||'',elapsedMs:Date.now()-started,attempt,body:parsed===null?text:parsed,checkedAt:new Date().toISOString()});return;}\n                    if(loginHtml){send({error:'TCGplayer login appears to be required',status:response.status,statusText:response.statusText,url:finalUrl,requestedUrl:url,finalHost,finalPath,loginByUrl,loginByBody,method,contentType:response.headers.get('content-type')||'',htmlDetected:html,bodyPreview:text.slice(0,500),checkedAt:new Date().toISOString()});return;}\n"""
if old not in s:
    raise SystemExit('v035 login diagnostic anchor not found')
s = s.replace(old, new, 1)

if 'loginByUrl' not in s or 'loginByBody' not in s or 'requestedUrl' not in s or 'finalHost' not in s:
    raise SystemExit('v035 diagnostics missing')

p.write_text(s)
print('Detailed Store authentication diagnostics enabled')
