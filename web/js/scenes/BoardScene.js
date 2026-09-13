// WebGL 棋盘场景：PixiJS v8 渲染网格/物品/生成器/宝箱，处理拖拽合并、点按、动画与粒子
import { Config } from '../core/Config.js';
import { bus } from '../core/EventBus.js';
import { Haptics } from '../core/Haptics.js';
import { createDisplayMetaStore } from '../engine/src/display-meta.js';

const easeOut = t=>1-Math.pow(1-t,3);
const easeBack = t=>{ const c=1.70158; return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2); };

export class BoardScene {
  constructor(state, mount){ this.state=state; this.mount=mount; this.nodes=new Map(); this.nodeMeta=createDisplayMetaStore(); this.selectedUid=null; this.drag=null; this._tweens=[]; }

  async init(){
    const app=new PIXI.Application();
    await app.init({resizeTo:this.mount,backgroundAlpha:0,antialias:true,
      autoDensity:true,resolution:Math.min(window.devicePixelRatio||1,2),powerPreference:'high-performance'});
    this.app=app; this.mount.appendChild(app.canvas);
    this.gridLayer=new PIXI.Container(); this.itemLayer=new PIXI.Container();
    this.fxLayer=new PIXI.Container(); this.snowLayer=new PIXI.Container();
    this.flashLayer=new PIXI.Graphics(); this.hoverG=new PIXI.Graphics();
    // 分层制造纵深感：网格 < 棋子 < 特效 < 飘雪 < 闪光 < 悬停
    app.stage.addChild(this.gridLayer,this.itemLayer,this.fxLayer,this.snowLayer,this.flashLayer,this.hoverG);
    this.itemLayer.sortableChildren=true;
    this._calcGeom(); this._drawGrid(); this._initSnow();
    new ResizeObserver(()=>{ this._calcGeom(); this._drawGrid(); this._layoutAll(true); this._initSnow(); }).observe(this.mount);

    app.stage.eventMode='static'; app.stage.hitArea=app.screen;
    const cv=app.canvas;
    cv.addEventListener('pointerdown',e=>this._down(e));
    cv.addEventListener('pointermove',e=>this._parallax(e));
    cv.addEventListener('pointerleave',()=>this._resetParallax());
    window.addEventListener('pointermove',e=>this._move(e),{passive:false});
    window.addEventListener('pointerup',e=>this._up(e));
    window.addEventListener('pointercancel',()=>this._cancel());

    bus.on('changed',p=>this._onChanged(p));
    bus.on('selectNone',()=>{this.selectedUid=null;});
    let lastSec=0;
    app.ticker.add((ticker)=>{ const now=performance.now(); this._tickTweens(now);
      this._tickSnow(now); this._tickIdle(now); this._tickShake(now);
      const s=Math.floor(Date.now()/1000); if(s!==lastSec){lastSec=s;this._tickTimers();} });
    this.sync(true);
  }

  // ---------- 几何 ----------
  _calcGeom(){
    const r=this.mount.getBoundingClientRect(), W=r.width, H=r.height;
    this.W=W; this.H=H;
    const safe=window.__frostSafeInsets||{top:0,right:0,bottom:0,left:0};
    const top=158+safe.top, bottom=96+safe.bottom;
    const left=12+safe.left, right=12+safe.right;
    const cols=this.state.cols, rows=this.state.rows;
    const cw=Math.max(cols,(W-left-right)/cols), ch=Math.max(rows,(H-top-bottom)/rows);
    this.cell=Math.max(1,Math.floor(Math.min(cw,ch)));
    this.gw=this.cell*cols, this.gh=this.cell*rows;
    this.ox=Math.round(left+(W-left-right-this.gw)/2); this.oy=Math.round(top+(H-top-bottom-this.gh)/2);
  }
  center(idx){ const c=idx%this.state.cols, r=Math.floor(idx/this.state.cols);
    return {x:this.ox+c*this.cell+this.cell/2, y:this.oy+r*this.cell+this.cell/2}; }
  idxAt(x,y){
    const c=Math.floor((x-this.ox)/this.cell), r=Math.floor((y-this.oy)/this.cell);
    if(c<0||c>=this.state.cols||r<0||r>=this.state.rows) return -1; return r*this.state.cols+c;
  }
  _evXY(e){ const rc=this.app.canvas.getBoundingClientRect(); return {x:e.clientX-rc.left,y:e.clientY-rc.top}; }

