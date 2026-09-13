// 权威游戏状态与规则：棋盘、资源、生成器、合并、订单、等级、商店、剧情、图鉴
import { Config } from './Config.js';
import { RNG } from './RNG.js';
import { bus } from './EventBus.js';
import { actionFail, actionOk } from '../engine/src/action-result.js';

let UID = 1;
const nid = () => (UID++).toString(36) + Date.now().toString(36).slice(-3);
const normalizeNickname=value=>{
  if(typeof value!=='string') return null;
  const nickname=value.normalize('NFKC').replace(/\s+/gu,' ').trim();
  const length=Array.from(nickname).length;
  if(length<1||length>12||/[\u0000-\u001f\u007f-\u009f<>{}\[\]\\]/u.test(nickname)) return null;
  return nickname;
};

export class GameState {
  constructor(){ this.cells = new Array(Config.balance.board.cols*Config.balance.board.rows).fill(null); }

  // ---------- 生命周期 ----------
  newGame(){
    const b = Config.balance;
    this.lv=1; this.xp=0;
    this.coin=80; this.gem=5; this.warmth=0; this.freeTaps=0;
    this.energy=b.energy.start; this.energyTs=Date.now();
    this.boardUnlocked=b.board.initialUnlocked;
    this.cells=new Array(b.board.cols*b.board.rows).fill(null);
    this.ownedGens=['g_crystal','g_fire'];
    this.boughtGens=[]; this.orders=[]; this.orderSlots=b.order.slots;
    this.storyDone=[]; this.chaptersSeen=[]; this.storyChoices={}; this.hb={};
    this.profile={nickname:''};
    this.stats={merge:0,order:0,produce:0,discover:0};
    this.mergeDiscoveries=[]; this._mergeFlow={count:0,lastAt:0}; this.lastMergeFeedback=null;
    this.tutorial={step:0,produced:false,merged:false,orderAccepted:false,ordered:false,unlocked:false,
      shopped:false,storyOpened:false,done:false,skipped:false};
    const language=Config.normalizeLocale(Config.locale||'zh-CN');
    this.settings={bgm:true,sfx:true,voice:true,language,voiceLanguage:language,
      fabSide:'right',fabY:.56,ordersCollapsed:true,questCollapsed:true};
    this.sandbox=false; // 内测爽玩模式：无限金币/钻石/体力
    this.refreshCost=b.order.refreshCost;
    // 初始布置
    this._put(7,  {k:'g',gid:'g_crystal',taps:0,cdUntil:0});
    this._put(10, {k:'g',gid:'g_fire',taps:0,cdUntil:0});
    this._put(13, {k:'i',fam:'crystal',tier:1});
    this._put(14, {k:'i',fam:'crystal',tier:1});
    this._put(16, {k:'i',fam:'fire',tier:1});
    this._put(17, {k:'i',fam:'fire',tier:1});
    // 首屏给出一条玩家亲手完成的火种连锁：四次合并就能抵达首个剧情交付。
    // 这是早期爽点，不直接替玩家完成，也不依赖生成器随机掉落。
    this._put(18, {k:'i',fam:'fire',tier:2});
    this._put(19, {k:'i',fam:'fire',tier:3});
    this._put(20, {k:'i',fam:'fire',tier:4});
    // 固定首单把第一次合并与第一次交付串成可完成闭环，避免随机订单让新手卡住。
    this.orders.push({id:nid(),npcId:'gunnar',needs:[{fam:'crystal',tier:2,n:1}],
      coin:50,xp:12,gem:0,warmth:2,accepted:false});
    for(let i=1;i<this.orderSlots;i++) this.orders.push(this._genOrder(this.orders.map(o=>o.npcId)));
    this._seenAll();
    return this;
  }
  hydrate(d){
    // 存档属于不可信输入：先建立完整默认状态，再逐项迁移、限幅并过滤结构。
    // 单个坏字段不会让启动白屏，也不会把原型或任意键带进运行态。
    this.newGame();
    if(!d || typeof d!=='object' || Array.isArray(d)) return this;
    const int=(value,fallback,min,max)=>Number.isFinite(Number(value))
      ?Math.min(max,Math.max(min,Math.trunc(Number(value)))):fallback;
    const str=(value,max=80)=>typeof value==='string'&&value.length<=max?value:null;
    const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
    const now=Date.now(), total=this.cells.length;

    this.lv=int(d.lv,this.lv,1,200);
    this.xp=int(d.xp,this.xp,0,1_000_000_000);
    this.coin=int(d.coin,this.coin,0,1_000_000_000);
    this.gem=int(d.gem,this.gem,0,1_000_000_000);
    this.warmth=int(d.warmth,this.warmth,0,1_000_000_000);
    this.freeTaps=int(d.freeTaps,this.freeTaps,0,Config.balance.earlyFlow?.freeTapsCap||24);
    this.energy=int(d.energy,this.energy,0,Config.energyMax(this.lv));
    this.energyTs=int(d.energyTs,now,0,now);
    this.boardUnlocked=int(d.boardUnlocked,Config.balance.board.initialUnlocked,Config.balance.board.initialUnlocked,total);

    const validFam=f=>Config.famList.includes(f);
    const validGen=g=>hasOwn(Config.generators,g);
    const validChest=c=>Config.shop.chests.some(x=>x.id===c);
    const cellOf=c=>{
      if(!c || typeof c!=='object' || Array.isArray(c)) return null;
      const uid=str(c.uid,96)||nid();
      if(c.k==='i' && validFam(c.fam)) return {k:'i',fam:c.fam,tier:int(c.tier,1,1,8),
        bubble:!!c.bubble,bubbleAt:int(c.bubbleAt,0,0,now),uid};
      if(c.k==='g' && validGen(c.gid)) return {k:'g',gid:c.gid,taps:int(c.taps,0,0,1000),
        cdUntil:int(c.cdUntil,0,0,now+7*24*60*60*1000),uid};
      if(c.k==='c' && validChest(c.cid)) return {k:'c',cid:c.cid,
        openAt:int(c.openAt,now,0,now+7*24*60*60*1000),uid};
      return null;
    };
    if(Array.isArray(d.cells)) this.cells=Array.from({length:total},(_,i)=>cellOf(d.cells[i]));

    const allGenIds=Object.keys(Config.generators);
    const requestedGens=Array.isArray(d.ownedGens)?d.ownedGens.filter(x=>typeof x==='string'&&allGenIds.includes(x)):[];
    const boardGens=this.cells.filter(c=>c?.k==='g').map(c=>c.gid);
    this.ownedGens=[...new Set(['g_crystal','g_fire',...requestedGens,...boardGens])];
    this.boughtGens=[...new Set((Array.isArray(d.boughtGens)?d.boughtGens:[])
      .filter(x=>typeof x==='string'&&allGenIds.includes(x)))];
    for(const gid of ['g_crystal','g_fire']){
      if(this.cells.some(c=>c?.k==='g'&&c.gid===gid)) continue;
      const to=this.emptyCells(true)[0]; if(to!=null) this._put(to,{k:'g',gid,taps:0,cdUntil:0});
    }

    const allNpcIds=new Set(Config.npcs.map(n=>n.id));
    const orderOf=o=>{
      if(!o||typeof o!=='object'||!allNpcIds.has(o.npcId)||!Array.isArray(o.needs)||o.needs.length<1||o.needs.length>4) return null;
      const needs=o.needs.map(q=>q&&validFam(q.fam)?{fam:q.fam,tier:int(q.tier,1,1,8),n:int(q.n,1,1,8)}:null);
      if(needs.some(q=>!q)) return null;
      return {id:str(o.id,96)||nid(),npcId:o.npcId,needs,
        coin:int(o.coin,10,0,1_000_000),xp:int(o.xp,10,0,1_000_000),
        gem:int(o.gem,0,0,10_000),warmth:int(o.warmth,0,0,1_000_000),
        // v0.1/v0.2 旧存档里已经展示的订单视为已接取，避免升级后突然锁住原进度。
        accepted:hasOwn(o,'accepted')?!!o.accepted:true};
    };
    this.orderSlots=Config.balance.order.slots;
    this.orders=(Array.isArray(d.orders)?d.orders.map(orderOf).filter(Boolean):[]).slice(0,this.orderSlots);
    while(this.orders.length<this.orderSlots) this.orders.push(this._genOrder(this.orders.map(o=>o.npcId)));

    const requestedDone=new Set(Array.isArray(d.storyDone)?d.storyDone.filter(x=>typeof x==='string'):[]);
    this.storyDone=[];
    outer: for(const chapter of Config.story) for(const node of chapter.nodes){
      if(!requestedDone.has(node.id)) break outer;
      this.storyDone.push(node.id);
    }
    // 旧存档升级到新剧情奖励表时，补回已经赢得的材料生成器，避免热更新后出现死路。
    for(const {node} of Config.flatNodes()){
      if(!this.storyDone.includes(node.id)) continue;
      const ids=[node.reward?.generator,...(node.reward?.generators||[])].filter(Boolean);
      ids.forEach(gid=>this._grantGenerator(gid));
    }
    const validChapterIds=new Set(Config.story.map(c=>c.id));
    this.chaptersSeen=Array.isArray(d.chaptersSeen)
      ?[...new Set(d.chaptersSeen.map(Number).filter(x=>validChapterIds.has(x)))]:[];
    const choiceNodes=new Map(Config.flatNodes()
      .filter(({node})=>node.interaction?.type==='choice'&&Array.isArray(node.interaction.options))
      .map(({node})=>[node.id,new Set(node.interaction.options.map(option=>option.id))]));
    this.storyChoices={};
    if(d.storyChoices&&typeof d.storyChoices==='object'&&!Array.isArray(d.storyChoices)){
      for(const [nodeId,options] of choiceNodes){
        const value=str(d.storyChoices[nodeId],48);
        if(value&&options.has(value)) this.storyChoices[nodeId]=value;
      }
    }
    const nickname=normalizeNickname(d.profile?.nickname);
    this.profile={nickname:nickname||''};
    const mapNums=(source,allowed)=>{ const out={}; if(source&&typeof source==='object'&&!Array.isArray(source)){
      for(const key of allowed){ if(hasOwn(source,key)) out[key]=int(source[key],0,0,1_000_000_000); }
    } return out; };
    const hbKeys=Config.famList.flatMap(f=>Array.from({length:8},(_,i)=>`${f}_${i+1}`));
    this.hb=mapNums(d.hb,hbKeys);
    this.stats={...this.stats,...mapNums(d.stats,['merge','order','produce','discover'])};
    const mergeKeys=new Set(Config.famList.flatMap(f=>Array.from({length:8},(_,i)=>`${f}_${i+1}`)));
    this.mergeDiscoveries=[...new Set((Array.isArray(d.mergeDiscoveries)?d.mergeDiscoveries:[])
      .filter(key=>typeof key==='string'&&mergeKeys.has(key)))];
    if(d.tutorial&&typeof d.tutorial==='object'&&!Array.isArray(d.tutorial)){
      for(const key of ['produced','merged','orderAccepted','ordered','unlocked','shopped','storyOpened','done','skipped'])
        this.tutorial[key]=!!d.tutorial[key];
      this.tutorial.step=int(d.tutorial.step,0,0,20);
      if(!hasOwn(d.tutorial,'orderAccepted')) this.tutorial.orderAccepted=this.orders.some(order=>order.accepted);
      if(!hasOwn(d.tutorial,'unlocked')) this.tutorial.unlocked=this.boardUnlocked>Config.balance.board.initialUnlocked;
      if(!hasOwn(d.tutorial,'storyOpened')) this.tutorial.storyOpened=this.storyDone.length>0;
    }
    if(d.settings&&typeof d.settings==='object'&&!Array.isArray(d.settings)){
      this.settings.bgm=d.settings.bgm!==false; this.settings.sfx=d.settings.sfx!==false; this.settings.voice=d.settings.voice!==false;
      // Config.locale is the language actually loaded for this session. Save.locale()
      // selected it before hydration; an explicit ?lang= override must also be reflected
      // by the selector instead of showing stale saved state.
      this.settings.language=Config.normalizeLocale(Config.locale||d.settings.language);
      this.settings.voiceLanguage=Config.supportedLocales.includes(d.settings.voiceLanguage)
        ?d.settings.voiceLanguage:this.settings.language;
      this.settings.fabSide=d.settings.fabSide==='left'?'left':'right';
      const fabY=Number(d.settings.fabY);
      this.settings.fabY=Number.isFinite(fabY)?Math.min(1,Math.max(0,fabY)):.56;
      this.settings.ordersCollapsed=d.settings.ordersCollapsed!==false;
      this.settings.questCollapsed=d.settings.questCollapsed!==false;
    }
    this.sandbox=!!d.sandbox;
    if(this.sandbox) this.energy=Config.energyMax(this.lv);
    this.refreshCost=int(d.refreshCost,Config.balance.order.refreshCost,0,1_000_000);
    return this;
  }
  serialize(){
    return {v:1,lv:this.lv,xp:this.xp,coin:this.coin,gem:this.gem,warmth:this.warmth,
      energy:this.energy,energyTs:this.energyTs,boardUnlocked:this.boardUnlocked,cells:this.cells,
      ownedGens:this.ownedGens,boughtGens:this.boughtGens,orders:this.orders,orderSlots:this.orderSlots,
      storyDone:this.storyDone,chaptersSeen:this.chaptersSeen,storyChoices:this.storyChoices,profile:this.profile,hb:this.hb,stats:this.stats,
      freeTaps:this.freeTaps,mergeDiscoveries:this.mergeDiscoveries,tutorial:this.tutorial,settings:this.settings,
      sandbox:!!this.sandbox,
      refreshCost:this.refreshCost};
  }
  // 爽玩模式：资源判定与扣减
  canPayCoin(n){ return this.sandbox || this.coin>=n; }
  payCoin(n){ if(!this.sandbox) this.coin-=n; }
  canPayGem(n){ return this.sandbox || this.gem>=n; }
  payGem(n){ if(!this.sandbox) this.gem-=n; }
  setSandbox(on){
    this.sandbox=!!on;
    if(this.sandbox) this.energy=Config.energyMax(this.lv);
    this.changed('sandbox',{on:this.sandbox}); this.changed('hud');
  }
  // —— 爽玩控制台：一键操作，制造即时正反馈 ——
  sbUnlockBoard(){ const before=this.boardUnlocked; this.boardUnlocked=this.cells.length;
    this.changed('sbBoard',{from:before,to:this.boardUnlocked}); bus.emit('sfx','unlock'); }
  sbAllGens(){ let added=0;
    for(const e of Config.shop.generators){ if(this.ownedGens.includes(e.id)) continue;
      const to=this.nearestEmpty(7); if(to<0) break;
      this.ownedGens.push(e.id); this.boughtGens.push(e.id);
      this._put(to,{k:'g',gid:e.id,taps:0,cdUntil:0}); added++; }
    this.changed('sbGens',{added}); bus.emit('sfx','unlock'); return added; }
  sbAddLevel(n=5){ for(let i=0;i<n;i++){ this.xp+=Config.xpNeed(this.lv);
      while(this.xp>=Config.xpNeed(this.lv)){ this.xp-=Config.xpNeed(this.lv); this.lv++; } }
    this.energy=Config.energyMax(this.lv);
    this.changed('sbLevel',{lv:this.lv}); bus.emit('sfx','unlock'); return this.lv; }
  sbOpenChests(){ let n=0; for(let i=0;i<this.cells.length;i++){ const c=this.cells[i];
      if(c&&c.k==='c'&&c.openAt>Date.now()){ c.openAt=Date.now(); n++; } }
    this.changed('sbChests',{n}); return n; }
  sbClearItems(){ let n=0; for(let i=0;i<this.cells.length;i++){ const c=this.cells[i];
      if(c&&(c.k==='i'||c.k==='c')){ this.cells[i]=null; n++; } }
    this.changed('sbClear',{n}); bus.emit('sfx','click'); return n; }
  // 给每种已解锁家族在空格上补一批 1~3 级材料，方便立刻合成/交付
  sbFillMaterials(){ let n=0; const fams=Config.unlockedFams(this.lv);
    for(const fam of fams){ for(let t=1;t<=3;t++){ const to=this.nearestEmpty(Math.floor(this.cells.length/2));
        if(to<0) break; this._put(to,{k:'i',fam,tier:t}); this._seen(fam,t); n++; } }
    this.changed('sbFill',{n}); bus.emit('sfx','reward'); return n; }
  // 为尚未完成的下一处剧情建筑精确备料，便于验收六章 24 个完整节点。
  sbPrepareNextStory(){
    const next=Config.story.flatMap(ch=>ch.nodes.map(node=>({chapter:ch,node})))
      .find(x=>!this.storyDone.includes(x.node.id));
    if(!next) return {finished:true};
    this.lv=Math.max(this.lv,next.node.unlockLv||next.chapter.unlockLv);
    this.boardUnlocked=this.cells.length;
    for(let i=0;i<this.cells.length;i++) if(this.cells[i]?.k!=='g') this.cells[i]=null;
    let added=0;
    for(const q of next.node.need) for(let i=0;i<q.n;i++){
      const to=this.nearestEmpty(Math.floor(this.cells.length/2));
      if(to<0) break;
      this._put(to,{k:'i',fam:q.fam,tier:q.tier}); this._seen(q.fam,q.tier); added++;
    }
    this.energy=Config.energyMax(this.lv);
    this.changed('sbStory',{chapter:next.chapter.id,node:next.node.id,added});
    bus.emit('sfx','reward');
    return {...next,added,finished:false};
  }
  _put(idx,o){ o.uid=nid(); this.cells[idx]=o; return o; }
  changed(type,p={}){ bus.emit('changed',{type,...p}); }

