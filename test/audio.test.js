import { AudioMgr } from '../web/js/core/Audio.js';

let pass=0,fail=0;
const ok=(condition,message)=>{ if(condition){ pass++; console.log('  ✓',message); }
  else { fail++; console.error('  ✗ FAIL:',message); } };
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

const instances=[];
const attempts=new Map();
class FakeAudio {
  constructor(url){ this.src=url; this.volume=1; this.paused=false; instances.push(this); }
  play(){
    const count=(attempts.get(this.src)||0)+1; attempts.set(this.src,count);
    if(this.src==='voice/blocked.ogg'&&count===1) return Promise.reject(Object.assign(new Error('gesture required'),{name:'NotAllowedError'}));
    if(this.src==='voice/missing.ogg') return Promise.reject(Object.assign(new Error('missing'),{name:'NotSupportedError'}));
    return Promise.resolve();
  }
  pause(){ this.paused=true; }
  removeAttribute(name){ if(name==='src') this.src=''; }
}
globalThis.Audio=FakeAudio;

AudioMgr.stopVoice();
AudioMgr.ready=true;
AudioMgr.ctx={resume:async()=>{}};
AudioMgr.voiceOn=true;

console.log('— 移动端配音队列回归 —');
AudioMgr.playVoiceSequence(['voice/blocked.ogg','voice/next.ogg']);
await tick();
ok(AudioMgr.pendingVoice==='voice/blocked.ogg'&&AudioMgr.voiceEl===null&&AudioMgr.voiceQueue.length===1,
  '首句被自动播放策略拒绝时保留原句和后续队列');
await AudioMgr.unlock();
ok(AudioMgr.voiceEl?.src==='voice/blocked.ogg'&&attempts.get('voice/blocked.ogg')===2,
  '首次手势解锁后重试的仍是被拦截的原句');
AudioMgr.voiceEl.onended();
ok(AudioMgr.voiceEl?.src==='voice/next.ogg'&&AudioMgr.pendingVoice==='voice/next.ogg',
  '原句结束后才播放队列下一句');
AudioMgr.voiceEl.onended();
ok(AudioMgr.voiceEl===null&&AudioMgr.pendingVoice===null&&AudioMgr.voiceQueue.length===0,
  '配音队列完成后正确清空');

AudioMgr.playVoiceSequence(['voice/missing.ogg','voice/recovery.ogg']);
await tick();
ok(AudioMgr.voiceEl?.src==='voice/recovery.ogg'&&AudioMgr.pendingVoice==='voice/recovery.ogg',
  '文件缺失只跳过损坏句，不会卡住后续对白');
AudioMgr.stopVoice();

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
