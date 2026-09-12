import { test, expect } from '@playwright/test';

const base = 'http://127.0.0.1:8099/';

async function boot(page, query = '?safeTop=32&safeRight=0&safeBottom=24&safeLeft=0&contentVersion=e2e') {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(base + query, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game), null, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  return errors;
}

test('全屏安全区、三章入口与固定来源存档', async ({ browser }) => {
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

  const welcome = page.locator('.dlg-next');
  if (await welcome.isVisible()) await welcome.click();
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
  await expect(page.locator('.dlg-line .say')).toContainText('暴风雪下了整整十年');
  await page.screenshot({ path: 'artifacts/qa/web-safe-area.png', fullPage: true });

  expect(errors).toEqual([]);
  await context.close();
});

test('左右挖孔边距不会遮住操作控件', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = await boot(page, '?safeTop=40&safeRight=18&safeBottom=28&safeLeft=12&contentVersion=e2e');
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

test('新手可沿竞品同款核心循环完成六步教学', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  const errors = await boot(page);
  await page.locator('.dlg-next').click();
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','produce');
  await expect(page.locator('#guideLayer .guide-shade')).toHaveCount(4);
  expect(await page.locator('.guide-focus').evaluate(el => getComputedStyle(el).boxShadow.includes('200vmax'))).toBe(false);
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
  await expect(page.locator('#guideLayer')).toHaveAttribute('data-step','order');
  await page.waitForTimeout(220);
  expect(await page.evaluate(() => window.__game.scene.itemLayer.children.length)).toBe(
    await page.evaluate(() => window.__game.scene.nodes.size)
  );
  await page.locator('.order-card').first().locator('.oc-submit').click();
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
  await expect(page.locator('.story-chap')).toHaveCount(3);
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
  const welcome=page.locator('.dlg-next');
  if(await welcome.isVisible()) await welcome.click();

  await page.evaluate(()=>{ window.__game.state.coin=0; window.__game.state.gem=0; window.__game.ui.renderHUD(); });
  await page.locator('[data-panel="shop"]').click();
  await page.locator('.modal').evaluate(el=>{el.dataset.instance='shop-stable';});
  await page.locator('.m-body').evaluate(el=>{el.scrollTop=220;});
  const before=await page.evaluate(()=>({
    cells:JSON.stringify(window.__game.state.cells),coin:window.__game.state.coin,gem:window.__game.state.gem,
    scroll:document.querySelector('.m-body').scrollTop
  }));

  await page.locator('[data-chest="chest_bronze"]').click();
  await expect(page.locator('.toast').last()).toContainText('金币不足');
  await expect(page.locator('.modal')).toHaveAttribute('data-instance','shop-stable');
  await expect(page.locator('.modal-mask')).toHaveCount(1);
  expect(await page.locator('.m-body').evaluate(el=>el.scrollTop)).toBe(before.scroll);
  expect(await page.evaluate(()=>JSON.stringify(window.__game.state.cells))).toBe(before.cells);
  expect(await page.evaluate(()=>window.__game.state.coin)).toBe(before.coin);

  await page.locator('[data-energy]').click();
  await expect(page.locator('.toast').last()).toContainText('钻石不足');
  await expect(page.locator('.modal')).toHaveAttribute('data-instance','shop-stable');
  expect(await page.locator('.m-body').evaluate(el=>el.scrollTop)).toBe(before.scroll);
  expect(await page.evaluate(()=>window.__game.state.gem)).toBe(before.gem);

  await page.evaluate(()=>{window.__game.state.coin=1000;});
  await page.locator('[data-chest="chest_bronze"]').click();
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