  // ---------- 棋盘工具 ----------
  get cols(){ return Config.balance.board.cols; }
  get rows(){ return Config.balance.board.rows; }
  isUnlocked(idx){ return idx < this.boardUnlocked; }
  emptyCells(onlyUnlocked=true){ const a=[]; for(let i=0;i<this.cells.length;i++){ if(!this.cells[i] && (!onlyUnlocked||this.isUnlocked(i))) a.push(i); } return a; }
  nearestEmpty(idx){
    const empt=this.emptyCells(true); if(!empt.length) return -1;
    const c=idx%this.cols, r=Math.floor(idx/this.cols);
    empt.sort((a,b)=>this._dist(a,r,c)-this._dist(b,r,c)); return empt[0];
  }
  _dist(i,r,c){ const rr=Math.floor(i/this.cols), cc=i%this.cols; return Math.abs(rr-r)+Math.abs(cc-c); }
  countItem(fam,tier){ let n=0; for(const c of this.cells){ if(c&&c.k==='i'&&!c.bubble&&c.fam===fam&&c.tier===tier) n++; } return n; }
  _seenAll(){ for(const c of this.cells) if(c&&c.k==='i') this._seen(c.fam,c.tier); }
  _seen(fam,tier){ const k=fam+'_'+tier, first=!this.hb[k]; this.hb[k]=(this.hb[k]||0)+1; return first; }

