import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const files=['story.json','npcs.json','items.json','shop.json','balance.json','ui.json'];
const locales=['en','ja','ko'];
const immutableKeys=new Set([
  'id','fam','family','generator','generatorId','gid','cid','npcId','img','scene','cg','icon',
  'voiceId','voiceArrivalId','voiceRequestId','voiceThanksId','type','side','color'
]);
const dialogueTupleKeys=new Set(['prologue','prompt','confirm','intro','pre','dialogue','epilogue']);
const placeholders=text=>[...String(text).matchAll(/{{[^}]+}}/g)].map(match=>match[0]).sort();
const tags=text=>[...String(text).matchAll(/<\/?[A-Za-z][^>]*>/g)].map(match=>match[0]).sort();
let pass=0,fail=0;
const ok=(condition,message)=>{ if(condition){ pass++; console.log('  ✓',message); }
  else { fail++; console.error('  ✗ FAIL:',message); } };

function compare(source,target,path='$',key='',issues=[]){
  if(source===null||typeof source!=='object'){
    if(typeof source!==typeof target) issues.push(`${path}: type`);
    if(typeof source==='number'||typeof source==='boolean'||source===null||immutableKeys.has(key)||(key==='bgm'&&path.includes('/story.json.')))
      if(!Object.is(source,target)) issues.push(`${path}: immutable value`);
    if(typeof source==='string'&&JSON.stringify(placeholders(source))!==JSON.stringify(placeholders(target))) issues.push(`${path}: placeholders`);
    if(typeof source==='string'&&JSON.stringify(tags(source))!==JSON.stringify(tags(target))) issues.push(`${path}: html tags`);
    return issues;
  }
  if(Array.isArray(source)!==Array.isArray(target)){ issues.push(`${path}: container type`); return issues; }
  if(Array.isArray(source)){
    if(source.length!==target.length) issues.push(`${path}: length`);
    if(dialogueTupleKeys.has(key)&&source.length>=2&&typeof source[0]==='string'&&typeof source[1]==='string'&&source[0]!==target?.[0])
      issues.push(`${path}[0]: speaker id`);
    source.forEach((value,index)=>compare(value,target[index],`${path}[${index}]`,key,issues));
    return issues;
  }
  const a=Object.keys(source).sort(),b=Object.keys(target||{}).sort();
  if(JSON.stringify(a)!==JSON.stringify(b)) issues.push(`${path}: keys`);
  for(const child of a) compare(source[child],target?.[child],`${path}.${child}`,child,issues);
  return issues;
}

console.log('— 四语配置安全性 —');
for(const locale of locales) for(const file of files){
  let source,target;
  try{
    source=JSON.parse(readFileSync(resolve(root,'web/config',file),'utf8'));
    target=JSON.parse(readFileSync(resolve(root,'web/config/locales',locale,file),'utf8'));
  }catch(error){ ok(false,`${locale}/${file} 可读取: ${error.message}`); continue; }
  const issues=compare(source,target,`${locale}/${file}`);
  ok(issues.length===0,`${locale}/${file} 保留结构、数值、ID 和占位符${issues.length?`: ${issues.slice(0,3).join(', ')}`:''}`);
}

for(const locale of locales){
  const story=JSON.parse(readFileSync(resolve(root,'web/config/locales',locale,'story.json'),'utf8'));
  const ids=story.chapters.flatMap(chapter=>chapter.nodes.map(node=>node.id));
  ok(story.chapters.length===6&&ids.length===24&&new Set(ids).size===24,`${locale} 保留 6 章 24 段主线`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
