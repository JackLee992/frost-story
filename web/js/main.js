// 启动入口：加载 -> 读档 -> WebGL 场景 -> UI
import { Config } from './core/Config.js';
import { GameState } from './core/GameState.js';
import { Save } from './core/Save.js';
import { AudioMgr } from './core/Audio.js';
import { Haptics } from './core/Haptics.js';
import { BoardScene } from './scenes/BoardScene.js';
import { UI } from './ui/UI.js';

// Android 壳注入真实 DisplayCutout / 系统手势边距；浏览器则由 CSS env() 兜底。
// 这里只接受有限数值，避免异常参数把核心玩法区域挤出屏幕。
const query=new URLSearchParams(location.search);
const inset=name=>{
  const value=Number.parseFloat(query.get(name)??'0');
  return Number.isFinite(value)?Math.min(120,Math.max(0,value)):0;
};
const safeInsets=Object.freeze({
  top:inset('safeTop'),right:inset('safeRight'),bottom:inset('safeBottom'),left:inset('safeLeft')
});
for(const [side,value] of Object.entries(safeInsets)){
  document.documentElement.style.setProperty(`--native-safe-${side[0]}`,`${value}px`);
}
window.__frostSafeInsets=safeInsets;
const contentVersion=query.get('contentVersion')||'bundled';
document.documentElement.dataset.contentVersion=/^[0-9A-Za-z._-]{1,64}$/.test(contentVersion)?contentVersion:'bundled';

const fill=document.getElementById('loadFill'), tip=document.getElementById('loadTip');
const setP=p=>fill.style.width=Math.round(p*100)+'%';

(async function main(){
  try{
    setP(.08);
    await Config.load(m=>{tip.textContent=m;setP(.18);});
    setP(.3);
    // 注册并预加载全部纹理
    const aliases=Object.keys(Config.textures);
    aliases.forEach(a=>PIXI.Assets.add({alias:a,src:Config.textures[a]}));
    let n=0;
    await PIXI.Assets.load(aliases,p=>{ n=p*0.5+0.3; setP(n); });
    setP(.86); tip.textContent='唤醒霜语谷…';

    const saved=Save.load();
    const state=new GameState();
    let isNew=false;
    if(saved){ state.hydrate(saved); } else { state.newGame(); isNew=true; }
    AudioMgr.setBgm(state.settings.bgm); AudioMgr.setSfx(state.settings.sfx); Haptics.setEnabled(state.settings.sfx);

    const scene=new BoardScene(state,document.getElementById('board'));
    await scene.init();
    const ui=new UI(state,scene);
    ui.renderHUD(); ui.renderOrders(); ui.renderQuest(); ui._tutorial();
    setP(1);

    document.getElementById('ui').classList.remove('hidden');
    setTimeout(()=>document.getElementById('loading').style.cssText='opacity:0;transition:opacity .5s;pointer-events:none',300);
    setTimeout(()=>document.getElementById('loading').remove(),900);

    // 按当前主线章节设置 BGM 与风雪强度（音频在首次手势后才真正出声）
    const obj=state.currentObjective();
    if(obj) ui._applyMood(obj.chapter);
    else AudioMgr.playBgm('bgm_spring');

    // 首次手势解锁音频（移动端自动播放限制）
    const unlock=()=>{ AudioMgr.unlock(); window.removeEventListener('pointerdown',unlock); };
    window.addEventListener('pointerdown',unlock);
    const flushSave=()=>Save.saveNow(state);
    window.addEventListener('beforeunload',flushSave);
    window.addEventListener('pagehide',flushSave);
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushSave(); });

    if(isNew){
      setTimeout(()=>ui.welcome(),700);
    } else {
      // 老玩家：若有已开放却未看过场的章节，补播章节开场，保持故事连续
      setTimeout(()=>ui._maybeChapterIntro(),900);
    }
    window.__game={state,scene,ui,Config};
  }catch(err){
    console.error(err);
    tip.textContent='加载失败：'+err.message;
  }
})();
