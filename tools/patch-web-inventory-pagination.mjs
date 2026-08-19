import fs from 'node:fs';

const file='src/modules/seller/inventory.js';
let s=fs.readFileSync(file,'utf8');

const anchor=`async function loadStored(){\n  const [products,conditions,stateRows]=await Promise.all([\n    rest('store_inventory_products?select=*&quantity=gt.0&order=quantity.desc,product_name.asc&limit=5000'),\n    rest('store_inventory_conditions?select=*&quantity=gt.0&order=quantity.desc&limit=5000'),\n    rest('store_inventory_sync_state?select=*&limit=1')\n  ]);\n  rows=products||[];conditionRows=conditions||[];\n  syncState({products:rows,conditionRows,status:'ready',syncState:stateRows?.[0]||null});\n  await loadCrossSource(rows.map(x=>x.product_id));\n  render();\n}\n`;

const replacement=`async function restAll(basePath,{pageSize=1000,maxRows=20000}={}){\n  const out=[];\n  for(let offset=0;offset<maxRows;offset+=pageSize){\n    const sep=basePath.includes('?')?'&':'?';\n    const batch=await rest(\`\${basePath}\${sep}limit=\${pageSize}&offset=\${offset}\`);\n    if(!Array.isArray(batch)||!batch.length)break;\n    out.push(...batch);\n    if(batch.length<pageSize)break;\n  }\n  return out;\n}\n\nasync function loadStored(){\n  const [products,conditions,stateRows]=await Promise.all([\n    restAll('store_inventory_products?select=*&quantity=gt.0&order=quantity.desc,product_name.asc'),\n    restAll('store_inventory_conditions?select=*&quantity=gt.0&order=quantity.desc'),\n    rest('store_inventory_sync_state?select=*&limit=1')\n  ]);\n  rows=products||[];conditionRows=conditions||[];\n  syncState({products:rows,conditionRows,status:'ready',syncState:stateRows?.[0]||null});\n  await loadCrossSource(rows.map(x=>x.product_id));\n  render();\n}\n`;

if(!s.includes(anchor))throw new Error('inventory loadStored pagination anchor not found');
s=s.replace(anchor,replacement);

if(!s.includes('async function restAll('))throw new Error('restAll pagination helper missing');
if(s.includes("store_inventory_products?select=*&quantity=gt.0&order=quantity.desc,product_name.asc&limit=5000"))throw new Error('single-page product read remains');

fs.writeFileSync(file,s);
console.log('Inventory DB reads now page through the full stored inventory');