  // 将“缺什么”翻译为玩家可执行的来源：哪个生成器、完整合成链、基础材料量，
  // 并判断当前棋盘是否已经能通过合法的两两合并做出来。
  materialSource(fam,tier,count=1){
    const family=Config.families[fam], generatorId=family?.generator, generator=generatorId&&Config.genById(generatorId);
    if(!family||!generator) return null;
    tier=Math.max(1,Math.min(8,Math.trunc(Number(tier)||1)));
    count=Math.max(1,Math.min(99,Math.trunc(Number(count)||1)));
    const available=Array.from({length:tier},(_,i)=>this.countItem(fam,i+1));
    for(let i=0;i<tier-1;i++){ available[i+1]+=Math.floor(available[i]/2); }
    let nextPair=[];
    for(let t=1;t<tier&&!nextPair.length;t++) nextPair=this.cells
      .map((cell,idx)=>cell?.k==='i'&&!cell.bubble&&cell.fam===fam&&cell.tier===t?idx:-1)
      .filter(idx=>idx>=0).slice(0,2);
    if(nextPair.length<2) nextPair=[];
    const shop=Config.shop.generators.find(entry=>entry.id===generatorId);
    const generatorIndex=this.cells.findIndex(cell=>cell?.k==='g'&&cell.gid===generatorId);
    return {fam,tier,count,itemName:family.tiers[tier-1],familyName:family.name,
      generatorId,generatorName:generator.name,generatorIndex,
      owned:this.ownedGens.includes(generatorId),unlockLv:shop?.unlockLv??generator.unlockLv,
      price:shop?.price??generator.price??0,locked:this.lv<(shop?.unlockLv??generator.unlockLv),
      path:family.tiers.slice(0,tier),baseNeeded:count*Math.pow(2,tier-1),boardCanCraft:available[tier-1]>=count,nextPair};
  }

