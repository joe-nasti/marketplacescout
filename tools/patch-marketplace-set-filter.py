from pathlib import Path
p=Path('cloud-worker/marketplace-worker.mjs')
s=p.read_text()
repls=[
('async function scanSearchPage({setSlug,printing,condition,language,from=0,size=10,algorithm="salesrel",directOnly=true}){\n  const body={algorithm,from,size,filters:{term:{productLineName:["magic"],productTypeName:["Cards"],setName:[setSlug]},range:{},match:{}},',
 'async function scanSearchPage({setSlug,tcgSetSlug,printing,condition,language,from=0,size=10,algorithm="salesrel",directOnly=true}){\n  const setFilter=String(tcgSetSlug||setSlug||"").trim();\n  const body={algorithm,from,size,filters:{term:{productLineName:["magic"],productTypeName:["Cards"],setName:[setFilter]},range:{},match:{}},'),
('async function autoSearchPass({setSlug,printing,condition,language,maxPositions=Infinity,onProgress}){let from=0,total=null,rows=[],algorithm="",targetTotal=null;while(total===null||from<total){const response=await scanSearchPage({setSlug,printing,condition,language,from,size:10});const parsed=parseProducts(response,from+1);if(total===null){total=parsed.total;targetTotal=Math.min(total,Number.isFinite(maxPositions)?maxPositions:total)}',
 'async function autoSearchPass({setSlug,tcgSetSlug,setName,printing,condition,language,maxPositions=Infinity,onProgress}){let from=0,total=null,rows=[],algorithm="",targetTotal=null;while(total===null||from<total){const response=await scanSearchPage({setSlug,tcgSetSlug,printing,condition,language,from,size:10});const parsed=parseProducts(response,from+1);if(total===null){total=parsed.total;if(total>10000)throw new Error(`Set filter mismatch for ${setName||tcgSetSlug||setSlug}: TCGplayer returned ${total} positions using ${tcgSetSlug||setSlug}`);targetTotal=Math.min(total,Number.isFinite(maxPositions)?maxPositions:total)}'),
('async function enrichMarketplaceCompetition(rows,{setSlug,condition,language,onProgress}){',
 'async function enrichMarketplaceCompetition(rows,{setSlug,tcgSetSlug,condition,language,onProgress}){'),
('const response=await scanSearchPage({setSlug,printing,condition,language,from,size:10,directOnly:false});',
 'const response=await scanSearchPage({setSlug,tcgSetSlug,printing,condition,language,from,size:10,directOnly:false});'),
('passes.push(await autoSearchPass({setSlug,printing:mode,condition,language,maxPositions:coverage.limit,',
 'passes.push(await autoSearchPass({setSlug,tcgSetSlug:profile.tcgSetSlug||setSlug,setName:profile.setName||setSlug,printing:mode,condition,language,maxPositions:coverage.limit,'),
('const competition=await enrichMarketplaceCompetition(rows,{setSlug,condition,language,',
 'const competition=await enrichMarketplaceCompetition(rows,{setSlug,tcgSetSlug:profile.tcgSetSlug||setSlug,condition,language,')
]
for old,new in repls:
    if old not in s:
        raise SystemExit(f'Expected Marketplace set-filter snippet not found: {old[:100]}')
    s=s.replace(old,new)
p.write_text(s)
print('Marketplace canonical TCG set URL filter + broad-result guard patched')
