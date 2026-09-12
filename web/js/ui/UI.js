// HTML 叠加层 UI：HUD、订单、弹窗、剧情对话、提示
import { Config } from '../core/Config.js';
import { bus } from '../core/EventBus.js';
import { AudioMgr } from '../core/Audio.js';
import { Haptics } from '../core/Haptics.js';
import { Save } from '../core/Save.js';
import { refreshScrollable, runActionOnce } from '../engine/src/stable-view.js';

const $=s=>document.querySelector(s);
const itemImg=(f,t)=>`assets/img/items/${f}_${t}.png`;
const npcImg=n=>`assets/img/${n.img}`;
const fmt=s=>{const m=Math.floor(s/60),x=s%60;return `${m}:${String(x).padStart(2,'0')}`;};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));

export class UI {
  constructor(state, scene){ this.s=state; this.scene=scene; this.el={}; this._cacheDom(); this._bind(); this._listen(); }
  _cacheDom(){
    ['levelBadge','xpBar','energyVal','energyTimer','coinVal','gemVal','warmthVal','taskShelf','ordersToggle','questToggle','orders','hint','guideLayer','modalLayer','toastLayer','itemPop','ipName','ipSub','ipPrice','ipSell','energyPlus','sbFab','quest','companion'].forEach(id=>this.el[id]=$('#'+id));
  }
  _bind(){
    document.querySelectorAll('.dock-btn').forEach(b=>b.onclick=()=>{ AudioMgr.play('click'); this.openPanel(b.dataset.panel); });
    this.el.ipSell.onclick=()=>{ if(this._selIdx!=null){ this.s.sellAt(this._selIdx); AudioMgr.play('reward'); } this.hidePop(); };
    this.el.energyPlus.onclick=()=>this.openPanel('shop');
    this._bindSandboxFab();
    this._sandboxFab(this.s.sandbox);
    document.addEventListener('pointerdown',e=>{
      if(!e.target.closest('#itemPop')&&!e.target.closest('#board')&&!e.target.closest('canvas')) this.hidePop();
    },true);
    setInterval(()=>this._tick(),1000);
  }