  _grantGenerator(gid,anchor=7){
    const def=Config.genById(gid); if(!def) return null;
    if(!this.ownedGens.includes(gid)) this.ownedGens.push(gid);
    let idx=this.cells.findIndex(cell=>cell?.k==='g'&&cell.gid===gid),placed=false;
    if(idx<0){ idx=this.nearestEmpty(anchor); if(idx>=0){ this._put(idx,{k:'g',gid,taps:0,cdUntil:0}); placed=true; } }
    return {gid,idx,placed,name:def.name};
  }
  placeOwnedGenerator(gid){
    if(!this.ownedGens.includes(gid)) return actionFail('generator_not_owned');
    const granted=this._grantGenerator(gid);
    if(!granted||granted.idx<0){ bus.emit('toast',{msg:Config.t('errors.boardFull')}); return actionFail('board_full'); }
    if(granted.placed) this.changed('placeGen',{idx:granted.idx,gid});
    return actionOk(granted);
  }
  _spawnRewardItems(starter,anchor=7){ const spawns=[];
    for(const entry of (Array.isArray(starter)?starter:[])){
      if(!Config.families[entry?.fam]) continue;
      const tier=Math.max(1,Math.min(8,Math.trunc(Number(entry.tier)||1)));
      const count=Math.max(0,Math.min(12,Math.trunc(Number(entry.n)||0)));
      for(let i=0;i<count;i++){ const idx=this.nearestEmpty(anchor); if(idx<0) return spawns;
        const item=this._put(idx,{k:'i',fam:entry.fam,tier}); this._seen(entry.fam,tier); spawns.push({idx,item}); }
    }
    return spawns;
  }

