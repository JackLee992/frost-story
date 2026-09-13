#!/usr/bin/env node
// Assigns one deterministic offline voice asset to every authored line, then
// writes the generation manifest consumed by generate_all.py.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const storyPath=resolve(root,'web/config/story.json');
const npcsPath=resolve(root,'web/config/npcs.json');
const manifestPath=resolve(root,'tools/voice/voice-manifest.json');
const runtimeManifestPath=resolve(root,'web/assets/audio/voice/manifest.json');
const story=JSON.parse(readFileSync(storyPath,'utf8'));
const npcs=JSON.parse(readFileSync(npcsPath,'utf8'));
const clips=[];

const cast={
  narrator:{voice:'zf_xiaoxiao,zf_xiaoyi',speed:.92,direction:'沉静温暖的女声旁白，句间留白，避免播报腔'},
  choco:{voice:'zf_xiaoni,zf_xiaoyi',speed:1.03,direction:'明亮灵动的年轻霜灵，亲近但不过分幼态'},
  gunnar:{voice:'zm_yunjian',speed:.88,direction:'粗粝而慈祥的老猎人，语速舒缓'},
  bobo:{voice:'zm_yunxi',speed:1.08,direction:'年轻热心的企鹅邮差，略带急促'},
  mier:{voice:'zf_xiaoyi',speed:1.0,direction:'爽朗温暖的面包师，带笑意'},
  elsa:{voice:'zf_xiaoni',speed:.86,direction:'慈爱的年长裁缝，柔和从容'},
  bar:{voice:'zm_yunjian,zm_yunxi',speed:.91,direction:'低沉克制的铁匠，情绪藏在停顿里'},
  gramps:{voice:'zm_yunjian',speed:.8,direction:'年迈平静的守焰人，温柔而有重量'},
  all:{voice:'zf_xiaoxiao,zf_xiaoyi',speed:.9,direction:'收束全章的温暖群像旁白'}
};
const localeSpecs={
  'zh-CN':{dir:'zh',provider:'kokoro',langCode:'z',cast},
  en:{dir:'en',provider:'kokoro',langCode:'a',cast:{
    narrator:{voice:'af_heart',speed:.94}, choco:{voice:'af_bella',speed:1.04}, gunnar:{voice:'am_michael',speed:.88},
    bobo:{voice:'am_puck',speed:1.08}, mier:{voice:'af_sarah',speed:1.0}, elsa:{voice:'af_nicole',speed:.88},
    bar:{voice:'am_fenrir',speed:.9}, gramps:{voice:'am_onyx',speed:.82}, all:{voice:'af_heart',speed:.92}
  }},
  ja:{dir:'ja',provider:'kokoro',langCode:'j',cast:{
    narrator:{voice:'jf_alpha',speed:.94}, choco:{voice:'jf_gongitsune',speed:1.04}, gunnar:{voice:'jm_kumo',speed:.88},
    bobo:{voice:'jf_nezumi',speed:1.07}, mier:{voice:'jf_tebukuro',speed:1.0}, elsa:{voice:'jf_alpha',speed:.87},
    bar:{voice:'jm_kumo',speed:.9}, gramps:{voice:'jm_kumo',speed:.8}, all:{voice:'jf_alpha',speed:.92}
  }},
  ko:{dir:'ko',provider:'melo',language:'KR',cast:{
    narrator:{voice:'KR',speed:.94,pitch:0}, choco:{voice:'KR',speed:1.06,pitch:1.4}, gunnar:{voice:'KR',speed:.88,pitch:-2.0},
    bobo:{voice:'KR',speed:1.08,pitch:.8}, mier:{voice:'KR',speed:1.0,pitch:.25}, elsa:{voice:'KR',speed:.87,pitch:-.7},
    bar:{voice:'KR',speed:.9,pitch:-1.45}, gramps:{voice:'KR',speed:.8,pitch:-2.4}, all:{voice:'KR',speed:.92,pitch:0}
  }}
};
const pad=n=>String(n).padStart(2,'0');
const rel=(name,locale='zh')=>`assets/audio/voice/${locale}/${name}.ogg`;
const asLine=(raw,defaultWho='narrator')=>Array.isArray(raw)?raw:[defaultWho,String(raw),{}];
const synthesisText=(say,spoken)=>String(spoken||say)
  .replaceAll('{{playerName}}','你').replaceAll('{{choice}}','选好的主灯')
  .replace(/{{[^}]+}}/g,'这件事').replace(/[《》「」『』]/g,'');
