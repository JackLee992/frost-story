import { test, expect } from '@playwright/test';

const base = 'http://127.0.0.1:8099/';

async function boot(page, query = '?safeTop=32&safeRight=0&safeBottom=24&safeLeft=0&contentVersion=e2e&lang=zh-CN') {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(base + query, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game), null, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  return errors;
}

// 序章为多页陪伴对白，逐页点到进入新手引导（或对白结束）
async function skipWelcome(page){
  const start=page.locator('.welcome-start');
  if(await start.isVisible().catch(()=>false)){
    await start.click({force:true});
    await page.waitForTimeout(180);
  }
  for(let i=0;i<12;i++){
    const cnt=await page.locator('.dlg-next').count();
    if(cnt===0) break;
    const b=page.locator('.dlg-next').last();
    if(!(await b.isVisible().catch(()=>false))){ await page.waitForTimeout(120); continue; }
    await b.click({force:true}).catch(()=>{});
    await page.waitForTimeout(190);
  }
  await page.locator('.dlg-next').waitFor({state:'detached',timeout:3000}).catch(()=>{});
  const profile=page.locator('[data-profile-name]');
  if(await profile.isVisible().catch(()=>false)){
    await profile.fill('雪灯');
    await page.locator('[data-save-profile]').click();
    for(let i=0;i<4;i++){
      const next=page.locator('.dlg-next').last();
      if(!(await next.isVisible().catch(()=>false))) break;
      await next.click({force:true}); await page.waitForTimeout(160);
    }
  }
  await page.waitForTimeout(150);
}

test('序章用故事收集玩家称呼，并允许在设置中安全修改', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(base); await page.evaluate(()=>localStorage.clear());
  const errors=await boot(page);
  await page.locator('.welcome-start').click();
  for(let i=0;i<12;i++){
    if(await page.locator('[data-profile-name]').isVisible().catch(()=>false)) break;
    const next=page.locator('.dlg-next').last();
    await next.click({force:true}); await page.waitForTimeout(120);
  }
  await expect(page.locator('.profile-story')).toContainText('怎么称呼你');
  // GeckoView 在部分 edge-to-edge 真机上不会同步缩小 visualViewport；输入框聚焦本身
  // 必须触发保底布局，让全部关键控件留在三星键盘顶边（约 60% 屏高）之上。
  await page.locator('[data-profile-name]').focus();
  for(const selector of ['[data-profile-name]','[data-save-profile]']){
    const rect=await page.locator(selector).boundingBox();
    expect(rect.y+rect.height).toBeLessThanOrEqual(480);
  }
  // Android edge-to-edge 下软键盘可能覆盖而不缩小 layout viewport；用 visual viewport
  // 等价高度回归，确保玩家始终看得到输入框和提交按钮。
  await page.evaluate(()=>{
    document.documentElement.style.setProperty('--visual-vh','450px');
    document.documentElement.style.setProperty('--visual-top','0px');
    document.body.classList.add('keyboard-open');
  });
  for(const selector of ['[data-profile-name]','[data-save-profile]']){
    const rect=await page.locator(selector).boundingBox();
    expect(rect.y+rect.height).toBeLessThanOrEqual(450);
  }
  await page.screenshot({path:'artifacts/qa/web-profile-keyboard.png',fullPage:true});
  await page.evaluate(()=>{
    document.body.classList.remove('keyboard-open');
    document.documentElement.style.setProperty('--visual-vh',`${window.innerHeight}px`);
  });
  await page.locator('[data-profile-name]').fill('<img>');
  await page.locator('[data-save-profile]').click();
  await expect(page.locator('.profile-error')).toContainText('符号');
  await page.locator('[data-profile-name]').fill('雪团');
  await page.locator('[data-save-profile]').click();
  await expect(page.locator('.story-say')).toContainText('雪团');
  await page.locator('.story-skip').click();
  expect(await page.evaluate(()=>window.__game.state.profile.nickname)).toBe('雪团');
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('froststory.save.v1'))).profile.nickname).toBe('雪团');

  await page.locator('[data-panel="settings"]').click();
  await expect(page.locator('[data-profile-edit]')).toContainText('雪团');
  await expect(page.locator('[data-game-language]')).toHaveValue('zh-CN');
  await expect(page.locator('[data-voice-language]')).toHaveValue('zh-CN');
  await page.locator('[data-voice-language]').selectOption('ja');
  expect(await page.evaluate(()=>window.__game.state.settings.voiceLanguage)).toBe('ja');
  expect(await page.evaluate(()=>window.__game.state.settings.language)).toBe('zh-CN');
  await page.locator('[data-profile-edit]').click();
  await page.locator('[data-profile-name]').fill('小雪灯');
  await page.locator('[data-save-profile]').click();
  await expect(page.locator('.story-say')).toContainText('小雪灯');
  await page.locator('.story-skip').click();
  await page.reload({waitUntil:'networkidle'}); await page.waitForFunction(()=>Boolean(window.__game));
  expect(await page.evaluate(()=>window.__game.state.profile.nickname)).toBe('小雪灯');
  expect(await page.evaluate(()=>window.__game.state.settings.language)).toBe('zh-CN');
  expect(await page.evaluate(()=>window.__game.state.settings.voiceLanguage)).toBe('ja');
  expect(errors).toEqual([]);
  await context.close();
});