  // ---------- 体力 ----------
  energyTick(){
    const e=Config.balance.energy, now=Date.now(), max=Config.energyMax(this.lv);
    if(this.sandbox){ if(this.energy!==max){this.energy=max;this.changed('energy');} this.energyTs=now; return false; }
    if(this.energy>=max){ this.energyTs=now; return false; }
    const gain=Math.floor((now-this.energyTs)/1000/e.regenSec);
    if(gain>0){ this.energy=Math.min(max,this.energy+gain); this.energyTs+=gain*e.regenSec*1000; this.changed('energy'); return true; }
    return false;
  }
  secToNextEnergy(){ const max=Config.energyMax(this.lv); if(this.energy>=max) return 0;
    return Math.max(0,Config.balance.energy.regenSec-Math.floor((Date.now()-this.energyTs)/1000)); }

  // ---------- 生成器 ----------
  tapGenerator(idx){
    const cell=this.cells[idx]; if(!cell||cell.k!=='g') return;
    const g=Config.genById(cell.gid); const now=Date.now();
    const boosted=!this.sandbox&&this.freeTaps>0;
    if(cell.cdUntil>now&&!boosted){ bus.emit('toast',{msg:Config.t('errors.workbenchResting')}); return; }
    if(!this.sandbox&&!boosted&&this.energy<g.energy){ bus.emit('toast',{msg:Config.t('errors.noEnergy')}); bus.emit('noEnergy'); return; }
    const empt=this.emptyCells(true);
    if(!empt.length){ bus.emit('toast',{msg:Config.t('errors.boardFull')}); this.changed('boardFull'); return; }
    if(boosted) this.freeTaps--;
    else if(!this.sandbox){
      this.energy-=g.energy;
      if(this.energy===Config.energyMax(this.lv)-g.energy) this.energyTs=now;
    }
    if(!boosted) cell.taps=(cell.taps||0)+1; this.stats.produce++;
    const out=RNG.weighted(g.outputs); let tier=out.tier;
    const bubble=RNG.chance(g.bubbleChance);
    const to=this.nearestEmpty(idx);
    const item=this._put(to,{k:'i',fam:g.family,tier,bubble,bubbleAt:bubble?now:0});
    this._seen(g.family,tier);
    if(!this.sandbox&&!boosted&&cell.taps>=g.tapsBeforeCd){ cell.cdUntil=now+g.cdSec*1000; cell.taps=0; }
    this.tutorial.produced=true;
    this.changed('produce',{from:idx,to,item,boosted});
  }
  genCdRemain(cell){ return Math.max(0,Math.ceil(((cell.cdUntil||0)-Date.now())/1000)); }

  popBubble(idx){ const c=this.cells[idx]; if(c&&c.bubble){ c.bubble=false; this.changed('pop',{idx}); } }

  // ---------- 移动 / 合并 ----------
  // 返回 'move' | 'merge' | 'invalid'
  dropOn(from,to){
    if(from===to) return 'invalid';
    const a=this.cells[from], b=this.cells[to];
    if(!a) return 'invalid';
    if(!this.isUnlocked(to)){ bus.emit('toast',{msg:Config.t('errors.frozen')}); return 'invalid'; }
    if(!b){ this.cells[to]=a; this.cells[from]=null; this.changed('move',{from,to}); return 'move'; }
    if(a.k==='i'&&b.k==='i'&&!a.bubble&&!b.bubble&&a.fam===b.fam&&a.tier===b.tier&&a.tier<8){
      const merged={k:'i',fam:a.fam,tier:a.tier+1};
      this.cells[from]=null; this.cells[to]=merged; merged.uid=nid();
      this._seen(merged.fam,merged.tier); this.stats.merge++;
      const flow=Config.balance.earlyFlow||{}, objective=this.currentObjective();
      const early=(objective?.chapter.id||999)<=(flow.maxChapter||3), now=Date.now();
      if(!early) this._mergeFlow={count:0,lastAt:0};
      else if(now-this._mergeFlow.lastAt<=(flow.comboWindowMs||6000)) this._mergeFlow.count++;
      else this._mergeFlow.count=1;
      if(early) this._mergeFlow.lastAt=now;
      const key=`${merged.fam}_${merged.tier}`, discovered=!this.mergeDiscoveries.includes(key);
      let coin=0,xp=0,energy=0,warmth=0;
      if(discovered){ this.mergeDiscoveries.push(key); this.stats.discover++;
        coin=merged.tier*(flow.discoveryCoinPerTier??2); xp=merged.tier*(flow.discoveryXpPerTier??2); this.coin+=coin; }
      const combo=early?this._mergeFlow.count:0;
      if(combo===3){ energy=flow.comboEnergyAt3??2; this.energy=Math.min(Config.energyMax(this.lv),this.energy+energy); }
      if(combo===5){ const bonusCoin=flow.comboCoinAt5??10; coin+=bonusCoin; warmth=flow.comboWarmthAt5??1; this.coin+=bonusCoin; this.warmth+=warmth; }
      const levelUps=xp?this.addXp(xp,false):[];
      this.lastMergeFeedback={combo,discovered,itemName:Config.itemName(merged.fam,merged.tier),coin,xp,energy,warmth,levelUps};
      if(combo>=5) this._mergeFlow={count:0,lastAt:now};
      this.tutorial.merged=true;
      this.changed('merge',{from,to,item:merged,feedback:this.lastMergeFeedback,levelUps}); return 'merge';
    }
    // 同类生成器换位 / 无效
    if(a.k===b.k){ this.cells[to]=a; this.cells[from]=b; this.changed('swap',{from,to}); return 'move'; }
    bus.emit('toast',{msg:Config.t('errors.sameItems')}); return 'invalid';
  }
  sellAt(idx){ const c=this.cells[idx]; if(!c||c.k!=='i') return 0;
    const price=Config.sellPrice(c.tier); this.coin+=price; this.cells[idx]=null;
    this.changed('sell',{idx,price}); return price; }