const add=(id,who,say,meta,kind)=>{
  const spec=cast[who]||cast.narrator;
  meta.voiceId=id; delete meta.voice;
  if(String(say).includes('{{')&&!meta.spoken) meta.spoken=synthesisText(say);
  clips.push({id:`zh-CN:${id}`,voiceId:id,locale:'zh-CN',path:rel(id),kind,role:who,text:String(say),spoken:synthesisText(say,meta.spoken),provider:'kokoro',langCode:'z',...spec});
};
const wireList=(list,prefix,kind,defaultWho='narrator')=>list.map((raw,index)=>{
  const line=asLine(raw,defaultWho), meta=line[2]&&typeof line[2]==='object'?line[2]:{};
  line[2]=meta; add(`${prefix}_${pad(index+1)}`,line[0],line[1],meta,kind);
  return line;
});

const byId=id=>story.chapters.flatMap(ch=>ch.nodes).find(node=>node.id===id);
const personalize=(nodeId,section,index,text,spoken)=>{
  const line=byId(nodeId)?.[section]?.[index]; if(!line) throw new Error(`missing personalization target ${nodeId}.${section}.${index}`);
  line[1]=text; line[2]={...(line[2]||{}),spoken};
};
personalize('n11','dialogue',2,'{{playerName}}，你提的这盏风灯，是埃文的吧。他是你祖父，也是谷里最好的霜灵师。','你提的这盏风灯，是埃文的吧。他是你祖父，也是谷里最好的霜灵师。');
personalize('n14','dialogue',3,'原来我被留下来，是为了等你呀，{{playerName}}。','原来我被留下来，是为了等你呀。');
personalize('n21','dialogue',3,'第一个派，一定给你，{{playerName}}。谢谢你，让我又能开始等一个人了。','第一个派，一定给你。谢谢你，让我又能开始等一个人了。');
personalize('n33','pre',0,'暖炉、蜂蜜暖饮、成套家具……不用等到世上最稀有的供物。{{playerName}}，守焰人的礼节，是把手边的温暖都带来。','暖炉、蜂蜜暖饮、成套家具……不用等到世上最稀有的供物。守焰人的礼节，是把手边的温暖都带来。');
personalize('n44','dialogue',2,'{{playerName}}，第二种温度，你已经替山谷拿到了——人惦记着人，就散不了。','第二种温度，你已经替山谷拿到了——人惦记着人，就散不了。');
personalize('n61','pre',1,'霜木殿堂做梁、霜晶照路、暖炉不停——{{playerName}}，往上走，别回头。','霜木殿堂做梁、霜晶照路、暖炉不停——往上走，别回头。');
personalize('n63','dialogue',1,'你来了，{{playerName}}。路很长，辛苦你了，我的孩子。','你来了。路很长，辛苦你了，我的孩子。');
personalize('n64','pre',0,'永暖圣火是希望，永冻钻是记忆，暖阳特调是牵挂，盛宴蛋糕是团圆——{{playerName}}，把这四样，放进霜心里。','永暖圣火是希望，永冻钻是记忆，暖阳特调是牵挂，盛宴蛋糕是团圆——把这四样，放进霜心里。');
story.epilogue[8][1]='《冰霜物语》 · 感谢 {{playerName}}，把春天一点一点，合并了回来。';
story.epilogue[8][2]={...(story.epilogue[8][2]||{}),spoken:'冰霜物语。感谢你，把春天一点一点，合并了回来。'};

story.prologue=wireList(story.prologue,'prologue','prologue');
story.profile.prompt=wireList(story.profile.prompt,'profile_prompt','profile');
story.profile.confirm=wireList(story.profile.confirm,'profile_confirm','profile');
for(const chapter of story.chapters){
  chapter.intro=wireList(chapter.intro,`chapter_${pad(chapter.id)}_intro`,'chapter-intro');
  for(const node of chapter.nodes){
    node.pre=wireList(node.pre||[],`${node.id}_pre`,'node-pre');
    node.dialogue=wireList(node.dialogue||[],`${node.id}_dialogue`,'node-dialogue');
  }
}
story.epilogue=wireList(story.epilogue,'epilogue','epilogue');

for(const npc of npcs.npcs.filter(item=>item.order!==false)){
  for(const [field,suffix,who] of [['arrival','arrival','narrator'],['request','request',npc.id],['thanks','thanks',npc.id]]){
    const base=`voice${suffix[0].toUpperCase()}${suffix.slice(1)}`, voiceId=`${npc.id}_${suffix}`;
    npc[`${base}Id`]=voiceId; delete npc[base];
    const spec=cast[who]||cast.narrator;
    clips.push({id:`zh-CN:${voiceId}`,voiceId,locale:'zh-CN',path:rel(voiceId),kind:`npc-${suffix}`,role:who,text:npc[field],spoken:synthesisText(npc[field]),...spec});
  }
}

for(const [group,cues] of Object.entries(story.companion||{})) for(const [key,cue] of Object.entries(cues||{})){
  const voiceId=`companion_${group}_${key}`; cue.voiceId=voiceId; delete cue.voice;
  clips.push({id:`zh-CN:${voiceId}`,voiceId,locale:'zh-CN',path:rel(voiceId),kind:`companion-${group}`,role:'choco',text:cue.text,
    spoken:synthesisText(cue.text,cue.spoken),provider:'kokoro',langCode:'z',...cast.choco});
}