test('界面语言与配音语言独立保存', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true,locale:'en-US'});
  const page=await context.newPage();
  await page.goto(base); await page.evaluate(()=>localStorage.clear());
  const errors=await boot(page,'?safeTop=20&safeBottom=20&contentVersion=i18n-e2e');
  expect(await page.evaluate(()=>window.__game.Config.locale)).toBe('en');
  await expect(page.locator('#dock')).toContainText('Settings');
  await page.evaluate(()=>window.__game.ui.closeModal());
  await page.locator('[data-panel="settings"]').click();
  await page.locator('[data-voice-language]').selectOption('ko');
  expect(await page.evaluate(()=>({game:window.__game.state.settings.language,voice:window.__game.state.settings.voiceLanguage})))
    .toEqual({game:'en',voice:'ko'});
  await page.locator('[data-game-language]').selectOption('ja');
  await page.waitForFunction(()=>window.__game?.Config?.locale==='ja');
  expect(await page.evaluate(()=>({game:window.__game.state.settings.language,voice:window.__game.state.settings.voiceLanguage,
    documentLanguage:document.documentElement.lang}))).toEqual({game:'ja',voice:'ko',documentLanguage:'ja'});
  expect(await page.evaluate(()=>window.__game.Config.voiceUrl('prologue_01',window.__game.state.settings.voiceLanguage)))
    .toContain('/ko/prologue_01.ogg');
  expect(errors).toEqual([]);
  await context.close();
});

test('中英日韩在窄屏均可用，并能读取各自离线配音', async ({ browser }) => {
  test.setTimeout(60_000);
  const cases=[
    {locale:'zh-CN',title:'冰霜物语'},
    {locale:'en',title:'Frost Story'},
    {locale:'ja',title:'フロスト・ストーリー'},
    {locale:'ko',title:'프로스트 스토리'}
  ];
  for(const item of cases){
    const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    const page=await context.newPage();
    const errors=await boot(page,`?safeTop=32&safeBottom=24&contentVersion=i18n-${item.locale}&lang=${item.locale}`);
    await expect(page).toHaveTitle(item.title);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(await page.evaluate(()=>window.__game.Config.locale)).toBe(item.locale);
    const voice=await page.evaluate(async locale=>{
      const response=await fetch(window.__game.Config.voiceUrl('prologue_01',locale));
      const bytes=new Uint8Array(await response.arrayBuffer());
      return {ok:response.ok,size:bytes.length,header:String.fromCharCode(...bytes.slice(0,4))};
    },item.locale);
    expect(voice.ok).toBe(true);
    expect(voice.size).toBeGreaterThan(1000);
    expect(voice.header).toBe('OggS');
    await page.evaluate(()=>window.__game.ui.closeModal());
    await page.locator('[data-panel="settings"]').click();
    await expect(page.locator('[data-game-language]')).toHaveValue(item.locale);
    await expect(page.locator('[data-voice-language]')).toHaveValue(item.locale);
    const modal=await page.locator('.modal').boundingBox();
    expect(modal.x).toBeGreaterThanOrEqual(0);
    expect(modal.x+modal.width).toBeLessThanOrEqual(360);
    expect(errors).toEqual([]);
    await page.screenshot({path:`artifacts/qa/web-locale-${item.locale}.png`,fullPage:true});
    await context.close();
  }
});

