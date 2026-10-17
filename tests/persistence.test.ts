import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {Engine} from '../src/game/engine';
import {DEFAULT_SETTINGS, type GameState} from '../src/game/types';
import {stock, TECHS} from '../src/game/data';
import {decodeSave, encodeSave, listSaves, loadLocal, removeSave, saveLocal, validateState} from '../src/game/persistence';

let initialSave: string;
beforeAll(() => {
  initialSave = new Engine({...DEFAULT_SETTINGS, seed: 'save-test', size: 'small', difficulty: 'easy', peaceful: true}).serialize();
});
afterEach(() => vi.unstubAllGlobals());
const fresh = () => Engine.load(initialSave);
const normalized = (state: GameState): unknown => JSON.parse(JSON.stringify(state));

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, value); }
}

describe('save serialization', () => {
  it('round trips a real running game, including AI decision history', () => {
    const engine = fresh();
    engine.step(160);
    const loaded = Engine.load(engine.serialize());
    expect(normalized(loaded.state)).toEqual(normalized(engine.state));
    expect(loaded.state).not.toBe(engine.state);
    const worker = loaded.state.entities.find(e => e.type === 'villager')!;
    expect(loaded.get(worker.id)).toBe(worker);
  });

  it('continues to the same simulation state after a mid-step save and reload', () => {
    const engine = fresh();
    engine.step(13);
    const loaded = Engine.load(engine.serialize());
    engine.step(200);
    loaded.step(200);
    expect(normalized(loaded.state)).toEqual(normalized(engine.state));
  });

  it('preserves carried resources, orders, paths, rally, queues, fog, snapshots, and projectiles exactly', () => {
    const engine = fresh(), state = engine.state, player = state.players[0]!;
    player.age = 3;
    player.resources = stock({food: 10000, wood: 10000, gold: 10000, stone: 10000});
    player.techs = ['gather','carry'];
    const tc = state.entities.find(e => e.owner === 0 && e.type === 'towncenter')!;
    const worker = state.entities.find(e => e.owner === 0 && e.type === 'villager')!;
    const source = state.entities.find(e => e.kind === 'resource' && e.resource === 'wood')!;
    const enemy = state.entities.find(e => e.owner === 1 && e.type === 'towncenter')!;
    const academy = engine.createBuilding(0, 'academy', tc.x + 10, tc.y + 8);
    expect(engine.command(0, {type: 'train', ids: [tc.id], unit: 'villager'}).ok).toBe(true);
    expect(engine.command(0, {type: 'research', id: academy.id, tech: 'health'}).ok).toBe(true);
    tc.queue[0]!.progress = 4.25;
    academy.queue[0]!.progress = 12.5;
    tc.rally = {x: tc.x + 5, y: tc.y + 6};
    worker.carry = 7.25;
    worker.carryType = 'wood';
    worker.orders = [{type: 'gather', target: source.id, resource: 'wood', x: source.x, y: source.y}, {type: 'stop', x: worker.x, y: worker.y}];
    worker.path = [{x: worker.x + 1, y: worker.y + 1}];
    worker.home = {x: worker.x, y: worker.y};
    player.explored[100] = 1;
    player.visible[101] = 1;
    player.memory[enemy.id] = {...structuredClone(enemy), hp: enemy.maxHp - 25};
    player.stats.gathered = 123.75;
    state.projectiles.push({id: state.nextId++, owner: 0, target: enemy.id, x: tc.x, y: tc.y, tx: enemy.x, ty: enemy.y, damage: 8, life: 0.4, total: 0.5, style: 'arrow'});
    state.paused = true;
    const loaded = Engine.load(engine.serialize());
    expect(normalized(loaded.state)).toEqual(normalized(state));
    expect(loaded.get(worker.id)?.carry).toBe(7.25);
    expect(loaded.state.players[0]!.memory[enemy.id]!.hp).toBe(enemy.maxHp - 25);
  });

  it('resumes queued research once and never reapplies completed health bonuses on reload', () => {
    const engine = fresh(), player = engine.state.players[0]!;
    player.age = 3;
    player.resources = stock({food: 10000, wood: 10000, gold: 10000});
    const start = engine.state.map.starts[0]!;
    const academy = engine.createBuilding(0, 'academy', start.x + 10, start.y + 8);
    expect(engine.command(0, {type: 'research', id: academy.id, tech: 'health'}).ok).toBe(true);
    academy.queue[0]!.progress = TECHS.health.time - 0.05;
    const worker = engine.state.entities.find(e => e.owner === 0 && e.type === 'villager')!;
    const initialMaxHp = worker.maxHp;
    const resumed = Engine.load(engine.serialize());
    resumed.step();
    expect(resumed.get(worker.id)!.maxHp).toBe(Math.round(initialMaxHp * 1.2));
    expect(resumed.state.players[0]!.techs.filter(t => t === 'health')).toHaveLength(1);
    const reloaded = Engine.load(resumed.serialize());
    reloaded.step(20);
    expect(reloaded.get(worker.id)!.maxHp).toBe(resumed.get(worker.id)!.maxHp);
    expect(reloaded.command(0, {type: 'research', id: academy.id, tech: 'health'}).ok).toBe(false);
    expect(reloaded.state.players[0]!.techs.filter(t => t === 'health')).toHaveLength(1);
  });

  it('creates detached validated state and drops unknown prototype-related fields', () => {
    const input = JSON.parse(initialSave);
    input.untrusted = {command: 'run'};
    input.players[0].memory.__proto__ = {polluted: true};
    const validated = validateState(input);
    expect('untrusted' in validated).toBe(false);
    expect(Object.getPrototypeOf(validated.players[0]!.memory)).toBe(null);
    validated.players[0]!.resources.food++;
    expect(input.players[0].resources.food).not.toBe(validated.players[0]!.resources.food);
  });
});

