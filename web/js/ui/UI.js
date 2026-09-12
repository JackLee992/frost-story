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

export class UI {
  constructor(state, scene){ this.s=state; this.scene=scene; this.el={}; this._cacheDom(); this._bind(); this._listen(); }
  _cacheDom(){
    ['levelBadge','xpBar','energyVal','energyTimer','coinVal','gemVal','warmthVal','orders','hint','guideLayer','modalLayer','toastLayer','itemPop','ipName','ipSub','ipPrice','ipSell','energyPlus','sbFab'].forEach(id=>this.el[id]=$('#'+id));
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
    const orders=this.el.orders.getBoundingClientRect(), dock=$('#dock').getBoundingClientRect();
    const width=f.offsetWidth||50, height=f.offsetHeight||66, edge=4;
    const minX=app.left+safe.left+edge;
    const maxX=Math.max(minX,app.right-safe.right-edge-width);
    const minY=Math.max(app.top+safe.top+56,orders.bottom+8);
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
    bus.on('changed',p=>{ this.renderHUD(); this.renderOrders(); this._tutorial(); Save.save(this.s);
      if(p?.type==='levelup'){ this._levelUp(p.ups); this.scene.celebrate?.(); Haptics.level(); }
      if(p?.type==='orderSubmit'){ Haptics.reward(); this._coinPulse(); }
      if(p?.type==='storyBuilt'){ this.scene.celebrate?.(); Haptics.unlock(); this._storyDialog(p.chapter,p.node); }
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
  renderOrders(){
    const box=this.el.orders; box.innerHTML='';
    this.s.orders.forEach((o,slot)=>{
      const npc=Config.npcById(o.npcId), have=this.s.orderHave(o), ready=this.s.orderReady(o);
      const card=document.createElement('div'); card.className='order-card'+(ready?' ready':'');
      card.innerHTML=`<div class="oc-top">
          <img class="oc-avatar" src="${npcImg(npc)}"/>
          <div class="oc-who"><b>${npc.name}</b><br><span>${npc.title}的委托</span></div>
        </div>
        <div class="oc-need">${o.needs.map((q,i)=>`<div class="need-chip ${have[i]>=q.n?'ok':'lack'}"><img src="${itemImg(q.fam,q.tier)}"><span class="have">${have[i]}/${q.n}</span></div>`).join('')}</div>
        <button class="oc-submit ${ready?'on':''}">交付 · ${o.coin}金${o.gem?` · ${o.gem}钻`:''}</button>`;
      const submit=card.querySelector('.oc-submit');
      submit.onclick=()=>{ if(!ready){this.toast('材料还没凑齐');return;} runActionOnce(submit,()=>this.s.submitOrder(slot)); };
      // 刷新
      const rf=document.createElement('div'); rf.style.cssText='position:absolute;top:5px;right:6px;font-size:10px;color:#7a93a8;';
      card.style.position='relative';
      rf.textContent=`↻${this.s.refreshCost}`; rf.onclick=()=>runActionOnce(rf,()=>this.s.refreshOrder(slot)); card.appendChild(rf);
      box.appendChild(card);
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

  // ---------- 六步新手引导 ----------
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
    const t=this.s.tutorial, layer=this.el.guideLayer;
    if(!layer||t.done||t.skipped){this._hideGuide();return;}
    let step;
    if(!t.produced){ const idx=this.s.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_crystal');
      step={id:'produce',n:1,title:'先取得一份材料',copy:'点一下发光的「霜晶矿脉」。生成器会消耗体力，并把材料放到最近的空格。',rect:this._cellRect(idx)}; }
    else if(!t.merged){ const pair=this._mergePair();
      step={id:'merge',n:2,title:'合并两个相同物品',copy:'按住其中一个相同材料，拖到另一个上面；同族同级的两个物品会升成更高一级。',rect:this._cellRect(pair)}; }
    else if(!t.ordered){ const target=document.querySelector('.order-card.ready')||document.querySelector('.order-card');
      step={id:'order',n:3,title:'交付顶部委托',copy:'材料齐全后订单会变绿。点「交付」获得金币、经验和暖意，再自动补充新订单。',rect:target?.getBoundingClientRect()}; }
    else if(!t.unlocked){ const idx=Math.min(this.s.boardUnlocked,this.s.cells.length-1);
      step={id:'unlock',n:4,title:'融化一块冰封格',copy:'点带雪花和锁的第一块冰封格，再花金币融化它，扩大可用棋盘空间。',rect:this._cellRect(idx)}; }
    else if(!t.shopped){ const target=document.querySelector('[data-panel="shop"]');
      step={id:'shop',n:5,title:'认识商店与宝箱',copy:'打开商店。金币可买宝箱和新生成器；宝箱倒计时结束后会掉落多件材料。',rect:target?.getBoundingClientRect()}; }
    else { const target=document.querySelector('[data-panel="story"]');
      step={id:'story',n:6,title:'用材料重建山谷',copy:'打开「山谷」，查看剧情节点所需材料。完成重建即可解锁三章原创故事。',rect:target?.getBoundingClientRect()}; }
    if(!step?.rect){this._hideGuide();return;}
    this.el.hint.classList.add('hidden');
    layer.classList.remove('hidden'); layer.dataset.step=step.id;
    layer.innerHTML=`<div class="guide-shade" data-shade="top"></div><div class="guide-shade" data-shade="right"></div>
      <div class="guide-shade" data-shade="bottom"></div><div class="guide-shade" data-shade="left"></div>
      <div class="guide-focus"></div><div class="guide-card">
      <div class="guide-kicker">新手引导 ${step.n}/6</div><div class="guide-title">${step.title}</div>
      <div class="guide-copy">${step.copy}</div><div class="guide-actions">
        <button data-guide-rules>查看规则</button><button class="guide-skip" data-guide-skip>跳过引导</button>
      </div></div>`;
    const app=$('#app').getBoundingClientRect(),safe=window.__frostSafeInsets||{top:0,right:0,bottom:0,left:0};
    const rr=step.rect,margin=6,local={left:rr.left-app.left-margin,top:rr.top-app.top-margin,
      width:(rr.width??rr.right-rr.left)+margin*2,height:(rr.height??rr.bottom-rr.top)+margin*2};
    const focus=layer.querySelector('.guide-focus');
    Object.assign(focus.style,{left:local.left+'px',top:local.top+'px',width:local.width+'px',height:local.height+'px'});
    // 四块有限遮罩代替 200vmax 巨型阴影。后者在 WebGL/移动 GPU 分块合成时会产生贯穿屏幕的瓦片接缝。
    const x0=Math.max(0,Math.min(app.width,local.left)),y0=Math.max(0,Math.min(app.height,local.top));
    const x1=Math.max(x0,Math.min(app.width,local.left+local.width)),y1=Math.max(y0,Math.min(app.height,local.top+local.height));
    const shade=(name,style)=>Object.assign(layer.querySelector(`[data-shade="${name}"]`).style,style);
    shade('top',{left:'0px',top:'0px',width:app.width+'px',height:y0+'px'});
    shade('right',{left:x1+'px',top:y0+'px',width:Math.max(0,app.width-x1)+'px',height:Math.max(0,y1-y0)+'px'});
    shade('bottom',{left:'0px',top:y1+'px',width:app.width+'px',height:Math.max(0,app.height-y1)+'px'});
    shade('left',{left:'0px',top:y0+'px',width:x0+'px',height:Math.max(0,y1-y0)+'px'});
    const card=layer.querySelector('.guide-card'),cardW=card.offsetWidth||326,cardH=card.offsetHeight||126;
    const minLeft=12+safe.left,maxLeft=Math.max(minLeft,app.width-safe.right-cardW-12);
    const left=Math.min(maxLeft,Math.max(minLeft,local.left+local.width/2-cardW/2));
    const below=local.top+local.height+12,above=local.top-cardH-12;
    const maxTop=app.height-safe.bottom-cardH-12,minTop=12+safe.top;
    const top=below<=maxTop?below:Math.max(minTop,Math.min(maxTop,above));
    Object.assign(card.style,{left:left+'px',top:top+'px'});
    layer.querySelector('[data-guide-skip]').onclick=()=>{t.skipped=true;t.done=true;Save.saveNow(this.s);this._hideGuide();this.toast('可在「设置 → 玩法规则」随时回看');};
    layer.querySelector('[data-guide-rules]').onclick=()=>this._rules();
  }

  // ---------- 弹窗框架 ----------
  modal(html, center=false){ this.closeModal();
    const bare=html.trimStart().startsWith('<div class="dlg"')||html.trimStart().startsWith('<div class="cdialog"');
    const mask=document.createElement('div'); mask.className='modal-mask';
    mask.innerHTML=`<div class="modal ${center?'center':''} ${bare?'bare':''}">${html}</div>`;
    mask.onclick=e=>{ if(e.target===mask) this.closeModal(); };
    this.el.modalLayer.appendChild(mask); this._modal=mask; AudioMgr.play('click'); return mask;
  }
  closeModal(){ this._modal?.remove(); this._modal=null; }
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

  _story(){
    const s=this.s;
    if(!s.tutorial.done&&s.tutorial.shopped){
      s.tutorial.storyOpened=true; s.tutorial.done=true; Save.saveNow(s); this._hideGuide();
      setTimeout(()=>this.toast('教学完成！按核心循环推进三章故事吧'),120);
    }
    const chaps=Config.story.map(ch=>{
      const lvLocked=s.lv<ch.unlockLv;
      const nodes=ch.nodes.map(n=>{
        const st=s.nodeState(n,ch);
        const needLine=n.need.map(q=>`<img src="${itemImg(q.fam,q.tier)}" style="width:18px;height:18px;vertical-align:middle">×${q.n}`).join(' ')+` <span style="color:#c98a3d">${n.coin}金</span>`;
        const btn = st==='done'?'<button class="sn-go gray">已完成 ✓</button>'
          : st==='ready'?'<button class="sn-go" data-build="'+n.id+'">重建</button>'
          : st==='lvlock'?`<button class="sn-go gray">Lv.${n.unlockLv||ch.unlockLv}</button>`
          : st==='locked'?'<button class="sn-go gray">尚未解锁</button>'
          : '<button class="sn-go gray">材料不足</button>';
        return `<div class="story-node ${st==='done'?'done':''}"><div class="sn-ic">${st==='done'?'✅':'🏗️'}</div>
          <div class="sn-info"><b>${n.name}</b><div class="needline">${needLine}</div></div>${btn}</div>`; }).join('');
      return `<div class="story-chap"><div class="story-scene" style="background-image:url(assets/img/${ch.scene})">
        <div class="sc-tt">${ch.title}</div>${lvLocked?`<div class="sc-lock">Lv.${ch.unlockLv} 开放</div>`:''}</div>${nodes}</div>`; }).join('');
    const m=this.modal(`<div class="m-head"><div class="m-title">霜语谷 · 重建</div><button class="m-close">✕</button></div><div class="m-body">${chaps}</div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    m.querySelectorAll('[data-build]').forEach(b=>b.onclick=()=>{
      for(const ch of Config.story){ const n=ch.nodes.find(x=>x.id===b.dataset.build); if(n){ if(s.buildNode(ch,n)){} break; } }
    });
  }

  _settings(){
    const s=this.s;
    const row=(k,label)=>`<div class="set-row"><span>${label}</span><div class="switch ${s.settings[k]?'on':''}" data-sw="${k}"><i></i></div></div>`;
    const m=this.modal(`<div class="m-head"><div class="m-title">设置</div><button class="m-close">✕</button></div>
      <div class="m-body">${row('bgm','背景音乐')}${row('sfx','游戏音效')}
        <div class="set-row sandbox-row"><span>🥽 爽玩模式（内测）<small style="display:block;color:#8a9bb0">无限金币 / 钻石 / 体力，自由体验全部内容</small></span><div class="switch ${s.sandbox?'on':''}" data-sandbox><i></i></div></div>
        <button class="set-help" data-rules>📘 玩法规则与新手说明</button>
        <button class="set-danger">重置存档（重新开始）</button>
        <div class="set-about">冰霜物语 Frost Story v0.1<br>WebGL 核心 · 独立内核壳 · 原创美术与音乐由 AI 生成</div>
      </div>`);
    m.querySelector('.m-close').onclick=()=>this.closeModal();
    m.querySelectorAll('[data-sw]').forEach(sw=>sw.onclick=()=>{ const k=sw.dataset.sw; s.settings[k]=!s.settings[k];
      AudioMgr.setBgm(s.settings.bgm); AudioMgr.setSfx(s.settings.sfx); Haptics.setEnabled(s.settings.sfx); sw.classList.toggle('on',s.settings[k]); Save.saveNow(s); });
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
        if(prepared.finished) feedback('三章剧情已全部完成 🎉');
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

  // ---------- 剧情对话 ----------
  _storyDialog(ch,node){
    const firstInChapter=!ch.nodes.some(n=>this.s.storyDone.includes(n.id)&&n.id!==node.id);
    const intro=firstInChapter?(ch.intro||[]).map(say=>['narrator',say]):[];
    const lines=[...intro,...(node.dialogue||[])]; let i=0;
    const rw=node.reward||{};
    const show=()=>{
      if(i<lines.length){ const [who,say]=lines[i];
        const npc=Config.npcs.find(n=>n.id===who)||{
          name:who==='all'?'众人':who==='narrator'?'霜语谷手记':who,img:'npc_sprite.png'
        };
        const m=this.modal(`<div class="dlg">
          <div class="dlg-scene" style="background-image:url(assets/img/${ch.scene})"></div>
          <div class="dlg-line"><img src="assets/img/${npc.img}"><div><div class="who">${npc.name}</div><div class="say">${say}</div></div></div>
          <button class="dlg-next">${i===lines.length-1?'查看奖励':'继续 ▸'}</button></div>`,true);
        m.querySelector('.dlg-next').onclick=()=>{i++;this.closeModal();show();};
      } else {
        const finale=node.id==='n33';
        const m=this.modal(`<div class="cdialog"><div class="big-ic">${finale?'🔥':'🏘️'}</div>
          <h3>${finale?'永暖圣火，重燃！':'「'+node.name+'」完成'}</h3>
          <p>${finale?'暴风雪散去，霜语谷迎来了久违的春天。谢谢你，霜灵师。':'山谷又恢复了一处生机。'}</p>
          <div class="reward-line">${rw.coin?`<span class="reward-chip">🪙 ${rw.coin}</span>`:''}${rw.gem?`<span class="reward-chip">💎 ${rw.gem}</span>`:''}${rw.generator?`<span class="reward-chip">🎁 新生成器</span>`:''}</div>
          <div class="cd-btns"><button class="cd-ok">${finale?'制作名单':'太棒了'}</button></div></div>`,true);
        m.querySelector('.cd-ok').onclick=()=>{ this.closeModal(); if(finale) this._credits(); };
      }
    };
    show();
  }
  _credits(){
    const m=this.modal(`<div class="cdialog"><h3>冰霜物语 · 通关</h3>
      <p style="line-height:2">玩法对标 Frost Valley 品类机制<br>美术 / 音乐：AI 原创生成<br>引擎：PixiJS WebGL · 独立 Gecko 内核<br><br>你已重建整座霜语谷，仍可继续合并收集～</p>
      <div class="cd-btns"><button class="cd-ok">继续游玩</button></div></div>`,true);
    m.querySelector('.cd-ok').onclick=()=>this.closeModal();
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
          <p><b>订单：</b>顶部卡片列出所需材料，凑齐后点交付，获得金币、经验与暖意。</p>
          <p><b>棋盘：</b>点带锁雪花可花金币融化；霜泡可直接点破，宝箱到时后点开。</p>
          <p><b>目标：</b>在「山谷」交付指定材料，依次完成 3 章共 9 个重建节点。</p>
        </div>
        <button class="set-help" data-ok>知道了，开始合并</button>
      </div>`);
    const close=()=>{this.closeModal();requestAnimationFrame(()=>this._tutorial());};
    m.querySelector('.m-close').onclick=close; m.querySelector('[data-ok]').onclick=close;
  }
  welcome(){
    const m=this.modal(`<div class="dlg">
      <div class="dlg-scene" style="background-image:url(assets/img/story_1.png)"></div>
      <div class="dlg-line"><img src="assets/img/npc_sprite.png"><div><div class="who">霜灵 · 啾可</div>
      <div class="say">十年暴风雪冰封了霜语谷。跟我完成 6 个小步骤：取得材料、两两合并、交付委托，再把温暖一点点拼回来！</div></div></div>
      <button class="dlg-next">开始新手引导 ▸</button><button class="welcome-rules">先看完整玩法规则</button></div>`,true);
    m.querySelector('.dlg-next').onclick=()=>{this.closeModal();requestAnimationFrame(()=>this._tutorial());};
    m.querySelector('.welcome-rules').onclick=()=>this._rules();
  }

  // ---------- toast ----------
  toast(msg){
    const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
    this.el.toastLayer.appendChild(t); setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),320);},1700);
  }
}