  // ---------- 解锁冰封格 ----------
  unlockInfo(){
    const b=Config.balance.board, extra=this.boardUnlocked-b.initialUnlocked;
    if(this.boardUnlocked>=this.cells.length) return null;
    const k=extra+1, cost=Math.round(b.unlockBaseCost*Math.pow(b.unlockCostGrowth,extra));
    const needLv=1+Math.floor((k-1)/b.unlockLevelStep); return {cost,needLv};
  }
  unlockNext(){
    const info=this.unlockInfo(); if(!info) return actionFail('fully_unlocked');
    if(this.lv<info.needLv){ bus.emit('toast',{msg:Config.t('errors.needLevel',{level:info.needLv})}); return actionFail('level_locked'); }
    if(!this.canPayCoin(info.cost)){ bus.emit('toast',{msg:Config.t('errors.noCoins')}); return actionFail('insufficient_coin'); }
    this.payCoin(info.cost); this.boardUnlocked++; this.tutorial.unlocked=true;
    const idx=this.boardUnlocked-1;
    this.changed('unlock',{idx});
    bus.emit('sfx','unlock');
    return actionOk({idx,cost:info.cost});
  }

  // ---------- 订单 ----------
  _genOrder(avoid=[]){
    const o=Config.balance.order, lv=this.lv;
    const fams=Config.unlockedFams(lv);
    const pool=Config.orderNpcs();
    const npcPool=pool.filter(n=>!avoid.includes(n.id));
    const npc=RNG.pick(npcPool.length?npcPool:pool);
    const cnt=Config.tierAtLevel(o.countByLv,lv);
    const maxT=Config.tierAtLevel(o.maxTierByLv,lv);
    const needs=[];
    for(let i=0;i<cnt;i++){
      const fam=RNG.pick(fams);
      // 低级概率更高
      let tier=1+Math.floor(Math.pow(RNG.next(),1.6)*maxT); tier=Math.max(1,Math.min(maxT,tier));
      const n=(tier<=2&&RNG.chance(.3))?2:1;
      needs.push({fam,tier,n});
    }
    let coin=10,xp=o.xpBase,warmth=0;
    for(const q of needs){ coin+=Config.sellPrice(q.tier)*q.n; warmth+=q.tier*q.n; xp+=q.tier*q.n*o.xpPerTier; }
    coin=Math.round(coin*o.coinMul);
    const gem=(RNG.chance(o.gemChance)&&maxT>=3)?RNG.int(1,2):0;
    return {id:nid(),npcId:npc.id,needs,coin,xp,gem,warmth,accepted:false};
  }
  orderHave(ord){ return ord.needs.map(q=>Math.min(q.n,this.countItem(q.fam,q.tier))); }
  orderReady(ord){ return !!ord?.accepted&&ord.needs.every((q,i)=>this.orderHave(ord)[i]>=q.n); }
  acceptOrder(slot){
    const ord=this.orders[slot];
    if(!ord) return actionFail('invalid_order');
    if(ord.accepted) return actionFail('order_already_accepted');
    ord.accepted=true; this.tutorial.orderAccepted=true;
    this.changed('orderAccepted',{slot,npcId:ord.npcId}); bus.emit('sfx','chime');
    return actionOk({slot,npcId:ord.npcId});
  }
  submitOrder(slot){
    const ord=this.orders[slot];
    if(!ord) return actionFail('invalid_order');
    if(!ord.accepted) return actionFail('order_not_accepted');
    if(!this.orderReady(ord)){ bus.emit('toast',{msg:Config.t('errors.requirements')}); return actionFail('requirements_not_met'); }
    // 扣材料
    for(const q of ord.needs){ let left=q.n;
      for(let i=0;i<this.cells.length&&left>0;i++){ const c=this.cells[i];
        if(c&&c.k==='i'&&!c.bubble&&c.fam===q.fam&&c.tier===q.tier){ this.cells[i]=null; left--; } } }
    this.coin+=ord.coin; this.gem+=ord.gem; this.warmth+=ord.warmth; this.stats.order++;
    this.tutorial.ordered=true;
    const reward={coin:ord.coin,gem:ord.gem,xp:ord.xp,warmth:ord.warmth};
    const avoid=this.orders.filter((_,i)=>i!==slot).map(o=>o.npcId);
    this.orders[slot]=this._genOrder(avoid);
    this.addXp(ord.xp);
    this.changed('orderSubmit',{slot,reward});
    bus.emit('sfx','reward');
    return actionOk({slot,reward});
  }
  refreshOrder(slot){
    if(!this.orders[slot]) return actionFail('invalid_order');
    if(this.orders[slot].accepted) return actionFail('order_already_accepted');
    const cost=this.refreshCost;
    if(!this.canPayCoin(cost)){ bus.emit('toast',{msg:Config.t('errors.noCoins')}); return actionFail('insufficient_coin'); }
    this.payCoin(cost);
    this.orders[slot]=this._genOrder(this.orders.filter((_,i)=>i!==slot).map(o=>o.npcId));
    this.refreshCost=Math.round(this.refreshCost*Config.balance.order.refreshGrowth);
    this.changed('orderRefresh'); bus.emit('sfx','click');
    return actionOk({slot,cost});
  }

