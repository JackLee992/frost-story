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

// Android 的软键盘在 edge-to-edge 模式下可能只缩小 visualViewport，而不改变
// 100vh/layout viewport。把真实可见高度交给 CSS，避免昵称输入框和提交按钮落在键盘下方。
const syncVisualViewport=()=>{
  const viewport=window.visualViewport;
  const height=Math.max(240,Math.min(window.innerHeight,Number(viewport?.height)||window.innerHeight));
  const top=Math.max(0,Number(viewport?.offsetTop)||0);
  document.documentElement.style.setProperty('--visual-vh',`${height}px`);
  document.documentElement.style.setProperty('--visual-top',`${top}px`);
  document.body.classList.toggle('keyboard-open',height<window.innerHeight-120);
};
let viewportFrame=0;
const queueVisualViewport=()=>{ cancelAnimationFrame(viewportFrame); viewportFrame=requestAnimationFrame(syncVisualViewport); };
syncVisualViewport();
window.visualViewport?.addEventListener('resize',queueVisualViewport);
window.visualViewport?.addEventListener('scroll',queueVisualViewport);
window.addEventListener('resize',queueVisualViewport);
const contentVersion=query.get('contentVersion')||'bundled';
document.documentElement.dataset.contentVersion=/^[0-9A-Za-z._-]{1,64}$/.test(contentVersion)?contentVersion:'bundled';

const fill=document.getElementById('loadFill'), tip=document.getElementById('loadTip');
const setP=p=>fill.style.width=Math.round(p*100)+'%';
const bootLocale=Config.normalizeLocale(query.get('lang')||Save.locale());
const BOOT_TEXT={
  'zh-CN':{title:'冰霜物语',subtitle:'合并 · 重建 · 温暖山谷',config:'读取故事与数值……',chains:'整理合成路线……',waking:'唤醒霜语谷……',failed:'加载失败'},
  en:{title:'Frost Story',subtitle:'MERGE · REBUILD · WARM THE VALLEY',config:'Loading stories and balance…',chains:'Mapping merge chains…',waking:'Waking Frostwhisper Valley…',failed:'Failed to load'},
  ja:{title:'フロスト・ストーリー',subtitle:'マージ · 復興 · 谷に温もりを',config:'物語を読み込み中…',chains:'マージ経路を整理中…',waking:'霜語りの谷を起こしています…',failed:'読み込みに失敗しました'},
  ko:{title:'프로스트 스토리',subtitle:'합치고 · 다시 세우고 · 골짜기를 따뜻하게',config:'이야기와 밸런스를 불러오는 중…',chains:'합성 경로를 정리하는 중…',waking:'서리말 골짜기를 깨우는 중…',failed:'불러오기에 실패했어요'}
};
const boot=BOOT_TEXT[bootLocale];
document.documentElement.lang=bootLocale;
document.title=boot.title;
document.querySelector('#loading .game-title').textContent=boot.title;
document.querySelector('#loading .game-sub').textContent=boot.subtitle;
tip.textContent=boot.waking;

(async function main(){
  try{
    setP(.08);
    await Config.load(stage=>{tip.textContent=boot[stage]||boot.waking;setP(.18);},bootLocale);
    setP(.3);
    // 注册并预加载全部纹理
    const aliases=Object.keys(Config.textures);
    aliases.forEach(a=>PIXI.Assets.add({alias:a,src:Config.textures[a]}));
    let n=0;
    await PIXI.Assets.load(aliases,p=>{ n=p*0.5+0.3; setP(n); });
    setP(.86); tip.textContent=Config.t('loading.waking');

    const saved=Save.load();
    const state=new GameState();
    let isNew=false;
    if(saved){ state.hydrate(saved); } else { state.newGame(); isNew=true; }
    AudioMgr.setBgm(state.settings.bgm); AudioMgr.setSfx(state.settings.sfx); AudioMgr.setVoice(state.settings.voice); Haptics.setEnabled(state.settings.sfx);

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
    } else if(!state.profile?.nickname){
      // v0.1/v0.2 存档升级后，用一小段剧情补建玩家档案，不打断或重置已有进度。
      setTimeout(()=>ui._profileStory(),900);
    } else {
      // 老玩家：若有已开放却未看过场的章节，补播章节开场，保持故事连续
      setTimeout(()=>ui._maybeChapterIntro(),900);
    }
    // 测试/真机诊断入口：只暴露运行态对象，不包含任何凭据或外部接口。
    window.__game={state,scene,ui,Config,AudioMgr};
  }catch(err){
    console.error(err);
    tip.textContent=(Config.ui?Config.t('loading.failed',{error:err.message}):`${boot.failed}: ${err.message}`);
  }
})();