test('全屏安全区、六章入口与固定来源存档', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  const errors = await boot(page);

  expect(await page.evaluate(() => document.documentElement.dataset.contentVersion)).toBe('e2e');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--native-safe-t').trim())).toBe('32px');

  const level = await page.locator('#levelBadge').boundingBox();
  const settingsButton = await page.locator('[data-panel="settings"]').boundingBox();
  expect(level.y).toBeGreaterThanOrEqual(32);
  expect(settingsButton.y + settingsButton.height).toBeLessThanOrEqual(800 - 24);
  const geometry = await page.evaluate(() => ({ oy: window.__game.scene.oy, gh: window.__game.scene.gh, h: window.__game.scene.H }));
  expect(geometry.oy).toBeGreaterThanOrEqual(158 + 32);
  expect(geometry.oy + geometry.gh).toBeLessThanOrEqual(geometry.h - 96 - 24);

  await skipWelcome(page);
  await page.locator('[data-panel="settings"]').click();
  await page.waitForTimeout(350);
  const modal = await page.locator('.modal').boundingBox();
  expect(modal.y).toBeGreaterThanOrEqual(32);
  expect(modal.y + modal.height).toBeLessThanOrEqual(800 - 24);
  await page.locator('[data-sandbox]').click();
  await page.locator('.m-close').click();
  await expect(page.locator('#sbFab')).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game));
  await expect(page.locator('#sbFab')).toBeVisible();
  expect(await page.evaluate(() => window.__game.state.sandbox)).toBe(true);

  const fabBefore = await page.locator('#sbFab').boundingBox();
  await page.mouse.move(fabBefore.x + fabBefore.width / 2, fabBefore.y + fabBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(6, 790, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const fabDragged = await page.locator('#sbFab').boundingBox();
  const dockAfterDrag = await page.locator('#dock').boundingBox();
  expect(await page.locator('#sbFab').getAttribute('data-side')).toBe('left');
  expect(fabDragged.x).toBeGreaterThanOrEqual(0);
  expect(fabDragged.y + fabDragged.height).toBeLessThanOrEqual(dockAfterDrag.y - 7);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game));
  await expect(page.locator('#sbFab')).toHaveAttribute('data-side','left');
  const fabPersisted = await page.locator('#sbFab').boundingBox();
  expect(Math.abs(fabPersisted.y - fabDragged.y)).toBeLessThanOrEqual(2);

  await page.locator('#sbFab').click();
  await page.locator('[data-act="story"]').click();
  await page.waitForTimeout(250);
  await page.locator('.m-close').click();
  await page.locator('[data-panel="story"]').click();
  await expect(page.locator('[data-build="n11"]')).toBeVisible();
  await page.locator('[data-build="n11"]').click();
  await expect(page.locator('.dlg-line .say')).toContainText('火星');
  await page.screenshot({ path: 'artifacts/qa/web-safe-area.png', fullPage: true });

  expect(errors).toEqual([]);
  await context.close();
});

test('左右挖孔边距不会遮住操作控件', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = await boot(page, '?safeTop=40&safeRight=18&safeBottom=28&safeLeft=12&contentVersion=e2e&lang=zh-CN');
  const left = await page.locator('#levelBadge').boundingBox();
  const right = await page.locator('.hud-right').boundingBox();
  const dock = await page.locator('#dock').boundingBox();
  expect(left.x).toBeGreaterThanOrEqual(12);
  expect(right.x + right.width).toBeLessThanOrEqual(393 - 18);
  expect(dock.y + dock.height).toBeLessThanOrEqual(852);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/qa/web-wide-cutout.png', fullPage: true });
  await context.close();
});