  _fabBounds(){
    const f=this.el.sbFab, app=$('#app').getBoundingClientRect();
    const safe=window.__frostSafeInsets||{top:0,right:0,bottom:0,left:0};
    const shelf=this.el.taskShelf.getBoundingClientRect(), dock=$('#dock').getBoundingClientRect();
    const width=f.offsetWidth||50, height=f.offsetHeight||66, edge=4;
    const minX=app.left+safe.left+edge;
    const maxX=Math.max(minX,app.right-safe.right-edge-width);
    const minY=Math.max(app.top+safe.top+56,shelf.bottom+8);
    const maxY=Math.max(minY,dock.top-height-8);
    return {minX,maxX,minY,maxY,width,height};
  }
  _layoutSandboxFab(){
    const f=this.el.sbFab; if(!f||f.classList.contains('hidden')) return;
    const b=this._fabBounds(), side=this.s.settings.fabSide==='left'?'left':'right';
    const ratio=Math.min(1,Math.max(0,Number(this.s.settings.fabY)||0));
    f.dataset.side=side;
    f.style.left=(side==='left'?b.minX:b.maxX)+'px';
    f.style.top=(b.minY+(b.maxY-b.minY)*ratio)+'px';
  }
  _bindSandboxFab(){
    const f=this.el.sbFab; if(!f) return;
    let drag=null, ignoreClick=false, ignoreTimer=0;
    f.onclick=e=>{
      if(ignoreClick){ e.preventDefault(); ignoreClick=false; return; }
      this._sandboxPanel();
    };
    f.onpointerdown=e=>{
      if(e.button!==undefined&&e.button!==0) return;
      const r=f.getBoundingClientRect();
      drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,left:r.left,top:r.top,moved:false};
      f.setPointerCapture?.(e.pointerId); f.classList.add('dragging'); e.preventDefault();
    };
    f.onpointermove=e=>{
      if(!drag||e.pointerId!==drag.id) return;
      const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
      if(Math.hypot(dx,dy)>6) drag.moved=true;
      if(!drag.moved) return;
      const b=this._fabBounds();
      const left=Math.min(b.maxX,Math.max(b.minX,drag.left+dx));
      const top=Math.min(b.maxY,Math.max(b.minY,drag.top+dy));
      f.style.left=left+'px'; f.style.top=top+'px';
      // 部分 Android 手势会以 cancel 收尾；移动时同步状态，仍能可靠保留最终位置。
      this.s.settings.fabSide=left+b.width/2<(b.minX+b.maxX+b.width)/2?'left':'right';
      this.s.settings.fabY=b.maxY===b.minY?0:Math.min(1,Math.max(0,(top-b.minY)/(b.maxY-b.minY)));
      Save.save(this.s,120);
      e.preventDefault();
    };
    const finish=e=>{
      if(!drag||e.pointerId!==drag.id) return;
      const moved=drag.moved; drag=null; f.classList.remove('dragging');
      try{ f.releasePointerCapture?.(e.pointerId); }catch{}
      if(!moved) return;
      const b=this._fabBounds(), r=f.getBoundingClientRect();
      this.s.settings.fabSide=r.left+r.width/2<(b.minX+b.maxX+b.width)/2?'left':'right';
      this.s.settings.fabY=b.maxY===b.minY?0:Math.min(1,Math.max(0,(r.top-b.minY)/(b.maxY-b.minY)));
      this._layoutSandboxFab(); Save.saveNow(this.s);
      ignoreClick=true; clearTimeout(ignoreTimer); ignoreTimer=setTimeout(()=>{ignoreClick=false;},400);
    };
    f.onpointerup=finish; f.onpointercancel=finish;
    window.addEventListener('resize',()=>{this._layoutSandboxFab();this._tutorial();});
  }
  _listen(){
    bus.on('changed',p=>{ this.renderHUD(); this.renderOrders(); this.renderQuest(); this._tutorial(); Save.save(this.s);
      if(p?.type==='levelup'){ this._levelUp(p.ups); this.scene.celebrate?.(); Haptics.level(); }
      if(p?.type==='orderSubmit'){ Haptics.reward(); this._coinPulse(); }
      if(p?.type==='storyBuilt'){ this.scene.celebrate?.(); Haptics.unlock();
        this._storyBeat(p.chapter,p.node,()=>this._storyDialog(p.chapter,p.node)); }
      if(p?.type==='sandbox'){ this._sandboxFab(p.on); if(p.on) this.scene.celebrate?.(); } });
    bus.on('toast',p=>this.toast(p.msg));
    bus.on('sfx',n=>AudioMgr.play(n));
    bus.on('selectItem',p=>this.showPop(p));
    bus.on('selectNone',()=>this.hidePop());
    bus.on('chestTap',p=>this._chestDialog(p.idx));
    bus.on('lockedTap',p=>this._unlockDialog(p.info));
    bus.on('noEnergy',()=>this._noEnergy());
  }
  _coinPulse(){ const el=document.querySelector('.res.coin'); if(!el) return;
    el.animate([{transform:'scale(1)'},{transform:'scale(1.22)'},{transform:'scale(1)'}],{duration:380,easing:'cubic-bezier(.2,1.4,.4,1)'}); }
  // ---------- HUD ----------
  renderHUD(){
    const s=this.s, need=Config.xpNeed(s.lv), sb=s.sandbox;
    $('.lv-num').textContent=s.lv;
    this.el.xpBar.style.width=Math.min(100,s.xp/need*100)+'%';
    this.el.energyVal.textContent=sb?'∞':s.energy;
    this.el.coinVal.textContent=sb?'∞':s.coin; this.el.gemVal.textContent=sb?'∞':s.gem; this.el.warmthVal.textContent=s.warmth;
    document.body.classList.toggle('sandbox-on',sb);
  }
  _tick(){ if(this.s.energyTick()) this.renderHUD();
    if(this.s.sandbox){ this.el.energyTimer.textContent='∞'; return; }
    const t=this.s.secToNextEnergy(); this.el.energyTimer.textContent=(this.s.energy>=Config.energyMax(this.s.lv))?'满':fmt(t);
  }
  // ---------- 订单 ----------
  _syncTaskShelf(){
    const expanded=!this.s.settings.ordersCollapsed||!this.s.settings.questCollapsed;
    this.el.taskShelf?.classList.toggle('has-expanded',expanded);
    requestAnimationFrame(()=>this._layoutSandboxFab());
  }
  _toggleTask(kind){
    const key=kind==='orders'?'ordersCollapsed':'questCollapsed';
    const other=kind==='orders'?'questCollapsed':'ordersCollapsed';
    const opening=!!this.s.settings[key];
    this.s.settings[key]=!opening;
    if(opening) this.s.settings[other]=true;
    Save.saveNow(this.s); this.renderOrders(); this.renderQuest(); this._tutorial();
  }
  renderOrders(){
    const box=this.el.orders,collapsed=!!this.s.settings.ordersCollapsed;
    box.classList.toggle('collapsed',collapsed);
    const pending=this.s.orders.filter(order=>!order.accepted).length;
    const ready=this.s.orders.filter(order=>this.s.orderReady(order)).length;
    const active=this.s.orders.length-pending;
    const badge=pending?`${pending} 个请求`:ready?`${ready} 可交付`:active?`${active} 进行中`:'暂无';
    this.el.ordersToggle.innerHTML=`<span><i>✉️</i><b>村民请求</b></span><em>${badge}</em><i class="task-chevron">⌄</i>`;
    this.el.ordersToggle.setAttribute('aria-expanded',String(!collapsed));
    this.el.ordersToggle.onclick=()=>this._toggleTask('orders');
    box.innerHTML='<div class="order-list"></div>';
    const list=box.querySelector('.order-list');
    this.s.orders.forEach((o,slot)=>{
      const npc=Config.npcById(o.npcId), have=this.s.orderHave(o), ready=this.s.orderReady(o);
      const card=document.createElement('article'); card.className='order-card'+(ready?' ready':'')+(o.accepted?' accepted':' pending');
      card.innerHTML=`<div class="oc-top">
          <img class="oc-avatar" src="${npcImg(npc)}" alt="${esc(npc.name)}"/>
          <div class="oc-who"><b>${esc(npc.name)}</b><br><span>${o.accepted?'正在等你的消息':esc(npc.title)+'来访'}</span></div>
        </div>
        ${o.accepted?'':`<p class="oc-teaser">“${esc(npc.request)}”</p>`}
        <div class="oc-need">${o.needs.map((q,i)=>`<div class="need-chip ${have[i]>=q.n?'ok':'lack'}"><img src="${itemImg(q.fam,q.tier)}"><span class="have">${have[i]}/${q.n}</span></div>`).join('')}</div>
        ${o.accepted
          ?`<button class="oc-submit ${ready?'on':''}">${ready?'交给 '+esc(npc.name):'继续准备'} · ${o.coin}金${o.gem?` · ${o.gem}钻`:''}</button>`
          :`<div class="oc-actions"><button class="oc-request" type="button">听听请求</button><button class="oc-refresh" type="button" aria-label="换一个请求">换一封 · ${this.s.refreshCost}金</button></div>`}`;
      const submit=card.querySelector('.oc-submit');
      if(submit) submit.onclick=()=>{ if(!ready){this.toast(`${npc.name}还在等材料`);return;}
        runActionOnce(submit,()=>this.s.submitOrder(slot),()=>{
          this.s.settings.ordersCollapsed=true; Save.saveNow(this.s); this.renderOrders(); this.renderQuest();
          this._orderThanks(npc);
        }); };
      const request=card.querySelector('.oc-request'); if(request) request.onclick=()=>this._orderRequest(slot);
      const rf=card.querySelector('.oc-refresh'); if(rf) rf.onclick=()=>runActionOnce(rf,()=>this.s.refreshOrder(slot));
      list.appendChild(card);
    });
    this._syncTaskShelf();
  }
  _orderRequest(slot){
    const order=this.s.orders[slot]; if(!order||order.accepted) return;
    const npc=Config.npcById(order.npcId), have=this.s.orderHave(order);
    const needs=order.needs.map((q,i)=>`<span class="need-chip ${have[i]>=q.n?'ok':'lack'}"><img src="${itemImg(q.fam,q.tier)}"><b>${Config.itemName(q.fam,q.tier)}</b><span class="have">${have[i]}/${q.n}</span></span>`).join('');
    const m=this.modal(`<div class="order-request">
      <div class="order-request-scene" style="background-image:url(assets/img/story_1.png)">
        <div class="order-request-frost"></div><img src="${npcImg(npc)}" alt="${esc(npc.name)}">
        <div><small>${esc(npc.title)} · 来到风灯小屋</small><h3>${esc(npc.name)}</h3></div>
      </div>
      <div class="order-request-body"><p class="order-arrival">${esc(npc.arrival)}</p>
        <blockquote>“${esc(npc.request)}”</blockquote>
        <div class="order-request-needs"><b>他需要</b><div>${needs}</div></div>
        <div class="cd-btns"><button class="cd-no" data-later type="button">先记在请求箱</button><button class="cd-ok" data-accept-order type="button">我来帮你</button></div>
      </div></div>`,true);
    AudioMgr.playVoice(npc.voiceRequest);
    m.querySelector('[data-later]').onclick=()=>this.closeModal();
    const accept=m.querySelector('[data-accept-order]');
    accept.onclick=()=>runActionOnce(accept,()=>this.s.acceptOrder(slot),()=>{
      this.s.settings.ordersCollapsed=false; this.s.settings.questCollapsed=true; Save.saveNow(this.s);
      this.closeModal(); this.renderOrders(); this.renderQuest();
      this._chocoSay(`${npc.name}把这件事托给我们了。先看看棋盘上已经有的材料。`,2300,true);
      requestAnimationFrame(()=>this._tutorial());
    });
  }
  _orderThanks(npc){
    this._playDialogue({
      ch:{title:`${npc.name}的回应`,subtitle:'篝火广场 · 风雪中的回音',scene:'story_1.png',hook:'每一份委托，都是一个人留下来的理由。'},
      lines:[[npc.id,npc.thanks,{voice:npc.voiceThanks}],['choco','你看，我们交出去的不只是材料。村子里又多了一件会被人记住的事。']],
      kind:'request',doneLabel:'回到合成盘',onDone:()=>requestAnimationFrame(()=>this._tutorial())
    });
  }
  // ---------- 物品气泡 ----------
  showPop(p){ const c=this.s.cells[p.idx]; if(!c||c.k!=='i') return; this._selIdx=p.idx;
    const fam=Config.families[c.fam], price=Config.sellPrice(c.tier);
    this.el.ipName.textContent=`${fam.tiers[c.tier-1]}`;
    this.el.ipSub.textContent=`${fam.name}链 · Lv.${c.tier}`;
    this.el.ipPrice.textContent=`${price} 金`;
    const rect=$('#board').getBoundingClientRect();
    const pop=this.el.itemPop; pop.classList.remove('hidden');
    let x=rect.left+p.boardX-pop.offsetWidth/2, y=rect.top+p.boardY-this.scene.cell-10-pop.offsetHeight;
    const safe=window.__frostSafeInsets||{top:0,right:0,bottom:0,left:0};
    x=Math.max(6+safe.left,Math.min(window.innerWidth-pop.offsetWidth-6-safe.right,x));
    if(y<rect.top+70+safe.top) y=rect.top+p.boardY+this.scene.cell+8;
    pop.style.left=x+'px'; pop.style.top=y+'px';
  }
  hidePop(){ this.el.itemPop.classList.add('hidden'); this._selIdx=null; }

  // ---------- 剧情内新手引导 ----------
  _cellRect(indices){
    const list=(Array.isArray(indices)?indices:[indices]).filter(i=>i>=0);
    if(!list.length) return $('#board').getBoundingClientRect();
    const br=$('#board').getBoundingClientRect(), half=this.scene.cell*.48;
    const boxes=list.map(i=>{const p=this.scene.center(i);return {left:br.left+p.x-half,top:br.top+p.y-half,right:br.left+p.x+half,bottom:br.top+p.y+half};});
    return {left:Math.min(...boxes.map(x=>x.left)),top:Math.min(...boxes.map(x=>x.top)),
      right:Math.max(...boxes.map(x=>x.right)),bottom:Math.max(...boxes.map(x=>x.bottom)),
      width:Math.max(...boxes.map(x=>x.right))-Math.min(...boxes.map(x=>x.left)),
      height:Math.max(...boxes.map(x=>x.bottom))-Math.min(...boxes.map(x=>x.top))};
  }
  _mergePair(){
    const seeded=[13,14],a0=this.s.cells[seeded[0]],b0=this.s.cells[seeded[1]];
    if(a0?.k==='i'&&b0?.k==='i'&&!a0.bubble&&!b0.bubble&&a0.fam===b0.fam&&a0.tier===b0.tier) return seeded;
    for(let i=0;i<this.s.boardUnlocked;i++){ const a=this.s.cells[i];
      if(!a||a.k!=='i'||a.bubble||a.tier>=8) continue;
      for(let j=i+1;j<this.s.boardUnlocked;j++){ const b=this.s.cells[j];
        if(b?.k==='i'&&!b.bubble&&a.fam===b.fam&&a.tier===b.tier) return [i,j]; }
    }
    return [];
  }
  _hideGuide(){ this.el.guideLayer?.classList.add('hidden'); if(this.el.guideLayer) this.el.guideLayer.innerHTML=''; this.el.hint.classList.add('hidden'); }
  // 陪伴角色的故事化台词（以啾可第一人称，把每个操作讲成重建山谷的一步）
  static COMP_LINES={
    produce:'风灯在发热……碰一下那道蓝光。',
    merge:'这两枚冰晶在互相呼应。让它们靠在一起试试？',
    request:'嘘——有人踩着雪来了。先听听他为什么敲门。',
    order:'冈特把火哨交给我们了。把做好的冰晶递给他吧。',
    unlock:'火哨照见了一块松动的冰。碰一碰那枚雪锁。',
    shop:'蜜儿说集市重新开门了。进去看看有什么在发光。',
    story:'广场下面传来微弱的火星声。去山谷看看，它在等我们。'
  };
  static COMP_REACT={
    produce:'它醒了……祖父的矿脉还认得你。',
    merge:'听见了吗？冰裂开的声音里，有一点火。',
    request:'冈特没有走。他一直替空村子守着夜路。',
    order:'远处的第一盏火哨亮了。',
    unlock:'冰层下面，是十年前留下的路。',
    shop:'货架空着，但门铃还会响。这里会重新热闹起来。',
    story:''
  };
  _tutorial(){
    const t=this.s.tutorial, layer=this.el.guideLayer, comp=this.el.companion;
    if(!comp) return;
    // 教学结束：收起引导光圈，陪伴角色转为常驻小伙伴
    if(!layer||t.done||t.skipped){ this._hideGuide(); this._companionIdle(); return; }
    let step;
    if(!t.produced){ const idx=this.s.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_crystal');
      step={id:'produce',rect:this._cellRect(idx),gesture:'tap'}; }
    else if(!t.merged){ const pair=this._mergePair();
      const from=pair.length?this.scene.center(pair[0]):null,to=pair.length?this.scene.center(pair[1]):null;
      step={id:'merge',rect:this._cellRect(pair),gesture:'drag',from,to}; }
    else if(!t.orderAccepted){ const target=this.s.settings.ordersCollapsed?this.el.ordersToggle:document.querySelector('.oc-request');
      step={id:'request',rect:target?.getBoundingClientRect(),gesture:'tap'}; }
    else if(!t.ordered){ const target=this.s.settings.ordersCollapsed?this.el.ordersToggle:(document.querySelector('.order-card.ready .oc-submit')||document.querySelector('.oc-submit'));
      step={id:'order',rect:target?.getBoundingClientRect(),gesture:'tap'}; }
    else if(!t.unlocked){ const idx=Math.min(this.s.boardUnlocked,this.s.cells.length-1);
      step={id:'unlock',rect:this._cellRect(idx),gesture:'tap'}; }
    else if(!t.shopped){ const target=document.querySelector('[data-panel="shop"]');
      step={id:'shop',rect:target?.getBoundingClientRect(),gesture:'tap'}; }
    else { const target=document.querySelector('[data-panel="story"]');
      step={id:'story',rect:target?.getBoundingClientRect(),gesture:'tap'}; }
    if(!step?.rect){ this._hideGuide(); this._companionIdle(); return; }
    // 步骤推进时，啾可先夸一句（陪伴感 / 即时反馈）
    if(this._compStep && this._compStep!==step.id && UI.COMP_REACT[this._compStep]){
      this._chocoSay(UI.COMP_REACT[this._compStep],1900,true);
    }
    this._compStep=step.id;
    this.el.hint.classList.add('hidden');
    // 柔和目标光圈（不压暗屏、不拦截操作，玩家可随时自由行动）
    layer.classList.remove('hidden'); layer.dataset.step=step.id;
    layer.innerHTML=`<div class="guide-focus comp-focus"></div><div class="guide-hand ${step.gesture==='drag'?'drag':'tap'}" aria-hidden="true">☝️</div>`;
    const app=$('#app').getBoundingClientRect(),margin=7;
    const rr=step.rect,local={left:rr.left-app.left-margin,top:rr.top-app.top-margin,
      width:(rr.width??rr.right-rr.left)+margin*2,height:(rr.height??rr.bottom-rr.top)+margin*2};
    Object.assign(layer.querySelector('.guide-focus').style,
      {left:local.left+'px',top:local.top+'px',width:local.width+'px',height:local.height+'px'});
    const hand=layer.querySelector('.guide-hand');
    if(step.gesture==='drag'&&step.from&&step.to){
      Object.assign(hand.style,{left:(step.from.x-app.left-10)+'px',top:(step.from.y-app.top-4)+'px',
        '--guide-dx':(step.to.x-step.from.x)+'px','--guide-dy':(step.to.y-step.from.y)+'px'});
    }else Object.assign(hand.style,{left:(local.left+local.width*.58)+'px',top:(local.top+local.height*.48)+'px'});
    this._companionActive(UI.COMP_LINES[step.id]);
  }
  _companionActive(line){ const comp=this.el.companion; if(!comp) return;
    comp.classList.remove('hidden','idle','busy'); comp.classList.add('teaching');
    comp.querySelector('.comp-say').textContent=line;
    comp.querySelector('.comp-who').textContent='霜灵 · 啾可';
    const skip=comp.querySelector('.comp-skip'); skip.style.display='';
    skip.onclick=()=>{ this.s.tutorial.skipped=true; this.s.tutorial.done=true; Save.saveNow(this.s);
      this._hideGuide(); this._companionIdle(); this.toast('啾可会留在风灯旁，想找方向时再点它'); };
    comp.querySelector('.comp-avatar').onclick=()=>this._chocoSay(line,2600);
  }
  // 教学后：陪伴角色常驻，点击讲当前主线（故事驱动），主线可交付时冒小光点
  _companionIdle(){ const comp=this.el.companion; if(!comp) return;
    comp.classList.remove('teaching'); comp.classList.add('idle');
    comp.classList.remove('hidden');
    comp.querySelector('.comp-skip').style.display='none';
    comp.querySelector('.comp-who').textContent='霜灵 · 啾可';
    const obj=this.s.currentObjective();
    comp.classList.toggle('ping', !!obj && this.s.nodeState(obj.node,obj.chapter)==='ready');
    comp.querySelector('.comp-avatar').onclick=()=>{
      AudioMgr.play('chime');
      const o=this.s.currentObjective();
      if(!o){ this._chocoSay('山谷已经四季如春啦，不过我们还能继续合并、收集，把日子过得更暖～',2600); return; }
      const st=this.s.nodeState(o.node,o.chapter);
      if(st==='ready') this._chocoSay(`「${o.node.name}」的材料都齐啦！快打开山谷交付，故事就要往下走了～`,2600);
      else if(st==='lack'){ const need=o.node.need.map(q=>`${Config.families[q.fam].name}${q.tier}阶×${q.n}`).join('、');
        this._chocoSay(`下一段故事是「${o.node.name}」，还需要：${need}。我们去合并准备吧！`,3000); }
      else if(st==='lvlock') this._chocoSay(`这段故事要等我们升到 Lv.${o.node.unlockLv||o.chapter.unlockLv}，多交付些委托就好～`,2600);
      else this._chocoSay(`跟着主线走就好，下一站：「${o.node.name}」。`,2400);
    };
    if(!comp.classList.contains('speaking')) comp.querySelector('.comp-say').textContent='';
  }
  _chocoSay(text,ms=2400,react=false){ const comp=this.el.companion; if(!comp) return;
    comp.classList.remove('hidden','idle'); comp.classList.add('speaking');
    comp.classList.toggle('react',react);
    comp.querySelector('.comp-say').textContent=text;
    clearTimeout(this._compTimer);
    this._compTimer=setTimeout(()=>{ comp.classList.remove('speaking','react');
      if(this.s.tutorial.done||this.s.tutorial.skipped) this._companionIdle(); },ms);
  }

  // ---------- 弹窗框架 ----------
  modal(html, center=false){ this.closeModal();
    const t=html.trimStart();
    const bare=t.startsWith('<div class="dlg"')||t.startsWith('<div class="cdialog"')||t.startsWith('<div class="cine"')
      ||t.startsWith('<div class="story-stage"')||t.startsWith('<div class="story-act"');
    const mask=document.createElement('div'); mask.className='modal-mask';
    mask.innerHTML=`<div class="modal ${center?'center':''} ${bare?'bare':''}">${html}</div>`;
    mask.onclick=e=>{ if(e.target===mask) this.closeModal(); };
    this.el.modalLayer.appendChild(mask); this._modal=mask;
    this.el.companion?.classList.add('busy');
    AudioMgr.play('click'); return mask;
  }
  closeModal(){ clearTimeout(this._dialogTimer); this._dialogTimer=0; AudioMgr.stopVoice();
    this._modal?.remove(); this._modal=null;
    this.el.companion?.classList.remove('busy'); }
  openPanel(name){
    if(name==='shop') return this._shop();
    if(name==='book') return this._book();
    if(name==='story') return this._story();
    if(name==='settings') return this._settings();
  }

  _shop(){
    const s=this.s, free=s.sandbox;
    if(!s.tutorial.done&&s.tutorial.unlocked&&!s.tutorial.shopped){
      s.tutorial.shopped=true; Save.saveNow(s); requestAnimationFrame(()=>this._tutorial());
    }
    const body=()=>{
      const chestRows=Config.shop.chests.map(c=>{
        const locked=s.lv<c.unlockLv;
        return `<div class="goods-row"><div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(160deg,${c.color},#8a5a22);display:grid;place-items:center;font-size:24px">🎁</div>
          <div class="goods-info"><b>${c.name}</b><p>${c.drop.count}件 ${c.drop.tierMin}-${c.drop.tierMax}级材料 · ${c.openSec}秒开箱${locked?` · Lv.${c.unlockLv}解锁`:''}</p></div>
          <button class="buy-btn gold" data-chest="${c.id}" ${locked?'disabled':''}>${locked?'未解锁':(free?'免费':c.price+' 金')}</button></div>`; }).join('');
      const genRows=Config.shop.generators.map(e=>{
        const g=Config.genById(e.id), bought=s.boughtGens.includes(e.id)||s.ownedGens.includes(e.id), locked=s.lv<e.unlockLv;
        return `<div class="goods-row"><img src="assets/img/${g.img}">
          <div class="goods-info"><b>${g.name}</b><p>产出「${Config.families[g.family].name}」链材料${locked?` · Lv.${e.unlockLv}解锁`:''}</p></div>
          <button class="buy-btn" data-gen="${e.id}" ${bought||locked?'disabled':''}>${bought?'已拥有':locked?'未解锁':(free?'免费':e.price+' 金')}</button></div>`; }).join('');
      return `<div class="shop-sec-t">体力</div>
        <div class="goods"><div class="goods-row"><div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(160deg,#ffd28a,#f09a36);display:grid;place-items:center;font-size:24px">⚡</div>
          <div class="goods-info"><b>体力瓶</b><p>立即回满体力（上限 ${Config.energyMax(s.lv)}）</p></div>
          <button class="buy-btn" data-energy>${free?'免费':Config.shop.energyPotion.gem+' 钻'}</button></div></div>
        <div class="shop-sec-t">宝箱</div><div class="goods">${chestRows}</div>
        <div class="shop-sec-t">生成器（一次拥有）</div><div class="goods">${genRows}</div>`;
    };
    const m=this.modal(`<div class="m-head"><div class="m-title">商店${free?' · 爽玩模式':''}</div><button class="m-close">✕</button></div><div class="m-body"></div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    const bind=()=>{
      m.querySelectorAll('[data-chest]').forEach(b=>b.onclick=()=>runActionOnce(b,()=>s.buyChest(b.dataset.chest),render));
      m.querySelectorAll('[data-gen]').forEach(b=>b.onclick=()=>runActionOnce(b,()=>s.buyGenerator(b.dataset.gen),render));
      const energy=m.querySelector('[data-energy]');
      if(energy) energy.onclick=()=>runActionOnce(energy,()=>s.buyEnergyPotion(),render);
    };
    const render=()=>refreshScrollable(m,body(),bind);
    render();
  }

  _book(){
    const s=this.s;
    const html=Config.famList.map(fam=>{ const f=Config.families[fam];
      const cells=f.tiers.map((name,t)=>{ const k=`${fam}_${t+1}`, n=s.hb[k]||0;
        return `<div class="book-cell ${n?'seen':'unseen'}"><img src="${itemImg(fam,t+1)}">${n?`<span class="bc-own">×${n}</span>`:''}<div class="bc-name">${n?name:'？？？'}</div></div>`; }).join('');
      return `<div class="book-fam" style="--fc:${f.color}"><h4>${f.name}链</h4><div class="book-grid">${cells}</div></div>`; }).join('');
    const m=this.modal(`<div class="m-head"><div class="m-title">山谷图鉴</div><button class="m-close">✕</button></div><div class="m-body">${html}</div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
  }

  _story(tab='build'){
    const s=this.s;
    if(!s.tutorial.done&&s.tutorial.shopped){
      s.tutorial.storyOpened=true; s.tutorial.done=true; Save.saveNow(s); this._hideGuide();
      setTimeout(()=>this.toast('教学完成！跟着主线任务，把霜语谷一点点重建起来吧'),120);
    }
    const m=this.modal(`<div class="m-head"><div class="m-title">霜语谷</div><button class="m-close">✕</button></div>
      <div class="story-tabs">
        <button data-tab="build" class="${tab==='build'?'on':''}">🏗️ 重建主线</button>
        <button data-tab="journal" class="${tab==='journal'?'on':''}">📓 山谷手账</button>
      </div><div class="m-body" id="storyTabBody"></div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    const body=m.querySelector('#storyTabBody');
    const renderBuild=()=>{ body.innerHTML=this._storyBuildHTML(); this._bindStoryBuild(body); AudioMgr.play('page'); };
    const renderJournal=()=>{ body.innerHTML=this._journalHTML(); AudioMgr.play('page'); };
    m.querySelectorAll('.story-tabs button').forEach(b=>b.onclick=()=>{
      m.querySelectorAll('.story-tabs button').forEach(x=>x.classList.toggle('on',x===b));
      if(b.dataset.tab==='journal') renderJournal(); else renderBuild(); });
    if(tab==='journal') renderJournal(); else renderBuild();
  }
  _needChips(node){ return node.need.map(q=>{ const have=this.s.countItem(q.fam,q.tier), ok=have>=q.n;
      return `<span class="need-chip ${ok?'ok':'lack'}"><img src="${itemImg(q.fam,q.tier)}"><span class="have">${have}/${q.n}</span></span>`; }).join('')
      +` <span class="coin-need ${this.s.canPayCoin(node.coin)?'':'lack'}">🪙 ${node.coin}</span>`; }
  _storyBuildHTML(){
    const s=this.s;
    return Config.story.map(ch=>{
      const prog=Config.chapterProgress(ch,s.storyDone), reachable=s.chapterReachable(ch), lvLocked=s.lv<ch.unlockLv;
      const locked=!reachable;
      const nodes=ch.nodes.map(n=>{
        const st=s.nodeState(n,ch), done=st==='done';
        const picked=s.storyChoice(n);
        const btn = done?'<button class="sn-go gray">回看 ✓</button>'
          : st==='ready'?'<button class="sn-go" data-build="'+n.id+'">交付重建</button>'
          : st==='lvlock'?`<button class="sn-go gray">Lv.${n.unlockLv||ch.unlockLv}</button>`
          : st==='locked'?'<button class="sn-go gray">尚未解锁</button>'
          : '<button class="sn-go gray" data-build="'+n.id+'">材料不足</button>';
        return `<div class="story-node ${done?'done':''} ${st==='ready'?'ready':''}">
          <div class="sn-ic">${done?'📖':'🏗️'}</div>
          <div class="sn-info"><b>${n.name}</b><div class="sn-place">${n.place||''}</div>
          ${picked?`<div class="sn-picked">${picked.icon} 你的布置 · ${esc(picked.name)}</div>`:''}
          <div class="needline">${this._needChips(n)}</div></div>${btn}</div>`; }).join('');
      const lockMask=locked?`<div class="sc-lock">🔒 完成上一章后开放</div>`
        :lvLocked?`<div class="sc-lock">Lv.${ch.unlockLv} 开放 · ${prog.got}/${prog.total}</div>`
        :`<div class="sc-prog">${prog.got}/${prog.total}</div>`;
      return `<div class="story-chap ${locked?'locked':''}"><div class="story-scene" style="background-image:url(assets/img/${ch.scene})">
        <div class="sc-tt">${ch.title}<small>${ch.subtitle||''}</small></div>${lockMask}
        ${ch.hook?`<div class="sc-hook">❓ ${esc(ch.hook)}</div>`:''}</div>${nodes}</div>`;
    }).join('');
  }
  _bindStoryBuild(scope){
    scope.querySelectorAll('[data-build]').forEach(b=>b.onclick=()=>{
      for(const ch of Config.story){ const n=ch.nodes.find(x=>x.id===b.dataset.build); if(n){ this._tapStoryNode(ch,n); break; } }
    });
  }
  // 点剧情节点：已完成→回看；就绪→先播请求(pre)对白再确认交付；否则提示
  _tapStoryNode(ch,node){
    const s=this.s, st=s.nodeState(node,ch);
    if(st==='done'){
      if(node.interaction?.type==='choice'&&!s.storyChoice(node))
        this._storyBeat(ch,node,()=>this._storyDialog(ch,node,{replay:true}));
      else this._storyDialog(ch,node,{replay:true});
      return;
    }
    if(st==='locked'){ this.toast('先完成前面的节点，故事才会继续'); return; }
    if(st==='lvlock'){ this.toast(`升到 Lv.${node.unlockLv||ch.unlockLv} 解锁这段剧情`); return; }
    const doBuild=()=>{ this.closeModal();
      if(!s.buildNode(ch,node)) return; /* buildNode 会经 changed 触发 _storyDialog 回报对白 */ };
    if(st==='lack'){ this.toast('材料或金币还没凑齐，跟着主线任务继续合并吧'); return; }
    if(Array.isArray(node.pre)&&node.pre.length){ this._preDialog(ch,node,doBuild); } else doBuild();
  }
  // 交付前：村民的请求（驱动玩家去合成）
  _preDialog(ch,node,onConfirm){
    this._playDialogue({ch,node,lines:node.pre||[],kind:'request',sceneImg:ch.scene,
      doneLabel:'查看交付清单',onDone:()=>{
      const m=this.modal(`<div class="cdialog"><div class="big-ic">🏗️</div><h3>交付材料 · ${node.name}</h3>
        <p>将消耗以下材料与金币，完成后故事会继续推进。</p>
        <div class="needline" style="justify-content:center;margin-bottom:14px">${this._needChips(node)}</div>
        <div class="cd-btns"><button class="cd-no" data-n>再准备一下</button><button class="cd-ok" data-y>确认交付</button></div></div>`,true);
      m.querySelector('[data-n]').onclick=()=>this.closeModal();
      m.querySelector('[data-y]').onclick=()=>onConfirm();
    }});
  }
  _npcOf(who){ return Config.npcs.find(n=>n.id===who)||{
    name:who==='all'?'众人':who==='narrator'?'霜语谷手记':who, img:who==='gramps'?'npc_gramps.png':'npc_sprite.png'}; }

  // ---------- 任务架中的主线（默认收起，玩家需要时展开） ----------
  renderQuest(){ const box=this.el.quest; if(!box) return; const s=this.s, obj=s.currentObjective();
    if(!obj){ box.classList.add('hidden','collapsed'); this.el.questToggle.classList.add('hidden'); this._syncTaskShelf(); return; }
    const {chapter:ch,node}=obj, st=s.nodeState(node,ch);
    const collapsed=!!s.settings.questCollapsed;
    box.classList.remove('hidden'); box.classList.toggle('collapsed',collapsed); box.classList.toggle('ready',st==='ready');
    this.el.questToggle.classList.remove('hidden');
    this.el.questToggle.innerHTML=`<span><i>${st==='ready'?'🔥':'📜'}</i><b>重建主线</b></span><em>${esc(node.name)}</em><i class="task-chevron">⌄</i>`;
    this.el.questToggle.classList.toggle('ready',st==='ready');
    this.el.questToggle.setAttribute('aria-expanded',String(!collapsed));
    this.el.questToggle.onclick=()=>this._toggleTask('quest');
    box.innerHTML=`<img class="q-scene" src="assets/img/${ch.scene}">
      <div class="q-body"><div class="q-top"><span class="q-ch">${ch.title.replace(/^第.章 · /,'')}</span>
        <span class="q-name">${node.name}</span></div>
        <div class="q-needs">${node.need.map(q=>{const have=s.countItem(q.fam,q.tier);
          return `<span class="need-chip ${have>=q.n?'ok':'lack'}"><img src="${itemImg(q.fam,q.tier)}">${have}/${q.n}</span>`;}).join('')}
          <span class="need-chip ${s.canPayCoin(node.coin)?'ok':'lack'}">🪙${node.coin}</span></div></div>
      <button class="q-go">${st==='ready'?'交付':'前往'}</button>`;
    box.querySelector('.q-go').onclick=()=>{ s.settings.questCollapsed=true; Save.saveNow(s); this.renderQuest(); this._story(); };
    // 同步陪伴角色的"可交付"提示光点
    const comp=this.el.companion;
    if(comp&&comp.classList.contains('idle')) comp.classList.toggle('ping',st==='ready');
    this._syncTaskShelf();
  }

  _settings(){
    const s=this.s;
    const row=(k,label)=>`<div class="set-row"><span>${label}</span><div class="switch ${s.settings[k]?'on':''}" data-sw="${k}"><i></i></div></div>`;
    const m=this.modal(`<div class="m-head"><div class="m-title">设置</div><button class="m-close">✕</button></div>
      <div class="m-body">${row('bgm','背景音乐')}${row('sfx','游戏音效')}${row('voice','剧情语音')}
        <div class="set-row sandbox-row"><span>🥽 爽玩模式（内测）<small style="display:block;color:#8a9bb0">无限金币 / 钻石 / 体力，自由体验全部内容</small></span><div class="switch ${s.sandbox?'on':''}" data-sandbox><i></i></div></div>
        <button class="set-help" data-rules>📘 玩法规则与新手说明</button>
        <button class="set-danger">重置存档（重新开始）</button>
        <div class="set-about">冰霜物语 Frost Story v0.2<br>WebGL 核心 · 独立内核壳 · 原创美术与音乐由 AI 生成</div>
      </div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    m.querySelectorAll('[data-sw]').forEach(sw=>sw.onclick=()=>{ const k=sw.dataset.sw; s.settings[k]=!s.settings[k];
      AudioMgr.setBgm(s.settings.bgm); AudioMgr.setSfx(s.settings.sfx); AudioMgr.setVoice(s.settings.voice); Haptics.setEnabled(s.settings.sfx); sw.classList.toggle('on',s.settings[k]); Save.saveNow(s); });
    const sbSw=m.querySelector('[data-sandbox]');
    sbSw.onclick=()=>{ s.setSandbox(!s.sandbox); sbSw.classList.toggle('on',s.sandbox); this.toast(s.sandbox?'爽玩模式已开启：资源无限':'已关闭爽玩模式'); Save.saveNow(s); };
    m.querySelector('[data-rules]').onclick=()=>this._rules();
    m.querySelector('.set-danger').onclick=()=>{
      this.modal(`<div class="cdialog"><h3>确定重置？</h3><p>所有进度将被清空，且无法恢复。</p>
        <div class="cd-btns"><button class="cd-no" data-n>取消</button><button class="cd-ok" data-y>确定重置</button></div></div>`,true)
        .querySelector('[data-y]').onclick=()=>{Save.wipe();location.reload();};
      this._modal.querySelector('[data-n]').onclick=()=>this.closeModal();
    };
  }

  // ---------- 爽玩控制台 ----------
  _sandboxFab(on){ const f=this.el.sbFab; if(!f) return; f.classList.toggle('hidden',!on);
    if(on) requestAnimationFrame(()=>this._layoutSandboxFab()); }
  _sbBtn(act,icon,label,desc){ return `<button class="sb-card" data-act="${act}"><span class="sb-ic">${icon}</span>
      <span class="sb-tx"><b>${label}</b><small>${desc}</small></span></button>`; }
  _sandboxPanel(){
    if(!this.s.sandbox){ this.openPanel('settings'); return; }
    const s=this.s;
    const m=this.modal(`<div class="m-head sb-head"><div class="m-title">🥽 爽玩控制台</div><button class="m-close">✕</button></div>
      <div class="m-body">
        <div class="sb-status">资源无限中 · 金币 / 钻石 / 体力 ∞ · 生成器无冷却 · 宝箱秒开</div>
        <div class="sb-grid">
          ${this._sbBtn('lvl','⭐','直升 5 级','解锁高阶链与章节')}
          ${this._sbBtn('board','🧊','融化全部棋盘','48 格瞬间全开')}
          ${this._sbBtn('gens','🏭','全部生成器','6 条合成链一次拥有')}
          ${this._sbBtn('fill','✨','铺满材料','每族补 1~3 级材料')}
          ${this._sbBtn('story','📜','下一段剧情','精确备齐下一节点材料')}
          ${this._sbBtn('chest','🎁','宝箱秒就绪','跳过所有开箱等待')}
          ${this._sbBtn('clear','🧹','清空棋盘','只留生成器，整理空间')}
        </div>
        <button class="sb-off" data-off>关闭爽玩模式（恢复正常数值）</button>
      </div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    const feedback=msg=>{ this.toast(msg); this.scene.shake?.(4,200); };
    m.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{
      const a=b.dataset.act;
      if(a==='lvl') feedback(`已升至 Lv.${s.sbAddLevel()} ⭐`);
      if(a==='board'){ s.sbUnlockBoard(); feedback('冰封棋盘已全部融化 ❄️'); }
      if(a==='gens'){ s.sbAllGens(); feedback('全部生成器已上棋盘 🏭'); }
      if(a==='fill'){ s.sbFillMaterials(); feedback('材料已铺满，尽情合成 ✨'); }
      if(a==='story'){
        const prepared=s.sbPrepareNextStory();
        if(prepared.finished) feedback('六章剧情已全部完成 🎉');
        else feedback(`已备齐「${prepared.node.name}」材料 📜`);
      }
      if(a==='chest'){ s.sbOpenChests(); feedback('所有宝箱已就绪 🎁'); }
      if(a==='clear'){ s.sbClearItems(); feedback('棋盘已整理 🧹'); }
      setTimeout(()=>this._sandboxPanel(),120); // 刷新面板状态
    });
    m.querySelector('[data-off]').onclick=()=>{ s.setSandbox(false); this._sandboxFab(false); this.closeModal();
      this.toast('已关闭爽玩模式'); };
  }

  // ---------- 专用小弹窗 ----------
  _levelUp(ups){
    const u=ups[ups.length-1];
    const m=this.modal(`<div class="cdialog"><div class="big-ic">⭐</div><h3>等级提升 Lv.${u.lv}</h3>
      <p>${u.text||'继续加油，霜语谷正在一点点复苏'}</p>
      <div class="reward-line"><span class="reward-chip">🪙 ${u.reward.coin}</span>${u.reward.gem?`<span class="reward-chip">💎 ${u.reward.gem}</span>`:''}<span class="reward-chip">⚡ 体力回满</span></div>
      <div class="cd-btns"><button class="cd-ok">好的</button></div></div>`,true);
    m.querySelector('.cd-ok').onclick=()=>this.closeModal();
  }
  _chestDialog(idx){ const c=this.s.cells[idx]; if(!c||c.k!=='c') return; const def=this.s.chestInfo(c);
    const remain=this.s.chestRemain(c);
    const body = remain<=0 ? `<h3>✨ 宝箱就绪</h3><p>打开获得 ${def.drop.count} 件材料和金币</p>
        <div class="cd-btns"><button class="cd-no" data-n>稍后</button><button class="cd-ok" data-o>立即开启</button></div>`
      : `<h3>${def.name} 解锁中</h3><p>还需 ${remain} 秒，可花费 ${def.skipGem} 钻立即开启</p>
        <div class="cd-btns"><button class="cd-no" data-n>等待</button><button class="cd-ok" data-s>花 ${def.skipGem} 钻跳过</button></div>`;
    const m=this.modal(`<div class="cdialog"><div class="big-ic">🎁</div>${body}</div>`,true);
    m.querySelector('[data-n]').onclick=()=>this.closeModal();
    const o=m.querySelector('[data-o]'); if(o) o.onclick=()=>runActionOnce(o,()=>this.s.skipChest(idx,true),()=>this.closeModal());
    const sk=m.querySelector('[data-s]'); if(sk) sk.onclick=()=>runActionOnce(sk,()=>this.s.skipChest(idx,false),()=>this.closeModal());
  }
  _unlockDialog(info){ if(!info){this.toast('棋盘已全部解锁');return;}
    const s=this.s, ok=s.lv>=info.needLv;
    const m=this.modal(`<div class="cdialog"><div class="big-ic">❄️</div><h3>融化冰封格</h3>
      <p>${ok?`花费 ${info.cost} 金币融化一片被冰雪覆盖的棋盘格，获得更多空间。`:`需要等级达到 Lv.${info.needLv} 才能融化这片区域。`}</p>
      <div class="cd-btns"><button class="cd-no" data-n>取消</button>${ok?`<button class="cd-ok" data-y>融化 · ${info.cost}金</button>`:''}</div></div>`,true);
    m.querySelector('[data-n]').onclick=()=>this.closeModal();
    const y=m.querySelector('[data-y]'); if(y) y.onclick=()=>runActionOnce(y,()=>s.unlockNext(),()=>this.closeModal());
  }
  _noEnergy(){ this.modal(`<div class="cdialog"><div class="big-ic">⚡</div><h3>体力不足</h3>
    <p>体力会随时间自动恢复，也可以用钻石在商店购买体力瓶。</p>
    <div class="cd-btns"><button class="cd-no" data-n>知道了</button><button class="cd-ok" data-y>去商店</button></div></div>`,true)
    .querySelector('[data-y]').onclick=()=>{this.closeModal();this._shop();};
    this._modal.querySelector('[data-n]').onclick=()=>this.closeModal();
  }

  // ---------- 剧情演出导演：同一舞台连续换镜，避免逐句销毁/重建弹窗 ----------
  _lineOf(line){
    if(Array.isArray(line)) return {who:line[0],say:line[1],...(line[2]&&typeof line[2]==='object'?line[2]:{})};
    if(line&&typeof line==='object') return line;
    return {who:'narrator',say:String(line||'')};
  }
  _storyText(text,node){
    const picked=node?this.s.storyChoice(node):null;
    return String(text||'').replaceAll('{{choice}}',picked?.name||'选好的主灯');
  }
  _playDialogue({ch=null,node=null,lines=[],kind='story',sceneImg=null,doneLabel='继续',onDone=null}){
    const cards=(lines||[]).map(line=>this._lineOf(line));
    if(!cards.length){ onDone?.(); return; }
    const title=node?.name||ch?.title||'序章 · 风灯归乡';
    const place=node?.place||ch?.subtitle||'霜语谷 · 长雪归途';
    const bg=sceneImg||node?.cg||ch?.scene||'story_1.png';
    const hasCg=String(bg).startsWith('cg_');
    const kindLabel=kind==='request'?'村民请求':kind==='welcome'?'序章':'主线剧情';
    const transcript=cards.map(line=>{ const npc=this._npcOf(line.who);
      return `<div class="story-log-line"><b>${esc(npc.name)}</b><p>${esc(this._storyText(line.say,node))}</p></div>`; }).join('');
    const m=this.modal(`<div class="story-stage ${hasCg?'has-cg':''}" data-kind="${esc(kind)}" data-line="0">
      <div class="story-stage-bg" style="background-image:url(assets/img/${esc(bg)})"></div>
      <div class="story-stage-atmo"></div>
      ${hasCg?`<div class="story-stage-cg"><img src="assets/img/${esc(bg)}" alt="${esc(title)} CG"></div>`:''}
      <div class="story-stage-toolbar">
        <span>${esc(kindLabel)} · ${esc(title)}</span>
        <div><button class="story-log" type="button" aria-expanded="false">回顾</button><button class="story-skip" type="button">跳过</button></div>
      </div>
      <div class="story-stage-caption"><b>${esc(place)}</b><span>${esc(ch?.hook||'')}</span></div>
      <div class="story-portrait" aria-hidden="true"><div class="story-portrait-glow"></div><img alt=""></div>
      <div class="story-copy dlg-line">
        <div class="who story-speaker"></div><p class="say story-say" aria-live="polite"></p>
        <div class="story-copy-foot"><span class="story-line-count"></span><button class="dlg-next" type="button"></button></div>
      </div>
      <div class="story-transcript hidden"><div class="story-log-head"><b>本段回顾</b><button type="button">返回画面</button></div>${transcript}</div>
    </div>`,true);
    const stage=m.querySelector('.story-stage'), portrait=m.querySelector('.story-portrait'), portraitImg=portrait.querySelector('img');
    const speaker=m.querySelector('.story-speaker'), say=m.querySelector('.story-say'), counter=m.querySelector('.story-line-count');
    const next=m.querySelector('.dlg-next'), log=m.querySelector('.story-log'), skip=m.querySelector('.story-skip');
    const transcriptPanel=m.querySelector('.story-transcript'); let index=0,typed=true,finished=false;
    const finishTyping=(text)=>{ clearTimeout(this._dialogTimer); this._dialogTimer=0; say.textContent=text; typed=true;
      next.dataset.typing='false'; next.textContent=index===cards.length-1?`${doneLabel} ▸`:'继续 ▸'; };
    const render=()=>{
      const line=cards[index],npc=this._npcOf(line.who),isNarrator=line.who==='narrator'||line.who==='all';
      const text=this._storyText(line.say,node); const side=line.side==='left'||line.side==='right'?line.side:(index%2?'left':'right');
      stage.dataset.line=String(index); stage.dataset.side=side; stage.classList.toggle('narrating',isNarrator);
      stage.querySelector('.story-stage-bg').style.backgroundPosition=`${42+(index%3)*8}% center`;
      portrait.classList.toggle('hidden',isNarrator); portraitImg.src=`assets/img/${npc.img}`; portraitImg.alt=npc.name;
      speaker.textContent=isNarrator?(line.who==='all'?'众人':'霜语谷手记'):`${npc.name}${kind==='request'?' · 请求':''}`;
      counter.textContent=`${index+1} / ${cards.length}`; say.textContent=''; typed=false;
      next.dataset.typing='true'; next.textContent='点击显示全文';
      AudioMgr.play(line.sfx||'page'); AudioMgr.playVoice(line.voice);
      const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||navigator.webdriver;
      if(reduced){ finishTyping(text); return; }
      const chars=Array.from(text); let at=0;
      const tick=()=>{ if(typed||finished) return; at=Math.min(chars.length,at+1); say.textContent=chars.slice(0,at).join('');
        if(at>=chars.length) finishTyping(text); else this._dialogTimer=setTimeout(tick,line.speed||24); };
      tick();
    };
    const complete=()=>{ if(finished) return; finished=true; clearTimeout(this._dialogTimer); this.closeModal(); onDone?.(); };
    next.onclick=()=>{ const text=this._storyText(cards[index].say,node); if(!typed){ finishTyping(text); return; }
      if(index<cards.length-1){ index++; render(); } else complete(); };
    skip.onclick=complete;
    const toggleLog=show=>{ transcriptPanel.classList.toggle('hidden',!show); stage.classList.toggle('log-open',show);
      log.setAttribute('aria-expanded',String(show)); };
    log.onclick=()=>toggleLog(transcriptPanel.classList.contains('hidden'));
    transcriptPanel.querySelector('button').onclick=()=>toggleLog(false);
    render();
  }

  // 交付之后不只“看结果”：关键节点需要玩家亲手点亮，或留下装修选择。
  _storyBeat(ch,node,after){
    const act=node.interaction;
    if(!act){ after?.(); return; }
    if(act.type==='choice'){ this._storyChoiceBeat(ch,node,act,after); return; }
    if(act.type!=='tap-sequence'||!Array.isArray(act.steps)||!act.steps.length){ after?.(); return; }
    const clamp=n=>Math.max(8,Math.min(92,Number(n)||50));
    const bg=node.cg||ch.scene;
    const targets=act.steps.map((step,index)=>`<button class="story-act-target ${index===0?'next':''}" type="button"
      data-step="${esc(step.id)}" style="--x:${clamp(step.x)}%;--y:${clamp(step.y)}%" aria-label="第 ${index+1} 步：${esc(step.label)}">
      <i>${esc(step.icon||'✨')}</i><span>${esc(step.label)}</span></button>`).join('');
    const m=this.modal(`<div class="story-act act-tap ${node.cg?'has-cg':''}" data-node="${esc(node.id)}">
      <div class="story-act-bg" style="background-image:url(assets/img/${esc(bg)})"></div><div class="story-act-frost"></div>
      ${node.cg?`<div class="story-act-cg"><img src="assets/img/${esc(bg)}" alt="${esc(node.name)} CG"></div>`:''}
      <div class="story-act-head"><span>亲手复苏 · ${esc(ch.title)}</span><button class="story-act-skip" type="button">跳过动作</button></div>
      <div class="story-act-title"><small>${esc(node.place||'')}</small><h2>${esc(act.title)}</h2><p>${esc(act.prompt||'')}</p></div>
      <div class="story-act-field">${targets}</div>
      <div class="story-act-bottom"><div class="story-act-result" aria-live="polite">完成 0 / ${act.steps.length}</div>
        <div class="story-act-meter"><i></i></div><button class="story-act-continue hidden" type="button">继续故事 ▸</button></div>
    </div>`,true);
    const stage=m.querySelector('.story-act'),buttons=[...m.querySelectorAll('.story-act-target')];
    const result=m.querySelector('.story-act-result'),meter=m.querySelector('.story-act-meter i'),continueBtn=m.querySelector('.story-act-continue');
    let current=0,finished=false;
    const done=()=>{ if(finished) return; finished=true; this.closeModal(); after?.(); };
    buttons.forEach((button,index)=>button.onclick=()=>{
      if(index!==current||finished) return;
      const step=act.steps[index]; button.classList.remove('next'); button.classList.add('done');
      AudioMgr.play(step.sfx||'tap'); Haptics.tap(); current++;
      const spark=document.createElement('i'); spark.className='story-act-spark'; spark.textContent='✦';
      spark.style.left=`${clamp(step.x)}%`; spark.style.top=`${clamp(step.y)}%`; stage.appendChild(spark); setTimeout(()=>spark.remove(),800);
      result.textContent=current===act.steps.length?act.complete:`完成 ${current} / ${act.steps.length}`;
      meter.style.width=`${current/act.steps.length*100}%`;
      if(current<act.steps.length) buttons[current].classList.add('next');
      else { stage.classList.add('complete'); continueBtn.classList.remove('hidden'); AudioMgr.play('reward'); Haptics.unlock(); }
    });
    continueBtn.onclick=done; m.querySelector('.story-act-skip').onclick=done;
  }
  _storyChoiceBeat(ch,node,act,after){
    const options=Array.isArray(act.options)?act.options:[];
    if(!options.length){ after?.(); return; }
    const bg=node.cg||ch.scene;
    const saved=this.s.storyChoice(node); let selected=saved?.id||'';
    const optionHTML=options.map(option=>{ const accent=/^#[0-9a-f]{6}$/i.test(option.accent||'')?option.accent:'#f5a33c';
      return `<button class="story-choice-card ${selected===option.id?'selected':''}" type="button" role="radio"
        aria-checked="${selected===option.id}" data-choice="${esc(option.id)}" style="--accent:${accent}">
        <i>${esc(option.icon||'✨')}</i><b>${esc(option.name)}</b><span>${esc(option.desc||'')}</span></button>`; }).join('');
    const m=this.modal(`<div class="story-act act-choice" data-node="${esc(node.id)}">
      <div class="story-act-bg" style="background-image:url(assets/img/${esc(bg)})"></div><div class="story-act-frost"></div>
      <div class="story-act-head"><span>我的山谷 · ${esc(ch.title)}</span><button class="story-act-skip" type="button">暂不选择</button></div>
      <div class="story-act-title"><small>${esc(node.place||'')}</small><h2>${esc(act.title)}</h2><p>${esc(act.prompt||'')}</p></div>
      <div class="story-choice-grid" role="radiogroup" aria-label="${esc(act.title)}">${optionHTML}</div>
      <div class="story-act-bottom"><div class="story-act-result" aria-live="polite">${saved?`已布置 · ${esc(saved.name)}`:'选择一种布置预览效果'}</div>
        <button class="story-choice-confirm" type="button" ${selected?'':'disabled'}>采用这个方案 ▸</button></div>
    </div>`,true);
    const stage=m.querySelector('.story-act'),cards=[...m.querySelectorAll('.story-choice-card')],confirm=m.querySelector('.story-choice-confirm');
    const result=m.querySelector('.story-act-result'); let finished=false;
    const done=()=>{ if(finished) return; finished=true; this.closeModal(); after?.(); };
    const select=id=>{ selected=id; const picked=options.find(option=>option.id===id);
      cards.forEach(card=>{ const on=card.dataset.choice===id; card.classList.toggle('selected',on); card.setAttribute('aria-checked',String(on)); });
      confirm.disabled=false; result.textContent=`预览 · ${picked.name}：${picked.desc||''}`;
      const accent=/^#[0-9a-f]{6}$/i.test(picked.accent||'')?picked.accent:'#f5a33c'; stage.style.setProperty('--choice-accent',accent);
      AudioMgr.play('tap'); Haptics.tap(); };
    cards.forEach(card=>card.onclick=()=>select(card.dataset.choice));
    if(selected) select(selected);
    confirm.onclick=()=>{ const savedResult=this.s.setStoryChoice(node.id,selected); if(!savedResult?.ok) return;
      const picked=this.s.storyChoice(node); stage.classList.add('complete'); result.textContent=act.complete||`已采用 ${picked.name}`;
      confirm.disabled=true; confirm.textContent='已保存 ✓'; AudioMgr.play('chime'); Haptics.unlock();
      setTimeout(done,420); };
    m.querySelector('.story-act-skip').onclick=done;
  }

  // ---------- 章节开场过场（电影感） ----------
  _moodWind(mood){ return {cold:.9,bustling:.4,holy:.35,hopeful:.3,tender:.25,finale:.05}[mood]??.7; }
  _applyMood(ch){ AudioMgr.playBgm(ch.bgm||'bgm'); AudioMgr.setWind(this._moodWind(ch.mood)); }
  _chapterIntro(ch, after){
    this.s.markChapterSeen(ch.id); this._applyMood(ch); AudioMgr.play('chime');
    const lines=ch.intro||[]; let i=0;
    const lineCard=()=>{ const m=this.modal(`<div class="cine">
        <div class="cine-bg" style="background-image:url(assets/img/${ch.scene})"></div>
        <div class="cine-veil"></div>
        <div class="cine-body">
          <div class="cine-kicker">FROST STORY · CHAPTER ${ch.id}</div>
          <h2 class="cine-title">${ch.title}</h2><div class="cine-sub">${ch.subtitle||''}</div>
          ${ch.hook?`<div class="cine-hook">本章悬念 · ${esc(ch.hook)}</div>`:''}
          <p class="cine-say">${lines[i]||''}</p>
          <div class="cine-dots">${lines.map((_,k)=>`<i class="${k===i?'on':''}"></i>`).join('')}</div>
          <button class="cine-next">${i>=lines.length-1?'进入本章 ▸':'继续 ▸'}</button>
        </div></div>`,true);
      m.querySelector('.cine-next').onclick=()=>{ i++; this.closeModal();
        if(i<lines.length) lineCard(); else { after?.(); } };
    };
    lineCard();
  }
  // 若存在已开放但未看过场的章节，自动播放（通关一章后/回到游戏时）
  _maybeChapterIntro(after){ const ch=this.s.nextUnseenChapter(); if(ch){ this._chapterIntro(ch,after); } else after?.(); }

  // ---------- 剧情回报对白（交付后 / 回看） ----------
  _storyDialog(ch,node,opts={}){
    const replay=!!opts.replay;
    this._playDialogue({ch,node,lines:node.dialogue||[],kind:'story',sceneImg:node.cg||ch.scene,
      doneLabel:replay?'合上回忆':(node.finale?'迎来结局':'查看收获'),onDone:()=>{
        const rw=node.reward||{}, finale=!!node.finale;
        if(replay){ this.closeModal(); return; }
        const m=this.modal(`<div class="cdialog"><div class="big-ic">${finale?'🔥':'🏘️'}</div>
          <h3>${finale?'霜心苏醒！':'「'+node.name+'」完成'}</h3>
          <p>${node.lore?node.lore.text:'山谷又恢复了一处生机。'}</p>
          <div class="reward-line">${rw.coin?`<span class="reward-chip">🪙 ${rw.coin}</span>`:''}${rw.gem?`<span class="reward-chip">💎 ${rw.gem}</span>`:''}${rw.generator?`<span class="reward-chip">🎁 新生成器</span>`:''}</div>
          <div class="cd-btns"><button class="cd-ok">${finale?'看结局':'太棒了'}</button></div></div>`,true);
        if(finale) AudioMgr.play('flame');
        m.querySelector('.cd-ok').onclick=()=>{ this.closeModal();
          if(finale){ this._ending(); } else { this._maybeChapterIntro(); } };
      }});
  }
  // ---------- 结局演出（数据驱动，替代旧 n33 硬编码） ----------
  _ending(){
    AudioMgr.playBgm('bgm_spring'); AudioMgr.setWind(0);
    this._playDialogue({lines:Config.epilogue||[],kind:'story',sceneImg:'cg_spring.png',
      doneLabel:'制作名单',onDone:()=>this._credits()});
  }
  _credits(){
    const m=this.modal(`<div class="cdialog"><h3>冰霜物语 · 温暖长明</h3>
      <p style="line-height:2">玩法：原创 Merge-2 合并重建<br>美术 / 音乐：AI 原创生成<br>引擎：PixiJS WebGL · 独立 Gecko 内核<br><br>六种人间温度，合成一整个春天。<br>感谢你把霜语谷一点点合并回来 ❄️→🔥</p>
      <div class="cd-btns"><button class="cd-ok">继续游玩</button></div></div>`,true);
    m.querySelector('.cd-ok').onclick=()=>this.closeModal();
  }

  // ---------- 山谷手账（世界观 / 回忆 / 角色羁绊） ----------
  _journalHTML(){
    const s=this.s, done=id=>s.isNodeDone(id);
    const bond=s.bondByNpc();
    // 序章
    const seenIntro=s.storyDone.length>0;
    let html=`<div class="jr-sec"><div class="jr-h">📖 故事缘起</div>
      <div class="jr-card ${seenIntro?'':'locked'}">${seenIntro?Config.prologue.map(l=>`<p>${l[1]}</p>`).join(''):'<p class="jr-lock">完成第一处重建后解锁</p>'}</div></div>`;
    // 角色羁绊
    html+=`<div class="jr-sec"><div class="jr-h">🧑‍🤝‍🧑 山谷伙伴</div><div class="jr-bonds">`+
      Config.npcs.map(n=>{ const v=bond[n.id]||0; const hearts='❤'.repeat(Math.min(5,Math.ceil(v/2)))+'♡'.repeat(5-Math.min(5,Math.ceil(v/2)));
        return `<div class="jr-npc ${v?'':'locked'}"><img src="assets/img/${n.img}"><b>${n.name}</b><span>${n.title}</span><small>${v?hearts:'尚未相识'}</small></div>`; }).join('')+`</div></div>`;
    // 每章：世界观词条 + 节点回忆
    for(const ch of Config.story){ const started=ch.nodes.some(n=>done(n.id));
      html+=`<div class="jr-sec"><div class="jr-h">${ch.title}</div>`;
      for(const w of (ch.worldLore||[])) html+=`<div class="jr-card ${started?'':'locked'}">${started?`<b>${w.title}</b><p>${w.text}</p>`:'<p class="jr-lock">章节开启后解锁</p>'}</div>`;
      for(const n of ch.nodes){ const isDone=done(n.id);
        const picked=s.storyChoice(n);
        html+=`<div class="jr-card mem ${isDone?'':'locked'}">${isDone
          ?`<b>${n.name}</b><p>${n.lore?n.lore.text:''}</p>${picked?`<div class="jr-choice">${picked.icon} 你的布置 · ${esc(picked.name)}</div>`:''}<small>${(n.dialogue||[]).filter(l=>l[0]!=='narrator'&&l[0]!=='all').map(l=>this._npcOf(l[0]).name).join(' · ')}</small>`
          :`<p class="jr-lock">🔒 尚未经历：${n.name}</p>`}</div>`; }
      html+=`</div>`; }
    return html;
  }
  _rules(){
    const m=this.modal(`<div class="m-head"><div class="m-title">📘 玩法规则</div><button class="m-close">✕</button></div>
      <div class="m-body">
        <div class="rules-loop">
          <div class="rules-step"><i>🏭</i><span>点生成器</span></div><div class="rules-step"><i>✨</i><span>两两合并</span></div>
          <div class="rules-step"><i>📦</i><span>交付订单</span></div><div class="rules-step"><i>🪙</i><span>升级扩格</span></div>
          <div class="rules-step"><i>🏘️</i><span>剧情重建</span></div>
        </div>
        <div class="rules-list">
          <p><b>合并：</b>两个同族、同等级物品拖到一起，升级为下一阶；不同物品拖拽可换位。</p>
          <p><b>生成：</b>点生成器消耗体力；连续使用后会短暂充能，体力离线也会恢复。</p>
          <p><b>村民请求：</b>先打开任务架听村民说明来意；只有回应“我来帮你”后，请求才进入进行中。凑齐材料交付，会听到角色后续。</p>
          <p><b>棋盘：</b>点带锁雪花可花金币融化；霜泡可直接点破，宝箱到时后点开。</p>
          <p><b>目标：</b>从任务架打开「重建主线」，或进入「山谷」交付指定材料，依次推进 6 章共 24 个剧情节点，唤醒霜心、迎回春天。手账会记录世界观与每个人的故事。</p>
        </div>
        <button class="set-help" data-ok>知道了，开始合并</button>
      </div>`);
    const close=()=>{this.closeModal();requestAnimationFrame(()=>this._tutorial());};
    m.querySelector('.m-close').onclick=close; m.querySelector('[data-ok]').onclick=close;
  }
  welcome(){
    const lines=Config.prologue.length?Config.prologue:[['choco','十年暴风雪冰封了霜语谷，跟着我把温暖一点点拼回来吧。']];
    const gate=this.modal(`<div class="welcome-gate"><img src="assets/img/title_keyart.png" alt="风雪中的霜语谷">
      <div class="welcome-gate-veil"></div><div class="welcome-gate-copy"><small>序章 · 风灯归乡</small>
      <h2>雪里，有人在等这盏灯</h2><p>戴上耳机，点亮祖父留下的风灯。</p>
      <button class="welcome-start" type="button">🏮 点亮风灯</button></div></div>`,true);
    gate.querySelector('.welcome-start').onclick=()=>{
      // 剧情转场不能等待 GeckoView 的 AudioContext/解码链路；首句 HTMLAudio
      // 会在这次点击手势内直接起播，WebAudio/SFX 则继续异步解锁和预热。
      void AudioMgr.unlock(); this.closeModal();
      this._playDialogue({lines,kind:'welcome',sceneImg:'title_keyart.png',doneLabel:'跟啾可进谷',onDone:()=>{
        this.s.markChapterSeen(1); const ch=Config.story[0]; if(ch) this._applyMood(ch); requestAnimationFrame(()=>this._tutorial());
      }});
    };
  }

  // ---------- toast ----------
  toast(msg){
    const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
    this.el.toastLayer.appendChild(t); setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),320);},1700);
  }
}
