// 核心规则单测（Node 运行，不依赖浏览器/PIXI）
import { Config } from '../web/js/core/Config.js';
import { GameState } from '../web/js/core/GameState.js';
import { RNG } from '../web/js/core/RNG.js';

const base='http://127.0.0.1:8099/';
const _f=globalThis.fetch;
globalThis.fetch=(u)=>_f(new URL(u,base));
let pass=0,fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓',m);}else{fail++;console.error('  ✗ FAIL:',m);} };
const silence=()=>{};

await Config.load();
RNG.reseed(42);
let s=new GameState().newGame();
console.log('— 初始化 —');
ok(s.cells.length===48,'棋盘 48 格');
ok(s.boardUnlocked===24,'初始解锁 24 格');
ok(s.orders.length===3,'3 个订单槽');
ok(s.emptyCells().length>15,'有足够空格');
ok(s.orders[0].npcId==='choco'&&s.orders[0].needs[0].fam==='crystal'&&s.orders[0].needs[0].tier===2,'首单与第一次合并形成确定闭环');

console.log('— 生成器产出 —');
const before=s.emptyCells().length; s.energy=50;
const gIdx=s.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_crystal');
s.tapGenerator(gIdx);
ok(s.emptyCells().length===before-1,'产出后空格 -1');
ok(s.energy===49,'体力 -1');
let taps=1; for(;taps<8;taps++) s.tapGenerator(gIdx);
const cdCell=s.cells[gIdx];
ok(cdCell.cdUntil>Date.now(),'8 次后进入冷却');
const empt=s.emptyCells().length; s.tapGenerator(gIdx);
ok(s.emptyCells().length===empt,'冷却中不再产出');

console.log('— 合并 —');
s.cells.fill(null); s.boardUnlocked=48;
s._put(0,{k:'i',fam:'crystal',tier:1}); s._put(1,{k:'i',fam:'crystal',tier:1});
let r=s.dropOn(0,1);
ok(r==='merge'&&s.cells[1].tier===2&&!s.cells[0],'两个同级合并为下一级');
s._put(0,{k:'i',fam:'fire',tier:1});
r=s.dropOn(0,1); ok(r==='move'&&s.cells[0].fam==='crystal'&&s.cells[1].fam==='fire','异族物品换位（便于整理棋盘）');
s._put(0,{k:'i',fam:'crystal',tier:8}); s._put(2,{k:'i',fam:'crystal',tier:8});
r=s.dropOn(0,2); ok(r==='move'&&s.cells[2].tier===8,'满级不合并但可换位');

console.log('— 订单 —');
s=new GameState().newGame(); s.cells.fill(null); s.boardUnlocked=48;
const o=s.orders[0];
o.needs.forEach(q=>{ for(let k=0;k<q.n;k++){ const i=s.emptyCells()[0]; s._put(i,{k:'i',fam:q.fam,tier:q.tier}); }});
ok(s.orderReady(o),'材料齐后订单就绪');
const coin0=s.coin,xp0=s.xp,lv0=s.lv;
s.submitOrder(0);
ok(s.coin>=coin0+o.coin,'获得金币（升级可能额外奖励）');
ok(s.lv>lv0||s.xp===xp0+o.xp,'经验入账或已转化为升级');

console.log('— 升级 —');
s.lv=1;s.xp=0; const need=Config.xpNeed(1); s.addXp(need);
ok(s.lv===2&&s.energy===Config.energyMax(2),'经验达标升级且体力回满');

console.log('— 宝箱 —');
s=new GameState().newGame(); s.coin=1000; s.cells.fill(null); s.boardUnlocked=48;
s.buyChest('chest_bronze');
const ci=s.cells.findIndex(c=>c?.k==='c'); ok(ci>=0,'买到宝箱上棋盘');
const cell=s.cells[ci]; cell.openAt=Date.now()-1;
s.skipChest(ci,true);
ok(!s.cells.some(c=>c?.k==='c'),'开箱后棋盘无宝箱'); ok(s.cells.some(c=>c?.k==='i'),'掉落材料');