test('任务架不遮棋盘，玩家通过角色剧情完成新手核心循环', async ({ browser }) => {
  // 该用例会解码 9 个音效、走完首局并跨重载验证持久化；GitHub 的冷 runner
  // 明显慢于本机，使用独立预算，避免默认 30 秒在最后一次 reload 前误报。
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  const errors = await boot(page);
  await expect(page.locator('.welcome-start')).toBeVisible();
  // 模拟 GeckoView 音频上下文初始化偏慢：剧情语音必须仍在用户点击手势内起播，
  // 不能等 WebAudio/SFX 解码链路完成后再调用 HTMLAudio.play()。
  await page.evaluate(() => {
    const audio=window.__game.AudioMgr, unlock=audio._unlock.bind(audio);
    audio._unlock=async()=>{ await new Promise(resolve=>setTimeout(resolve,900)); return unlock(); };
  });
  await page.locator('.welcome-start').click();
  await expect(page.locator('.story-stage')).toBeVisible();
  await page.waitForFunction(()=>window.__game.AudioMgr.voiceEl?.currentTime>.05,null,{timeout:700});
  expect(await page.evaluate(()=>window.__game.AudioMgr.ready)).toBe(false);
  await page.waitForFunction(()=>window.__game.AudioMgr.ready&&window.__game.AudioMgr.voiceEl?.src.includes('prologue_01.ogg'));
  await page.waitForFunction(()=>Object.keys(window.__game.AudioMgr.bufs).length===9);
  expect(await page.evaluate(()=>({sfx:Object.keys(window.__game.AudioMgr.bufs).length,voicePaused:window.__game.AudioMgr.voiceEl.paused}))).toEqual({sfx:9,voicePaused:false});
  await skipWelcome(page);
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','produce');
  await expect(page.locator('#guideLayer .guide-shade')).toHaveCount(0);
  await expect(page.locator('#companion.teaching')).toBeVisible();
  await expect(page.locator('.comp-who')).not.toContainText('/');
  expect(await page.locator('.guide-focus').evaluate(el => getComputedStyle(el).boxShadow.includes('9999px'))).toBe(false);
  await expect(page.locator('#orders')).toHaveClass(/collapsed/);
  await expect(page.locator('#quest')).toHaveClass(/collapsed/);
  const shelf=await page.locator('#taskShelf').boundingBox();
  const boardTop=await page.evaluate(()=>window.__game.scene.oy);
  expect(shelf.height).toBeLessThanOrEqual(48);
  expect(shelf.y+shelf.height).toBeLessThanOrEqual(boardTop);
  await page.screenshot({ path: 'artifacts/qa/web-onboarding-step1.png', fullPage: true });

  const generator = await page.evaluate(() => {
    const idx=window.__game.state.cells.findIndex(c=>c?.k==='g'&&c.gid==='g_crystal');
    return window.__game.scene.center(idx);
  });
  await page.mouse.click(generator.x,generator.y);
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','merge');

  const pair = await page.evaluate(() => [13,14].map(i=>window.__game.scene.center(i)));
  await page.mouse.move(pair[0].x,pair[0].y); await page.mouse.down();
  await page.mouse.move(pair[1].x,pair[1].y,{steps:8}); await page.mouse.up();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','request');
  await page.waitForTimeout(220);
  expect(await page.evaluate(() => window.__game.scene.itemLayer.children.length)).toBe(
    await page.evaluate(() => window.__game.scene.nodes.size)
  );
  await page.locator('.orders-summary').click();
  await expect(page.locator('#orders')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#quest')).toHaveClass(/collapsed/);
  await page.screenshot({path:'artifacts/qa/web-task-shelf-expanded.png',fullPage:true});
  await page.locator('.order-card').first().locator('.oc-request').click();
  await expect(page.locator('.order-request')).toContainText('冈特');
  await expect(page.locator('.order-request')).toContainText('火哨');
  await expect(page.locator('.order-request')).toContainText('我来帮你');
  await page.waitForTimeout(320);
  await page.screenshot({path:'artifacts/qa/web-order-request-story.png',fullPage:true});
  await page.locator('[data-accept-order]').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','order');
  await page.locator('.order-card').first().locator('.oc-submit').click();
  await expect(page.locator('.story-stage')).toContainText('火哨亮了');
  await page.locator('.story-skip').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','unlock');

  const locked = await page.evaluate(() => window.__game.scene.center(window.__game.state.boardUnlocked));
  await page.mouse.click(locked.x,locked.y);
  await page.locator('[data-y]').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','shop');

  await page.locator('[data-panel="shop"]').click();
  await expect(page.locator('.m-title')).toContainText('商店');
  await page.locator('.m-close').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','story');

  await page.locator('[data-panel="story"]').click();
  expect(await page.locator('.modal-mask').evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  await expect(page.locator('.story-chap')).toHaveCount(6);
  expect(await page.evaluate(() => window.__game.state.tutorial.done)).toBe(true);
  await expect(page.locator('#guideLayer')).toBeHidden();
  await page.screenshot({ path: 'artifacts/qa/web-onboarding-clean-grid.png', fullPage: true });

  await page.locator('.m-close').click();
  const sceneBounds = await page.evaluate(() => {
    const scene=window.__game.scene;
    return scene.itemLayer.children.map(node=>{const b=node.getBounds();return {width:b.width,height:b.height};});
  });
  expect(sceneBounds.length).toBe(await page.evaluate(() => window.__game.scene.nodes.size));
  for(const bounds of sceneBounds){
    expect(bounds.width).toBeGreaterThan(1);
    expect(bounds.height).toBeGreaterThan(1);
    expect(bounds.width).toBeLessThan(120);
    expect(bounds.height).toBeLessThan(120);
  }
  expect(await page.evaluate(() => {
    const forbidden=['_idx','_sz','_phase','_press','_pop','_born','_key','_chestDrawn','_pulsing','_halo'];
    return window.__game.scene.itemLayer.children.flatMap(node=>forbidden.filter(key=>Object.hasOwn(node,key)));
  })).toEqual([]);

  expect(await page.evaluate(() => {
    const {state,scene}=window.__game;
    const idx=state.cells.findIndex(c=>c?.k==='i');
    const cell=state.cells[idx]; cell.bubble=true; cell.bubbleAt=Date.now();
    for(let i=0;i<20;i++) scene.sync(true);
    const node=scene.nodes.get(cell.uid),meta=scene.nodeMeta.get(node);
    return meta.veil.children.length;
  })).toBe(1);
  await page.screenshot({ path: 'artifacts/qa/web-clean-board.png', fullPage: true });

  await page.locator('.quest-summary').click();
  await expect(page.locator('#quest')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#orders')).toHaveClass(/collapsed/);
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>Boolean(window.__game));
  await expect(page.locator('#quest')).not.toHaveClass(/collapsed/);
  await page.locator('.quest-summary').click();
  await expect(page.locator('#quest')).toHaveClass(/collapsed/);
  expect((await page.locator('#taskShelf').boundingBox()).height).toBeLessThanOrEqual(48);

  await page.locator('[data-panel="settings"]').click();
  await page.locator('[data-rules]').click();
  await expect(page.locator('.m-title')).toContainText('玩法规则');
  expect(errors).toEqual([]);
  await context.close();
});

test('失败交易保留当前弹窗、列表与滚动位置', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(base);
  await page.evaluate(()=>localStorage.clear());
  const errors=await boot(page);
  await skipWelcome(page);

  await page.evaluate(()=>{ window.__game.state.coin=0; window.__game.state.gem=0; window.__game.ui.renderHUD(); });
  await page.locator('[data-panel="shop"]').click();
  await page.locator('.modal').evaluate(el=>{el.dataset.instance='shop-stable';});
  await page.locator('.m-body').evaluate(el=>{el.scrollTop=Math.min(24,el.scrollHeight-el.clientHeight);});
  const touchTap=async selector=>{
    // locator.click() 会先把目标滚到视口内，反而改变本用例正在验证的 scrollTop；
    // 这里用真实触屏坐标点击当前可见按钮，匹配 Android 用户手势。
    const rect=await page.locator(selector).boundingBox();
    expect(rect).not.toBeNull();
    await page.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);
  };
  const before=await page.evaluate(()=>({
    cells:JSON.stringify(window.__game.state.cells),coin:window.__game.state.coin,gem:window.__game.state.gem,
    scroll:document.querySelector('.m-body').scrollTop
  }));
  expect(before.scroll).toBeGreaterThan(0);

  await touchTap('[data-chest="chest_bronze"]');
  await expect(page.locator('.toast').last()).toContainText('金币不足');
  await expect(page.locator('.modal')).toHaveAttribute('data-instance','shop-stable');
  await expect(page.locator('.modal-mask')).toHaveCount(1);
  expect(await page.locator('.m-body').evaluate(el=>el.scrollTop)).toBe(before.scroll);
  expect(await page.evaluate(()=>JSON.stringify(window.__game.state.cells))).toBe(before.cells);
  expect(await page.evaluate(()=>window.__game.state.coin)).toBe(before.coin);

  await touchTap('[data-energy]');
  await expect(page.locator('.toast').last()).toContainText('钻石不足');
  await expect(page.locator('.modal')).toHaveAttribute('data-instance','shop-stable');
  expect(await page.locator('.m-body').evaluate(el=>el.scrollTop)).toBe(before.scroll);
  expect(await page.evaluate(()=>window.__game.state.gem)).toBe(before.gem);

  await page.evaluate(()=>{window.__game.state.coin=1000;});
  await touchTap('[data-chest="chest_bronze"]');
  await expect(page.locator('.modal')).toHaveAttribute('data-instance','shop-stable');
  expect(await page.locator('.m-body').evaluate(el=>el.scrollTop)).toBe(before.scroll);
  expect(await page.evaluate(()=>window.__game.state.cells.filter(c=>c?.k==='c').length)).toBe(1);
  expect(await page.evaluate(()=>window.__game.state.coin)).toBe(940);

  await page.locator('.m-close').click();
  await page.evaluate(()=>{
    const s=window.__game.state;
    const idx=s.cells.findIndex(c=>c?.k==='c');
    s.gem=0; window.__game.ui._chestDialog(idx);
  });
  await page.locator('[data-s]').click();
  await expect(page.locator('.toast').last()).toContainText('钻石不足');
  await expect(page.locator('[data-s]')).toBeVisible();

  await page.locator('[data-n]').click();
  await page.evaluate(()=>{
    const s=window.__game.state; s.lv=20; s.coin=0;
    window.__game.ui._unlockDialog(s.unlockInfo());
  });
  const unlocked=await page.evaluate(()=>window.__game.state.boardUnlocked);
  await page.locator('[data-y]').click();
  await expect(page.locator('.toast').last()).toContainText('金币不足');
  await expect(page.locator('[data-y]')).toBeVisible();
  expect(await page.evaluate(()=>window.__game.state.boardUnlocked)).toBe(unlocked);

  expect(errors).toEqual([]);
  await context.close();
});

