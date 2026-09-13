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
ok(s.emptyCells().length>=12,'开局连锁素材加入后仍有足够空格');
ok(s.orders[0].npcId==='gunnar'&&s.orders[0].needs[0].fam==='crystal'&&s.orders[0].needs[0].tier===2,'冈特带剧情登场，首个请求与第一次合并形成确定闭环');
ok(s.orders.every(order=>order.accepted===false),'新委托默认等待玩家回应，不会自动接取');
ok(new Set(s.orders.map(order=>order.npcId)).size===s.orders.length,'同一批请求不会让同一村民重复登场');
ok(s.settings.ordersCollapsed===true&&s.settings.questCollapsed===true,'委托与主线默认收进任务架');
ok(s.settings.voice===true,'剧情语音默认开启');
ok(s.settings.language==='zh-CN'&&s.settings.voiceLanguage===s.settings.language,'游戏语言与配音语言首次默认一致');
ok(s.setVoiceLanguage('ja')?.ok===true&&s.settings.language==='zh-CN'&&s.settings.voiceLanguage==='ja','配音语言可独立切换而不改变字幕语言');
ok(s.setVoiceLanguage('xx')?.ok===false&&s.settings.voiceLanguage==='ja','未支持的配音语言不会污染设置');
ok(s.profile?.nickname===''&&s.playerName==='提灯人','新玩家以未命名的提灯人身份进入序章');

console.log('— 玩家档案与昵称安全迁移 —');
{
  const profile=new GameState().newGame();
  ok(profile.setNickname('  雪团  ')?.ok===true&&profile.profile.nickname==='雪团','剧情中输入的昵称会规范化并保存');
  ok(profile.setNickname('')?.ok===false&&profile.profile.nickname==='雪团','空昵称不会覆盖已有档案');
  ok(profile.setNickname('<img>')?.ok===false&&profile.profile.nickname==='雪团','危险标记不能写入玩家称呼');
  ok(profile.setNickname('这是一个远远超过十二个字的玩家昵称')?.ok===false,'昵称长度限制按 Unicode 字符执行');
  const restored=new GameState().hydrate(JSON.parse(JSON.stringify(profile.serialize())));
  ok(restored.profile.nickname==='雪团'&&restored.playerName==='雪团','昵称随游戏存档往返');
  const repaired=new GameState().hydrate({profile:{nickname:'<script>'}});
  ok(repaired.profile.nickname===''&&repaired.playerName==='提灯人','损坏或危险的旧档案会回退为未命名状态');
}