  // ---------- 网格底 ----------
  _drawGrid(){
    const g=this.gridLayer; g.removeChildren();
    const s=this.state;
    for(let i=0;i<s.cells.length;i++){
      const {x,y}=this.center(i), pad=5, sz=this.cell-pad*2;
      const cell=new PIXI.Graphics();
      if(s.isUnlocked(i)){
        // 空格只留一个柔和落点，不再用 48 个连续描边把画面切成“竖条”。
        if(!s.cells[i]){
          cell.roundRect(x-sz/2,y-sz/2,sz,sz,12).fill(0xffffff,0.035);
          cell.circle(x,y,Math.max(1.6,this.cell*.032)).fill({color:0xffffff,alpha:.28});
        }
      }
      else{ // 冰封格
        const next=i===s.boardUnlocked;
        cell.circle(x,y,this.cell*(next?.34:.22)).fill({color:0x9fd0f2,alpha:next?.18:.055});
        if(next) cell.circle(x,y,this.cell*.34).stroke({width:1.5,color:0xdff1ff,alpha:.5});
        const flake=new PIXI.Text({text:'❄',style:{fontSize:this.cell*(next?.34:.27),fill:'#eaf6ff',alpha:next?.9:.58}});
        flake.anchor.set(.5); flake.position.set(x,y-4); cell.addChild(flake);
        const info=s.unlockInfo();
        if(next && info){ const t=new PIXI.Text({text:'🔒',style:{fontSize:this.cell*0.26}});
          t.anchor.set(.5); t.position.set(x,y+this.cell*0.18); cell.addChild(t); }
      }
      g.addChild(cell);
    }
  }

  // ---------- 节点（按 uid 复用） ----------
  sync(force){
    const s=this.state, live=new Set();
    for(let idx=0;idx<s.cells.length;idx++){
      const c=s.cells[idx]; if(!c) continue; live.add(c.uid);
      let node=this.nodes.get(c.uid);
      if(!node){ node=this._makeNode(c); this.nodes.set(c.uid,node); this.itemLayer.addChild(node); }
      node.zIndex=idx; this.nodeMeta.ensure(node).idx=idx;
      this._updateNode(node,c);
      if(this.drag?.uid!==c.uid) this._place(node,idx,force);
    }
    for(const [uid,node] of this.nodes){ if(!live.has(uid)){ this.nodes.delete(uid);
      // 节点可能在淡出期间被爽玩清盘/重建销毁，补间需跳过已销毁对象（否则 position/alpha 抛空指针）
      this.tween(160,t=>{ if(!node.destroyed) node.alpha=1-t; },()=>{ if(node.destroyed) return; this.nodeMeta.delete(node);node.destroy({children:true}); }); } }
  }
  _layoutAll(instant){ for(const node of this.nodes.values()){ const idx=this.nodeMeta.get(node)?.idx; if(idx!=null) this._place(node,idx,instant); } }
  _place(node,idx,instant){ const p=this.center(idx);
    if(instant){node.position.set(p.x,p.y);return;}
    // `_sx` / `_sy` 是 Pixi Transform 的内部矩阵缓存，不能拿来保存动画起点。
    // 覆盖它们会让新棋子的高度变成 0 或上万像素，表现为贯穿全屏的竖条。
    const fromX=node.x,fromY=node.y;
    this.tween(170,t=>{ if(node.destroyed) return; node.position.set(fromX+(p.x-fromX)*easeOut(t),fromY+(p.y-fromY)*easeOut(t));});
  }