console.log('— 解锁格 —');
s=new GameState().newGame(); const info=s.unlockInfo();
ok(info.cost>0&&info.needLv>=1,'解锁信息正常');
s.coin=9999; const u0=s.boardUnlocked; s.unlockNext(); ok(s.boardUnlocked===u0+1,'解锁后 +1 格');

console.log('— 剧情 —');
s=new GameState().newGame(); s.coin=9999; s.cells.fill(null); s.boardUnlocked=48;
const ch=Config.story[0], n=ch.nodes[0];
n.need.forEach(q=>{for(let k=0;k<q.n;k++){const i=s.emptyCells()[0];s._put(i,{k:'i',fam:q.fam,tier:q.tier});}});
ok(s.nodeState(n,ch)==='ready','材料金币齐 -> ready');
ok(s.buildNode(ch,n)===true && s.storyDone.includes(n.id),'重建成功并记录');

console.log('— 存档往返 —');
const json=JSON.stringify(s.serialize()); const d=JSON.parse(json);
const s2=new GameState().hydrate(d);
ok(s2.cells.length===48&&s2.storyDone.length===1&&s2.coin===s.coin,'序列化/反序列化一致');

console.log('— 损坏存档迁移 —');
{
  const dirty={v:1,lv:'oops',coin:-7,gem:Infinity,energy:999999,cells:[{k:'i',fam:'__proto__',tier:99}],
    orders:[{npcId:'nobody',needs:[]}],storyDone:['n33'],settings:null,hb:{'__proto__':999},sandbox:false};
  const repaired=new GameState().hydrate(dirty);
  ok(repaired.lv===1&&repaired.coin===0&&repaired.energy<=Config.energyMax(1),'异常数值被限幅或回退');
  ok(repaired.cells.length===48&&!repaired.cells.some(c=>c?.fam==='__proto__'),'非法棋子被丢弃且棋盘完整');
  ok(repaired.orders.length===Config.balance.order.slots&&repaired.storyDone.length===0,'非法订单与跳章记录被安全修复');
  ok(repaired.cells.filter(c=>c?.k==='g').length>=2,'关键初始生成器自动恢复');
}

console.log('— 爽玩模式 —');
{
  const s=new GameState().newGame(); s.setSandbox(true);
  const coin0=s.coin, e0=s.energy;
  // 无限体力：连点 30 次生成器不掉体力、不冷却
  const gi=s.cells.findIndex(c=>c?.k==='g');
  for(let i=0;i<30;i++) s.tapGenerator(gi);
  ok(s.energy===e0,'爽玩模式体力不消耗');
  ok(!s.cells[gi].cdUntil,'爽玩模式生成器无冷却');
  // 无限金币：0 金币也能解锁/购买
  s.coin=0; s.lv=20; const u0=s.boardUnlocked; s.unlockNext(); ok(s.boardUnlocked===u0+1&&s.coin===0,'0 金币也能融化棋盘');
  s.coin=0; s.buyGenerator('g_drink'); ok(s.ownedGens.includes('g_drink')&&s.coin===0,'0 金币也能买生成器');
  // 一键全开
  s.sbUnlockBoard(); ok(s.boardUnlocked===48,'一键融化全部 48 格');
  const lv=s.sbAddLevel(5); ok(lv>=6,'一键直升 5 级');
  s.cells.fill(null); s._put(7,{k:'g',gid:'g_crystal'}); const n=s.sbFillMaterials(); ok(n>0,'一键铺满材料');
  const cleared=s.sbClearItems(); ok(cleared===n&&s.cells.some(c=>c?.k==='g'),'一键清空只留生成器');
  // 存档保留爽玩标记
  const s2=new GameState().hydrate(JSON.parse(JSON.stringify(s.serialize()))); ok(s2.sandbox===true,'爽玩状态随存档持久化');
  s.setSandbox(false); ok(!s.sandbox,'可关闭爽玩模式');
}