console.log('— 前三章爽感与材料来源 —');
{
  // 成熟 Merge-2 首局会预摆一条可连续合成的短链，让玩家先体验升级与爆点，
  // 而不是先连续点十几次生成器。开局火种应能直接连锁到首个主线目标。
  const starter=new GameState().newGame();
  let cascade=true;
  for(let tier=1;tier<5;tier++){
    const pair=starter.cells.map((cell,idx)=>cell?.k==='i'&&cell.fam==='fire'&&cell.tier===tier?idx:-1).filter(idx=>idx>=0).slice(0,2);
    if(pair.length<2){ cascade=false; break; }
    if(starter.dropOn(pair[0],pair[1])!=='merge'){ cascade=false; break; }
  }
  ok(cascade&&starter.countItem('fire',5)>=1,'开局预摆链可四连合成首个主线材料');

  const source=typeof starter.materialSource==='function'?starter.materialSource('wood',3,2):null;
  ok(source?.generatorId==='g_wood'&&source.generatorName==='雪松堆'
    &&source.itemName==='木板'&&source.baseNeeded===8
    &&source.path.join(' → ')==='松枝 → 木段 → 木板','缺少木板时能给出生成器、合成路径和基础材料量');
  const guided=new GameState().newGame(),flameSource=guided.materialSource('fire',5,1);
  ok(flameSource.boardCanCraft&&flameSource.nextPair?.length===2
    &&flameSource.nextPair.every(idx=>guided.cells[idx]?.fam==='fire'),
    '棋盘已有材料时给出下一对可合并位置，而不是只把玩家送去生成器');

  // 每种主线需求必须在它第一次出现前已拥有对应生成器；前三章不靠猜商店解死路。
  const available=new Set(['crystal','fire']); let sourceFlow=true;
  for(const ch of Config.story.slice(0,3)) for(const node of ch.nodes){
    if(node.need.some(q=>!available.has(q.fam))) sourceFlow=false;
    const ids=[node.reward?.generator,...(node.reward?.generators||[])].filter(Boolean);
    ids.forEach(id=>{ const gen=Config.genById(id); if(gen) available.add(gen.family); });
  }
  ok(sourceFlow,'前三章每种材料链在被主线要求前都有剧情解锁的生成器');

  const early=Config.story.slice(0,3).flatMap(ch=>ch.nodes);
  const effort=node=>node.need.reduce((sum,q)=>sum+q.n*Math.pow(2,q.tier-1),0);
  ok(early.every(node=>effort(node)<=96),'前三章单节点不超过 96 个一级材料等价量');
  ok(early.every(node=>(node.reward?.coin||0)>=node.coin
    &&(node.reward?.energy||0)>=8&&(node.reward?.freeTaps||0)>=6),'前三章每段主线净赚金币并续上体力与余温生成');

  const rush=new GameState().newGame();
  const firstTwo=Config.story.slice(0,2).flatMap(ch=>ch.nodes);
  firstTwo.forEach(node=>rush.addXp(node.reward?.xp||0));
  ok(rush.lv>=10,'前两章主线奖励可形成连续十级冲刺');
  ok(Config.xpNeed(9)<=100&&Config.xpNeed(10)>=400,'Lv.10 前升级轻快，Lv.10 后切回长期成长曲线');

  const journey=new GameState().newGame(); let naturallyOpen=true;
  for(const ch of Config.story.slice(0,2)) for(const node of ch.nodes){
    for(let i=0;i<journey.cells.length;i++) if(journey.cells[i]?.k!=='g') journey.cells[i]=null;
    for(const q of node.need) for(let n=0;n<q.n;n++) journey._put(journey.emptyCells()[0],{k:'i',fam:q.fam,tier:q.tier});
    if(journey.nodeState(node,ch)!=='ready'||!journey.buildNode(ch,node)){ naturallyOpen=false; break; }
  }
  ok(naturallyOpen&&journey.lv>=10,'正常奖励结算即可逐段解锁前两章并到达 Lv.10，无隐藏等级墙');
}

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
{
  const warm=new GameState().newGame(),idx=warm.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_fire');
  warm.energy=7; warm.freeTaps=2; warm.cells[idx].cdUntil=Date.now()+10_000;
  warm.tapGenerator(idx);
  ok(warm.energy===7&&warm.freeTaps===1&&warm.cells[idx].cdUntil>Date.now(),
    '余温生成不耗体力且可在充能期间使用，但不会篡改原冷却');
}

console.log('— 合并 —');
s.cells.fill(null); s.boardUnlocked=48;
s._put(0,{k:'i',fam:'crystal',tier:1}); s._put(1,{k:'i',fam:'crystal',tier:1});
let r=s.dropOn(0,1);
ok(r==='merge'&&s.cells[1].tier===2&&!s.cells[0],'两个同级合并为下一级');
s._put(0,{k:'i',fam:'fire',tier:1});
r=s.dropOn(0,1); ok(r==='move'&&s.cells[0].fam==='crystal'&&s.cells[1].fam==='fire','异族物品换位（便于整理棋盘）');
s._put(0,{k:'i',fam:'crystal',tier:8}); s._put(2,{k:'i',fam:'crystal',tier:8});
r=s.dropOn(0,2); ok(r==='move'&&s.cells[2].tier===8,'满级不合并但可换位');

console.log('— 合并爽感反馈 —');
{
  const flow=new GameState().newGame(); flow.cells.fill(null); flow.boardUnlocked=48;
  flow.lv=8; flow.energy=10; flow.coin=0; flow.xp=0;
  const fams=['crystal','fire','wood'];
  fams.forEach((fam,i)=>{
    flow._put(i*2,{k:'i',fam,tier:1}); flow._put(i*2+1,{k:'i',fam,tier:1});
    flow.dropOn(i*2,i*2+1);
  });
  ok(flow.stats.discover===3&&flow.coin>=6&&flow.xp>=6,'首次合成新物品立即奖励金币与经验');
  ok(flow.energy===12&&flow.lastMergeFeedback?.combo===3&&flow.lastMergeFeedback?.energy===2,
    '三次连续合并触发暖流连击并返还体力');

  const saved=new GameState().newGame(); saved.cells.fill(null); saved.boardUnlocked=48; saved.coin=0;
  saved._put(0,{k:'i',fam:'wood',tier:1}); saved._put(1,{k:'i',fam:'wood',tier:1}); saved.dropOn(0,1);
  const restored=new GameState().hydrate(JSON.parse(JSON.stringify(saved.serialize()))),coinAfterDiscovery=restored.coin;
  restored._put(2,{k:'i',fam:'wood',tier:1}); restored._put(3,{k:'i',fam:'wood',tier:1}); restored.dropOn(2,3);
  ok(restored.stats.discover===1&&restored.coin===coinAfterDiscovery,'发现奖励随存档去重，重载不能重复刷取');
}