  _makeNode(c){
    const n=new PIXI.Container();
    const sz=this.cell-8;
    // 立体底影（固定，face 悬浮其上制造 3D 感）
    const shadow=new PIXI.Graphics(); shadow.ellipse(0,sz*0.42,sz*0.4,sz*0.13).fill({color:0x0a1c30,alpha:.28});
    n.addChild(shadow);
    const face=new PIXI.Container(); n.addChild(face);
    const back=new PIXI.Graphics(); face.addChild(back);
    const content=new PIXI.Container(); face.addChild(content);
    // 顶部玻璃高光
    const gloss=new PIXI.Graphics(); gloss.roundRect(-sz*0.42,-sz*0.42,sz*0.84,sz*0.3,8).fill({color:0xffffff,alpha:.10});
    face.addChild(gloss);
    const veil=new PIXI.Graphics(); face.addChild(veil);
    const badge=new PIXI.Text({text:'',style:{fontFamily:'Poetsen',fontSize:Math.max(11,this.cell*0.2),fill:'#fff',fontWeight:'700',
      stroke:{color:'#16324a',width:3}}}); badge.anchor.set(.5); face.addChild(badge);
    const note=new PIXI.Text({text:'',style:{fontFamily:'Poetsen',fontSize:this.cell*0.26,fill:'#fff',stroke:{color:'#16324a',width:3}}});
    note.anchor.set(.5); face.addChild(note);
    this.nodeMeta.ensure(n,{shadow,face,back,content,gloss,veil,badge,note,sz,
      phase:Math.random()*Math.PI*2,press:0,pop:0,born:performance.now(),key:null,
      sprite:null,chestDrawn:false,pulsing:false,halo:null});
    return n;
  }

  _updateNode(n,c){
    const m=this.nodeMeta.ensure(n),sz=m.sz;
    m.back.clear(); m.veil.clear(); m.note.text='';
    for(const child of m.veil.removeChildren()) child.destroy?.({children:true});
    if(this.selectedUid===c.uid){ m.back.roundRect(-sz/2,-sz/2,sz,sz,12).fill(0xffd76a,0.25).stroke({width:2.5,color:0xffd76a}); }
    if(c.k==='i'){
      const fam=Config.families[c.fam]; const col=PIXI.Color.shared.setValue(fam.color).toNumber();
      m.back.roundRect(-sz/2,-sz/2,sz,sz,12).fill(0xffffff,0.16).stroke({width:1.5,color:col,alpha:.55});
      const textureKey=`i${c.fam}_${c.tier}`;
      if(!m.sprite||m.key!==textureKey){ for(const child of m.content.removeChildren()) child.destroy?.({children:true});
        const spr=new PIXI.Sprite(PIXI.Texture.from(`item_${c.fam}_${c.tier}`)); spr.anchor.set(.5);
        spr.width=sz*0.86; spr.height=sz*0.86; m.content.addChild(spr); m.sprite=spr; m.key=textureKey; }
      m.badge.text=String(c.tier); m.badge.position.set(sz*0.34,-sz*0.34);
      // 霜泡
      if(c.bubble){ m.veil.circle(0,0,sz*0.5).fill(0x9fdcff,0.55).stroke({width:2,color:0xeaf6ff,alpha:.9});
        const b=new PIXI.Text({text:'❄',style:{fontSize:sz*0.4,fill:'#fff'}}); b.anchor.set(.5); m.veil.addChild(b); }
    } else if(c.k==='g'){
      const def=Config.genById(c.gid);
      if(!m.sprite||m.key!==c.gid){ for(const child of m.content.removeChildren()) child.destroy?.({children:true});
        const spr=new PIXI.Sprite(PIXI.Texture.from(`token_${def.family}`)); spr.anchor.set(.5);
        spr.width=sz*0.98; spr.height=sz*0.98; m.content.addChild(spr); m.sprite=spr; m.key=c.gid; }
      m.badge.text='';
      const rem=this.state.genCdRemain(c);
      if(rem>0){ const f=rem/def.cdSec; m.veil.roundRect(-sz/2,-sz/2,sz,sz,12).fill(0x0b2138,0.55*f+0.15);
        m.note.text=rem+'s'; }
    } else if(c.k==='c'){
      if(!m.chestDrawn){ for(const child of m.content.removeChildren()) child.destroy?.({children:true}); const chest=this._drawChest(sz); m.content.addChild(chest); m.chestDrawn=true; }
      m.badge.text='';
      const rem=this.state.chestRemain(c);
      if(rem>0){ m.veil.roundRect(-sz/2,-sz/2,sz,sz,12).fill(0x0b2138,0.45); m.note.text=rem+'s'; }
      else { m.note.text='✨'; this._pulse(n); }
    }
  }
  _drawChest(sz){
    const c=new PIXI.Container();
    const body=new PIXI.Graphics();
    body.roundRect(-sz*0.36,-sz*0.18,sz*0.72,sz*0.5,6).fill(0xc98a3d).stroke({width:2,color:0x8a5a22});
    body.roundRect(-sz*0.4,-sz*0.4,sz*0.8,sz*0.28,8).fill(0xe0a54f).stroke({width:2,color:0x8a5a22});
    body.roundRect(-sz*0.08,-sz*0.06,sz*0.16,sz*0.2,3).fill(0xffd76a);
    c.addChild(body); return c;
  }
  _pulse(n){ const m=this.nodeMeta.get(n); if(!m||m.pulsing) return; m.pulsing=true; const t0=performance.now();
    const loop=(now)=>{ const t=(now-t0)/1000; if(!n.parent){m.pulsing=false;return;}
      const cell=this.state.cells[m.idx];
      m.content.scale.set(1+Math.sin(t*4)*0.05);
      if(m.chestDrawn&&cell?.k==='c'&&this.state.chestRemain(cell)===0) requestAnimationFrame(loop);
      else {m.content.scale.set(1);m.pulsing=false;} }; requestAnimationFrame(loop); }

