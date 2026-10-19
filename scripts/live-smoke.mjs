import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';

// The remote target is intentional. Override LIVE_URL to exercise a local Pages
// package with exactly the same real-pointer checks. HTTPS verification stays on.
const target = new URL(process.env.LIVE_URL ?? 'https://vudh1.github.io/aoe1/');
const prefix = target.pathname.replace(/\/?$/, '/');
const output = resolve(process.env.LIVE_OUTPUT ?? '/tmp');
await mkdir(output, {recursive: true});
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (!process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const proxyURL = !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
const browser = await chromium.launch({executablePath, headless: true, ...(proxyURL ? {proxy: {server: proxyURL}} : {})});
const report = {target: target.href, testedAt: new Date().toISOString(), browser: browser.version(), checks: [], errors: [], failedAssets: [], mobile: null};
const contexts = [];

async function context(options = {}) {
  const result = await browser.newContext({viewport: {width: 1440, height: 900}, ...options});
  contexts.push(result);
  result.on('page', page => {
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) report.failedAssets.push({status: response.status(), url: response.url()});
    });
  });
  return result;
}
async function check(name, fn) {
  const began = Date.now();
  try { const detail = await fn(); report.checks.push({name, passed: true, durationMs: Date.now() - began, ...(detail ? {detail} : {})}); }
  catch (error) { report.checks.push({name, passed: false, durationMs: Date.now() - began, error: error.message}); }
  console.log(`${report.checks.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
}
async function start(page, path = prefix) {
  await page.goto(new URL(path, target).href, {waitUntil: 'networkidle'});
  await page.getByTestId('quick-start').click();
  await page.waitForFunction(() => window.__DAWN__?.engine?.state.tick > 0);
}
async function tick(page, count) {
  await page.evaluate(count => window.__DAWN__.engine.step(count), count);
  await page.waitForTimeout(200);
}
async function screenPoint(page, point, center = false) {
  return page.evaluate(({point, center}) => {
    const d = window.__DAWN__;
    if (center) d.renderer.center(point.x, point.y);
    return d.renderer.worldToScreen(point.x, point.y);
  }, {point, center});
}
async function clickEntity(page, id, {button = 'left', center = false, shift = false} = {}) {
  const position = await page.evaluate(id => {
    const e = window.__DAWN__.engine.get(id);
    if (!e) throw new Error(`Entity ${id} missing`);
    return {x: e.x, y: e.y};
  }, id);
  const point = await screenPoint(page, position, center);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y - 6, {button});
  if (shift) await page.keyboard.up('Shift');
}

try {
  const desktop = await context();
  const page = await desktop.newPage();
  await check('published root and nested /aoe1/ start without missing assets', async () => {
    for (const path of [prefix, `${prefix}aoe1/`]) {
      await page.goto(new URL(path, target).href, {waitUntil: 'networkidle'});
      if (path === prefix) await page.screenshot({path: resolve(output, 'dawn-live-menu.png')});
      await page.getByTestId('quick-start').click();
      await page.waitForFunction(() => window.__DAWN__?.engine?.state.tick > 0);
      assert.equal(await page.getByTestId('pause').isVisible(), true);
    }
    await page.screenshot({path: resolve(output, 'dawn-live-game.png')});
    assert.deepEqual(report.failedAssets, []);
  });
  await check('custom match and tutorial use the published menus', async () => {
    await page.goto(target.href);
    await page.getByRole('button', {name: 'CUSTOM GAME'}).click();
    await page.getByLabel('Map seed', {exact: true}).fill('LIVE-SMOKE-CUSTOM');
    await page.getByRole('combobox', {name: 'Opponents', exact: true}).selectOption('3');
    await page.getByRole('combobox', {name: 'Allies', exact: true}).selectOption('0');
    await page.getByRole('combobox', {name: 'Map size', exact: true}).selectOption('small');
    await page.getByRole('combobox', {name: 'Game speed', exact: true}).selectOption('2');
    await page.getByTestId('custom-start').click();
    assert.deepEqual(await page.evaluate(() => {
      const s = window.__DAWN__.engine.state;
      return {seed: s.settings.seed, players: s.players.length, size: s.map.size, speed: s.settings.speed};
    }), {seed: 'LIVE-SMOKE-CUSTOM', players: 4, size: 96, speed: 2});
    await page.goto(target.href);
    await page.getByTestId('tutorial-start').click();
    assert.equal(await page.evaluate(() => window.__DAWN__.engine.state.settings.tutorial), true);
  });
  await check('allied and hostile villages autonomously walk, gather and deposit', async () => {
    await start(page);
    const initial = await page.evaluate(() => {
      const s = window.__DAWN__.engine.state;
      return {teams: s.players.map(p => ({id: p.id, team: p.team ?? p.id})), towns: s.entities.filter(e => e.type === 'towncenter').map(e => e.owner), workers: s.entities.filter(e => e.owner > 0 && e.type === 'villager').map(e => ({id: e.id, owner: e.owner, x: e.x, y: e.y})), gathered: s.players.map(p => p.stats.gathered)};
    });
    assert.equal(initial.teams.length, 3, 'Quick skirmish must create player, enemy and ally');
    const ally = initial.teams.find(p => p.id > 0 && p.team === initial.teams[0].team);
    const enemy = initial.teams.find(p => p.team !== initial.teams[0].team);
    assert.ok(ally && enemy);
    assert.deepEqual(initial.towns.sort(), [0, ally.id, enemy.id].sort());
    const moved = new Set();
    for (let sample = 0; sample < 8; sample++) {
      await tick(page, 200);
      const positions = await page.evaluate(ids => ids.map(id => {const e = window.__DAWN__.engine.get(id); return e && {id, x: e.x, y: e.y};}), initial.workers.map(worker => worker.id));
      for (const worker of initial.workers) {
        const current = positions.find(p => p?.id === worker.id);
        if (current && Math.hypot(current.x - worker.x, current.y - worker.y) > .75) moved.add(worker.owner);
      }
    }
    const gathered = await page.evaluate(() => window.__DAWN__.engine.state.players.map(p => p.stats.gathered));
    for (const id of [ally.id, enemy.id]) {
      assert.ok(moved.has(id), `NPC kingdom ${id} must visibly move workers`);
      assert.ok(gathered[id] > initial.gathered[id], `NPC kingdom ${id} must physically deposit resources`);
    }
    return {ally: ally.id, enemy: enemy.id, gathered};
  });
  await check('real pointer selects, gathers finite timber and deposits wood', async () => {
    await start(page);
    const fixture = await page.evaluate(() => {
      const s = window.__DAWN__.engine.state;
      const worker = s.entities.find(e => e.owner === 0 && e.type === 'villager');
      const tree = s.entities.filter(e => e.type === 'tree').sort((a, b) => Math.hypot(a.x - worker.x, a.y - worker.y) - Math.hypot(b.x - worker.x, b.y - worker.y))[0];
      return {worker: worker.id, tree: tree.id, wood: s.players[0].resources.wood, amount: tree.amount};
    });
    await clickEntity(page, fixture.worker, {center: true});
    await page.getByTestId('build-house').waitFor({state: 'visible'});
    await clickEntity(page, fixture.tree, {button: 'right'});
    assert.equal(await page.evaluate(id => window.__DAWN__.engine.get(id).orders.some(o => o.type === 'gather'), fixture.worker), true);
    await tick(page, 1800);
    const result = await page.evaluate(id => ({wood: window.__DAWN__.engine.state.players[0].resources.wood, amount: window.__DAWN__.engine.get(id)?.amount ?? 0}), fixture.tree);
    assert.ok(result.wood > fixture.wood, 'gathered timber must reach a drop-off');
    assert.ok(result.amount < fixture.amount, 'timber must deplete the tree');
    return {initialWood: fixture.wood, finalWood: result.wood};
  });
  await check('pointer construction, training and shift selection move actual units', async () => {
    await start(page);
    const fixture = await page.evaluate(() => {
      const d = window.__DAWN__, s = d.engine.state;
      const tc = s.entities.find(e => e.owner === 0 && e.type === 'towncenter');
      const workers = s.entities.filter(e => e.owner === 0 && e.type === 'villager');
      for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
        if (Math.hypot(x, y) < 5 || Math.hypot(x, y) > 8) continue;
        const origin = {x: Math.floor(tc.x + x) + .5, y: Math.floor(tc.y + y) + .5};
        if (d.engine.canPlace(0, 'house', origin.x, origin.y).ok) return {tc: tc.id, workers: workers.map(e => e.id), site: {x: Math.floor(origin.x) + 1, y: Math.floor(origin.y) + 1}, count: workers.length};
      }
      throw new Error('No valid initial house site');
    });
    await clickEntity(page, fixture.workers[0], {center: true});
    await page.getByTestId('build-house').click();
    const site = await screenPoint(page, fixture.site);
    await page.mouse.move(site.x, site.y); await page.mouse.click(site.x, site.y);
    await page.waitForFunction(() => window.__DAWN__.engine.state.entities.some(e => e.owner === 0 && e.type === 'house' && !e.completed));
    await tick(page, 2000);
    assert.equal(await page.evaluate(() => window.__DAWN__.engine.state.entities.some(e => e.owner === 0 && e.type === 'house' && e.completed)), true);
    await clickEntity(page, fixture.tc, {center: true});
    await page.getByTestId('train-villager').click();
    assert.equal(await page.evaluate(id => window.__DAWN__.engine.get(id).queue.some(q => q.type === 'villager'), fixture.tc), true);
    await tick(page, 500);
    assert.equal(await page.evaluate(() => window.__DAWN__.engine.state.entities.filter(e => e.owner === 0 && e.type === 'villager').length), fixture.count + 1);
    await clickEntity(page, fixture.workers[0], {center: true});
    await clickEntity(page, fixture.workers[1], {shift: true});
    const destination = await page.evaluate(id => {const e = window.__DAWN__.engine.get(id); return {x: e.x + 6, y: e.y + 2};}, fixture.tc);
    const p = await screenPoint(page, destination);
    await page.mouse.click(p.x, p.y, {button: 'right'});
    assert.equal(await page.evaluate(ids => ids.filter(id => window.__DAWN__.engine.get(id).orders.some(o => o.type === 'move')).length, fixture.workers.slice(0, 2)), 2);
    await tick(page, 500);
    const distances = await page.evaluate(({ids, destination}) => ids.map(id => {const e = window.__DAWN__.engine.get(id); return Math.hypot(e.x - destination.x, e.y - destination.y);}), {ids: fixture.workers.slice(0, 2), destination});
    assert.ok(Math.max(...distances) < 5);
  });
  await check('real pointer attack defeats the last hostile and shows conquest', async () => {
    await start(page);
    // A small combat fixture isolates hit testing and conquest from a long AI
    // match. Inputs and the resulting damage/elimination still use normal rules.
    const fixture = await page.evaluate(() => {
      const d = window.__DAWN__, s = d.engine.state;
      const tc = s.entities.find(e => e.owner === 0 && e.type === 'towncenter');
      for (const e of s.entities) if (e.owner === 1) e.hp = 0;
      if (s.players[1].ai) s.players[1].ai.nextDecision = 1e9;
      const attacker = d.engine.createUnit(0, 'infantry', tc.x - 5, tc.y - 4);
      const defender = d.engine.createUnit(1, 'villager', tc.x - 5, tc.y - 1);
      defender.hp = 1; attacker.cooldown = 30; d.engine.step(1);
      return {attacker: attacker.id, defender: defender.id};
    });
    await clickEntity(page, fixture.attacker, {center: true});
    await clickEntity(page, fixture.defender, {button: 'right'});
    assert.equal(await page.evaluate(id => window.__DAWN__.engine.get(id).orders.some(o => o.type === 'attack'), fixture.attacker), true);
    await page.evaluate(id => {window.__DAWN__.engine.get(id).cooldown = 0;}, fixture.attacker);
    await tick(page, 200);
    assert.equal(await page.evaluate(() => window.__DAWN__.engine.state.result), 'victory');
    assert.equal(await page.getByText('Victory', {exact: true}).first().isVisible(), true);
  });
  await check('contextual pointer commands protect allied workers from friendly fire', async () => {
    await start(page);
    const fixture = await page.evaluate(() => {
      const d = window.__DAWN__, s = d.engine.state;
      const ally = s.players.find(p => p.id > 0 && p.team === s.players[0].team);
      if (!ally) throw new Error('Quick skirmish must include an ally');
      const tc = s.entities.find(e => e.owner === 0 && e.type === 'towncenter');
      const attacker = d.engine.createUnit(0, 'infantry', tc.x - 5, tc.y - 4);
      const target = d.engine.createUnit(ally.id, 'villager', tc.x - 5, tc.y - 1);
      target.orders = [{type: 'hold', x: target.x, y: target.y}];
      if (ally.ai) ally.ai.nextDecision = 1e9;
      d.engine.step(1); return {attacker: attacker.id, target: target.id, hp: target.hp};
    });
    await clickEntity(page, fixture.attacker, {center: true});
    await clickEntity(page, fixture.target, {button: 'right'});
    assert.equal(await page.evaluate(id => window.__DAWN__.engine.get(id).orders.some(o => o.type === 'attack'), fixture.attacker), false);
    await tick(page, 200);
    assert.equal(await page.evaluate(id => window.__DAWN__.engine.get(id)?.hp, fixture.target), fixture.hp);
  });
  await check('illustrated portrait and complete inventory decode their bundled atlas', async () => {
    await start(page);
    const worker = await page.evaluate(() => window.__DAWN__.engine.state.entities.find(e => e.owner === 0 && e.type === 'villager').id);
    await clickEntity(page, worker, {center: true});
    assert.equal(await page.getByTestId('illustrated-portrait').locator('[data-art="villager"]').isVisible(), true);
    await page.getByTestId('inventory-toggle').click();
    const inventory = page.getByTestId('inventory-panel');
    await inventory.waitFor({state: 'visible'});
    const detail = await inventory.evaluate(async element => {
      const counts = Object.fromEntries(['resource', 'unit', 'building', 'technology'].map(kind => [kind, element.querySelectorAll(`[data-inventory-kind="${kind}"]`).length]));
      const urls = [...new Set([...element.querySelectorAll('[data-art]')].map(art => getComputedStyle(art).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]).filter(Boolean))];
      const atlases = await Promise.all(urls.map(async url => {const image = new Image(); image.src = url; await image.decode(); return {url, width: image.naturalWidth, height: image.naturalHeight};}));
      return {counts, atlases, villagerAvailable: element.querySelector('[data-inventory-kind="unit"][data-inventory-key="villager"]')?.getAttribute('data-availability'), heavyAvailable: element.querySelector('[data-inventory-kind="unit"][data-inventory-key="heavy"]')?.getAttribute('data-availability')};
    });
    assert.deepEqual(detail.counts, {resource: 4, unit: 8, building: 14, technology: 11});
    assert.equal(detail.atlases.length, 1);
    assert.ok(detail.atlases[0].width >= 600 && detail.atlases[0].width === detail.atlases[0].height);
    assert.equal(detail.villagerAvailable, 'available'); assert.equal(detail.heavyAvailable, 'locked');
    await page.screenshot({path: resolve(output, 'dawn-live-inventory.png')});
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    assert.equal(await page.evaluate(() => window.__DAWN__.engine.state.paused), false);
    return detail;
  });
  await check('pause is frozen; a local save restores after a real reload', async () => {
    await start(page); await tick(page, 100); await page.getByTestId('pause').click();
    const tickBefore = await page.evaluate(() => window.__DAWN__.engine.state.tick);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.__DAWN__.engine.state.tick), tickBefore);
    await page.getByTestId('save-game').click();
    await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('dawn.save.')));
    await page.reload(); await page.getByTestId('continue').click();
    assert.ok(await page.evaluate(() => window.__DAWN__.engine.state.tick) >= tickBefore);
  });
  await check('iPhone-size touch and HUD survey', async () => {
    const mobile = await context({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true});
    const phone = await mobile.newPage();
    await phone.goto(target.href, {waitUntil: 'networkidle'});
    await phone.screenshot({path: resolve(output, 'dawn-live-mobile-menu.png')});
    await phone.getByTestId('quick-start').tap();
    await phone.waitForFunction(() => window.__DAWN__?.engine?.state.tick > 0);
    const position = await phone.evaluate(() => {
      const d = window.__DAWN__, worker = d.engine.state.entities.find(e => e.owner === 0 && e.type === 'villager');
      d.renderer.center(worker.x, worker.y);
      for (let r = 3; r <= 5; r++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (Math.hypot(x, y) < 3 || Math.hypot(x, y) > 5) continue;
        const destination = {x: Math.floor(worker.x + x) + .5, y: Math.floor(worker.y + y) + .5};
        const screen = d.renderer.worldToScreen(destination.x, destination.y);
        if (!d.engine.canStand(worker, destination.x, destination.y) || screen.x < 35 || screen.x > innerWidth - 35 || screen.y < 180 || screen.y > innerHeight - 280) continue;
        return {...d.renderer.worldToScreen(worker.x, worker.y), id: worker.id, destination, target: screen};
      }
      throw new Error('No visible, clear phone movement target');
    });
    await phone.touchscreen.tap(position.x, position.y - 6);
    await phone.waitForTimeout(200);
    const survey = await phone.evaluate(id => {
      const bounds = {};
      for (const selector of ['#resources', '[data-testid="pause"]', '#selection', '#commands', '#actions', '#map-panel']) {
        const r = document.querySelector(selector).getBoundingClientRect();
        bounds[selector] = {x: r.x, y: r.y, width: r.width, height: r.height, withinViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight};
      }
      return {viewport: {width: innerWidth, height: innerHeight}, bounds, villagerSelected: window.__DAWN__.app.selected.includes(id), touchCommandPresent: !!document.querySelector('[data-testid="touch-order"]'), touchOrderAccepted: false, touchMoved: false};
    }, position.id);
    if (survey.touchCommandPresent) {
      await phone.getByTestId('touch-order').tap();
      await phone.touchscreen.tap(position.target.x, position.target.y);
      survey.touchOrderAccepted = await phone.evaluate(id => window.__DAWN__.engine.get(id)?.orders.some(order => order.type === 'move'), position.id);
      await tick(phone, 250);
      survey.touchMoved = await phone.evaluate(({id, destination}) => {const e = window.__DAWN__.engine.get(id); return e && Math.hypot(e.x - destination.x, e.y - destination.y) < 1.5;}, position);
    }
    report.mobile = survey;
    await phone.screenshot({path: resolve(output, 'dawn-live-mobile-game.png')});
    if (process.env.LIVE_REQUIRE_TOUCH === '1') {
      assert.equal(survey.bounds['[data-testid="pause"]'].withinViewport, true, 'pause must fit on phone');
      assert.ok(survey.bounds['#commands'].width >= 100, 'command panel must remain usable');
      assert.equal(survey.villagerSelected, true, 'native touch must select a villager');
      assert.equal(survey.touchCommandPresent, true, 'touch must expose a command gesture');
      assert.equal(survey.touchOrderAccepted, true, 'native touch must issue an actual movement order');
      assert.equal(survey.touchMoved, true, 'the commanded worker must reach the touched ground');
    }
    return survey;
  });
  await check('all tested pages have no runtime exceptions or missing HTTP assets', async () => {
    assert.deepEqual(report.errors, []); assert.deepEqual(report.failedAssets, []);
  });
} finally {
  await writeFile(resolve(output, 'dawn-live-report.json'), JSON.stringify(report, null, 2));
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
console.log(`Report and screenshots: ${output}`);
if (report.checks.some(check => !check.passed)) process.exitCode = 1;
