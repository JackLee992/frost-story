// 音频管理：BGM/环境声用 HTMLAudio（可循环、可交叉淡化），短音效用 WebAudio（低延迟、可叠加）
const SFX = {
  merge:'assets/audio/sfx_merge.wav', tap:'assets/audio/sfx_tap.wav', reward:'assets/audio/sfx_reward.wav',
  click:'assets/audio/sfx_click.wav', unlock:'assets/audio/sfx_unlock.wav', pop:'assets/audio/sfx_pop.wav',
  chime:'assets/audio/sfx_chime.wav', page:'assets/audio/sfx_page.wav', flame:'assets/audio/sfx_flame.wav'
};
// 分章 BGM：键与 story.json 中 chapter.bgm 对应
const BGM_TRACKS = {
  bgm:'assets/audio/bgm.wav',
  bgm_street:'assets/audio/bgm_street.ogg',
  bgm_temple:'assets/audio/bgm_temple.ogg',
  bgm_harbor:'assets/audio/bgm_harbor.ogg',
  bgm_memory:'assets/audio/bgm_memory.ogg',
  bgm_spring:'assets/audio/bgm_spring.ogg'
};
const BGM_BASE_VOL=.4, BGM_DUCK_VOL=.14, WIND_URL='assets/audio/amb_wind.ogg';
class AudioManager {
  constructor(){ this.bgmOn=true; this.sfxOn=true; this.voiceOn=true; this.bufs={}; this.ctx=null; this.ready=false;
    this.bgmKey=null; this.bgmEl=null; this.windEl=null; this.voiceEl=null; this.pendingVoice=null;
    this._windTarget=0; this._fadeTimer=0; this._unlocking=null; }
  async unlock(){
    if(this.ready){ try{await this.ctx?.resume();}catch{} this._bgPlay(); this._windPlay();
      if(this.pendingVoice&&!this.voiceEl) this._startVoice(this.pendingVoice); return; }
    if(this._unlocking) return this._unlocking;
    this._unlocking=this._unlock();
    try{ return await this._unlocking; } finally { this._unlocking=null; }
  }
  async _unlock(){
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      await this.ctx.resume();
      // GeckoView 个别设备的 decodeAudioData 可能迟迟不返回；短音效在后台预热，
      // 绝不能让它阻塞“点亮风灯”后的首句语音和剧情转场。
      Promise.allSettled(Object.entries(SFX).map(async ([k,u])=>{ this.bufs[k]=await this._dec(u); }))
        .then(results=>{ if(results.some(result=>result.status==='rejected')) console.warn('some sfx failed to preload'); });
      // 环境风雪层（循环，默认按章节情绪调音量）
      this.windEl=new Audio(WIND_URL); this.windEl.loop=true; this.windEl.volume=0; this._windPlay();
      this._windTimer=setInterval(()=>{ if(!this.windEl) return;
        const target=this.bgmOn?this._windTarget*.16:0;
        if(Math.abs(this.windEl.volume-target)<.001) this.windEl.volume=target;
        else this.windEl.volume+=(target-this.windEl.volume)*.08; },120);
      this.ready=true;
      if(this.bgmKey) this._ensureBgm(this.bgmKey); else this.playBgm('bgm',0);
      if(this.pendingVoice&&!this.voiceEl) this._startVoice(this.pendingVoice);
    }catch(e){ console.warn('audio init failed', e); }
  }
  async _dec(u){ return this.ctx.decodeAudioData(await fetch(u).then(r=>r.arrayBuffer())); }
  _bgPlay(){ if(this.bgmOn && this.bgmEl) this.bgmEl.play().catch(()=>{}); }
  _windPlay(){ if(this.bgmOn && this.windEl) this.windEl.play().catch(()=>{}); }
  _ensureBgm(key){
    const url=BGM_TRACKS[key]||BGM_TRACKS.bgm;
    if(!this.bgmEl){ this.bgmEl=new Audio(url); this.bgmEl.loop=true; this.bgmEl.volume=BGM_BASE_VOL; this.bgmKey=key; this._bgPlay(); return; }
    if(this.bgmKey===key) return;
    const old=this.bgmEl, next=new Audio(url); next.loop=true; next.volume=0;
    this.bgmEl=next; this.bgmKey=key; this._bgPlay();
    clearInterval(this._fadeTimer);
    const t0=performance.now(), dur=650, from=old.volume, target=this.voiceEl?BGM_DUCK_VOL:BGM_BASE_VOL;
    this._fadeTimer=setInterval(()=>{ const k=Math.min(1,(performance.now()-t0)/dur);
      old.volume=from*(1-k); next.volume=target*k;
      if(k>=1){ clearInterval(this._fadeTimer); old.pause(); old.src=''; } },30);
  }
  // 切换分章 BGM（fadeMs=0 表示不淡化，用于启动）
  playBgm(key, fadeMs=650){ if(!key) return;
    if(!this.ready){ this.bgmKey=key; return; }
    if(fadeMs===0){ this._ensureBgm(key); if(this.bgmEl) this.bgmEl.volume=BGM_BASE_VOL; return; }
    this._ensureBgm(key);
  }
  // 风雪环境声强度 0~1：寒冷章节更强，回暖章节渐弱（游戏推进影响听感）
  setWind(level){ this._windTarget=Math.max(0,Math.min(1,Number(level)||0));
    if(!this.windEl) return;
    const target=this.bgmOn?this._windTarget*.16:0;
    this.windEl.volume+=(target-this.windEl.volume)*.1; }
  play(n){
    if(!this.sfxOn || !this.ctx || !this.bufs[n]) return;
    const t=this.ctx.currentTime, s=this.ctx.createBufferSource();
    s.buffer=this.bufs[n]; const g=this.ctx.createGain(); g.gain.value=.85;
    s.connect(g).connect(this.ctx.destination); s.start(t);
  }
  playVoice(url){
    this.stopVoice(false); this.pendingVoice=typeof url==='string'?url:null;
    if(!this.voiceOn||!this.pendingVoice){ this.pendingVoice=null; this._restoreBgm(); return; }
    // HTMLAudio 与 WebAudio/SFX 解码彼此独立。这里必须在玩家点击的同一调用栈
    // 直接 play，GeckoView 才会把它识别为用户授权的媒体播放；若失败，
    // pendingVoice 仍保留，AudioContext 解锁完成后可再尝试一次。
    this._startVoice(this.pendingVoice);
  }
  _startVoice(url){
    if(!this.voiceOn||!url) return;
    this.stopVoice(false); this.pendingVoice=url;
    const voice=new Audio(url); voice.preload='auto'; voice.volume=.96; this.voiceEl=voice;
    if(this.bgmEl) this.bgmEl.volume=BGM_DUCK_VOL;
    const finish=()=>{ if(this.voiceEl!==voice) return; this.voiceEl=null; this.pendingVoice=null; this._restoreBgm(); };
    voice.onended=finish; voice.onerror=finish;
    voice.play().catch(()=>{ if(this.voiceEl===voice){ this.voiceEl=null; this._restoreBgm(); } });
  }
  stopVoice(restore=true){
    const voice=this.voiceEl; this.voiceEl=null;
    if(voice){ voice.onended=null; voice.onerror=null; voice.pause(); voice.removeAttribute('src'); }
    this.pendingVoice=null; if(restore) this._restoreBgm();
  }
  _restoreBgm(){ if(this.bgmEl) this.bgmEl.volume=BGM_BASE_VOL; }
  setBgm(on){ this.bgmOn=on;
    if(!on){ this.bgmEl?.pause(); this.windEl?.pause(); return; }
    this._restoreBgm(); if(this.voiceEl&&this.bgmEl) this.bgmEl.volume=BGM_DUCK_VOL; this._bgPlay(); this._windPlay();
  }
  setSfx(on){ this.sfxOn=on; }
  setVoice(on){ this.voiceOn=on!==false; if(!this.voiceOn) this.stopVoice(); }
}
export const AudioMgr = new AudioManager();