writeFileSync(storyPath,`${JSON.stringify(story,null,2)}\n`);
writeFileSync(npcsPath,`${JSON.stringify(npcs,null,2)}\n`);

const localizedLines=(localizedStory,localizedNpcs)=>{
  const found=new Map();
  const put=(line,kind,role=line?.[0])=>{
    const meta=line?.[2]||{},voiceId=meta.voiceId;
    if(!voiceId) throw new Error(`localized ${kind} line is missing voiceId`);
    found.set(voiceId,{voiceId,kind,role,text:String(line[1]),spoken:synthesisText(line[1],meta.spoken)});
  };
  (localizedStory.prologue||[]).forEach(line=>put(line,'prologue'));
  (localizedStory.profile?.prompt||[]).forEach(line=>put(line,'profile'));
  (localizedStory.profile?.confirm||[]).forEach(line=>put(line,'profile'));
  for(const chapter of localizedStory.chapters||[]){
    (chapter.intro||[]).forEach(line=>put(line,'chapter-intro'));
    for(const node of chapter.nodes||[]){
      (node.pre||[]).forEach(line=>put(line,'node-pre'));
      (node.dialogue||[]).forEach(line=>put(line,'node-dialogue'));
    }
  }
  (localizedStory.epilogue||[]).forEach(line=>put(line,'epilogue'));
  for(const npc of (localizedNpcs.npcs||[]).filter(item=>item.order!==false)){
    for(const [field,suffix,role] of [['arrival','Arrival','narrator'],['request','Request',npc.id],['thanks','Thanks',npc.id]]){
      const voiceId=npc[`voice${suffix}Id`];
      found.set(voiceId,{voiceId,kind:`npc-${suffix.toLowerCase()}`,role,text:String(npc[field]),spoken:synthesisText(npc[field])});
    }
  }
  for(const [group,cues] of Object.entries(localizedStory.companion||{})) for(const cue of Object.values(cues||{})){
    found.set(cue.voiceId,{voiceId:cue.voiceId,kind:`companion-${group}`,role:'choco',text:String(cue.text),spoken:synthesisText(cue.text,cue.spoken)});
  }
  return found;
};

const baseIds=clips.map(clip=>clip.voiceId);
for(const locale of ['en','ja','ko']){
  const localeRoot=resolve(root,'web/config/locales',locale);
  const localizedStoryPath=resolve(localeRoot,'story.json'),localizedNpcsPath=resolve(localeRoot,'npcs.json');
  if(!existsSync(localizedStoryPath)||!existsSync(localizedNpcsPath)) throw new Error(`missing localized configs for ${locale}; run npm run i18n:generate first`);
  const lines=localizedLines(JSON.parse(readFileSync(localizedStoryPath,'utf8')),JSON.parse(readFileSync(localizedNpcsPath,'utf8')));
  if(lines.size!==baseIds.length) throw new Error(`${locale}: expected ${baseIds.length} voice IDs, got ${lines.size}`);
  const localeSpec=localeSpecs[locale];
  for(const voiceId of baseIds){
    const line=lines.get(voiceId); if(!line) throw new Error(`${locale}: missing ${voiceId}`);
    const voiceSpec=localeSpec.cast[line.role]||localeSpec.cast.narrator;
    clips.push({id:`${locale}:${voiceId}`,locale,path:rel(voiceId,localeSpec.dir),...line,
      provider:localeSpec.provider,langCode:localeSpec.langCode,language:localeSpec.language,...voiceSpec});
  }
}

const paths=clips.map(clip=>clip.path);
if(new Set(paths).size!==paths.length) throw new Error('voice paths must be unique');
writeFileSync(manifestPath,`${JSON.stringify({version:1,generatedBy:'tools/voice/build_voice_manifest.mjs',clips},null,2)}\n`);
mkdirSync(dirname(runtimeManifestPath),{recursive:true});
writeFileSync(runtimeManifestPath,`${JSON.stringify({schema:1,total:clips.length,
  locales:{zh:216,en:216,ja:216,ko:216},paths:clips.map(clip=>clip.path)},null,2)}\n`);
console.log(JSON.stringify({clips:clips.length,locales:Object.fromEntries(Object.keys(localeSpecs).map(locale=>[locale,clips.filter(x=>x.locale===locale).length])),
  story:clips.filter(x=>x.locale==='zh-CN'&&!x.kind.startsWith('npc-')&&!x.kind.startsWith('companion-')).length,
  npc:clips.filter(x=>x.locale==='zh-CN'&&x.kind.startsWith('npc-')).length,
  companion:clips.filter(x=>x.locale==='zh-CN'&&x.kind.startsWith('companion-')).length,
  manifest:manifestPath,runtimeManifest:runtimeManifestPath},null,2));
