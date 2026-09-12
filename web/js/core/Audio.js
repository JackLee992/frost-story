// 音频管理：BGM 用 HTMLAudio 循环，短音效用 WebAudio（低延迟、可叠加）
const SFX = {
  merge:'assets/audio/sfx_merge.wav', tap:'assets/audio/sfx_tap.wav', reward:'assets/audio/sfx_reward.wav',
  click:'assets/audio/sfx_click.wav', unlock:'assets/audio/sfx_unlock.wav', pop:'assets/audio/sfx_pop.wav'
};
class AudioManager {
  constructor(){ this.bgmOn=true; this.sfxOn=true; this.bufs={}; this.ctx=null; this.bg=null; this.ready=false; }
  async unlock(){
    if(this.ctx){ this._bgPlay(); return; }
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      await this.ctx.resume();
      await Promise.all(Object.entries(SFX).map(async ([k,u])=>{ try{ this.bufs[k]=await this._dec(u); }catch(e){} }));
      this.bg = new Audio('assets/audio/bgm.wav'); this.bg.loop=true; this.bg.volume=.4;
      this.ready=true; this._bgPlay();
    }catch(e){ console.warn('audio init failed', e); }
  }
  async _dec(u){ return this.ctx.decodeAudioData(await fetch(u).then(r=>r.arrayBuffer())); }
  _bgPlay(){ if(this.bgmOn && this.bg) this.bg.play().catch(()=>{}); }
  play(n){
    if(!this.sfxOn || !this.ctx || !this.bufs[n]) return;
    const t=this.ctx.currentTime, s=this.ctx.createBufferSource();
    s.buffer=this.bufs[n]; const g=this.ctx.createGain(); g.gain.value=.85;
    s.connect(g).connect(this.ctx.destination); s.start(t);
  }
  setBgm(on){ this.bgmOn=on; if(!this.bg) return; on?this.bg.play().catch(()=>{}):this.bg.pause(); }
  setSfx(on){ this.sfxOn=on; }
}
export const AudioMgr = new AudioManager();