console.log('— 订单 —');
s=new GameState().newGame(); s.cells.fill(null); s.boardUnlocked=48;
const o=s.orders[0];
o.needs.forEach(q=>{ for(let k=0;k<q.n;k++){ const i=s.emptyCells()[0]; s._put(i,{k:'i',fam:q.fam,tier:q.tier}); }});
ok(!s.orderReady(o),'材料齐但未接受时不能直接交付');
const accept=s.acceptOrder(0);
ok(accept?.ok===true&&o.accepted&&s.tutorial.orderAccepted,'玩家回应后委托才进入进行中');
const acceptedSnapshot=JSON.stringify(o);
ok(s.acceptOrder(0)?.code==='order_already_accepted'&&JSON.stringify(o)===acceptedSnapshot,'重复接受不会改写委托');
ok(s.orderReady(o),'接受后且材料齐，委托才就绪');
const coin0=s.coin,xp0=s.xp,lv0=s.lv;
s.submitOrder(0);
ok(s.coin>=coin0+o.coin,'获得金币（升级可能额外奖励）');
ok(s.lv>lv0||s.xp===xp0+o.xp,'经验入账或已转化为升级');
ok(s.orders[0].accepted===false,'交付后出现的新请求仍需玩家自行接受');

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
ok(s.ownedGens.includes('g_wood')&&s.cells.some(c=>c?.k==='g'&&c.gid==='g_wood'),
  '首段主线完成后直接获得下一段所需的雪松堆');
ok(s.freeTaps>=6&&s.cells.some(c=>c?.k==='i'&&c.fam==='wood'),
  '主线奖励补充余温生成次数和可立即合并的木料');

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

  const legacy=new GameState().newGame().serialize();
  delete legacy.orders[0].accepted;
  const migrated=new GameState().hydrate(legacy);
  ok(migrated.orders[0].accepted===true,'旧存档中已经显示的委托按已接受迁移，避免进度中断');
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

console.log('— 完整主线试玩链（6 章 24 节点）—');
{
  const s=new GameState().newGame(); s.setSandbox(true);
  let built=0;
  while(built<40){
    const prepared=s.sbPrepareNextStory();
    if(prepared.finished) break;
    ok(s.nodeState(prepared.node,prepared.chapter)==='ready',`节点 ${prepared.node.id} 已精确备料`);
    ok(s.buildNode(prepared.chapter,prepared.node),`节点 ${prepared.node.id} 可完成`);
    built++;
  }
  const total=Config.flatNodes().length;
  ok(built===total&&s.storyDone.length===total,`六章 ${total} 节点全部贯通`);
  ok(s.sbPrepareNextStory().finished===true,'通关后正确返回已完成');
}