  // ---------- 经验 / 等级 ----------
  addXp(n,announce=true){
    n=Math.max(0,Math.min(1_000_000,Math.trunc(Number(n)||0)));
    this.xp+=n; const ups=[];
    while(this.xp>=Config.xpNeed(this.lv)){ this.xp-=Config.xpNeed(this.lv); this.lv++;
      const r=Config.balance.levelRewards;
      const reward={coin:r.coinBase*this.lv, gem:(this.lv%r.gemEvery===0)?r.gemAmount:0};
      this.coin+=reward.coin; this.gem+=reward.gem; this.energy=Config.energyMax(this.lv); this.energyTs=Date.now();
      ups.push({lv:this.lv,reward,text:this._unlockText(this.lv)});
    }
    if(ups.length&&announce){ this.changed('levelup',{ups}); bus.emit('sfx','unlock'); }
    return ups;
  }
  _unlockText(lv){ const u=Config.balance.unlocks.find(x=>x.lv===lv); return u?u.text:''; }

  // ---------- 商店 ----------
  buyChest(cid){
    const c=Config.shop.chests.find(x=>x.id===cid); if(!c) return actionFail('unknown_product');
    if(this.lv<c.unlockLv){ bus.emit('toast',{msg:Config.t('source.lockedUntil',{level:c.unlockLv})}); return actionFail('level_locked'); }
    if(!this.canPayCoin(c.price)){ bus.emit('toast',{msg:Config.t('errors.noCoins')}); return actionFail('insufficient_coin'); }
    const to=this.nearestEmpty(Math.floor(this.cells.length/2)); if(to<0){ bus.emit('toast',{msg:Config.t('errors.boardFull')}); return actionFail('board_full'); }
    this.payCoin(c.price);
    this._put(to,{k:'c',cid,openAt:this.sandbox?Date.now():Date.now()+c.openSec*1000});
    this.changed('buyChest',{idx:to}); bus.emit('sfx','click');
    return actionOk({idx:to,cid,price:c.price});
  }
  chestInfo(cell){ return Config.shop.chests.find(x=>x.id===cell.cid); }
  chestRemain(cell){ return Math.max(0,Math.ceil((cell.openAt-Date.now())/1000)); }
  skipChest(idx,free=false){
    const c=this.cells[idx]; if(!c||c.k!=='c') return actionFail('invalid_chest');
    const def=this.chestInfo(c); if(!def) return actionFail('unknown_product');
    if(!free){ if(!this.canPayGem(def.skipGem)){ bus.emit('toast',{msg:Config.t('errors.noGems')}); return actionFail('insufficient_gem'); } this.payGem(def.skipGem); }
    return this._openChest(idx,def);
  }
  _openChest(idx,def){
    const d=def.drop; const fams=Config.unlockedFams(this.lv); const spawns=[];
    this.cells[idx]=null;
    for(let i=0;i<d.count;i++){ const to=this.nearestEmpty(idx); if(to<0) break;
      const tier=RNG.int(d.tierMin,d.tierMax); const fam=RNG.pick(fams);
      const it=this._put(to,{k:'i',fam,tier}); this._seen(fam,tier); spawns.push({idx:to,it}); }
    if(d.guaranteed){ const to=this.nearestEmpty(idx); if(to>=0){ const fam=RNG.pick(fams);
      const it=this._put(to,{k:'i',fam,tier:d.tierMax}); this._seen(fam,d.tierMax); spawns.push({idx:to,it}); } }
    const coin=RNG.int(d.coin[0],d.coin[1]); this.coin+=coin;
    this.changed('openChest',{spawns,coin}); bus.emit('sfx','reward');
    return actionOk({idx,spawns,coin});
  }
  buyGenerator(gid){
    const entry=Config.shop.generators.find(x=>x.id===gid); if(!entry) return actionFail('unknown_product');
    if(this.lv<entry.unlockLv){ bus.emit('toast',{msg:Config.t('source.lockedUntil',{level:entry.unlockLv})}); return actionFail('level_locked'); }
    if(this.boughtGens.includes(gid)||this.ownedGens.includes(gid)){ bus.emit('toast',{msg:Config.t('errors.alreadyOwned')}); return actionFail('already_owned'); }
    if(!this.canPayCoin(entry.price)){ bus.emit('toast',{msg:Config.t('errors.noCoins')}); return actionFail('insufficient_coin'); }
    const to=this.nearestEmpty(7); if(to<0){ bus.emit('toast',{msg:Config.t('errors.boardFull')}); return actionFail('board_full'); }
    this.payCoin(entry.price); this.ownedGens.push(gid); this.boughtGens.push(gid);
    this._put(to,{k:'g',gid,taps:0,cdUntil:0});
    this.changed('buyGen',{idx:to}); bus.emit('sfx','unlock');
    return actionOk({idx:to,gid,price:entry.price});
  }
  buyEnergyPotion(){ const p=Config.shop.energyPotion;
    if(!this.canPayGem(p.gem)){ bus.emit('toast',{msg:Config.t('errors.noGems')}); return actionFail('insufficient_gem'); }
    this.payGem(p.gem); this.energy=Config.energyMax(this.lv); this.energyTs=Date.now();
    this.changed('energy'); bus.emit('sfx','reward'); bus.emit('toast',{msg:Config.t('errors.energyFull')});
    return actionOk({energy:this.energy,cost:p.gem});
  }

