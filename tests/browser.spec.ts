import { test, expect, type Page } from '@playwright/test';
import type { BuildingType, Command, Entity, GameState, MatchSettings, Point, UnitType } from '../src/game/types';

interface DawnDebug {
  engine: {
    state: GameState; step(ticks?: number): void;
    command(owner: number, command: Command): {ok: boolean; reason?: string};
    canPlace(owner: number, type: BuildingType, x: number, y: number): {ok: boolean; reason?: string};
    canStand(entity: Entity, x: number, y: number): boolean;
    createUnit(owner: number, type: UnitType, x: number, y: number): Entity;
    get(id: number): Entity | undefined;
  };
  renderer: {center(x: number, y: number): void; worldToScreen(x: number, y: number): Point};
  app: {start(settings: MatchSettings): void};
}
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page) ?? [], 'Uncaught browser exceptions').toEqual([]); });

async function start(page: Page, path = '/aoe1/'): Promise<void> {
  await page.goto(path); await page.getByTestId('quick-start').click();
  await expect(page.getByTestId('battlefield')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as {__DAWN__?: DawnDebug}).__DAWN__?.engine);
}
async function tick(page: Page, ticks: number): Promise<void> {
  await page.evaluate(n => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.step(n), ticks);
  await page.waitForTimeout(180);
}
async function point(page: Page, position: Point, center = false): Promise<Point> {
  return page.evaluate(({position, center}) => {
    const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__;
    if (center) d.renderer.center(position.x, position.y);
    return d.renderer.worldToScreen(position.x, position.y); // Browser client pixels.
  }, {position, center});
}
async function clickEntity(page: Page, id: number, options: {button?: 'left'|'right'; shift?: boolean; center?: boolean} = {}): Promise<void> {
  const position = await page.evaluate(id => {
    const e = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id);
    if (!e) throw new Error(`Missing entity ${id}`);
    return {x: e.x, y: e.y};
  }, id);
  const p = await point(page, position, options.center ?? false);
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y-6, {button: options.button ?? 'left'});
  if (options.shift) await page.keyboard.up('Shift');
}

test('packaged game starts at the project root and /aoe1/ without missing assets or runtime errors', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failed.push(`${response.status()} ${response.url()}`); });
  for (const path of ['/', '/aoe1/']) {
    await start(page, path);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick)).toBeGreaterThan(0);
    await expect(page.getByTestId('pause')).toBeVisible();
  }
  expect(failed).toEqual([]);
});

test('custom match settings and tutorial launch through the real menus', async ({ page }) => {
  await page.goto('/aoe1/');
  await page.getByRole('button', {name: 'CUSTOM GAME'}).click();
  await page.getByLabel('Map seed', {exact: true}).fill('BROWSER-CUSTOM');
  await page.getByRole('combobox', {name: 'Opponents', exact: true}).selectOption('3');
  await page.getByRole('combobox', {name: 'Allies', exact: true}).selectOption('0');
  await page.getByRole('combobox', {name: 'Map size', exact: true}).selectOption('small');
  await page.getByRole('combobox', {name: 'Game speed', exact: true}).selectOption('2');
  await page.getByTestId('custom-start').click();
  const custom = await page.evaluate(() => {
    const s = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state;
    return {seed: s.settings.seed, opponents: s.settings.opponents, size: s.map.size, players: s.players.length, speed: s.settings.speed};
  });
  expect(custom).toEqual({seed: 'BROWSER-CUSTOM', opponents: 3, size: 96, players: 4, speed: 2});
  await page.goto('/aoe1/'); await page.getByTestId('tutorial-start').click();
  expect(await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.settings.tutorial)).toBe(true);
});

