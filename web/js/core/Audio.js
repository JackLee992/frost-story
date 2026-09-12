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
const BGM_BASE_VOL=.4, WIND_URL='assets/audio/amb_wind.ogg';
class AudioManager {
  constructor(){ this.bgmOn=true; this.sfxOn=true; this.bufs={}; this.ctx=null; this.ready=false;
    this.bgmKey=null; this.bgmEl=null; this.windEl=null; this._windTarget=0; this._fadeTimer=0; }
  async unlock(){
    if(this.ctx){ this._bgPlay(); this._windPlay(); return; }
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      await this.ctx.resume();
      await Promise.all(Object.entries(SFX).map(async ([k,u])=>{ try{ this.bufs[k]=await this._dec(u); }catch(e){} }));
      // 环境风雪层（循环，默认按章节情绪调音量）
      this.windEl=new Audio(WIND_URL); this.windEl.loop=true; this.windEl.volume=0; this._windPlay();
      this._windTimer=setInterval(()=>{ if(!this.windEl) return;
        const target=this.bgmOn?this._windTarget*.16:0;
        if(Math.abs(this.windEl.volume-target)<.001) this.windEl.volume=target;
        else this.windEl.volume+=(target-this.windEl.volume)*.08; },120);
      this.ready=true;
      if(this.bgmKey) this._ensureBgm(this.bgmKey); else this.playBgm('bgm',0);
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
    const t0=performance.now(), dur=650, from=old.volume;
    this._fadeTimer=setInterval(()=>{ const k=Math.min(1,(performance.now()-t0)/dur);
      old.volume=from*(1-k); next.volume=BGM_BASE_VOL*k;
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
  setBgm(on){ this.bgmOn=on;
    if(!on){ this.bgmEl?.pause(); this.windEl?.pause(); return; }
    this._bgPlay(); this._windPlay();
  }
  setSfx(on){ this.sfxOn=on; }
}
export const AudioMgr = new AudioManager();