  // ---------- 剧情 ----------
  nodeState(node,chapter){
    if(this.storyDone.includes(node.id)) return 'done';
    const my=chapter.nodes.indexOf(node);
    if(my>0 && !this.storyDone.includes(chapter.nodes[my-1].id)) return 'locked';
    if(chapter.id>1){ const prev=Config.story[chapter.id-2]; if(!prev.nodes.every(n=>this.storyDone.includes(n.id))) return 'locked'; }
    if(this.lv<(node.unlockLv||chapter.unlockLv)) return 'lvlock';
    const hasCoin=this.canPayCoin(node.coin);
    const hasItems=node.need.every(q=>this.countItem(q.fam,q.tier)>=q.n);
    return (hasCoin&&hasItems)?'ready':'lack';
  }
  buildNode(chapter,node){
    const st=this.nodeState(node,chapter); if(st!=='ready'){ bus.emit('toast',{msg:st==='lack'?Config.t('errors.notReady'):Config.t('errors.notOpen')}); return false; }
    this.payCoin(node.coin);
    for(const q of node.need){ let left=q.n; for(let i=0;i<this.cells.length&&left>0;i++){ const c=this.cells[i];
      if(c&&c.k==='i'&&c.fam===q.fam&&c.tier===q.tier){ this.cells[i]=null; left--; } } }
    this.storyDone.push(node.id);
    const rw=node.reward||{}; this.coin+=rw.coin||0; this.gem+=rw.gem||0;
    if(rw.energy){ this.energy=Math.min(Config.energyMax(this.lv),this.energy+rw.energy); this.energyTs=Date.now(); }
    if(rw.freeTaps){ const cap=Config.balance.earlyFlow?.freeTapsCap||24;
      this.freeTaps=Math.min(cap,this.freeTaps+rw.freeTaps); }
    const levelUps=rw.xp?this.addXp(rw.xp,false):[];
    const generatorIds=[rw.generator,...(rw.generators||[])].filter(Boolean);
    const granted=generatorIds.map(gid=>this._grantGenerator(gid)).filter(Boolean);
    const starterSpawns=this._spawnRewardItems(rw.starter,7);
    this.changed('storyBuilt',{chapter,node,reward:rw,levelUps,granted,starterSpawns}); bus.emit('sfx','unlock');
    return true;
  }

  // ---------- 剧情推进（故事线 <-> 游戏 双向驱动） ----------
  get playerName(){ return this.profile?.nickname||Config.t('profile.fallback'); }
  setNickname(value){
    const nickname=normalizeNickname(value);
    if(!nickname) return actionFail('invalid_nickname');
    this.profile={nickname};
    this.changed('profile',{nickname});
    return actionOk({nickname});
  }
  setVoiceLanguage(locale){
    if(!Config.supportedLocales.includes(locale)) return actionFail('unsupported_locale');
    this.settings.voiceLanguage=locale; this.changed('voiceLanguage',{locale}); return actionOk({locale});
  }
  // 当前主线目标（第一个未完成节点）
  currentObjective(){ return Config.currentObjective(this.storyDone); }
  // 章节是否已对玩家开放：第 1 章常开；其余需上一章全部完成
  chapterReachable(ch){
    if(ch.id<=1) return true;
    const prev=Config.story[ch.id-2]; return !!prev && prev.nodes.every(n=>this.storyDone.includes(n.id));
  }
  markChapterSeen(id){ if(!this.chaptersSeen.includes(id)){ this.chaptersSeen.push(id); this.changed('chapterSeen',{id}); } }
  // 装修选择只接受配置表中声明过的节点/选项；动态内容更新不能向存档注入任意键。
  setStoryChoice(nodeId,choiceId){
    const entry=Config.flatNodes().find(({node})=>node.id===nodeId);
    if(!entry||entry.node.interaction?.type!=='choice') return actionFail('invalid_choice_node');
    const option=(entry.node.interaction.options||[]).find(item=>item.id===choiceId);
    if(!option) return actionFail('invalid_choice');
    this.storyChoices[nodeId]=choiceId;
    this.changed('storyChoice',{nodeId,choiceId});
    return actionOk({nodeId,choiceId});
  }
  storyChoice(nodeOrId){
    const node=typeof nodeOrId==='string'
      ?Config.flatNodes().find(entry=>entry.node.id===nodeOrId)?.node:nodeOrId;
    if(!node||node.interaction?.type!=='choice') return null;
    const id=this.storyChoices[node.id];
    return (node.interaction.options||[]).find(option=>option.id===id)||null;
  }
  // 下一个尚未播放过场、且已开放的章节（用于自动弹出章节开场）
  nextUnseenChapter(){ return Config.story.find(ch=>!this.chaptersSeen.includes(ch.id)&&this.chapterReachable(ch))||null; }
  // 角色羁绊：该 NPC 在已完成节点的 pre/dialogue 中登场次数（手账用，纯派生不存档）
  bondByNpc(){ const m={};
    const add=(who,n)=>{ if(who==='narrator'||who==='all') return; m[who]=(m[who]||0)+n; };
    for(const ch of Config.story) for(const node of ch.nodes){ if(!this.storyDone.includes(node.id)) continue;
      (node.pre||[]).forEach(l=>add(l[0],1)); (node.dialogue||[]).forEach(l=>add(l[0],1)); }
    return m;
  }
  // 某节点是否已完成（手账/回放用）
  isNodeDone(id){ return this.storyDone.includes(id); }
}