  // ---------- 氛围：飘雪 / 视差 / 待机 ----------
  _initSnow(){
    this.snowLayer.removeChildren(); this._flakes=[];
    const N=42;
    for(let i=0;i<N;i++){
      const depth=Math.random(); // 0 远 1 近
      const f=new PIXI.Graphics();
      const r=1+depth*2.6; f.circle(0,0,r).fill({color:0xffffff,alpha:.25+depth*.5});
      this.snowLayer.addChild(f);
      this._flakes.push({g:f,x:Math.random()*this.W,y:Math.random()*this.H,
        vy:14+depth*34, drift:6+depth*14, ph:Math.random()*Math.PI*2, depth});
    }
  }
  _tickSnow(now){
    if(!this._flakes) return; const t=now/1000, dt=this._lastSnow?(now-this._lastSnow)/1000:.016; this._lastSnow=now;
    for(const f of this._flakes){
      f.y+=f.vy*dt; f.x+=Math.sin(t*1.3+f.ph)*f.drift*dt;
      if(f.y>this.H+6){ f.y=-6; f.x=Math.random()*this.W; }
      if(f.x<-6) f.x=this.W+6; if(f.x>this.W+6) f.x=-6;
      f.g.position.set(f.x,f.y);
    }
  }
  _parallax(e){ const rc=this.app.canvas.getBoundingClientRect();
    const nx=(e.clientX-rc.left)/rc.width-.5, ny=(e.clientY-rc.top)/rc.height-.5;
    this._px=nx; this._py=ny; }
  _resetParallax(){ this._px=0; this._py=0; }
  _tickIdle(now){
    const t=now/1000;
    // 分层视差：网格微动、棋子稍大、飘雪最明显，营造 3D 纵深
    const px=this._px||0, py=this._py||0;
    this.gridLayer.position.set(px*-4,py*-4);
    this.itemLayer.position.set(px*7,py*7);
    this.snowLayer.position.set(px*14,py*14);
    for(const [uid,n] of this.nodes){
      if(this.drag?.uid===uid) continue;
      const m=this.nodeMeta.get(n); if(!m) continue;
      const c=this.state.cells[m.idx]; if(!c||c.uid!==uid) continue;
      const isGen=c.k==='g';
      const bob=Math.sin(t*1.8+m.phase)*(isGen?1.6:1.1);
      // 入场回弹（每帧由出生时间戳计算，避免缩放矩阵残留）
      const ep=easeBack(Math.min(1,(now-(m.born||0))/260));
      n.scale.set(Math.max(.001,ep));
      // 按压回弹
      const target=(this._pressedUid===uid)?.92:1;
      m.press+=(target-m.press)*.35;
      const pop=m.pop||0;
      m.face.position.set(0,bob);
      m.face.scale.set(m.press*(1+pop));
      if(m.pop>0){ m.pop=Math.max(0,m.pop-.06); m.shadow.alpha=.28*(1-m.pop*.6); }
      // 生成器就绪时缓慢呼吸光晕
      if(isGen && this.state.genCdRemain(c)===0){ const glow=.5+Math.sin(t*2.4+m.phase)*.18;
        if(!m.halo){ m.halo=new PIXI.Graphics(); n.addChildAt(m.halo,1); }
        m.halo.clear(); m.halo.roundRect(-m.sz/2,-m.sz/2,m.sz,m.sz,12).stroke({width:2,color:0x9fe3ff,alpha:glow});
      } else if(m.halo){ m.halo.clear(); }
    }
  }
  popNode(uid){ const n=this.nodes.get(uid),m=n&&this.nodeMeta.get(n); if(m) m.pop=.28; }
  flash(color=0xffffff,alpha=.55){ const r=this.app.screen;
    this.flashLayer.clear().rect(0,0,r.width,r.height).fill({color,alpha});
    this.tween(520,o=>{this.flashLayer.clear().rect(0,0,r.width,r.height).fill({color,alpha:alpha*(1-o)});},
      ()=>this.flashLayer.clear()); }
  ring(pos,color=0x9fe3ff){ const g=new PIXI.Graphics(); this.fxLayer.addChild(g);
    this.tween(560,o=>{g.clear();const rr=8+o*this.cell*1.1;g.circle(pos.x,pos.y,rr).stroke({width:4*(1-o)+1,color,alpha:1-o});},
      ()=>g.destroy()); }
  // 全屏庆祝（爽玩模式开启 / 升级）
  celebrate(color='#bfe9ff'){ this.flash(0xbfe9ff,.5);
    const pts=[{x:this.W/2,y:this.H*.3},{x:this.W*.28,y:this.H*.5},{x:this.W*.72,y:this.H*.5}];
    pts.forEach(p=>this.burst(p,color,14)); }
  // 画面晃动（mag 像素，dur 毫秒）
  shake(mag=6,dur=260){ this._shake={t0:performance.now(),mag,dur}; }
  _tickShake(now){ if(!this._shake){ this.app.stage.position.set(this._stageX||0,this._stageY||0); return; }
    const o=(now-this._shake.t0)/this._shake.dur;
    if(o>=1){ this._shake=null; this.app.stage.position.set(0,0); return; }
    const m=this._shake.mag*(1-o);
    this.app.stage.position.set((Math.random()-.5)*2*m,(Math.random()-.5)*2*m); }
  // 冰裂纹路：从中心放射的锯齿线，一闪即碎
  crack(pos,color=0xdff4ff){ const g=new PIXI.Graphics(); this.fxLayer.addChild(g);
    const arms=7;
    this.tween(360,o=>{ g.clear();
      for(let a=0;a<arms;a++){ const ang=a/arms*Math.PI*2+0.3;
        const r1=this.cell*0.18*o, r2=this.cell*0.62*o;
        const mx=pos.x+Math.cos(ang+0.3)*((r1+r2)/2), my=pos.y+Math.sin(ang+0.3)*((r1+r2)/2);
        g.moveTo(pos.x+Math.cos(ang)*r1,pos.y+Math.sin(ang)*r1)
         .lineTo(mx,my).lineTo(pos.x+Math.cos(ang)*r2,pos.y+Math.sin(ang)*r2); }
      g.stroke({width:2.2,color,alpha:1-o}); },()=>g.destroy()); }
  // 碎片：带旋转与重力的多边形碎块
  shatter(pos,color=0xbfe9ff,n=10){ for(let i=0;i<n;i++){ const s=new PIXI.Graphics();
      const r=3+Math.random()*4; s.poly([0,-r,r,0,0,r,-r,0]).fill({color,alpha:.95});
      s.position.set(pos.x,pos.y); this.fxLayer.addChild(s);
      const a=Math.random()*Math.PI*2, d=30+Math.random()*46, vr=(Math.random()-.5)*.5;
      this.tween(620,o=>{s.position.set(pos.x+Math.cos(a)*d*o,pos.y+Math.sin(a)*d*o+26*o*o);
        s.rotation+=vr; s.alpha=1-o;},()=>s.destroy()); } }