test('real pointer selects a villager, gathers finite wood and physically deposits it', async ({ page }) => {
  await start(page);
  const scenario = await page.evaluate(() => {
    const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__;
    const worker = d.engine.state.entities.find(e => e.owner === 0 && e.type === 'villager')!;
    const tree = d.engine.state.entities.filter(e => e.type === 'tree').sort((a,b) => Math.hypot(a.x-worker.x,a.y-worker.y)-Math.hypot(b.x-worker.x,b.y-worker.y))[0]!;
    return {worker: worker.id, tree: tree.id, wood: d.engine.state.players[0]!.resources.wood, amount: tree.amount};
  });
  await clickEntity(page, scenario.worker, {center: true});
  await expect(page.getByTestId('build-house')).toBeVisible();
  await clickEntity(page, scenario.tree, {button: 'right'});
  await expect.poll(() => page.evaluate(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.orders.some(o => o.type === 'gather'), scenario.worker)).toBe(true);
  await tick(page, 1800);
  const result = await page.evaluate(id => {
    const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__;
    return {wood: d.engine.state.players[0]!.resources.wood, amount: d.engine.get(id)?.amount ?? 0};
  }, scenario.tree);
  expect(result.wood).toBeGreaterThan(scenario.wood); expect(result.amount).toBeLessThan(scenario.amount);
});

test('pointer construction, Town Center training, group selection and movement affect simulation', async ({ page }) => {
  await start(page);
  const setup = await page.evaluate(() => {
    const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__, s = d.engine.state;
    const tc = s.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    const workers = s.entities.filter(e => e.owner === 0 && e.type === 'villager');
    const candidates: Point[] = [];
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
      if (Math.hypot(x,y) < 5 || Math.hypot(x,y) > 8) continue;
      const p = {x: Math.floor(tc.x+x)+.5, y: Math.floor(tc.y+y)+.5};
      if (d.engine.canPlace(0, 'house', p.x, p.y).ok) candidates.push({x: Math.floor(p.x)+1, y: Math.floor(p.y)+1});
    }
    if (!candidates.length) throw new Error('No clear initial house site');
    return {tc: tc.id, workers: workers.map(e => e.id), site: candidates[0]!, count: workers.length};
  });
  await clickEntity(page, setup.workers[0]!, {center: true}); await page.getByTestId('build-house').click();
  const site = await point(page, setup.site);
  await page.mouse.move(site.x, site.y); await page.mouse.click(site.x, site.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.entities.some(e => e.owner === 0 && e.type === 'house' && !e.completed))).toBe(true);
  await tick(page, 2000);
  expect(await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.entities.some(e => e.owner === 0 && e.type === 'house' && e.completed))).toBe(true);
  await clickEntity(page, setup.tc, {center: true}); await page.getByTestId('train-villager').click();
  expect(await page.evaluate(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.queue.some(q => q.type === 'villager'), setup.tc)).toBe(true);
  await tick(page, 500);
  expect(await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.entities.filter(e => e.owner === 0 && e.type === 'villager').length)).toBe(setup.count+1);
  await clickEntity(page, setup.workers[0]!, {center: true}); await clickEntity(page, setup.workers[1]!, {shift: true});
  const destination = await page.evaluate(id => {
    const tc = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)!;
    return {x: tc.x+6, y: tc.y+2};
  }, setup.tc);
  const target = await point(page, destination); await page.mouse.click(target.x, target.y, {button: 'right'});
  expect(await page.evaluate(ids => ids.filter(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.orders.some(o => o.type === 'move')).length, setup.workers.slice(0,2))).toBe(2);
  await tick(page, 500);
  const distances = await page.evaluate(({ids, destination}) => ids.map(id => {
    const e = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)!;
    return Math.hypot(e.x-destination.x,e.y-destination.y);
  }), {ids: setup.workers.slice(0,2), destination});
  expect(Math.max(...distances)).toBeLessThan(5);
});