console.log('— 剧情体系数据驱动约束 —');
{
  const flat=Config.flatNodes();
  // 唯一终章节点
  const finales=flat.filter(x=>x.node.finale);
  ok(finales.length===1 && finales[0].node.id==='n64','唯一数据驱动终章节点 n64');
  // 序章/结局非空
  ok(Array.isArray(Config.prologue)&&Config.prologue.length>=3,'序章存在');
  ok(Array.isArray(Config.epilogue)&&Config.epilogue.length>=6,'结局演出存在');
  // 每个节点需求合法、对白角色合法、交付前请求存在
  const npcIds=new Set(Config.npcs.map(n=>n.id)); const fams=new Set(Config.famList);
  let preOk=true, whoOk=true;
  for(const {node} of flat){
    if(!Array.isArray(node.pre)||node.pre.length<1) preOk=false;
    for(const q of node.need) if(!fams.has(q.fam)||q.tier<1||q.tier>8) whoOk=false;
    for(const line of [...(node.pre||[]),...(node.dialogue||[])])
      if(!npcIds.has(line[0])&&line[0]!=='narrator'&&line[0]!=='all') whoOk=false;
  }
  ok(preOk,'每个节点都有交付前请求对白（故事驱动游戏）');
  ok(whoOk,'所有对白角色与需求链合法');
  const interactive=flat.filter(({node})=>node.interaction);
  const interactionOk=interactive.every(({node})=>{
    const act=node.interaction;
    const copyOk=[act.title,act.prompt,act.complete].every(value=>typeof value==='string'&&value.length>=4);
    if(act.type==='tap-sequence') return copyOk&&Array.isArray(act.steps)&&act.steps.length>=3&&act.steps.every(step=>
      typeof step.id==='string'&&typeof step.label==='string'&&step.x>=0&&step.x<=100&&step.y>=0&&step.y<=100);
    if(act.type==='choice') return copyOk&&Array.isArray(act.options)&&act.options.length===3&&
      new Set(act.options.map(option=>option.id)).size===3&&act.options.every(option=>option.name&&option.desc);
    return false;
  });
  ok(interactive.length>=9&&interactionOk,'前三章关键节点具备合法的亲手复苏/装修选择交互');
  const earlyCadence=Config.story.slice(0,3).every(ch=>{
    const acts=ch.nodes.map(node=>node.interaction?.type||'rest');
    return acts.filter(type=>type==='tap-sequence').length>=2&&acts.includes('choice')&&acts.includes('rest');
  });
  ok(earlyCadence,'前三章均按操作高潮、选择与喘息节点交替编排');
  ok(Config.story.every(ch=>typeof ch.hook==='string'&&ch.hook.length>=10),'每章都有可见的悬念钩子');
  // 主线目标按顺序推进
  const s=new GameState().newGame();
  ok(s.currentObjective().node.id==='n11','初始主线目标为 n11');
  // 章节开放门控：第 2 章在第 1 章未完成前不可达
  ok(s.chapterReachable(Config.story[0])===true && s.chapterReachable(Config.story[1])===false,'章节顺序门控');
  // 章节过场记录 + 存档往返
  s.markChapterSeen(1); const again=new GameState().hydrate(JSON.parse(JSON.stringify(s.serialize())));
  ok(again.chaptersSeen.length===1&&again.chaptersSeen[0]===1,'章节过场记录可持久化');
  // 非法章节 id 被过滤
  const dirty=new GameState().hydrate({chaptersSeen:[1,99,'x',3]});
  ok(JSON.stringify(dirty.chaptersSeen)==='[1,3]','非法章节过场记录被过滤');
  const choiceNode=flat.find(({node})=>node.interaction?.type==='choice')?.node;
  const choiceId=choiceNode.interaction.options[1].id;
  const picked=s.setStoryChoice(choiceNode.id,choiceId);
  const choiceRoundTrip=new GameState().hydrate(JSON.parse(JSON.stringify(s.serialize())));
  ok(picked?.ok===true&&choiceRoundTrip.storyChoice(choiceNode)?.id===choiceId,'装修选择写入存档并可安全恢复');
  const choiceSnapshot=JSON.stringify(choiceRoundTrip.storyChoices);
  const rejected=choiceRoundTrip.setStoryChoice(choiceNode.id,'__unknown_choice__');
  ok(rejected?.ok===false&&JSON.stringify(choiceRoundTrip.storyChoices)===choiceSnapshot,'非法装修选择被拒绝且不污染存档');
  const dirtyChoices=new GameState().hydrate({storyChoices:{[choiceNode.id]:'__bad__',__proto__:'polluted'}});
  ok(Object.keys(dirtyChoices.storyChoices).length===0,'损坏或未声明的装修选择键被过滤');
  // 剧情-only NPC（祖父、陪伴向导啾可）不下订单
  const og=new GameState().newGame(); og.lv=20; let leaked=false;
  for(let i=0;i<200;i++){ const o=og._genOrder([]); if(o.npcId==='gramps'||o.npcId==='choco') leaked=true; }
  ok(!leaked,'祖父与陪伴向导啾可均为剧情角色，不进入订单池');
  ok(Config.orderNpcs().every(n=>typeof n.request==='string'&&n.request.length>=24&&typeof n.thanks==='string'&&n.thanks.length>=12),
    '每位派单村民都有具体请求缘由和完成回应');
  const lineOf=line=>Array.isArray(line)?{who:line[0],say:line[1],...(line[2]||{})}:line;
  const authored=[...Config.prologue,...(Config.profile?.prompt||[]),...(Config.profile?.confirm||[])];
  for(const chapter of Config.story){ authored.push(...(chapter.intro||[]));
    for(const node of chapter.nodes) authored.push(...(node.pre||[]),...(node.dialogue||[])); }
  authored.push(...Config.epilogue);
  const storyCards=authored.map(lineOf);
  ok(storyCards.length>=179&&storyCards.every(line=>typeof line.voiceId==='string'&&line.voiceId),
    '序章、昵称剧情、章节过场、24 段主线与结局的每句对白均声明稳定语音 ID');
  ok(storyCards.filter(line=>String(line.say).includes('{{playerName}}')).every(line=>line.spoken&&!line.spoken.includes('{{')),
    '含玩家动态昵称的可见对白声明不含占位符的录音文本');
  const orderCards=Config.orderNpcs().flatMap(npc=>[
    {say:npc.arrival,voiceId:npc.voiceArrivalId},{say:npc.request,voiceId:npc.voiceRequestId},{say:npc.thanks,voiceId:npc.voiceThanksId}
  ]);
  ok(orderCards.length===15&&orderCards.every(line=>line.say&&line.voiceId),
    '五位村民的登场、请求与答谢 15 句全部声明离线语音');
  const companionCards=Object.values(Config.companion||{}).flatMap(group=>Object.values(group||{}));
  ok(companionCards.length>=20&&companionCards.every(line=>line.text&&line.voiceId),
    '剧情教学、即时反馈与材料引导均有啾可语音提示');
  const voiced=[...storyCards,...orderCards,...companionCards].map(line=>line.voiceId);
  const uniqueVoices=[...new Set(voiced)];
  ok(uniqueVoices.length===216,'完整有声脚本包含 216 个独立语音片段');
  ok(Config.supportedLocales.length===4&&['zh-CN','en','ja','ko'].every(locale=>Config.supportedLocales.includes(locale)),
    '文本和配音均声明中英日韩四种受支持语言');
  const voiceJobs=Config.supportedLocales.flatMap(locale=>uniqueVoices.map(voiceId=>({locale,voiceId})));
  const voiceResponses=[];
  // Keep the local/CI HTTP server under a realistic connection count while
  // still checking every shipped voice through the same URL path as the game.
  for(let start=0;start<voiceJobs.length;start+=24){
    voiceResponses.push(...await Promise.all(voiceJobs.slice(start,start+24).map(async ({locale,voiceId})=>{
      const response=await fetch(Config.voiceUrl(voiceId,locale)); if(!response.ok) return false;
      const bytes=new Uint8Array(await response.arrayBuffer());
      return bytes.length>1000&&String.fromCharCode(...bytes.slice(0,4))==='OggS';
    })));
  }
  ok(voiceResponses.length===864&&voiceResponses.every(Boolean),'中英日韩 864 条剧情语音均可读取，且为非空 Ogg/Opus 文件');
  // 角色羁绊为纯派生：完成节点后计数增长
  const bd=new GameState().newGame(); bd.setSandbox(true);
  const p=bd.sbPrepareNextStory(); bd.buildNode(p.chapter,p.node);
  ok(Object.keys(bd.bondByNpc()).length>=1,'完成节点后产生角色羁绊');
}