test('关键剧情包含连续电影对白、亲手复苏与可持久化装修选择', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(base);
  await page.evaluate(()=>localStorage.clear());
  const errors=await boot(page);
  await skipWelcome(page);

  await page.evaluate(()=>{
    const {state}=window.__game;
    state.setSandbox(true);
    const prepared=state.sbPrepareNextStory();
    state.buildNode(prepared.chapter,prepared.node);
  });
  const act=page.locator('.story-act[data-node="n11"]');
  await expect(act).toBeVisible();
  await expect(act.locator('.story-act-target')).toHaveCount(3);
  await expect(act.locator('.story-act-bg')).toHaveAttribute('style',/cg_first_flame\.png/);
  await page.waitForTimeout(260);
  const actSkip=await act.locator('.story-act-skip').boundingBox();
  expect(actSkip.y).toBeGreaterThanOrEqual(32);
  await page.screenshot({path:'artifacts/qa/web-story-interaction.png',fullPage:true});

  for(let i=0;i<3;i++) await act.locator('.story-act-target').nth(i).click();
  await expect(act).toHaveClass(/complete/);
  await expect(act.locator('.story-act-result')).toContainText('第一堆火没有熄灭');
  await page.screenshot({path:'artifacts/qa/web-story-interaction-complete.png',fullPage:true});
  await act.locator('.story-act-continue').click();

  const stage=page.locator('.story-stage');
  await expect(stage).toBeVisible();
  await expect(stage.locator('.story-stage-bg')).toHaveAttribute('style',/cg_first_flame\.png/);
  await stage.evaluate(el=>{el.closest('.modal').dataset.instance='cinema-stable';});
  await stage.locator('.dlg-next').click();
  await expect(page.locator('.modal')).toHaveAttribute('data-instance','cinema-stable');
  await stage.locator('.story-log').click();
  await expect(stage.locator('.story-transcript')).toBeVisible();
  await expect(stage.locator('.story-transcript')).toContainText('最后一个没走的老猎人');
  await stage.locator('.story-log-head button').click();
  await stage.locator('.story-skip').click();
  await expect(page.locator('.cdialog')).toContainText('重燃篝火广场');
  await page.locator('.cd-ok').click();

  await page.evaluate(()=>{
    const ch=window.__game.state.currentObjective().chapter;
    const node=ch.nodes.find(item=>item.id==='n14');
    window.__choiceBeatDone=false;
    window.__game.ui._storyChoiceBeat(ch,node,node.interaction,()=>{window.__choiceBeatDone=true;});
  });
  await page.locator('[data-choice="crystal"]').click();
  await expect(page.locator('[data-choice="crystal"]')).toHaveAttribute('aria-checked','true');
  await page.screenshot({path:'artifacts/qa/web-story-choice.png',fullPage:true});
  await page.locator('.story-choice-confirm').click();
  await page.waitForFunction(()=>window.__choiceBeatDone===true);
  expect(await page.evaluate(()=>window.__game.state.storyChoice('n14')?.id)).toBe('crystal');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('froststory.save.v1')).storyChoices.n14)).toBe('crystal');

  await page.evaluate(()=>{
    const ch=window.__game.state.currentObjective().chapter;
    const node=ch.nodes.find(item=>item.id==='n14');
    window.__game.ui._storyDialog(ch,node,{replay:true});
  });
  await expect(page.locator('.story-say')).toContainText('霜晶星灯');
  await page.locator('.story-skip').click();
  expect(errors).toEqual([]);
  await context.close();
});