  // ---------- 输入 ----------
  _down(e){ const {x,y}=this._evXY(e); const idx=this.idxAt(x,y);
    bus.emit('boardDown',{idx});
    if(idx<0){ this._clearSel(); return; }
    const c=this.state.cells[idx];
    if(!this.state.isUnlocked(idx)){ this._tapLocked(idx); return; }
    if(!c){ this._clearSel(); return; }
    this._pressedUid=c.uid;
    this.drag={uid:c.uid,from:idx,startX:x,startY:y,x,y,active:false,pointerId:e.pointerId};
    this._pressedUid=c.uid;
  }
  _move(e){ if(!this.drag||this.drag.pointerId!==e.pointerId) return; const {x,y}=this._evXY(e);
    this.drag.x=x; this.drag.y=y;
    if(!this.drag.active && Math.hypot(x-this.drag.startX,y-this.drag.startY)>9){ this.drag.active=true; bus.emit('selectNone'); }
    if(this.drag.active){ e.preventDefault?.(); const node=this.nodes.get(this.drag.uid); if(node){node.position.set(x,y);node.zIndex=999;}
      const ti=this.idxAt(x,y); this._showHover(ti,this.drag.from); }
  }
  _up(e){ if(!this.drag) return; const d=this.drag; this.drag=null; this.hoverG.clear(); this._pressedUid=null;
    const node=this.nodes.get(d.uid); if(node) node.zIndex=d.from;
    if(!d.active){ // 点按
      const c=this.state.cells[d.from]; if(!c) return;
      const pc=this.center(d.from);
      if(c.k==='i'&&c.bubble){ this.state.popBubble(d.from); bus.emit('sfx','pop');
        this.crack(pc); this.shatter(pc,'#bfe9ff',12); this.shake(5,220); Haptics.pop(); return; }
      if(c.k==='g'){ this.state.tapGenerator(d.from); bus.emit('sfx','tap');
        this.shake(2.2,120); Haptics.tap(); return; }
      if(c.k==='c'){ bus.emit('chestTap',{idx:d.from}); return; }
      this._select(d.from); return;
    }
    const {x,y}=this._evXY(e); let ti=this.idxAt(x,y);
    if(ti<0) ti=d.from;
    const res=this.state.dropOn(d.from,ti);
    if(res==='merge'){ const col=Config.families[this.state.cells[ti].fam].color, pc=this.center(ti);
      bus.emit('sfx','merge'); this.burst(pc,col); this.ring(pc,col); this.shatter(pc,'#ffffff',8);
      this.popNode(this.state.cells[ti].uid); this.shake(5,200); Haptics.merge(); }
    else if(res==='move'){ bus.emit('sfx','click'); }
  }
  _cancel(){ this.drag=null; this.hoverG.clear(); this.sync(); }
  _showHover(ti,from){ const g=this.hoverG; g.clear(); if(ti<0||ti===from) return; const {x,y}=this.center(ti), sz=this.cell-6;
    const ok=!this.state.cells[ti]||(()=>{const a=this.state.cells[from],b=this.state.cells[ti];
      return a&&b&&a.k==='i'&&b.k==='i'&&!a.bubble&&!b.bubble&&a.fam===b.fam&&a.tier===b.tier&&a.tier<8;})();
    g.roundRect(x-sz/2,y-sz/2,sz,sz,10).stroke({width:3,color:ok?0x7fffb0:0xff9a8a,alpha:.95});
  }
  _select(idx){ const c=this.state.cells[idx]; if(!c||c.k!=='i'){this._clearSel();return;}
    this.selectedUid=c.uid; const p=this.center(idx);
    bus.emit('selectItem',{idx,clientX:0,clientY:0,boardX:p.x,boardY:p.y,cell:this.cell}); this.sync(); }
  _clearSel(){ this.selectedUid=null; bus.emit('selectNone'); }
  _tapLocked(idx){ const info=this.state.unlockInfo(); bus.emit('lockedTap',{idx,info}); }

