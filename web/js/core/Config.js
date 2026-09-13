// 配置加载：集中读取 config/*.json（对标竞品 Config 表），并生成纹理清单
async function loadJSON(f){ const r=await fetch(f); if(!r.ok) throw new Error('config missing '+f); return r.json(); }

export class Config {
  static supportedLocales=['zh-CN','en','ja','ko'];
  static normalizeLocale(value){ const raw=String(value||'').toLowerCase();
    if(raw.startsWith('zh')) return 'zh-CN'; if(raw.startsWith('ja')) return 'ja'; if(raw.startsWith('ko')) return 'ko';
    if(raw.startsWith('en')) return 'en'; return 'zh-CN'; }
  static voiceUrl(voiceId,locale='zh-CN'){ if(!voiceId) return null;
    const lang=this.normalizeLocale(locale)==='zh-CN'?'zh':this.normalizeLocale(locale);
    return `assets/audio/voice/${lang}/${voiceId}.ogg`; }
  static t(key,vars={}){ const value=String(key||'').split('.').reduce((obj,part)=>obj?.[part],this.ui);
    const template=typeof value==='string'?value:key;
    return Object.entries(vars).reduce((text,[name,replacement])=>text.replaceAll(`{{${name}}}`,String(replacement??'')),template); }
  static async load(onProgress,requestedLocale='zh-CN'){
    const step=(m)=>onProgress && onProgress(m);
    const locale=this.normalizeLocale(requestedLocale),contentRoot=locale==='zh-CN'?'config':`config/locales/${locale}`;
    step('config');
    const [items,npcs,balance,shop,story,ui] = await Promise.all([
      loadJSON(`${contentRoot}/items.json`), loadJSON(`${contentRoot}/npcs.json`),
      loadJSON(`${contentRoot}/balance.json`), loadJSON(`${contentRoot}/shop.json`), loadJSON(`${contentRoot}/story.json`),
      loadJSON(`${contentRoot}/ui.json`)
    ]);
    this.locale=locale; this.ui=ui; this.items=items; this.npcs=npcs.npcs; this.balance=balance; this.shop=shop;
    this.story=story.chapters; this.prologue=story.prologue||[]; this.profile=story.profile||{prompt:[],confirm:[]};
    this.companion=story.companion||{}; this.epilogue=story.epilogue||[];
    step('chains');
    this.families = items.families;
    this.generators = items.generators;
    this.famList = Object.keys(this.families);
    // 纹理清单
    const tex = {};
    for(const fam of this.famList) for(let t=1;t<=8;t++) tex[`item_${fam}_${t}`]=`assets/img/items/${fam}_${t}.png`;
    for(const fam of this.famList) tex[`token_${fam}`]=`assets/img/token_${fam}.png`;
    for(const n of this.npcs) tex[`npc_${n.id}`]=`assets/img/${n.img}`;
    tex.board='assets/img/board_bg.png'; tex.title='assets/img/title_keyart.png';
    this.story.forEach(c=>{ tex[`story_${c.id}`]=`assets/img/${c.scene}`;
      for(const node of c.nodes) if(node.cg) tex[`cg_${c.id}_${node.id}`]=`assets/img/${node.cg}`; });
    this.textures = tex;
    return this;
  }
  // 扁平化全部主线节点（保持章节/节点顺序），用于主线目标、爽玩备料与遍历
  static flatNodes(){ const out=[]; for(const ch of this.story) for(const node of ch.nodes) out.push({chapter:ch,node}); return out; }
  // 玩家当前主线目标：第一个尚未完成的节点（故事线驱动游戏）
  static currentObjective(done){ const list=this.flatNodes();
    return list.find(x=>!(done||[]).includes(x.node.id))||null; }
  static finaleNode(){ const f=this.flatNodes().filter(x=>x.node.finale); return f[f.length-1]||null; }
  static chapterProgress(ch,done){ const total=ch.nodes.length, got=ch.nodes.filter(n=>(done||[]).includes(n.id)).length; return {got,total}; }
  // 可派单 NPC（剧情-only 角色不下委托）
  static orderNpcs(){ return this.npcs.filter(n=>n.order!==false); }
  // 家族是否已按等级解锁
  static famUnlocked(fam, lv){ const g=this.generators[this.families[fam].generator]; return lv >= g.unlockLv; }
  static unlockedFams(lv){ return this.famList.filter(f=>this.famUnlocked(f,lv)); }
  static itemName(fam,tier){ return this.families[fam].tiers[tier-1]; }
  static sellPrice(tier){ return Math.round(this.items.sellBase*Math.pow(this.items.sellGrowth,tier-1)); }
  static xpNeed(lv){ const sprint=this.balance.xp.sprint||[];
    if(lv>=1&&lv<=sprint.length) return sprint[lv-1];
    return Math.round(this.balance.xp.base*Math.pow(lv,this.balance.xp.pow)); }
  static energyMax(lv){ const e=this.balance.energy; return Math.min(e.maxCap, e.baseMax + Math.floor((lv-1)/e.perLevels)*5); }
  static genById(genId){ return this.generators[genId]; }
  static npcById(id){ return this.npcs.find(n=>n.id===id); }
  static tierAtLevel(table, lv){ let v=table[0][1]; for(const [need,val] of table){ if(lv>=need) v=val; } return v; }
}
