import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/game/engine';
import { updateAI } from '../src/game/ai';
import { DEFAULT_SETTINGS, type Command } from '../src/game/types';

function game() {
  const engine = new Engine({ ...DEFAULT_SETTINGS, seed: 'AI-REGRESSION', size: 'small', peaceful: true });
  engine.state.players[1]!.ai = undefined;
  engine.state.players[0]!.ai = { nextDecision: 0, phase: 'opening', nextAttack: 0, scoutIndex: 0, lastBuild: 0 };
  return engine;
}

describe('AI uses the shared rules and its own discoveries', () => {
  it('retries an unaffordable or rejected production command instead of assuming it succeeded', () => {
    const engine = game();
    const original = engine.command.bind(engine);
    let reject = true;
    const requests: Command[] = [];
    engine.command = (owner, command) => {
      requests.push(command);
      if (command.type === 'train' && reject) return { ok: false, reason: 'Temporary population pressure' };
      return original(owner, command);
    };
    updateAI(engine);
    const food = engine.state.players[0]!.resources.food;
    expect(engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!.queue).toHaveLength(0);
    reject = false;
    engine.state.tick = 40;
    updateAI(engine);
    expect(requests.filter(c => c.type === 'train').length).toBeGreaterThanOrEqual(2);
    expect(engine.state.players[0]!.resources.food).toBe(food - 50);
    expect(engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!.queue[0]!.type).toBe('villager');
  });

  it('scouts unexplored land without targeting the location of an undiscovered rival', () => {
    const engine = game();
    const player = engine.state.players[0]!;
    player.memory = {};
    const enemy = engine.state.entities.find(e => e.owner === 1 && e.type === 'towncenter')!;
    expect(engine.isVisible(0, enemy)).toBe(false);
    const spy = vi.spyOn(engine, 'command');
    updateAI(engine);
    const orders = spy.mock.calls.map(([, c]) => c).filter((c): c is Extract<Command, { type: 'order' }> => c.type === 'order');
    expect(orders.some(c => c.order.type === 'attackMove')).toBe(true);
    expect(orders.some(c => c.order.target === enemy.id || c.order.x === enemy.x && c.order.y === enemy.y)).toBe(false);
    expect(player.memory[enemy.id]).toBeUndefined();
  });

  it('advances only through paid research with completed prerequisites', () => {
    const engine = game();
    const player = engine.state.players[0]!;
    const tc = engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    for (let i = 0; i < 12; i++) engine.createUnit(0, 'villager', tc.x + 6 + i % 3, tc.y + 6 + Math.floor(i / 3));
    for (let i = 0; i < 3; i++) engine.createBuilding(0, 'house', tc.x - 7 - i * 3, tc.y);
    engine.createBuilding(0, 'granary', tc.x, tc.y + 10);
    engine.createBuilding(0, 'storage', tc.x - 8, tc.y + 5);
    engine.createBuilding(0, 'barracks', tc.x + 7, tc.y);
    player.resources = { food: 1000, wood: 1000, gold: 500, stone: 150 };
    updateAI(engine);
    expect(player.age).toBe(1);
    expect(tc.queue.some(q => q.type === 'age2')).toBe(true);
    expect(player.resources.food).toBeLessThanOrEqual(550);
    player.ai = undefined;
    engine.command(0, { type: 'order', ids: engine.state.entities.filter(e => e.owner === 0 && e.kind === 'unit').map(e => e.id), order: { type: 'hold', x: tc.x, y: tc.y } });
    engine.step(20 * 70);
    expect(player.age).toBe(2);
  });

  it('walks toward a remembered resource before issuing a gather order outside sight', () => {
    const engine = game();
    const player = engine.state.players[0]!;
    const resource = engine.state.entities.find(e => e.kind === 'resource' && e.resource === 'wood' && !engine.isVisible(0, e))!;
    player.visible.fill(0);
    player.memory = { [resource.id]: structuredClone(resource) };
    const spy = vi.spyOn(engine, 'command');
    updateAI(engine);
    const orders = spy.mock.calls.map(([, c]) => c).filter((c): c is Extract<Command, { type: 'order' }> => c.type === 'order');
    expect(orders.some(c => c.order.type === 'gather' && c.order.target === resource.id)).toBe(false);
    expect(orders.some(c => c.order.type === 'move' && c.order.x === resource.x && c.order.y === resource.y)).toBe(true);
  });

  it('builds housing through paid construction before the population fills', () => {
    const engine = game();
    const tc = engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    engine.createUnit(0, 'villager', tc.x + 6, tc.y + 5);
    const before = engine.state.players[0]!.resources.wood;
    updateAI(engine);
    expect(engine.state.entities.some(e => e.owner === 0 && e.type === 'house' && !e.completed)).toBe(true);
    expect(engine.state.players[0]!.resources.wood).toBeLessThan(before);
  });

  it('grows a working economy over three simulated minutes', () => {
    const engine = game();
    engine.step(20 * 180);
    const player = engine.state.players[0]!;
    expect(player.stats.gathered).toBeGreaterThan(500);
    expect(engine.state.entities.filter(e => e.owner === 0 && e.type === 'villager').length).toBeGreaterThan(8);
    expect(engine.population(0).cap).toBeGreaterThan(10);
    expect(Object.values(player.resources).every(value => value >= 0 && Number.isFinite(value))).toBe(true);
  }, 30_000);

  it('can attack a discovered AI rival while the human kingdom remains undiscovered', () => {
    const engine = new Engine({ ...DEFAULT_SETTINGS, seed: 'AI-RIVALS', size: 'small', opponents: 2 });
    engine.state.players[2]!.ai = undefined;
    const player = engine.state.players[1]!;
    const home = engine.state.entities.find(e => e.owner === 1 && e.type === 'towncenter')!;
    const rival = engine.state.entities.find(e => e.owner === 2 && e.type === 'towncenter')!;
    expect(engine.isVisible(1, rival)).toBe(false);
    player.memory[rival.id] = structuredClone(rival);
    for (let i = 0; i < 6; i++) engine.createUnit(1, 'infantry', home.x - 5 + i, home.y + 5);
    const spy = vi.spyOn(engine, 'command');
    updateAI(engine);
    expect(spy.mock.calls.some(([owner, command]) => owner === 1 && command.type === 'order' && command.ids.length >= 6 && command.order.type === 'attackMove' && command.order.x === rival.x && command.order.y === rival.y)).toBe(true);
  });

  it('pays to rebuild its lost town center using surviving workers', () => {
    const engine = game();
    const player = engine.state.players[0]!;
    engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!.hp = 0;
    player.resources = { food: 0, wood: 300, gold: 0, stone: 150 };
    updateAI(engine);
    expect(engine.state.entities.some(e => e.owner === 0 && e.type === 'towncenter' && !e.completed)).toBe(true);
    expect(player.resources.wood).toBe(0);
    expect(player.resources.stone).toBe(0);
  });

  it('returns partial cargo after an interrupted order instead of leaving the worker idle', () => {
    const engine = game();
    const worker = engine.state.entities.find(e => e.owner === 0 && e.type === 'villager')!;
    worker.carry = 4;
    worker.carryType = 'wood';
    worker.orders = [];
    updateAI(engine);
    expect(worker.orders[0]?.type).toBe('deposit');
    expect(worker.carry).toBe(4);
  });

  it('does not build distant dropsites merely because a scout discovered resources', () => {
    const engine = game();
    const player = engine.state.players[0]!;
    const tc = engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    for (let i = 0; i < 15; i++) engine.createUnit(0, 'villager', tc.x + 5 + i % 4, tc.y + 5 + Math.floor(i / 4));
    engine.createBuilding(0, 'granary', tc.x, tc.y + 10);
    engine.createBuilding(0, 'storage', tc.x - 8, tc.y + 5);
    engine.createBuilding(0, 'barracks', tc.x + 7, tc.y);
    const remote = engine.state.entities.find(e => e.kind === 'resource' && Math.hypot(e.x - tc.x, e.y - tc.y) > 40)!;
    player.memory[remote.id] = structuredClone(remote);
    player.resources.wood = 500;
    engine.state.tick = 400;
    const spy = vi.spyOn(engine, 'command');
    updateAI(engine);
    expect(spy.mock.calls.some(([, c]) => c.type === 'build' && (c.building === 'granary' || c.building === 'storage'))).toBe(false);
  });

  it('regroups wounded survivors and returns them to battle rather than permanently disabling the army', () => {
    const engine = game();
    engine.state.settings.peaceful = false;
    const player = engine.state.players[0]!;
    const home = engine.state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    const enemy = engine.state.entities.find(e => e.owner === 1 && e.type === 'towncenter')!;
    player.memory[enemy.id] = structuredClone(enemy);
    const wounded = Array.from({ length: 6 }, (_, i) => engine.createUnit(0, 'infantry', home.x - 5 + i, home.y + 5));
    for (const soldier of wounded) { soldier.hp = 10; soldier.lastHit = 0; }
    updateAI(engine);
    expect(player.ai!.phase).toBe('recover');
    engine.state.tick = 601;
    player.ai!.nextDecision = 0;
    const spy = vi.spyOn(engine, 'command');
    updateAI(engine);
    expect(spy.mock.calls.some(([, c]) => c.type === 'order' && c.ids.length === 6 && c.order.type === 'attackMove' && c.order.x === enemy.x)).toBe(true);
    expect(wounded.every(soldier => soldier.hp === 10)).toBe(true);
    const raider = engine.createUnit(1, 'infantry', home.x + 5, home.y + 5);
    player.ai!.nextDecision = 0;
    engine.state.tick = 602;
    spy.mockClear();
    updateAI(engine);
    expect(spy.mock.calls.some(([, c]) => c.type === 'order' && c.ids.length === 6 && c.order.type === 'attackMove' && c.order.x === raider.x)).toBe(true);
  });
});