test('前三章交替安排场景操作、个人选择与喘息节点', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(base);
  await page.evaluate(()=>localStorage.clear());
  const errors=await boot(page);
  await page.evaluate(()=>window.__game.ui.closeModal());

  await page.evaluate(()=>{
    const ch=window.__game.Config.story[0],node=ch.nodes.find(item=>item.id==='n13');
    window.__beatDone=false;
    window.__game.ui._storyBeat(ch,node,()=>{window.__beatDone=true;});
  });
  const bridge=page.locator('.story-act[data-node="n13"]');
  await expect(bridge).toContainText('让第一封信过桥');
  await expect(bridge.locator('.story-act-target')).toHaveCount(3);
  for(let i=0;i<3;i++) await bridge.locator('.story-act-target').nth(i).click();
  await expect(bridge.locator('.story-act-result')).toContainText('波波抱紧邮袋');
  await page.screenshot({path:'artifacts/qa/web-story-bridge-beat.png',fullPage:true});
  await bridge.locator('.story-act-continue').click();
  await page.waitForFunction(()=>window.__beatDone===true);

  await page.evaluate(()=>{
    const ch=window.__game.Config.story[1],node=ch.nodes.find(item=>item.id==='n22');
    window.__choiceBeatDone=false;
    window.__game.ui._storyBeat(ch,node,()=>{window.__choiceBeatDone=true;});
  });
  await expect(page.locator('.story-act[data-node="n22"]')).toContainText('归乡围巾');
  await page.locator('[data-choice="hearth"]').click();
  await page.locator('.story-choice-confirm').click();
  await page.waitForFunction(()=>window.__choiceBeatDone===true);
  expect(await page.evaluate(()=>window.__game.state.storyChoice('n22')?.id)).toBe('hearth');

  await page.evaluate(()=>{
    const ch=window.__game.Config.story[2],node=ch.nodes.find(item=>item.id==='n32');
    window.__choiceBeatDone=false;
    window.__game.ui._storyBeat(ch,node,()=>{window.__choiceBeatDone=true;});
  });
  const dome=page.locator('.story-act[data-node="n32"]');
  await expect(dome).toContainText('把一片星空留在穹顶');
  await dome.locator('[data-choice="hunterbow"]').click();
  await page.screenshot({path:'artifacts/qa/web-story-dome-choice.png',fullPage:true});
  await dome.locator('.story-choice-confirm').click();
  await page.waitForFunction(()=>window.__choiceBeatDone===true);
  expect(await page.evaluate(()=>({n22:window.__game.state.storyChoice('n22')?.id,n32:window.__game.state.storyChoice('n32')?.id})))
    .toEqual({n22:'hearth',n32:'hunterbow'});
  expect(errors).toEqual([]);
  await context.close();
});

