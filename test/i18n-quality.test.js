import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const files=['story.json','npcs.json','items.json','shop.json','balance.json','ui.json'];
const locales=['en','ja','ko'];
const glossary={
  en:{'冰霜物语':'Frost Story','霜语谷':'Frostwhisper Valley','归雁港':'Homewing Harbor','暖流号':'Warm Current','霜林':'Frostwood','永暖圣殿':'Everwarm Sanctuary','啾可':'Choco','冈特':'Gunnar','蜜儿':'Mier','波波':'Bobo','艾莎':'Elsa','巴尔':'Barr','埃文':'Evan','霜灵师':'Frostweaver'},
  ja:{'冰霜物语':'フロスト・ストーリー','霜语谷':'霜語りの谷','归雁港':'帰雁港','暖流号':'暖流号','霜林':'霜の森','永暖圣殿':'永暖の聖殿','啾可':'チョコ','冈特':'グンナー','蜜儿':'ミエル','波波':'ボボ','艾莎':'エルサ','巴尔':'バル','埃文':'エヴァン','霜灵师':'霜術師'},
  ko:{'冰霜物语':'프로스트 스토리','霜语谷':'서리말 골짜기','归雁港':'귀안항','暖流号':'온류호','霜林':'서리숲','永暖圣殿':'영원의 온기 성전','啾可':'초코','冈特':'군나르','蜜儿':'미엘','波波':'보보','艾莎':'엘사','巴尔':'바르','埃文':'에번','霜灵师':'서리술사'}
};
let pass=0,fail=0;
const ok=(condition,message)=>{ if(condition){ pass++; console.log('  ✓',message); }
  else { fail++; console.error('  ✗ FAIL:',message); } };
const playerFacingKey=new Set(['title','subtitle','hook','name','place','text','prompt','complete','label','desc','arrival','request','thanks','spoken','iapPlaceholder']);
const cjk=/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const hanKana=/[\u3040-\u30ff\u3400-\u9fff]/u;
const hangul=/[\uac00-\ud7af]/u;

function visit(source,target,path,key='',pairs=[]){
  if(typeof source==='string'){
    if(key===''||playerFacingKey.has(key)||path.includes('ui.json')||path.includes('.tiers[')) pairs.push({source,target:String(target??''),path});
    return pairs;
  }
  if(Array.isArray(source)){
    // Dialogue tuple: only the visible line and prerecorded spoken variant are player-facing.
    if(source.length>=2&&typeof source[0]==='string'&&typeof source[1]==='string'){
      pairs.push({source:source[1],target:String(target?.[1]??''),path:`${path}[1]`});
      if(typeof source[2]?.spoken==='string') pairs.push({source:source[2].spoken,target:String(target?.[2]?.spoken??''),path:`${path}[2].spoken`});
      return pairs;
    }
    source.forEach((value,index)=>visit(value,target?.[index],`${path}[${index}]`,key,pairs));
    return pairs;
  }
  if(source&&typeof source==='object') for(const [child,value] of Object.entries(source))
    visit(value,target?.[child],`${path}.${child}`,child,pairs);
  return pairs;
}

console.log('— ChatGPT 审校门禁 —');
for(const locale of locales){
  const pairs=[];
  for(const file of files){
    const source=JSON.parse(readFileSync(resolve(root,'web/config',file),'utf8'));
    const target=JSON.parse(readFileSync(resolve(root,'web/config/locales',locale,file),'utf8'));
    visit(source,target,file,'',pairs);
  }
  const scriptLeaks=pairs.filter(({target})=>locale==='en'?cjk.test(target):locale==='ko'?hanKana.test(target):hangul.test(target));
  ok(scriptLeaks.length===0,`${locale} 没有其他语种字符残留${scriptLeaks.length?`: ${scriptLeaks.slice(0,3).map(x=>x.path).join(', ')}`:''}`);
  const unchanged=pairs.filter(({source,target})=>source===target&&source.length>1&&cjk.test(source));
  ok(unchanged.length===0,`${locale} 没有整句漏翻${unchanged.length?`: ${unchanged.slice(0,3).map(x=>x.path).join(', ')}`:''}`);
  const termIssues=[];
  for(const pair of pairs) for(const [sourceTerm,targetTerm] of Object.entries(glossary[locale]))
    if(pair.source.includes(sourceTerm)&&!pair.target.toLocaleLowerCase().includes(targetTerm.toLocaleLowerCase())) termIssues.push(`${pair.path}: ${sourceTerm}`);
  ok(termIssues.length===0,`${locale} 世界观和角色名统一${termIssues.length?`: ${termIssues.slice(0,3).join(', ')}`:''}`);
  const engineering=pairs.filter(({target})=>locale==='en'?/\b(generator|rebuild mainline|synthesis path|frost tales)\b/i.test(target)
    :locale==='ja'?/(生成器|発生器)/u.test(target):/(생성기|재건 메인라인)/u.test(target));
  ok(engineering.length===0,`${locale} 不暴露生硬工程术语${engineering.length?`: ${engineering.slice(0,3).map(x=>x.path).join(', ')}`:''}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