  // ---------- 状态变化反馈 ----------
  _onChanged(p){
    this._drawGrid(); this.sync();
    if(!p||!p.type) return;
    if(p.type==='produce' && p.to!=null){ const n=this.nodes.get(p.item.uid),m=n&&this.nodeMeta.get(n); if(m) m.born=performance.now();
      this.burst(this.center(p.to),p.boosted?'#ffd76a':'#bfe9ff',p.boosted?10:6);
      if(p.boosted) this.fly(this.center(p.to),Config.t('board.afterglow'),'#ffd76a'); }
    if(p.type==='merge'){ const f=p.feedback||{},parts=[f.discovered?Config.t('board.discovery',{name:f.itemName}):Config.t('board.merge')];
      if(f.combo>=2) parts.push(Config.t('board.combo',{count:f.combo})); if(f.energy) parts.push(Config.t('board.energy',{count:f.energy}));
      this.fly(this.center(p.to),parts.join('  '),f.discovered?'#ffe08a':'#bfe9ff');
      if(f.combo>=3){ this.burst(this.center(p.to),'#ffd76a',f.combo>=5?20:13); this.flash(0xffd76a,f.combo>=5?.28:.14); } }
    if(p.type==='sell'){ this.fly(this.center(p.idx),`+${p.price}`,'#ffd76a'); }
    if(p.type==='unlock'){ this.burst(this.center(p.idx),'#bfe9ff',12); this.crack(this.center(p.idx)); this.shake(6,260); Haptics.unlock(); }
    if(p.type==='openChest'){ (p.spawns||[]).forEach(s=>this.burst(this.center(s.idx),'#ffe6a8',8)); this.flash(0xffe6a8,.35); this.shake(8,320); Haptics.chest(); }
    if(p.type==='move'||p.type==='swap'){ this.burst(this.center(p.to),'#dff1ff',5); }
    if(p.type&&p.type.startsWith('sb')){ this._onSandboxFx(p.type); }
  }
  _onSandboxFx(type){
    if(type==='sbBoard'){ this.flash(0x9fe3ff,.5); this.shake(10,420); Haptics.unlock();
      for(let i=24;i<this.state.cells.length;i+=4) this.burst(this.center(i),'#bfe9ff',6); }
    else if(type==='sbGens'){ this.flash(0xffe6a8,.35); this.shake(7,300); Haptics.reward(); }
    else if(type==='sbLevel'){ this.celebrate(); Haptics.level(); }
    else if(type==='sbFill'){ this.shake(5,260); Haptics.reward(); }
    else { this.shake(4,200); }
  }
  _tickTimers(){ // 冷却/霜泡/宝箱倒计时刷新
    let need=false;
    for(const [uid,n] of this.nodes){ const idx=this.nodeMeta.get(n)?.idx,c=this.state.cells[idx]; if(!c||c.uid!==uid) continue;
      if(c.k==='g' && this.state.genCdRemain(c)>0){ this._updateNode(n,c); need=true; }
      if(c.k==='c'){ this._updateNode(n,c); }
      if(c.k==='i'&&c.bubble&&c.bubbleAt&&Date.now()-c.bubbleAt>=Config.balance.bubble.autoPopSec*1000){ this.state.popBubble(idx); bus.emit('sfx','pop'); }
    }
  }