test('主线缺料可追踪合成路径并一键定位生成器或商店', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(base);
  await page.evaluate(()=>localStorage.clear());
  const errors=await boot(page);
  await skipWelcome(page);

  await page.locator('[data-panel="story"]').click();
  await expect(page.locator('[data-build="n11"]')).toContainText('找材料');
  // 真机快速结束序章时，上一帧排队的教学刷新不得把啾可/光圈重新叠到当前弹层下。
  await expect(page.locator('.modal-mask')).toHaveCount(1);
  await expect(page.locator('#companion')).toHaveCSS('display','none');
  await expect(page.locator('#guideLayer')).toHaveClass(/hidden/);
  await page.evaluate(()=>window.__game.ui._tutorial());
  await expect(page.locator('#companion')).toHaveCSS('display','none');
  await expect(page.locator('#guideLayer')).toHaveClass(/hidden/);
  await page.locator('.m-close').click();

  // 带修饰 class 的专用对话框仍必须使用透明宿主，否则外壳+内卡会看起来像弹窗重叠。
  await page.evaluate(()=>window.__game.ui._levelUp([{lv:2,reward:{coin:120,gem:0},text:'热饮链解锁'}]));
  await expect(page.locator('.modal-mask')).toHaveCount(1);
  await expect(page.locator('.modal')).toHaveClass(/bare/);
  await page.locator('.cd-ok').click();

  await page.locator('.quest-summary').click();
  await expect(page.locator('#quest')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#quest .q-go')).toContainText('找材料');
  await page.locator('#quest .q-go').click();
  const guide=page.locator('.objective-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('篝火堆');
  await expect(guide).toContainText('燧石火种');
  await expect(guide).toContainText('火星 → 火苗 → 火把 → 小炭炉 → 篝火堆');
  await expect(guide).toContainText('棋盘上已经有一条可合成路线');
  await page.screenshot({path:'artifacts/qa/web-material-guide.png',fullPage:true});

  await guide.locator('[data-locate-chain="fire"]').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','source');
  await expect(page.locator('#companion .comp-say')).toContainText('两个火星拖到一起');
  await page.evaluate(()=>{ const {chapter,node}=window.__game.state.currentObjective(); window.__game.ui._objectiveGuide(chapter,node); });
  await guide.locator('[data-locate-generator="g_fire"]').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','source');
  await expect(page.locator('#companion .comp-say')).toContainText('燧石火种');

  await page.evaluate(()=>{
    const s=window.__game.state;
    s.lv=6;
    s.ownedGens=s.ownedGens.filter(id=>id!=='g_food');
    s.cells=s.cells.map(cell=>cell?.k==='g'&&cell.gid==='g_food'?null:cell);
    window.__game.scene.sync(true);
    window.__game.ui._materialGuide('food',4,1);
  });
  await expect(page.locator('.material-guide')).toContainText('旧烤箱');
  await page.locator('.material-guide [data-shop-generator="g_food"]').click();
  await expect(page.locator('.m-title')).toContainText('商店');
  await expect(page.locator('[data-goods-generator="g_food"]')).toHaveClass(/source-focus/);
  await page.screenshot({path:'artifacts/qa/web-material-source-shop.png',fullPage:true});
  expect(errors).toEqual([]);
  await context.close();
});