test('pointer attack destroys the last hostile and triggers a legitimate conquest result', async ({ page }) => {
  await start(page);
  const ids = await page.evaluate(() => {
    const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__, s = d.engine.state;
    const tc = s.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    for (const e of s.entities) if (e.owner === 1) e.hp = 0;
    if (s.players[1]!.ai) s.players[1]!.ai.nextDecision = 1e9;
    // Resource-free start corridor outside the Town Center footprint.
    const attacker = d.engine.createUnit(0, 'infantry', tc.x-5, tc.y-4);
    const defender = d.engine.createUnit(1, 'villager', tc.x-5, tc.y-1);
    defender.hp = 1; attacker.cooldown = 30;
    d.engine.step(1); return {attacker: attacker.id, defender: defender.id};
  });
  await clickEntity(page, ids.attacker, {center: true}); await clickEntity(page, ids.defender, {button: 'right'});
  expect(await page.evaluate(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.orders.some(o => o.type === 'attack'), ids.attacker)).toBe(true);
  await page.evaluate(id => { (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)!.cooldown = 0; }, ids.attacker);
  await tick(page, 200);
  expect(await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.result)).toBe('victory');
  await expect(page.getByText('Victory', {exact: true}).first()).toBeVisible();
});

test('pause freezes simulation; local save survives reload; restart creates a fresh single match', async ({ page }) => {
  await start(page); await tick(page, 100); await page.getByTestId('pause').click();
  const frozen = await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick)).toBe(frozen);
  await page.getByTestId('save-game').click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('dawn.save.')))).toBe(true);
  await page.reload(); await page.getByTestId('continue').click(); await expect(page.getByTestId('battlefield')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick)).toBeGreaterThanOrEqual(frozen);
  if (await page.getByTestId('resume').isVisible()) await page.getByTestId('resume').click();
  await page.getByTestId('pause').click(); await page.getByTestId('restart').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick)).toBeLessThan(80);
  const before = await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick);
  await page.waitForTimeout(500);
  const delta = await page.evaluate(() => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state.tick)-before;
  expect(delta).toBeGreaterThan(1); expect(delta).toBeLessThan(20);
});

test('quick skirmish creates allied and enemy villages whose workers walk, gather and deposit unaided', async ({ page }) => {
  await start(page);
  const initial = await page.evaluate(() => {
    const s = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.state;
    return {
      teams: s.players.map(p => ({id: p.id, team: p.team ?? p.id, hasAI: !!p.ai})),
      towns: s.entities.filter(e => e.type === 'towncenter').map(e => e.owner),
      workers: s.entities.filter(e => e.owner > 0 && e.type === 'villager').map(e => ({id: e.id, owner: e.owner, x: e.x, y: e.y})),
      sources: s.entities.filter(e => e.kind === 'resource').map(e => ({id: e.id, amount: e.amount})),
      gathered: s.players.map(p => p.stats.gathered),
    };
  });
  expect(initial.teams).toHaveLength(3);
  const ally = initial.teams.find(p => p.id > 0 && p.team === initial.teams[0]!.team)!;
  const enemy = initial.teams.find(p => p.team !== initial.teams[0]!.team)!;
  expect(ally, 'A quick skirmish includes an allied kingdom').toBeDefined();
  expect(enemy, 'A quick skirmish includes a hostile kingdom').toBeDefined();
  expect(ally.hasAI && enemy.hasAI).toBe(true);
  expect(initial.towns.sort()).toEqual([0, ally.id, enemy.id].sort());
  const moved = new Set<number>();
  for (let sample = 0; sample < 8; sample++) {
    await tick(page, 200);
    const positions = await page.evaluate(ids => {
      const e = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine;
      return ids.map(id => {const worker = e.get(id); return worker ? {id, x: worker.x, y: worker.y} : undefined;});
    }, initial.workers.map(worker => worker.id));
    for (const worker of initial.workers) {
      const current = positions.find(p => p?.id === worker.id);
      if (current && Math.hypot(current.x - worker.x, current.y - worker.y) > .75) moved.add(worker.owner);
    }
  }
  const final = await page.evaluate(sources => {
    const e = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine;
    return {gathered: e.state.players.map(p => p.stats.gathered), depleted: sources.some(source => (e.get(source.id)?.amount ?? 0) < source.amount)};
  }, initial.sources);
  expect([...moved]).toEqual(expect.arrayContaining([ally.id, enemy.id]));
  for (const id of [ally.id, enemy.id]) expect(final.gathered[id], `Kingdom ${id} physically deposits resources`).toBeGreaterThan(initial.gathered[id]!);
  expect(final.depleted, 'Autonomous economies consume finite resource entities').toBe(true);
});