  // ---------- 动效 ----------
  tween(dur,onUpdate,onDone,instant){ this._tweens.push({t0:performance.now(),dur,onUpdate,onDone}); }
  _tickTweens(now){ const rest=[]; for(const tw of this._tweens){ let t=(now-tw.t0)/tw.dur; try{
    if(t>=1){t=1;tw.onUpdate?.(1);tw.onDone?.();} else {tw.onUpdate?.(t);rest.push(tw);}
  }catch(e){ /* 过期补间（目标已销毁）直接丢弃，绝不能中断渲染循环 */ console.warn('tween skipped',e?.message); } } this._tweens=rest; }
  fly(pos,text,color){ const t=new PIXI.Text({text,style:{fontFamily:['PingFang SC','Noto Sans CJK SC','sans-serif'],fontSize:15,fontWeight:'800',fill:color,stroke:{color:'#0b2138',width:3}}});
    t.anchor.set(.5); t.position.set(pos.x,pos.y-10); this.fxLayer.addChild(t);
    this.tween(800,o=>{t.position.y=pos.y-10-34*o;t.alpha=1-o;},()=>t.destroy()); }
  burst(pos,color,n=10){ for(let i=0;i<n;i++){ const s=new PIXI.Graphics(); s.circle(0,0,3+Math.random()*3).fill(PIXI.Color.shared.setValue(color).toNumber());
      s.position.set(pos.x,pos.y); this.fxLayer.addChild(s); const a=Math.random()*Math.PI*2, d=24+Math.random()*30;
      this.tween(520+Math.random()*200,o=>{s.position.set(pos.x+Math.cos(a)*d*o,pos.y+Math.sin(a)*d*o-6*o);s.alpha=1-o;},()=>s.destroy()); } }
}
