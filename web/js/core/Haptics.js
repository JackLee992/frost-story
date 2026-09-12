// 触觉反馈：封装 navigator.vibrate（Android GeckoView 已声明 VIBRATE 权限）
// 不支持的平台静默忽略；跟随“游戏音效”开关
export const Haptics = {
  enabled:true,
  setEnabled(v){ this.enabled=!!v; },
  run(p){ if(!this.enabled) return; try{ if(navigator.vibrate) navigator.vibrate(p); }catch(_){} },
  tap(){ this.run(12); },                 // 点按生成器：轻触
  merge(){ this.run([10,18,22]); },       // 合成：两段脆响
  pop(){ this.run([6,12,6,12,14]); },     // 破冰/霜泡：连续碎裂
  reward(){ this.run([8,20,30]); },       // 交付/奖励：上扬
  unlock(){ this.run([14,24,40]); },      // 解锁/重建：厚重
  chest(){ this.run([10,16,10,16,26]); }, // 宝箱
  level(){ this.run([16,30,16,30,60]); }  // 升级：长振动
};