test('right click on an allied unit never attacks or damages it', async ({ page }) => {
  await start(page);
  const fixture = await page.evaluate(() => {
    const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__, s = d.engine.state;
    const ally = s.players.find(p => p.id > 0 && p.team === s.players[0]!.team)!;
    if (!ally) throw new Error('Quick skirmish must include an ally');
    const tc = s.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    const attacker = d.engine.createUnit(0, 'infantry', tc.x - 5, tc.y - 4);
    const target = d.engine.createUnit(ally.id, 'villager', tc.x - 5, tc.y - 1);
    target.orders = [{type: 'hold', x: target.x, y: target.y}];
    if (ally.ai) ally.ai.nextDecision = 1e9;
    d.engine.step(1);
    return {attacker: attacker.id, target: target.id, hp: target.hp};
  });
  await clickEntity(page, fixture.attacker, {center: true});
  await clickEntity(page, fixture.target, {button: 'right'});
  expect(await page.evaluate(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.orders.some(order => order.type === 'attack'), fixture.attacker)).toBe(false);
  await tick(page, 200);
  expect(await page.evaluate(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.hp, fixture.target)).toBe(fixture.hp);
});

test.describe('phone controls', () => {
  test.use({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true});

  test('native touch can select and command a villager with the HUD inside the screen', async ({ page }) => {
    await page.goto('/aoe1/'); await page.getByTestId('quick-start').tap();
    await page.waitForFunction(() => !!(window as unknown as {__DAWN__?: DawnDebug}).__DAWN__?.engine);
    const setup = await page.evaluate(() => {
      const d = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__;
      const worker = d.engine.state.entities.find(e => e.owner === 0 && e.type === 'villager')!;
      d.renderer.center(worker.x, worker.y);
      for (let r = 3; r <= 5; r++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (Math.hypot(x, y) < 3 || Math.hypot(x, y) > 5) continue;
        const destination = {x: Math.floor(worker.x + x) + .5, y: Math.floor(worker.y + y) + .5};
        const screen = d.renderer.worldToScreen(destination.x, destination.y);
        if (!d.engine.canStand(worker, destination.x, destination.y) || screen.x < 35 || screen.x > innerWidth - 35 || screen.y < 180 || screen.y > innerHeight - 280) continue;
        return {id: worker.id, from: d.renderer.worldToScreen(worker.x, worker.y), to: screen, destination};
      }
      throw new Error('No visible, clear phone movement target');
    });
    await page.touchscreen.tap(setup.from.x, setup.from.y - 6);
    await expect(page.getByTestId('build-house')).toBeVisible();
    await page.getByTestId('touch-order').tap();
    await page.touchscreen.tap(setup.to.x, setup.to.y);
    await expect.poll(() => page.evaluate(id => (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)?.orders.some(order => order.type === 'move'), setup.id)).toBe(true);
    await tick(page, 250);
    const distance = await page.evaluate(({id, destination}) => {
      const e = (window as unknown as {__DAWN__: DawnDebug}).__DAWN__.engine.get(id)!;
      return Math.hypot(e.x - destination.x, e.y - destination.y);
    }, {id: setup.id, destination: setup.destination});
    expect(distance).toBeLessThan(1.5);
    const bounds = await page.evaluate(() => {
      const pause = document.querySelector('[data-testid="pause"]')!.getBoundingClientRect();
      const commands = document.querySelector('#commands')!.getBoundingClientRect();
      return {pauseFits: pause.left >= 0 && pause.right <= innerWidth && pause.top >= 0 && pause.bottom <= innerHeight, commandsWidth: commands.width};
    });
    expect(bounds.pauseFits, 'Pause remains accessible in portrait orientation').toBe(true);
    expect(bounds.commandsWidth, 'Construction and military commands retain usable space').toBeGreaterThanOrEqual(100);
    await page.getByTestId('pause').tap();
    await expect(page.getByTestId('resume')).toBeVisible();
  });
});
