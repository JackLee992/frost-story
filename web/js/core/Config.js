// 配置加载：集中读取 config/*.json（对标竞品 Config 表），并生成纹理清单
async function loadJSON(f){ const r=await fetch(f); if(!r.ok) throw new Error('config missing '+f); return r.json(); }

export class Config {
  static async load(onProgress){
    const step=(m)=>onProgress && onProgress(m);
    step('读取数值表…');
    const [items,npcs,balance,shop,story] = await Promise.all([
      loadJSON('config/items.json'), loadJSON('config/npcs.json'),
      loadJSON('config/balance.json'), loadJSON('config/shop.json'), loadJSON('config/story.json')
    ]);
    this.items=items; this.npcs=npcs.npcs; this.balance=balance; this.shop=shop; this.story=story.chapters;
    step('整理合成链…');
    this.families = items.families;
    this.generators = items.generators;
    this.famList = Object.keys(this.families);
    // 纹理清单
    const tex = {};
    for(const fam of this.famList) for(let t=1;t<=8;t++) tex[`item_${fam}_${t}`]=`assets/img/items/${fam}_${t}.png`;
    for(const fam of this.famList) tex[`token_${fam}`]=`assets/img/token_${fam}.png`;
    for(const n of this.npcs) tex[`npc_${n.id}`]=`assets/img/${n.img}`;
    tex.board='assets/img/board_bg.png'; tex.title='assets/img/title_keyart.png';
    this.story.forEach((c,i)=> tex[`story_${c.id}`]=`assets/img/${c.scene}`);
    this.textures = tex;
    return this;
  }
  // 家族是否已按等级解锁
  static famUnlocked(fam, lv){ const g=this.generators[this.families[fam].generator]; return lv >= g.unlockLv; }
  static unlockedFams(lv){ return this.famList.filter(f=>this.famUnlocked(f,lv)); }
  static itemName(fam,tier){ return this.families[fam].tiers[tier-1]; }
  static sellPrice(tier){ return Math.round(this.items.sellBase*Math.pow(this.items.sellGrowth,tier-1)); }
  static xpNeed(lv){ return Math.round(this.balance.xp.base*Math.pow(lv,this.balance.xp.pow)); }
  static energyMax(lv){ const e=this.balance.energy; return Math.min(e.maxCap, e.baseMax + Math.floor((lv-1)/e.perLevels)*5); }
  static genById(genId){ return this.generators[genId]; }
  static npcById(id){ return this.npcs.find(n=>n.id===id); }
  static tierAtLevel(table, lv){ let v=table[0][1]; for(const [need,val] of table){ if(lv>=need) v=val; } return v; }
}