console.log('— 剧情内新手核心链 —');
{
  const guide=new GameState().newGame();
  const gi=guide.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_crystal');
  guide.tapGenerator(gi); ok(guide.tutorial.produced,'点生成器后推进教学');
  guide.dropOn(13,14); ok(guide.tutorial.merged&&!guide.orderReady(guide.orders[0]),'首次合并后先等待玩家回应村民');
  guide.acceptOrder(0); ok(guide.tutorial.orderAccepted&&guide.orderReady(guide.orders[0]),'回应冈特后首单可交付');
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
  ok(submitResult?.ok===false&&submitResult.code==='order_not_accepted','未接受委托不能绕过剧情直接交付');
  ok(JSON.stringify(submit.cells)===submitCells&&submit.orders[0].id===submitOrder&&submit.coin===submitCoin,'交付失败不扣材料、不替换订单');

  submit.acceptOrder(0);
  const acceptedOrder=submit.orders[0].id, acceptedCost=submit.refreshCost;
  const acceptedRefresh=submit.refreshOrder(0);
  ok(acceptedRefresh?.ok===false&&acceptedRefresh.code==='order_already_accepted'&&submit.orders[0].id===acceptedOrder&&submit.refreshCost===acceptedCost,
    '进行中的委托不能付费刷新，避免抹掉已发生的角色剧情');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
