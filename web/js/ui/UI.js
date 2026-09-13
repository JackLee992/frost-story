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
  constructor(state, scene){ this.s=state; this.scene=scene; this.el={}; this._cacheDom(); this._localizeShell(); this._bind(); this._listen(); }
  _cacheDom(){
    ['levelBadge','xpBar','energyVal','energyTimer','coinVal','gemVal','warmthVal','taskShelf','ordersToggle','questToggle','orders','hint','guideLayer','modalLayer','toastLayer','itemPop','ipName','ipSub','ipPrice','ipSell','energyPlus','sbFab','quest','companion'].forEach(id=>this.el[id]=$('#'+id));
  }
  t(key,vars={}){ return Config.t(key,vars); }
  _voice(voiceId){ return Config.voiceUrl(voiceId,this.s.settings.voiceLanguage); }
  _localizeShell(){
    document.documentElement.lang={en:'en',ja:'ja',ko:'ko','zh-CN':'zh-CN'}[Config.locale]||'zh-CN';
    // meta.title 已经是各语言完整品牌名；再次拼接英文会让英文标题重复，
    // 中文标题也会在启动完成后从本地化标题退回双语旧标题。
    document.title=this.t('meta.title');
    const panels={shop:'shell.shop',book:'shell.book',story:'shell.valley',settings:'shell.settings'};
    for(const button of document.querySelectorAll('.dock-btn')) button.innerHTML=`<span class="d-ic">${{shop:'🛒',book:'📖',story:'🏘️',settings:'⚙️'}[button.dataset.panel]}</span>${this.t(panels[button.dataset.panel])}`;
    this.el.orders?.setAttribute('aria-label',this.t('shell.orders')); this.el.quest?.setAttribute('aria-label',this.t('shell.mainQuest'));
    this.el.sbFab?.setAttribute('aria-label',this.t('shell.sandbox')); const fabText=this.el.sbFab?.querySelector('span'); if(fabText) fabText.textContent=this.t('shell.sandbox');
    const sell=$('#ipSell'); if(sell) sell.childNodes[0].textContent=this.t('items.sell')+' ';
    const title=$('.game-title'),sub=$('.game-sub'); if(title) title.textContent=this.t('meta.title'); if(sub) sub.textContent=`FROST STORY · ${this.t('meta.subtitle')}`;
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
    // 所有缺料标记都能直接解释“从哪里来、怎么合”，不要求玩家先学会读配置或猜商店。
    document.addEventListener('click',e=>{ const target=e.target.closest('[data-material-help]'); if(!target) return;
      e.preventDefault(); e.stopPropagation();
      this._materialGuide(target.dataset.fam,Number(target.dataset.tier),Number(target.dataset.count));
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
      if(p?.type==='merge'&&p.levelUps?.length){ this._levelUp(p.levelUps); this.scene.celebrate?.(); Haptics.level(); }
      if(p?.type==='storyBuilt'){ this.scene.celebrate?.(); Haptics.unlock();
        this._storyBeat(p.chapter,p.node,()=>this._storyDialog(p.chapter,p.node,{levelUps:p.levelUps||[]})); }
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
    if(!sb) this.el.energyTimer.textContent=s.freeTaps>0?this.t('hud.afterglow',{count:s.freeTaps})
      :(s.energy>=Config.energyMax(s.lv)?this.t('hud.full'):fmt(s.secToNextEnergy()));
    document.body.classList.toggle('sandbox-on',sb);
  }
  _tick(){ if(this.s.energyTick()) this.renderHUD();
    if(this.s.sandbox){ this.el.energyTimer.textContent='∞'; return; }
    if(this.s.freeTaps>0){ this.el.energyTimer.textContent=this.t('hud.afterglow',{count:this.s.freeTaps}); return; }
    const t=this.s.secToNextEnergy(); this.el.energyTimer.textContent=(this.s.energy>=Config.energyMax(this.s.lv))?this.t('hud.full'):fmt(t);
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
    const badge=pending?this.t('orders.requests',{count:pending}):ready?this.t('orders.ready',{count:ready}):active?this.t('orders.active',{count:active}):this.t('orders.none');
    this.el.ordersToggle.innerHTML=`<span><i>✉️</i><b>${this.t('shell.orders')}</b></span><em>${badge}</em><i class="task-chevron">⌄</i>`;
    this.el.ordersToggle.setAttribute('aria-expanded',String(!collapsed));
    this.el.ordersToggle.onclick=()=>this._toggleTask('orders');
    box.innerHTML='<div class="order-list"></div>';
    const list=box.querySelector('.order-list');
    this.s.orders.forEach((o,slot)=>{
      const npc=Config.npcById(o.npcId), have=this.s.orderHave(o), ready=this.s.orderReady(o);
      const card=document.createElement('article'); card.className='order-card'+(ready?' ready':'')+(o.accepted?' accepted':' pending');
      card.innerHTML=`<div class="oc-top">
          <img class="oc-avatar" src="${npcImg(npc)}" alt="${esc(npc.name)}"/>
          <div class="oc-who"><b>${esc(npc.name)}</b><br><span>${o.accepted?this.t('orders.waiting'):esc(this.t('orders.visiting',{title:npc.title}))}</span></div>
        </div>
        ${o.accepted?'':`<p class="oc-teaser">“${esc(npc.request)}”</p>`}
        <div class="oc-need">${o.needs.map(q=>this._materialChip(q)).join('')}</div>
        ${o.accepted
          ?`<button class="oc-submit ${ready?'on':''}">${ready?this.t('orders.give',{name:esc(npc.name)}):this.t('orders.prepare')} · ${o.coin}${this.t('common.coin')}${o.gem?` · ${o.gem}${this.t('common.gem')}`:''}</button>`
          :`<div class="oc-actions"><button class="oc-request" type="button">${this.t('orders.listen')}</button><button class="oc-refresh" type="button">${this.t('orders.refresh',{cost:this.s.refreshCost})}</button></div>`}`;
      const submit=card.querySelector('.oc-submit');
      if(submit) submit.onclick=()=>{ if(!ready){this.toast(this.t('orders.stillNeeds',{name:npc.name}));return;}
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
    const needs=order.needs.map(q=>this._materialChip(q,true)).join('');
    const m=this.modal(`<div class="order-request">
      <div class="order-request-scene" style="background-image:url(assets/img/story_1.png)">
        <div class="order-request-frost"></div><img src="${npcImg(npc)}" alt="${esc(npc.name)}">
        <div><small>${esc(this.t('orders.arrived',{title:npc.title}))}</small><h3>${esc(npc.name)}</h3></div>
      </div>
      <div class="order-request-body"><p class="order-arrival">${esc(npc.arrival)}</p>
        <blockquote>“${esc(npc.request)}”</blockquote>
        <div class="order-request-needs"><b>${this.t('orders.needs')}</b><div>${needs}</div></div>
        <div class="cd-btns"><button class="cd-no" data-later type="button">${this.t('orders.saveForLater')}</button><button class="cd-ok" data-accept-order type="button">${this.t('orders.accept')}</button></div>
      </div></div>`,true);
    AudioMgr.playVoiceSequence([this._voice(npc.voiceArrivalId),this._voice(npc.voiceRequestId)]);
    m.querySelector('[data-later]').onclick=()=>this.closeModal();
    const accept=m.querySelector('[data-accept-order]');
    accept.onclick=()=>runActionOnce(accept,()=>this.s.acceptOrder(slot),()=>{
      this.s.settings.ordersCollapsed=false; this.s.settings.questCollapsed=true; Save.saveNow(this.s);
      this.closeModal(); this.renderOrders(); this.renderQuest();
      this._chocoSay(Config.companion?.orders?.accepted,3000,true,{npcName:npc.name});
      requestAnimationFrame(()=>this._tutorial());
    });
  }
  _orderThanks(npc){
    this._playDialogue({
      ch:{title:this.t('orders.responseTitle',{name:npc.name}),subtitle:this.t('orders.responsePlace'),scene:'story_1.png',hook:this.t('orders.responseHook')},
      lines:[[npc.id,npc.thanks,{voiceId:npc.voiceThanksId}],['choco',Config.companion?.orders?.followup?.text||'',{voiceId:Config.companion?.orders?.followup?.voiceId}]],
      kind:'request',doneLabel:this.t('orders.backToBoard'),onDone:()=>requestAnimationFrame(()=>this._tutorial())
    });
  }
  // ---------- 物品气泡 ----------
  showPop(p){ const c=this.s.cells[p.idx]; if(!c||c.k!=='i') return; this._selIdx=p.idx;
    const fam=Config.families[c.fam], price=Config.sellPrice(c.tier);
    this.el.ipName.textContent=`${fam.tiers[c.tier-1]}`;
    this.el.ipSub.textContent=this.t('items.chainLevel',{family:fam.name,level:c.tier});
    this.el.ipPrice.textContent=this.t('items.price',{price});
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
  _tutorial(){
    const t=this.s.tutorial, layer=this.el.guideLayer, comp=this.el.companion;
    if(!comp) return;
    // 弹层是当前唯一的阻塞交互面。序章结束、resize 或状态事件可能已经排队
    // 了一次教学刷新；它们在 modal 存在时必须停止，不能重新取消 busy 而叠到弹层下。
    if(this._modal){ this._hideGuide(); comp.classList.add('busy'); return; }
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
    const previous=this._compStep,changed=previous!==step.id;
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
    const cue=Config.companion?.tutorial?.[step.id];
    const reaction=previous&&changed?Config.companion?.reactions?.[previous]:null;
    clearTimeout(this._guideCueTimer);
    if(reaction){
      this._chocoSay(reaction,1800,true);
      this._guideCueTimer=setTimeout(()=>{ if(this._compStep===step.id&&!this._modal) this._companionActive(cue,true); },1500);
    }else this._companionActive(cue,changed);
  }
  _cueText(cue,vars={}){ const line=cue&&typeof cue==='object'?cue:{text:String(cue||'')};
    return Object.entries(vars).reduce((text,[key,value])=>text.replaceAll(`{{${key}}}`,String(value??'')),line.text||''); }
  _companionActive(cue,play=false){ const comp=this.el.companion; if(!comp) return;
    const line=this._cueText(cue);
    comp.classList.remove('hidden','idle','busy'); comp.classList.add('teaching');
    comp.querySelector('.comp-say').textContent=line;
    comp.querySelector('.comp-who').textContent=this.t('profile.role');
    const skip=comp.querySelector('.comp-skip'); skip.style.display='';
    skip.onclick=()=>{ this.s.tutorial.skipped=true; this.s.tutorial.done=true; Save.saveNow(this.s);
      this._hideGuide(); this._companionIdle(); this.toast(this.t('valley.tutorialDone')); };
    if(play&&cue?.voiceId) AudioMgr.playVoice(this._voice(cue.voiceId));
    comp.querySelector('.comp-avatar').onclick=()=>this._chocoSay(cue,3000);
  }
  // 教学后：陪伴角色常驻，点击讲当前主线（故事驱动），主线可交付时冒小光点
  _companionIdle(){ const comp=this.el.companion; if(!comp) return;
    comp.classList.remove('teaching'); comp.classList.add('idle');
    comp.classList.remove('hidden');
    comp.querySelector('.comp-skip').style.display='none';
    comp.querySelector('.comp-who').textContent=this.t('profile.role');
    const obj=this.s.currentObjective();
    comp.classList.toggle('ping', !!obj && this.s.nodeState(obj.node,obj.chapter)==='ready');
    comp.querySelector('.comp-avatar').onclick=()=>{
      AudioMgr.play('chime');
      const o=this.s.currentObjective();
      if(!o){ this._chocoSay(Config.companion?.idle?.complete,3200); return; }
      const st=this.s.nodeState(o.node,o.chapter);
      if(st==='ready') this._chocoSay(Config.companion?.idle?.ready,3200,false,{nodeName:o.node.name});
      else if(st==='lack'){ const q=o.node.need.find(need=>this.s.countItem(need.fam,need.tier)<need.n)||o.node.need[0];
        const source=this.s.materialSource(q.fam,q.tier,q.n);
        this._chocoSay(Config.companion?.idle?.lack,4300,false,{nodeName:o.node.name,itemName:source.itemName,generatorName:source.generatorName}); }
      else if(st==='lvlock') this._chocoSay(Config.companion?.idle?.lvlock,3200,false,{level:o.node.unlockLv||o.chapter.unlockLv});
      else this._chocoSay(Config.companion?.idle?.next,3000,false,{nodeName:o.node.name});
    };
    if(!comp.classList.contains('speaking')) comp.querySelector('.comp-say').textContent='';
  }
  _chocoSay(cue,ms=2400,react=false,vars={}){ const comp=this.el.companion; if(!comp) return;
    const meta=cue&&typeof cue==='object'?cue:{text:String(cue||'')},text=this._cueText(meta,vars);
    comp.classList.remove('hidden','idle'); comp.classList.add('speaking');
    comp.classList.toggle('react',react);
    comp.querySelector('.comp-say').textContent=text;
    if(meta.voiceId) AudioMgr.playVoice(this._voice(meta.voiceId));
    clearTimeout(this._compTimer);
    this._compTimer=setTimeout(()=>{ comp.classList.remove('speaking','react');
      if(this.s.tutorial.done||this.s.tutorial.skipped) this._companionIdle(); },ms);
  }

  // ---------- 弹窗框架 ----------
  modal(html, center=false){ this.closeModal(false); this._hideGuide();
    const t=html.trimStart();
    // 专用对话框可带 modifier class（如 `cdialog level-rush`）；宿主仍应透明，
    // 否则宿主卡片与内层卡片会同时绘制，视觉上像多个弹窗叠放。
    const bare=['dlg','cdialog','cine','story-stage','story-act','profile-story']
      .some(name=>t.startsWith(`<div class="${name}`));
    const mask=document.createElement('div'); mask.className='modal-mask';
    mask.innerHTML=`<div class="modal ${center?'center':''} ${bare?'bare':''}">${html}</div>`;
    mask.onclick=e=>{ if(e.target===mask) this.closeModal(); };
    this.el.modalLayer.appendChild(mask); this._modal=mask;
    this.el.companion?.classList.add('busy');
    AudioMgr.play('click'); return mask;
  }
  closeModal(resumeTutorial=true){ clearTimeout(this._dialogTimer); this._dialogTimer=0; AudioMgr.stopVoice();
    this._modal?.remove(); this._modal=null;
    this.el.companion?.classList.remove('busy');
    if(resumeTutorial&&!this.s.tutorial.done&&!this.s.tutorial.skipped)
      requestAnimationFrame(()=>{ if(!this._modal) this._tutorial(); }); }
  openPanel(name){
    if(name==='shop') return this._shop();
    if(name==='book') return this._book();
    if(name==='story') return this._story();
    if(name==='settings') return this._settings();
  }

  _shop(focusGen=null){
    const s=this.s, free=s.sandbox;
    if(!s.tutorial.done&&s.tutorial.unlocked&&!s.tutorial.shopped){
      s.tutorial.shopped=true; Save.saveNow(s); requestAnimationFrame(()=>this._tutorial());
    }
    const body=()=>{
      const chestRows=Config.shop.chests.map(c=>{
        const locked=s.lv<c.unlockLv;
        return `<div class="goods-row"><div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(160deg,${c.color},#8a5a22);display:grid;place-items:center;font-size:24px">🎁</div>
          <div class="goods-info"><b>${c.name}</b><p>${this.t('shop.chestDesc',{count:c.drop.count,min:c.drop.tierMin,max:c.drop.tierMax,seconds:c.openSec,lock:locked?this.t('shop.unlockAt',{level:c.unlockLv}):''})}</p></div>
          <button class="buy-btn gold" data-chest="${c.id}" ${locked?'disabled':''}>${locked?this.t('common.locked'):(free?this.t('common.free'):c.price+' '+this.t('common.coin'))}</button></div>`; }).join('');
      const genRows=Config.shop.generators.map(e=>{
        const g=Config.genById(e.id), bought=s.boughtGens.includes(e.id)||s.ownedGens.includes(e.id), locked=s.lv<e.unlockLv;
        return `<div class="goods-row ${focusGen===e.id?'source-focus':''}" data-goods-generator="${e.id}"><img src="assets/img/${g.img}">
          <div class="goods-info"><b>${g.name}</b><p>${this.t('shop.makeFamily',{family:Config.families[g.family].name,lock:locked?this.t('shop.unlockAt',{level:e.unlockLv}):''})}</p></div>
          <button class="buy-btn" data-gen="${e.id}" ${bought||locked?'disabled':''}>${bought?this.t('common.owned'):locked?this.t('common.locked'):(free?this.t('common.free'):e.price+' '+this.t('common.coin'))}</button></div>`; }).join('');
      return `<div class="shop-sec-t">${this.t('shop.energy')}</div>
        <div class="goods"><div class="goods-row"><div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(160deg,#ffd28a,#f09a36);display:grid;place-items:center;font-size:24px">⚡</div>
          <div class="goods-info"><b>${this.t('shop.energyBottle')}</b><p>${this.t('shop.energyDesc',{max:Config.energyMax(s.lv)})}</p></div>
          <button class="buy-btn" data-energy>${free?this.t('common.free'):Config.shop.energyPotion.gem+' '+this.t('common.gem')}</button></div></div>
        <div class="shop-sec-t">${this.t('shop.chests')}</div><div class="goods">${chestRows}</div>
        <div class="shop-sec-t">${this.t('shop.workbenches')}</div><div class="goods">${genRows}</div>`;
    };
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('shop.title')}${free?' · '+this.t('shop.playMode'):''}</div><button class="m-close">✕</button></div><div class="m-body"></div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    const bind=()=>{
      m.querySelectorAll('[data-chest]').forEach(b=>b.onclick=()=>runActionOnce(b,()=>s.buyChest(b.dataset.chest),render));
      m.querySelectorAll('[data-gen]').forEach(b=>b.onclick=()=>runActionOnce(b,()=>s.buyGenerator(b.dataset.gen),render));
      const energy=m.querySelector('[data-energy]');
      if(energy) energy.onclick=()=>runActionOnce(energy,()=>s.buyEnergyPotion(),render);
      const focused=focusGen&&m.querySelector(`[data-goods-generator="${focusGen}"]`);
      if(focused) requestAnimationFrame(()=>focused.scrollIntoView?.({block:'center',behavior:'smooth'}));
    };
    const render=()=>refreshScrollable(m,body(),bind);
    render();
  }

  _book(){
    const s=this.s;
    const html=Config.famList.map(fam=>{ const f=Config.families[fam];
      const cells=f.tiers.map((name,t)=>{ const k=`${fam}_${t+1}`, n=s.hb[k]||0;
        return `<div class="book-cell ${n?'seen':'unseen'}"><img src="${itemImg(fam,t+1)}">${n?`<span class="bc-own">×${n}</span>`:''}<div class="bc-name">${n?name:'？？？'}</div></div>`; }).join('');
      return `<div class="book-fam" style="--fc:${f.color}"><h4>${f.name}</h4><div class="book-grid">${cells}</div></div>`; }).join('');
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('shell.book')}</div><button class="m-close">✕</button></div><div class="m-body">${html}</div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
  }

  _story(tab='build'){
    const s=this.s;
    if(!s.tutorial.done&&s.tutorial.shopped){
      s.tutorial.storyOpened=true; s.tutorial.done=true; Save.saveNow(s); this._hideGuide();
      setTimeout(()=>this.toast(this.t('valley.tutorialDone')),120);
    }
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('valley.title')}</div><button class="m-close">✕</button></div>
      <div class="story-tabs">
        <button data-tab="build" class="${tab==='build'?'on':''}">${this.t('valley.mainQuest')}</button>
        <button data-tab="journal" class="${tab==='journal'?'on':''}">${this.t('valley.journal')}</button>
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
  _materialChip(q,withName=false){ const have=this.s.countItem(q.fam,q.tier),ok=have>=q.n,name=Config.itemName(q.fam,q.tier);
    return `<button type="button" class="need-chip material-help ${ok?'ok':'lack'}" data-material-help data-fam="${q.fam}"
      data-tier="${q.tier}" data-count="${q.n}" aria-label="${esc(this.t('items.how',{name}))}"><img src="${itemImg(q.fam,q.tier)}">${withName?`<b>${esc(name)}</b>`:''}<span class="have">${have}/${q.n}</span></button>`; }
  _needChips(node){ return node.need.map(q=>this._materialChip(q)).join('')
      +` <span class="coin-need ${this.s.canPayCoin(node.coin)?'':'lack'}">🪙 ${node.coin}</span>`; }
  _sourceAction(source){
    const chain=source.nextPair?.length===2?`<button class="source-primary" type="button" data-locate-chain="${source.fam}" data-chain-tier="${source.tier}">${this.t('source.startPair')}</button>`:'';
    if(source.generatorIndex>=0) return `${chain}<button class="${chain?'source-secondary':'source-primary'}" type="button" data-locate-generator="${source.generatorId}">${chain?this.t('source.findWorkbench'):this.t('source.findOnBoard')}</button>`;
    if(source.owned) return `<button class="source-primary" type="button" data-place-generator="${source.generatorId}">${this.t('source.placeWorkbench')}</button>`;
    if(source.locked) return `<button class="source-locked" type="button" disabled>${this.t('common.level',{level:source.unlockLv})}</button>`;
    return `<button class="source-primary" type="button" data-shop-generator="${source.generatorId}">${this.t('source.shopWorkbench')}</button>`;
  }
  _sourceCard(q){ const source=this.s.materialSource(q.fam,q.tier,q.n),have=this.s.countItem(q.fam,q.tier);
    if(!source) return '';
    const state=source.boardCanCraft?this.t('source.readyChain')
      :have>=q.n?this.t('source.materialsReady')
      :source.generatorIndex>=0?this.t('source.tapAndMerge',{name:source.generatorName})
      :source.owned?this.t('source.ownedOffBoard')
      :source.locked?this.t('source.lockedUntil',{level:source.unlockLv})
      :this.t('source.availableInShop',{name:source.generatorName});
    return `<article class="source-card" data-source-family="${source.fam}">
      <div class="source-target"><img src="${itemImg(source.fam,source.tier)}"><div><small>${esc(source.familyName)} · ${this.t('source.missing',{count:Math.max(0,q.n-have)})}</small><b>${esc(source.itemName)} ×${q.n}</b></div></div>
      <div class="source-origin"><img src="assets/img/${Config.genById(source.generatorId).img}"><span>${this.t('source.from')}</span><b>${esc(source.generatorName)}</b></div>
      <div class="source-path" aria-label="${this.t('source.path')}"><span>${source.path.map(name=>esc(name)).join(' → ')}</span></div>
      <p class="source-state ${source.boardCanCraft?'ready':''}">${source.boardCanCraft?'✨':'💡'} ${esc(state)} · ${this.t('source.fromScratch',{count:source.baseNeeded})}</p>
      <div class="source-actions">${this._sourceAction(source)}</div></article>`;
  }
  _bindSourceActions(scope){
    scope.querySelectorAll('[data-locate-chain]').forEach(button=>button.onclick=()=>this._focusMergeChain(button.dataset.locateChain,Number(button.dataset.chainTier)));
    scope.querySelectorAll('[data-locate-generator]').forEach(button=>button.onclick=()=>this._focusMaterialSource(button.dataset.locateGenerator));
    scope.querySelectorAll('[data-shop-generator]').forEach(button=>button.onclick=()=>this._shop(button.dataset.shopGenerator));
    scope.querySelectorAll('[data-place-generator]').forEach(button=>button.onclick=()=>{
      const gid=button.dataset.placeGenerator; this.closeModal(false); const result=this.s.placeOwnedGenerator(gid);
      if(result?.ok) this._focusMaterialSource(gid);
    });
    scope.querySelectorAll('[data-open-orders]').forEach(button=>button.onclick=()=>{ this.closeModal();
      this.s.settings.ordersCollapsed=false; this.s.settings.questCollapsed=true; Save.saveNow(this.s); this.renderOrders(); this.renderQuest(); });
  }
  _materialGuide(fam,tier,count=1){ const q={fam,tier:Number(tier)||1,n:Number(count)||1},source=this.s.materialSource(q.fam,q.tier,q.n);
    if(!source){ this.toast(this.t('source.noSource')); return; }
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('source.title',{item:esc(source.itemName)})}</div><button class="m-close">✕</button></div>
      <div class="m-body material-guide"><p class="guide-lead">${this.t('source.lead')}</p>
        ${this._sourceCard(q)}</div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal(); this._bindSourceActions(m);
  }
  _objectiveGuide(ch,node){
    const missing=node.need.filter(q=>this.s.countItem(q.fam,q.tier)<q.n);
    const cards=(missing.length?missing:node.need).map(q=>this._sourceCard(q)).join('');
    const levelNeed=node.unlockLv||ch.unlockLv,lvLocked=this.s.lv<levelNeed;
    const coinHelp=!this.s.canPayCoin(node.coin)?`<div class="source-money"><span>🪙 ${this.t('source.needCoins',{count:Math.max(0,node.coin-this.s.coin)})}</span><button type="button" data-open-orders>${this.t('source.hearRequests')}</button></div>`:'';
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('source.next',{name:esc(node.name)})}</div><button class="m-close">✕</button></div>
      <div class="m-body objective-guide"><div class="objective-guide-head" style="background-image:url(assets/img/${ch.scene})">
        <small>${esc(ch.title)}</small><h3>${esc(node.name)}</h3><p>${esc(node.place||'')}</p></div>
        ${lvLocked?`<div class="source-level">⭐ ${this.t('source.needLevel',{level:levelNeed})}</div>`:''}${cards}${coinHelp}</div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal(); this._bindSourceActions(m);
  }
  _focusMaterialSource(gid){
    this.closeModal(false); const generator=Config.genById(gid); if(!generator) return;
    let idx=this.s.cells.findIndex(cell=>cell?.k==='g'&&cell.gid===gid);
    if(idx<0&&this.s.ownedGens.includes(gid)){ const placed=this.s.placeOwnedGenerator(gid); if(placed?.ok) idx=placed.idx; }
    if(idx<0){ this.toast(this.t('source.noWorkbench',{name:generator.name})); return; }
    const layer=this.el.guideLayer,app=$('#app').getBoundingClientRect(),rect=this._cellRect(idx),margin=8;
    layer.classList.remove('hidden'); layer.dataset.step='source';
    layer.innerHTML='<div class="guide-focus source-guide-focus"></div><div class="guide-hand tap" aria-hidden="true">☝️</div>';
    const local={left:rect.left-app.left-margin,top:rect.top-app.top-margin,width:rect.width+margin*2,height:rect.height+margin*2};
    Object.assign(layer.querySelector('.guide-focus').style,{left:local.left+'px',top:local.top+'px',width:local.width+'px',height:local.height+'px'});
    Object.assign(layer.querySelector('.guide-hand').style,{left:(local.left+local.width*.58)+'px',top:(local.top+local.height*.46)+'px'});
    this.scene.ring?.(this.scene.center(idx),'#ffd76a'); this.scene.popNode?.(this.s.cells[idx].uid);
    this.el.companion?.classList.remove('teaching','idle');
    this._chocoSay(Config.companion?.source?.generator,4200,true,{generatorName:generator.name,
      baseItem:Config.families[generator.family].tiers[0]});
    clearTimeout(this._sourceGuideTimer); this._sourceGuideTimer=setTimeout(()=>{
      if(layer.dataset.step==='source'){ this._hideGuide(); requestAnimationFrame(()=>this._tutorial()); }
    },4200);
  }
  _focusMergeChain(fam,targetTier){
    const source=this.s.materialSource(fam,targetTier,1),pair=source?.nextPair||[]; if(pair.length<2){ this._materialGuide(fam,targetTier,1); return; }
    this.closeModal(false); const layer=this.el.guideLayer,app=$('#app').getBoundingClientRect(),rect=this._cellRect(pair),margin=8;
    layer.classList.remove('hidden'); layer.dataset.step='source';
    layer.innerHTML='<div class="guide-focus source-guide-focus"></div><div class="guide-hand drag" aria-hidden="true">☝️</div>';
    const local={left:rect.left-app.left-margin,top:rect.top-app.top-margin,width:rect.width+margin*2,height:rect.height+margin*2};
    Object.assign(layer.querySelector('.guide-focus').style,{left:local.left+'px',top:local.top+'px',width:local.width+'px',height:local.height+'px'});
    const from=this.scene.center(pair[0]),to=this.scene.center(pair[1]),hand=layer.querySelector('.guide-hand');
    Object.assign(hand.style,{left:(from.x-app.left-10)+'px',top:(from.y-app.top-4)+'px','--guide-dx':(to.x-from.x)+'px','--guide-dy':(to.y-from.y)+'px'});
    pair.forEach(idx=>this.scene.ring?.(this.scene.center(idx),'#ffd76a'));
    const current=Config.itemName(fam,this.s.cells[pair[0]].tier),target=Config.itemName(fam,targetTier);
    this.el.companion?.classList.remove('teaching','idle');
    this._chocoSay(Config.companion?.source?.merge,4200,true,{currentItem:current,targetItem:target});
    clearTimeout(this._sourceGuideTimer); this._sourceGuideTimer=setTimeout(()=>{
      if(layer.dataset.step==='source'){ this._hideGuide(); requestAnimationFrame(()=>this._tutorial()); }
    },4200);
  }
  _storyBuildHTML(){
    const s=this.s;
    return Config.story.map(ch=>{
      const prog=Config.chapterProgress(ch,s.storyDone), reachable=s.chapterReachable(ch), lvLocked=s.lv<ch.unlockLv;
      const locked=!reachable;
      const nodes=ch.nodes.map(n=>{
        const st=s.nodeState(n,ch), done=st==='done';
        const picked=s.storyChoice(n);
        const btn = done?`<button class="sn-go gray">${this.t('quest.lookBack')}</button>`
          : st==='ready'?`<button class="sn-go" data-build="${n.id}">${this.t('quest.repair')}</button>`
          : st==='lvlock'?`<button class="sn-go gray">Lv.${n.unlockLv||ch.unlockLv}</button>`
          : st==='locked'?`<button class="sn-go gray">${this.t('common.locked')}</button>`
          : `<button class="sn-go" data-build="${n.id}">${this.t('quest.findMaterials')}</button>`;
        return `<div class="story-node ${done?'done':''} ${st==='ready'?'ready':''}">
          <div class="sn-ic">${done?'📖':'🏗️'}</div>
          <div class="sn-info"><b>${n.name}</b><div class="sn-place">${n.place||''}</div>
          ${picked?`<div class="sn-picked">${this.t('journal.yourChoice',{icon:picked.icon,name:esc(picked.name)})}</div>`:''}
          <div class="needline">${this._needChips(n)}</div></div>${btn}</div>`; }).join('');
      const lockMask=locked?`<div class="sc-lock">🔒 ${this.t('quest.completePrevious')}</div>`
        :lvLocked?`<div class="sc-lock">${this.t('quest.openAt',{level:ch.unlockLv,done:prog.got,total:prog.total})}</div>`
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
    if(st==='locked'){ this.toast(this.t('quest.previousFirst')); return; }
    if(st==='lvlock'){ this._objectiveGuide(ch,node); return; }
    const doBuild=()=>{ this.closeModal();
      if(!s.buildNode(ch,node)) return; /* buildNode 会经 changed 触发 _storyDialog 回报对白 */ };
    if(st==='lack'){ this._objectiveGuide(ch,node); return; }
    if(Array.isArray(node.pre)&&node.pre.length){ this._preDialog(ch,node,doBuild); } else doBuild();
  }
  // 交付前：村民的请求（驱动玩家去合成）
  _preDialog(ch,node,onConfirm){
    this._playDialogue({ch,node,lines:node.pre||[],kind:'request',sceneImg:ch.scene,
      doneLabel:this.t('quest.viewList'),onDone:()=>{
      const m=this.modal(`<div class="cdialog"><div class="big-ic">🏗️</div><h3>${this.t('quest.handoverTitle',{name:node.name})}</h3>
        <p>${this.t('quest.handoverDesc')}</p>
        <div class="needline" style="justify-content:center;margin-bottom:14px">${this._needChips(node)}</div>
        <div class="cd-btns"><button class="cd-no" data-n>${this.t('quest.prepareMore')}</button><button class="cd-ok" data-y>${this.t('quest.confirm')}</button></div></div>`,true);
      m.querySelector('[data-n]').onclick=()=>this.closeModal();
      m.querySelector('[data-y]').onclick=()=>onConfirm();
    }});
  }
  _npcOf(who){ return Config.npcs.find(n=>n.id===who)||{
    name:who==='all'?this.t('dialogue.everyone'):who==='narrator'?this.t('dialogue.journal'):who, img:who==='gramps'?'npc_gramps.png':'npc_sprite.png'}; }

  // ---------- 任务架中的主线（默认收起，玩家需要时展开） ----------
  renderQuest(){ const box=this.el.quest; if(!box) return; const s=this.s, obj=s.currentObjective();
    if(!obj){ box.classList.add('hidden','collapsed'); this.el.questToggle.classList.add('hidden'); this._syncTaskShelf(); return; }
    const {chapter:ch,node}=obj, st=s.nodeState(node,ch);
    const collapsed=!!s.settings.questCollapsed;
    box.classList.remove('hidden'); box.classList.toggle('collapsed',collapsed); box.classList.toggle('ready',st==='ready');
    this.el.questToggle.classList.remove('hidden');
    this.el.questToggle.innerHTML=`<span><i>${st==='ready'?'🔥':'📜'}</i><b>${this.t('shell.mainQuest')}</b></span><em>${esc(node.name)}</em><i class="task-chevron">⌄</i>`;
    this.el.questToggle.classList.toggle('ready',st==='ready');
    this.el.questToggle.setAttribute('aria-expanded',String(!collapsed));
    this.el.questToggle.onclick=()=>this._toggleTask('quest');
    box.innerHTML=`<img class="q-scene" src="assets/img/${ch.scene}">
      <div class="q-body"><div class="q-top"><span class="q-ch">${this.t('chapter.short',{number:ch.id})}</span>
        <span class="q-name">${node.name}</span></div>
        <div class="q-needs">${node.need.map(q=>this._materialChip(q)).join('')}
          <span class="need-chip ${s.canPayCoin(node.coin)?'ok':'lack'}">🪙${node.coin}</span></div></div>
      <button class="q-go">${st==='ready'?this.t('quest.repair'):st==='lack'?this.t('quest.findMaterials'):st==='lvlock'?this.t('quest.levelUp'):this.t('common.view')}</button>`;
    box.querySelector('.q-go').onclick=()=>{ s.settings.questCollapsed=true; Save.saveNow(s); this.renderQuest();
      if(st==='ready') this._tapStoryNode(ch,node); else if(st==='lack'||st==='lvlock') this._objectiveGuide(ch,node); else this._story(); };
    // 同步陪伴角色的"可交付"提示光点
    const comp=this.el.companion;
    if(comp&&comp.classList.contains('idle')) comp.classList.toggle('ping',st==='ready');
    this._syncTaskShelf();
  }

  _settings(){
    const s=this.s;
    const row=(k,label)=>`<div class="set-row"><span>${label}</span><div class="switch ${s.settings[k]?'on':''}" data-sw="${k}"><i></i></div></div>`;
    const languages=[['zh-CN','中文'],['en','English'],['ja','日本語'],['ko','한국어']];
    const options=value=>languages.map(([id,label])=>`<option value="${id}" ${value===id?'selected':''}>${label}</option>`).join('');
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('settings.title')}</div><button class="m-close">✕</button></div>
      <div class="m-body"><button class="profile-setting" data-profile-edit type="button"><span>${this.t('settings.player')}</span><b>${esc(s.playerName)} ›</b></button>
        <label class="set-row locale-row"><span>${this.t('settings.gameLanguage')}<small>${this.t('settings.gameLanguageHelp')}</small></span><select data-game-language>${options(s.settings.language)}</select></label>
        <label class="set-row locale-row"><span>${this.t('settings.voiceLanguage')}<small>${this.t('settings.voiceLanguageHelp')}</small></span><select data-voice-language>${options(s.settings.voiceLanguage)}</select></label>
        ${row('bgm',this.t('settings.bgm'))}${row('sfx',this.t('settings.sfx'))}${row('voice',this.t('settings.voice'))}
        <div class="set-row sandbox-row"><span>${this.t('settings.playMode')}<small style="display:block;color:#8a9bb0">${this.t('settings.playModeHelp')}</small></span><div class="switch ${s.sandbox?'on':''}" data-sandbox><i></i></div></div>
        <button class="set-help" data-rules>${this.t('settings.rules')}</button>
        <button class="set-danger">${this.t('settings.reset')}</button>
        <div class="set-about">${this.t('settings.about')}</div>
      </div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    m.querySelector('[data-profile-edit]').onclick=()=>this._profileNaming({editing:true});
    m.querySelector('[data-voice-language]').onchange=e=>{ if(s.setVoiceLanguage(e.target.value)?.ok) Save.saveNow(s); };
    m.querySelector('[data-game-language]').onchange=e=>{ const locale=e.target.value;
      if(!Config.supportedLocales.includes(locale)) return; s.settings.language=locale; Save.setLocale(locale); Save.saveNow(s); location.reload(); };
    m.querySelectorAll('[data-sw]').forEach(sw=>sw.onclick=()=>{ const k=sw.dataset.sw; s.settings[k]=!s.settings[k];
      AudioMgr.setBgm(s.settings.bgm); AudioMgr.setSfx(s.settings.sfx); AudioMgr.setVoice(s.settings.voice); Haptics.setEnabled(s.settings.sfx); sw.classList.toggle('on',s.settings[k]); Save.saveNow(s); });
    const sbSw=m.querySelector('[data-sandbox]');
    sbSw.onclick=()=>{ s.setSandbox(!s.sandbox); sbSw.classList.toggle('on',s.sandbox); this.toast(s.sandbox?this.t('settings.playOn'):this.t('settings.playOff')); Save.saveNow(s); };
    m.querySelector('[data-rules]').onclick=()=>this._rules();
    m.querySelector('.set-danger').onclick=()=>{
      this.modal(`<div class="cdialog"><h3>${this.t('settings.resetTitle')}</h3><p>${this.t('settings.resetDesc')}</p>
        <div class="cd-btns"><button class="cd-no" data-n>${this.t('common.cancel')}</button><button class="cd-ok" data-y>${this.t('settings.resetConfirm')}</button></div></div>`,true)
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
    const m=this.modal(`<div class="m-head sb-head"><div class="m-title">${this.t('sandbox.title')}</div><button class="m-close">✕</button></div>
      <div class="m-body">
        <div class="sb-status">${this.t('sandbox.status')}</div>
        <div class="sb-grid">
          ${this._sbBtn('lvl','⭐',this.t('sandbox.level'),this.t('sandbox.levelHelp'))}
          ${this._sbBtn('board','🧊',this.t('sandbox.board'),this.t('sandbox.boardHelp'))}
          ${this._sbBtn('gens','🏭',this.t('sandbox.benches'),this.t('sandbox.benchesHelp'))}
          ${this._sbBtn('fill','✨',this.t('sandbox.fill'),this.t('sandbox.fillHelp'))}
          ${this._sbBtn('story','📜',this.t('sandbox.story'),this.t('sandbox.storyHelp'))}
          ${this._sbBtn('chest','🎁',this.t('sandbox.chests'),this.t('sandbox.chestsHelp'))}
          ${this._sbBtn('clear','🧹',this.t('sandbox.clear'),this.t('sandbox.clearHelp'))}
        </div>
        <button class="sb-off" data-off>${this.t('sandbox.close')}</button>
      </div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    const feedback=msg=>{ this.toast(msg); this.scene.shake?.(4,200); };
    m.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{
      const a=b.dataset.act;
      if(a==='lvl') feedback(this.t('sandbox.levelDone',{level:s.sbAddLevel()}));
      if(a==='board'){ s.sbUnlockBoard(); feedback(this.t('sandbox.boardDone')); }
      if(a==='gens'){ s.sbAllGens(); feedback(this.t('sandbox.benchesDone')); }
      if(a==='fill'){ s.sbFillMaterials(); feedback(this.t('sandbox.fillDone')); }
      if(a==='story'){
        const prepared=s.sbPrepareNextStory();
        if(prepared.finished) feedback(this.t('sandbox.storyDone'));
        else feedback(this.t('sandbox.storyPrepared',{name:prepared.node.name}));
      }
      if(a==='chest'){ s.sbOpenChests(); feedback(this.t('sandbox.chestsDone')); }
      if(a==='clear'){ s.sbClearItems(); feedback(this.t('sandbox.clearDone')); }
      setTimeout(()=>this._sandboxPanel(),120); // 刷新面板状态
    });
    m.querySelector('[data-off]').onclick=()=>{ s.setSandbox(false); this._sandboxFab(false); this.closeModal();
      this.toast(this.t('settings.playOff')); };
  }

  // ---------- 专用小弹窗 ----------
  _levelUp(ups){
    const u=ups[ups.length-1];
    const coin=ups.reduce((sum,item)=>sum+item.reward.coin,0),gem=ups.reduce((sum,item)=>sum+item.reward.gem,0);
    const m=this.modal(`<div class="cdialog level-rush"><div class="big-ic">⭐</div><h3>${ups.length>1?this.t('popups.levelMany',{count:ups.length}):this.t('popups.levelOne')} Lv.${u.lv}</h3>
      <p>${u.text||this.t('popups.levelStory')}</p>
      <div class="reward-line"><span class="reward-chip">🪙 ${coin}</span>${gem?`<span class="reward-chip">💎 ${gem}</span>`:''}<span class="reward-chip">⚡ ${this.t('popups.energyFull')}</span></div>
      <div class="cd-btns"><button class="cd-ok">${this.t('popups.ok')}</button></div></div>`,true);
    m.querySelector('.cd-ok').onclick=()=>this.closeModal();
  }
  _chestDialog(idx){ const c=this.s.cells[idx]; if(!c||c.k!=='c') return; const def=this.s.chestInfo(c);
    const remain=this.s.chestRemain(c);
    const body = remain<=0 ? `<h3>${this.t('popups.chestReady')}</h3><p>${this.t('popups.chestReward',{count:def.drop.count})}</p>
        <div class="cd-btns"><button class="cd-no" data-n>${this.t('common.later')}</button><button class="cd-ok" data-o>${this.t('popups.openNow')}</button></div>`
      : `<h3>${this.t('popups.opening',{name:def.name})}</h3><p>${this.t('popups.secondsLeft',{seconds:remain,gems:def.skipGem})}</p>
        <div class="cd-btns"><button class="cd-no" data-n>${this.t('popups.wait')}</button><button class="cd-ok" data-s>${this.t('popups.skipGems',{gems:def.skipGem})}</button></div>`;
    const m=this.modal(`<div class="cdialog"><div class="big-ic">🎁</div>${body}</div>`,true);
    m.querySelector('[data-n]').onclick=()=>this.closeModal();
    const o=m.querySelector('[data-o]'); if(o) o.onclick=()=>runActionOnce(o,()=>this.s.skipChest(idx,true),()=>this.closeModal());
    const sk=m.querySelector('[data-s]'); if(sk) sk.onclick=()=>runActionOnce(sk,()=>this.s.skipChest(idx,false),()=>this.closeModal());
  }
  _unlockDialog(info){ if(!info){this.toast(this.t('popups.boardOpen'));return;}
    const s=this.s, ok=s.lv>=info.needLv;
    const m=this.modal(`<div class="cdialog"><div class="big-ic">❄️</div><h3>${this.t('popups.meltTitle')}</h3>
      <p>${ok?this.t('popups.meltDesc',{cost:info.cost}):this.t('popups.meltLevel',{level:info.needLv})}</p>
      <div class="cd-btns"><button class="cd-no" data-n>${this.t('common.cancel')}</button>${ok?`<button class="cd-ok" data-y>${this.t('popups.melt',{cost:info.cost})}</button>`:''}</div></div>`,true);
    m.querySelector('[data-n]').onclick=()=>this.closeModal();
    const y=m.querySelector('[data-y]'); if(y) y.onclick=()=>runActionOnce(y,()=>s.unlockNext(),()=>this.closeModal());
  }
  _noEnergy(){ this.modal(`<div class="cdialog"><div class="big-ic">⚡</div><h3>${this.t('popups.noEnergyTitle')}</h3>
    <p>${this.t('popups.noEnergyDesc')}</p>
    <div class="cd-btns"><button class="cd-no" data-n>${this.t('popups.gotIt')}</button><button class="cd-ok" data-y>${this.t('popups.goShop')}</button></div></div>`,true)
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
    return String(text||'').replaceAll('{{choice}}',picked?.name||this.t('interaction.defaultChoice'))
      .replaceAll('{{playerName}}',this.s.playerName);
  }
  _playDialogue({ch=null,node=null,lines=[],kind='story',sceneImg=null,doneLabel=null,onDone=null}){
    const cards=(lines||[]).map(line=>this._lineOf(line));
    if(!cards.length){ onDone?.(); return; }
    const title=node?.name||ch?.title||this.t('welcome.chapter');
    const place=node?.place||ch?.subtitle||this.t('welcome.chapter');
    const bg=sceneImg||node?.cg||ch?.scene||'story_1.png';
    const hasCg=String(bg).startsWith('cg_');
    const kindLabel=kind==='request'?this.t('dialogue.request'):kind==='welcome'?this.t('dialogue.prologue'):this.t('dialogue.main');
    const transcript=cards.map(line=>{ const npc=this._npcOf(line.who);
      return `<div class="story-log-line"><b>${esc(npc.name)}</b><p>${esc(this._storyText(line.say,node))}</p></div>`; }).join('');
    const m=this.modal(`<div class="story-stage ${hasCg?'has-cg':''}" data-kind="${esc(kind)}" data-line="0">
      <div class="story-stage-bg" style="background-image:url(assets/img/${esc(bg)})"></div>
      <div class="story-stage-atmo"></div>
      ${hasCg?`<div class="story-stage-cg"><img src="assets/img/${esc(bg)}" alt="${esc(title)} CG"></div>`:''}
      <div class="story-stage-toolbar">
        <span>${esc(kindLabel)} · ${esc(title)}</span>
        <div><button class="story-log" type="button" aria-expanded="false">${this.t('dialogue.review')}</button><button class="story-skip" type="button">${this.t('dialogue.skip')}</button></div>
      </div>
      <div class="story-stage-caption"><b>${esc(place)}</b><span>${esc(ch?.hook||'')}</span></div>
      <div class="story-portrait" aria-hidden="true"><div class="story-portrait-glow"></div><img alt=""></div>
      <div class="story-copy dlg-line">
        <div class="who story-speaker"></div><p class="say story-say" aria-live="polite"></p>
        <div class="story-copy-foot"><span class="story-line-count"></span><button class="dlg-next" type="button"></button></div>
      </div>
      <div class="story-transcript hidden"><div class="story-log-head"><b>${this.t('dialogue.reviewTitle')}</b><button type="button">${this.t('dialogue.back')}</button></div>${transcript}</div>
    </div>`,true);
    const stage=m.querySelector('.story-stage'), portrait=m.querySelector('.story-portrait'), portraitImg=portrait.querySelector('img');
    const speaker=m.querySelector('.story-speaker'), say=m.querySelector('.story-say'), counter=m.querySelector('.story-line-count');
    const next=m.querySelector('.dlg-next'), log=m.querySelector('.story-log'), skip=m.querySelector('.story-skip');
    const transcriptPanel=m.querySelector('.story-transcript'); let index=0,typed=true,finished=false;
    const finishTyping=(text)=>{ clearTimeout(this._dialogTimer); this._dialogTimer=0; say.textContent=text; typed=true;
      next.dataset.typing='false'; next.textContent=index===cards.length-1?`${doneLabel||this.t('common.continue')} ▸`:`${this.t('common.continue')} ▸`; };
    const render=()=>{
      const line=cards[index],npc=this._npcOf(line.who),isNarrator=line.who==='narrator'||line.who==='all';
      const text=this._storyText(line.say,node); const side=line.side==='left'||line.side==='right'?line.side:(index%2?'left':'right');
      stage.dataset.line=String(index); stage.dataset.side=side; stage.classList.toggle('narrating',isNarrator);
      stage.querySelector('.story-stage-bg').style.backgroundPosition=`${42+(index%3)*8}% center`;
      portrait.classList.toggle('hidden',isNarrator); portraitImg.src=`assets/img/${npc.img}`; portraitImg.alt=npc.name;
      speaker.textContent=isNarrator?(line.who==='all'?this.t('dialogue.everyone'):this.t('dialogue.journal')):`${npc.name}${kind==='request'?' · '+this.t('dialogue.request'):''}`;
      counter.textContent=`${index+1} / ${cards.length}`; say.textContent=''; typed=false;
      next.dataset.typing='true'; next.textContent=this.t('dialogue.showAll');
      AudioMgr.play(line.sfx||'page'); AudioMgr.playVoice(this._voice(line.voiceId));
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
      data-step="${esc(step.id)}" style="--x:${clamp(step.x)}%;--y:${clamp(step.y)}%" aria-label="${this.t('interaction.step',{number:index+1,label:esc(step.label)})}">
      <i>${esc(step.icon||'✨')}</i><span>${esc(step.label)}</span></button>`).join('');
    const m=this.modal(`<div class="story-act act-tap ${node.cg?'has-cg':''}" data-node="${esc(node.id)}">
      <div class="story-act-bg" style="background-image:url(assets/img/${esc(bg)})"></div><div class="story-act-frost"></div>
      ${node.cg?`<div class="story-act-cg"><img src="assets/img/${esc(bg)}" alt="${esc(node.name)} CG"></div>`:''}
      <div class="story-act-head"><span>${this.t('interaction.restore',{chapter:esc(ch.title)})}</span><button class="story-act-skip" type="button">${this.t('interaction.skip')}</button></div>
      <div class="story-act-title"><small>${esc(node.place||'')}</small><h2>${esc(act.title)}</h2><p>${esc(act.prompt||'')}</p></div>
      <div class="story-act-field">${targets}</div>
      <div class="story-act-bottom"><div class="story-act-result" aria-live="polite">${this.t('interaction.progress',{done:0,total:act.steps.length})}</div>
        <div class="story-act-meter"><i></i></div><button class="story-act-continue hidden" type="button">${this.t('interaction.continueStory')}</button></div>
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
      result.textContent=current===act.steps.length?act.complete:this.t('interaction.progress',{done:current,total:act.steps.length});
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
      <div class="story-act-head"><span>${this.t('interaction.myValley',{chapter:esc(ch.title)})}</span><button class="story-act-skip" type="button">${this.t('interaction.chooseLater')}</button></div>
      <div class="story-act-title"><small>${esc(node.place||'')}</small><h2>${esc(act.title)}</h2><p>${esc(act.prompt||'')}</p></div>
      <div class="story-choice-grid" role="radiogroup" aria-label="${esc(act.title)}">${optionHTML}</div>
      <div class="story-act-bottom"><div class="story-act-result" aria-live="polite">${saved?this.t('journal.yourChoice',{icon:saved.icon,name:esc(saved.name)}):this.t('interaction.chooseHint')}</div>
        <button class="story-choice-confirm" type="button" ${selected?'':'disabled'}>${this.t('interaction.useChoice')}</button></div>
    </div>`,true);
    const stage=m.querySelector('.story-act'),cards=[...m.querySelectorAll('.story-choice-card')],confirm=m.querySelector('.story-choice-confirm');
    const result=m.querySelector('.story-act-result'); let finished=false;
    const done=()=>{ if(finished) return; finished=true; this.closeModal(); after?.(); };
    const select=id=>{ selected=id; const picked=options.find(option=>option.id===id);
      cards.forEach(card=>{ const on=card.dataset.choice===id; card.classList.toggle('selected',on); card.setAttribute('aria-checked',String(on)); });
      confirm.disabled=false; result.textContent=this.t('interaction.preview',{name:picked.name,desc:picked.desc||''});
      const accent=/^#[0-9a-f]{6}$/i.test(picked.accent||'')?picked.accent:'#f5a33c'; stage.style.setProperty('--choice-accent',accent);
      AudioMgr.play('tap'); Haptics.tap(); };
    cards.forEach(card=>card.onclick=()=>select(card.dataset.choice));
    if(selected) select(selected);
    confirm.onclick=()=>{ const savedResult=this.s.setStoryChoice(node.id,selected); if(!savedResult?.ok) return;
      const picked=this.s.storyChoice(node); stage.classList.add('complete'); result.textContent=act.complete||this.t('interaction.adopted',{name:picked.name});
      confirm.disabled=true; confirm.textContent=this.t('interaction.saved'); AudioMgr.play('chime'); Haptics.unlock();
      setTimeout(done,420); };
    m.querySelector('.story-act-skip').onclick=done;
  }

  // ---------- 章节开场过场（电影感） ----------
  _moodWind(mood){ return {cold:.9,bustling:.4,holy:.35,hopeful:.3,tender:.25,finale:.05}[mood]??.7; }
  _applyMood(ch){ AudioMgr.playBgm(ch.bgm||'bgm'); AudioMgr.setWind(this._moodWind(ch.mood)); }
  _chapterIntro(ch, after){
    this.s.markChapterSeen(ch.id); this._applyMood(ch); AudioMgr.play('chime');
    const lines=ch.intro||[]; let i=0;
    const lineCard=()=>{ const line=this._lineOf(lines[i]),text=this._storyText(line.say);
      const m=this.modal(`<div class="cine">
        <div class="cine-bg" style="background-image:url(assets/img/${ch.scene})"></div>
        <div class="cine-veil"></div>
        <div class="cine-body">
          <div class="cine-kicker">FROST STORY · CHAPTER ${ch.id}</div>
          <h2 class="cine-title">${ch.title}</h2><div class="cine-sub">${ch.subtitle||''}</div>
          ${ch.hook?`<div class="cine-hook">${this.t('chapter.mystery',{hook:esc(ch.hook)})}</div>`:''}
          <p class="cine-say">${esc(text)}</p>
          <div class="cine-dots">${lines.map((_,k)=>`<i class="${k===i?'on':''}"></i>`).join('')}</div>
          <button class="cine-next">${i>=lines.length-1?this.t('chapter.enter'):`${this.t('common.continue')} ▸`}</button>
        </div></div>`,true);
      AudioMgr.playVoice(this._voice(line.voiceId));
      m.querySelector('.cine-next').onclick=()=>{ i++; this.closeModal();
        if(i<lines.length) lineCard(); else { after?.(); } };
    };
    lineCard();
  }
  // 若存在已开放但未看过场的章节，自动播放（通关一章后/回到游戏时）
  _maybeChapterIntro(after){ const ch=this.s.nextUnseenChapter(); if(ch){ this._chapterIntro(ch,after); } else after?.(); }

  // ---------- 剧情回报对白（交付后 / 回看） ----------
  _storyDialog(ch,node,opts={}){
    const replay=!!opts.replay,levelUps=opts.levelUps||[];
    this._playDialogue({ch,node,lines:node.dialogue||[],kind:'story',sceneImg:node.cg||ch.scene,
      doneLabel:replay?this.t('dialogue.back'):(node.finale?this.t('rewards.ending'):this.t('common.continue')),onDone:()=>{
        const rw=node.reward||{}, finale=!!node.finale;
        if(replay){ this.closeModal(); return; }
        const m=this.modal(`<div class="cdialog"><div class="big-ic">${finale?'🔥':'🏘️'}</div>
          <h3>${finale?this.t('rewards.finale'):this.t('rewards.finished',{name:node.name})}</h3>
          <p>${node.lore?node.lore.text:this.t('rewards.defaultStory')}</p>
          ${levelUps.length?`<div class="story-rush-win">${this.t('rewards.rush',{count:levelUps.length,level:levelUps[levelUps.length-1].lv})}</div>`:''}
          <div class="reward-line">${rw.coin?`<span class="reward-chip">🪙 ${rw.coin}</span>`:''}${rw.gem?`<span class="reward-chip">💎 ${rw.gem}</span>`:''}${rw.xp?`<span class="reward-chip">⭐ ${this.t('rewards.experience',{count:rw.xp})}</span>`:''}${rw.energy?`<span class="reward-chip">⚡ ${rw.energy}</span>`:''}${rw.freeTaps?`<span class="reward-chip">🏮 ${this.t('hud.afterglow',{count:rw.freeTaps})}</span>`:''}${rw.generator?`<span class="reward-chip">🎁 ${esc(Config.genById(rw.generator)?.name||this.t('rewards.newWorkbench'))}</span>`:''}</div>
          <div class="cd-btns"><button class="cd-ok">${finale?this.t('rewards.ending'):this.t('rewards.great')}</button></div></div>`,true);
        if(finale) AudioMgr.play('flame');
        m.querySelector('.cd-ok').onclick=()=>{ this.closeModal();
          if(finale){ this._ending(); } else { this._maybeChapterIntro(); } };
      }});
  }
  // ---------- 结局演出（数据驱动，替代旧 n33 硬编码） ----------
  _ending(){
    AudioMgr.playBgm('bgm_spring'); AudioMgr.setWind(0);
    this._playDialogue({lines:Config.epilogue||[],kind:'story',sceneImg:'cg_spring.png',
      doneLabel:this.t('common.continue'),onDone:()=>this._credits()});
  }
  _credits(){
    const m=this.modal(`<div class="cdialog"><h3>${this.t('meta.title')} · Frost Story</h3>
      <p style="line-height:2">${this.t('settings.about')}<br><br>${this.t('rewards.defaultStory')}<br>❄️ → 🔥</p>
      <div class="cd-btns"><button class="cd-ok">${this.t('common.continue')}</button></div></div>`,true);
    m.querySelector('.cd-ok').onclick=()=>this.closeModal();
  }

  // ---------- 山谷手账（世界观 / 回忆 / 角色羁绊） ----------
  _journalHTML(){
    const s=this.s, done=id=>s.isNodeDone(id);
    const bond=s.bondByNpc();
    // 序章
    const seenIntro=s.storyDone.length>0;
    let html=`<div class="jr-sec"><div class="jr-h">${this.t('journal.origin')}</div>
      <div class="jr-card ${seenIntro?'':'locked'}">${seenIntro?Config.prologue.map(l=>`<p>${l[1]}</p>`).join(''):`<p class="jr-lock">${this.t('journal.originLocked')}</p>`}</div></div>`;
    // 角色羁绊
    html+=`<div class="jr-sec"><div class="jr-h">${this.t('journal.partners')}</div><div class="jr-bonds">`+
      Config.npcs.map(n=>{ const v=bond[n.id]||0; const hearts='❤'.repeat(Math.min(5,Math.ceil(v/2)))+'♡'.repeat(5-Math.min(5,Math.ceil(v/2)));
        return `<div class="jr-npc ${v?'':'locked'}"><img src="assets/img/${n.img}"><b>${n.name}</b><span>${n.title}</span><small>${v?hearts:this.t('journal.notMet')}</small></div>`; }).join('')+`</div></div>`;
    // 每章：世界观词条 + 节点回忆
    for(const ch of Config.story){ const started=ch.nodes.some(n=>done(n.id));
      html+=`<div class="jr-sec"><div class="jr-h">${ch.title}</div>`;
      for(const w of (ch.worldLore||[])) html+=`<div class="jr-card ${started?'':'locked'}">${started?`<b>${w.title}</b><p>${w.text}</p>`:`<p class="jr-lock">${this.t('quest.completePrevious')}</p>`}</div>`;
      for(const n of ch.nodes){ const isDone=done(n.id);
        const picked=s.storyChoice(n);
        html+=`<div class="jr-card mem ${isDone?'':'locked'}">${isDone
          ?`<b>${n.name}</b><p>${n.lore?n.lore.text:''}</p>${picked?`<div class="jr-choice">${this.t('journal.yourChoice',{icon:picked.icon,name:esc(picked.name)})}</div>`:''}<small>${(n.dialogue||[]).filter(l=>l[0]!=='narrator'&&l[0]!=='all').map(l=>this._npcOf(l[0]).name).join(' · ')}</small>`
          :`<p class="jr-lock">${this.t('journal.notExperienced',{name:n.name})}</p>`}</div>`; }
      html+=`</div>`; }
    return html;
  }
  _rules(){
    const m=this.modal(`<div class="m-head"><div class="m-title">${this.t('rules.title')}</div><button class="m-close">✕</button></div>
      <div class="m-body">
        <div class="rules-loop">
          <div class="rules-step"><i>🏭</i><span>${this.t('rules.generate')}</span></div><div class="rules-step"><i>✨</i><span>${this.t('rules.merge')}</span></div>
          <div class="rules-step"><i>📦</i><span>${this.t('rules.orders')}</span></div><div class="rules-step"><i>🪙</i><span>${this.t('rules.expand')}</span></div>
          <div class="rules-step"><i>🏘️</i><span>${this.t('rules.story')}</span></div>
        </div>
        <div class="rules-list">
          <p>${this.t('rules.mergeDesc')}</p><p>${this.t('rules.generateDesc')}</p><p>${this.t('rules.ordersDesc')}</p>
          <p>${this.t('rules.boardDesc')}</p><p>${this.t('rules.storyDesc')}</p>
        </div>
        <button class="set-help" data-ok>${this.t('rules.done')}</button>
      </div>`);
    const close=()=>{this.closeModal();requestAnimationFrame(()=>this._tutorial());};
    m.querySelector('.m-close').onclick=close; m.querySelector('[data-ok]').onclick=close;
  }
  welcome(){
    const lines=Config.prologue||[];
    const gate=this.modal(`<div class="welcome-gate"><img src="assets/img/title_keyart.png" alt="${esc(this.t('meta.title'))}">
      <div class="welcome-gate-veil"></div><div class="welcome-gate-copy"><small>${this.t('welcome.chapter')}</small>
      <h2>${this.t('welcome.title')}</h2><p>${this.t('welcome.tip')}</p>
      <button class="welcome-start" type="button">${this.t('welcome.start')}</button></div></div>`,true);
    gate.querySelector('.welcome-start').onclick=()=>{
      // 剧情转场不能等待 GeckoView 的 AudioContext/解码链路；首句 HTMLAudio
      // 会在这次点击手势内直接起播，WebAudio/SFX 则继续异步解锁和预热。
      void AudioMgr.unlock(); this.closeModal();
      this._playDialogue({lines,kind:'welcome',sceneImg:'title_keyart.png',doneLabel:this.t('welcome.answer'),onDone:()=>this._profileStory()});
    };
  }

  _profileStory(){
    const prompt=Config.profile?.prompt||[];
    this._playDialogue({lines:prompt,kind:'welcome',sceneImg:'title_keyart.png',doneLabel:this.t('welcome.tell'),onDone:()=>this._profileNaming()});
  }
  _profileNaming({editing=false}={}){
    const current=editing?this.s.profile?.nickname||'':'';
    const m=this.modal(`<div class="profile-story">
      <div class="profile-story-bg" style="background-image:url(assets/img/title_keyart.png)"></div><div class="profile-story-veil"></div>
      <div class="profile-story-body"><div class="profile-choco"><img src="assets/img/npc_sprite.png" alt="Choco"><div><small>${this.t('profile.role')}</small><p>${editing?this.t('profile.editPrompt'):this.t('profile.newPrompt')}</p></div></div>
        <label for="profileName">${this.t('profile.label')}</label>
        <input id="profileName" data-profile-name maxlength="12" autocomplete="nickname" inputmode="text" value="${esc(current)}" placeholder="${this.t('profile.placeholder')}" aria-describedby="profileHelp profileError">
        <div id="profileHelp" class="profile-help">${this.t('profile.help')}</div>
        <div id="profileError" class="profile-error" aria-live="polite"></div>
        <button data-save-profile type="button">${this.t('profile.save')}</button>
      </div></div>`,true);
    const input=m.querySelector('[data-profile-name]'),error=m.querySelector('.profile-error'),save=m.querySelector('[data-save-profile]');
    const submit=()=>{ const result=this.s.setNickname(input.value);
      if(!result?.ok){ error.textContent=this.t('profile.error'); input.focus(); return; }
      Save.saveNow(this.s); this.closeModal(false);
      this._playDialogue({lines:Config.profile?.confirm||[],kind:'welcome',sceneImg:'title_keyart.png',doneLabel:editing?this.t('profile.saveEdit'):this.t('welcome.enter'),onDone:()=>{
        if(!editing){ this.s.markChapterSeen(1); const ch=Config.story[0]; if(ch) this._applyMood(ch); }
        requestAnimationFrame(()=>this._tutorial());
      }});
    };
    save.onclick=submit; input.onkeydown=e=>{if(e.key==='Enter') submit();};
    setTimeout(()=>input.focus(),80);
    if(editing) AudioMgr.playVoice(this._voice(Config.profile?.prompt?.[0]?.[2]?.voiceId));
  }

  // ---------- toast ----------
  toast(msg){
    const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
    this.el.toastLayer.appendChild(t); setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),320);},1700);
  }
}