describe('malformed and bounded saves', () => {
  it.each(['', 'not JSON', '{', 'null', '[]'])('rejects malformed root %j', value => {
    expect(() => decodeSave(value)).toThrow();
  });
  it('rejects oversized input before parsing', () => {
    expect(() => decodeSave(' '.repeat(16 * 1024 * 1024 + 1))).toThrow(/too large/i);
  });
  it.each([
    ['unsupported version', (s: any) => {s.version = 2;}],
    ['NaN', (s: any) => {s.tick = NaN;}],
    ['null numeric field', (s: any) => {s.tick = null;}],
    ['infinite resources', (s: any) => {s.players[0].resources.food = Infinity;}],
    ['negative resources', (s: any) => {s.players[0].resources.wood = -1;}],
    ['huge map', (s: any) => {s.map.size = 1000000;}],
    ['short terrain', (s: any) => {s.map.tiles.pop();}],
    ['invalid terrain', (s: any) => {s.map.tiles[0] = 9;}],
    ['short explored map', (s: any) => {s.players[0].explored.pop();}],
    ['invalid visibility bit', (s: any) => {s.players[0].visible[0] = 2;}],
    ['invalid owner', (s: any) => {s.entities.find((e: any) => e.kind === 'unit').owner = 99;}],
    ['invalid unit type', (s: any) => {s.entities.find((e: any) => e.kind === 'unit').type = 'dragon';}],
    ['nonfinite position', (s: any) => {s.entities[0].x = Infinity;}],
    ['off-map position', (s: any) => {s.entities[0].x = -20;}],
    ['duplicate entity IDs', (s: any) => {s.entities[1].id = s.entities[0].id;}],
    ['next ID collision', (s: any) => {s.nextId = 1;}],
    ['duplicate completed research', (s: any) => {s.players[0].techs = ['health','health'];}],
    ['malformed memory ID', (s: any) => {s.players[0].memory['__proto__'] = null; Object.defineProperty(s.players[0].memory, 'bad', {value: s.entities[0], enumerable: true});}],
  ])('rejects %s', (_name, mutate) => {
    const state = JSON.parse(initialSave);
    mutate(state);
    expect(() => validateState(state)).toThrow(/invalid save/i);
    expect(() => decodeSave(JSON.stringify(state))).toThrow(/invalid save/i);
  });

  it('rejects invalid production costs and repeated queued research', () => {
    const engine = fresh(), player = engine.state.players[0]!;
    player.age = 3;
    player.resources = stock({food: 10000, gold: 10000});
    const start = engine.state.map.starts[0]!;
    const academy = engine.createBuilding(0, 'academy', start.x + 9, start.y + 10);
    expect(engine.command(0, {type: 'research', id: academy.id, tech: 'health'}).ok).toBe(true);
    const original = structuredClone(academy.queue[0]!);
    academy.queue[0]!.cost.gold = -1;
    expect(() => encodeSave(engine.state)).toThrow(/cost.gold/);
    academy.queue = [original, structuredClone(original)];
    expect(() => encodeSave(engine.state)).toThrow(/already completed or queued/);
    academy.queue = [original];
    player.techs = ['health'];
    expect(() => encodeSave(engine.state)).toThrow(/already completed or queued/);
  });
});

describe('browser local saves', () => {
  it('saves, lists metadata, loads, and removes independent slots', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const engine = fresh();
    expect(saveLocal('First kingdom', engine.state)).toEqual({ok: true});
    engine.step(2);
    expect(saveLocal('Second kingdom', engine.state)).toEqual({ok: true});
    expect(listSaves().map(s => s.slot).sort()).toEqual(['First kingdom','Second kingdom']);
    expect(listSaves()[0]!.seed).toBe('save-test');
    expect(listSaves()[0]!.savedAt).toBeGreaterThan(0);
    expect(loadLocal('First kingdom')!.tick).toBe(0);
    expect(loadLocal('Second kingdom')!.tick).toBe(2);
    removeSave('First kingdom');
    expect(loadLocal('First kingdom')).toBe(null);
    expect(listSaves()).toHaveLength(1);
  });
  it('reports quota failures without throwing or destroying an existing save', () => {
    const local = new MemoryStorage();
    vi.stubGlobal('localStorage', local);
    expect(saveLocal('good', fresh().state).ok).toBe(true);
    vi.spyOn(local, 'setItem').mockImplementation(() => {throw new DOMException('Quota exceeded', 'QuotaExceededError');});
    const result = saveLocal('new', fresh().state);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/full/i);
    expect(loadLocal('good')).not.toBe(null);
    expect(loadLocal('new')).toBe(null);
  });
  it('handles unavailable storage and skips corrupt slots while preserving good saves', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(saveLocal('test', fresh().state).ok).toBe(false);
    expect(loadLocal('test')).toBe(null);
    expect(listSaves()).toEqual([]);
    expect(() => removeSave('test')).not.toThrow();
    const local = new MemoryStorage();
    vi.stubGlobal('localStorage', local);
    expect(saveLocal('good', fresh().state).ok).toBe(true);
    local.setItem('dawn-of-kingdoms:save:broken', '{');
    local.setItem('another-app', 'unrelated');
    expect(() => loadLocal('broken')).toThrow(/not valid JSON/);
    expect(listSaves().map(s => s.slot)).toEqual(['good']);
    expect(local.getItem('another-app')).toBe('unrelated');
  });
});