console.log('— 三章完整试玩链 —');
{
  const s=new GameState().newGame(); s.setSandbox(true);
  let built=0;
  while(built<20){
    const prepared=s.sbPrepareNextStory();
    if(prepared.finished) break;
    ok(s.nodeState(prepared.node,prepared.chapter)==='ready',`节点 ${prepared.node.id} 已精确备料`);
    ok(s.buildNode(prepared.chapter,prepared.node),`节点 ${prepared.node.id} 可完成`);
    built++;
  }
  ok(built===9&&s.storyDone.length===9,'三章九节点全部贯通');
  ok(s.sbPrepareNextStory().finished===true,'通关后正确返回已完成');
}

console.log('— 六步新手核心链 —');
{
  const guide=new GameState().newGame();
  const gi=guide.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_crystal');
  guide.tapGenerator(gi); ok(guide.tutorial.produced,'点生成器后推进教学');
  guide.dropOn(13,14); ok(guide.tutorial.merged&&guide.orderReady(guide.orders[0]),'首次合并后首单可交付');
  guide.submitOrder(0); ok(guide.tutorial.ordered&&guide.coin>=130,'首单交付后有足够金币继续教学');
  guide.unlockNext(); ok(guide.tutorial.unlocked&&guide.boardUnlocked===25,'融化冰封格后推进教学');
}

console.log('— 失败交易原子性 —');
{
  const chest=new GameState().newGame(); chest.coin=0;
  const chestCells=JSON.stringify(chest.cells);
  const chestResult=chest.buyChest('chest_bronze');
  ok(chestResult?.ok===false&&chestResult.code==='insufficient_coin','宝箱金币不足返回明确失败');
  ok(chest.coin===0&&JSON.stringify(chest.cells)===chestCells,'宝箱失败不扣资源、不改棋盘');

  const generator=new GameState().newGame(); generator.lv=20; generator.coin=0;
  const generatorCells=JSON.stringify(generator.cells), owned=[...generator.ownedGens];
  const generatorResult=generator.buyGenerator('g_drink');
  ok(generatorResult?.ok===false&&generatorResult.code==='insufficient_coin','生成器金币不足返回明确失败');
  ok(generator.coin===0&&JSON.stringify(generator.cells)===generatorCells&&JSON.stringify(generator.ownedGens)===JSON.stringify(owned),'生成器失败不产生部分写入');

  const energy=new GameState().newGame(); energy.gem=0; energy.energy=3;
  const energyResult=energy.buyEnergyPotion();
  ok(energyResult?.ok===false&&energyResult.code==='insufficient_gem'&&energy.gem===0&&energy.energy===3,'体力瓶失败不扣钻石、不改体力');

  const unlock=new GameState().newGame(); unlock.lv=20; unlock.coin=0;
  const unlocked=unlock.boardUnlocked;
  const unlockResult=unlock.unlockNext();
  ok(unlockResult?.ok===false&&unlockResult.code==='insufficient_coin'&&unlock.boardUnlocked===unlocked,'融化失败不改解锁数');

  const skip=new GameState().newGame(); skip.cells.fill(null); skip.boardUnlocked=48; skip.gem=0;
  const kept=skip._put(0,{k:'c',cid:'chest_bronze',openAt:Date.now()+30_000});
  const skipResult=skip.skipChest(0,false);
  ok(skipResult?.ok===false&&skipResult.code==='insufficient_gem'&&skip.cells[0]?.uid===kept.uid&&skip.gem===0,'宝箱加速失败保留宝箱');

  const refresh=new GameState().newGame(); refresh.coin=0;
  const oldOrder=refresh.orders[0].id, oldCost=refresh.refreshCost;
  const refreshResult=refresh.refreshOrder(0);
  ok(refreshResult?.ok===false&&refreshResult.code==='insufficient_coin'&&refresh.orders[0].id===oldOrder&&refresh.refreshCost===oldCost,'订单刷新失败保留原订单与价格');

  const submit=new GameState().newGame();
  const submitCells=JSON.stringify(submit.cells), submitOrder=submit.orders[0].id, submitCoin=submit.coin;
  const submitResult=submit.submitOrder(0);
  ok(submitResult?.ok===false&&submitResult.code==='requirements_not_met','材料不足交付返回明确失败');
  ok(JSON.stringify(submit.cells)===submitCells&&submit.orders[0].id===submitOrder&&submit.coin===submitCoin,'交付失败不扣材料、不替换订单');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
