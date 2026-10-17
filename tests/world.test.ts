import {describe, expect, it} from 'vitest';
import {AGE_NAMES, BUILDINGS, CIVS, TECHS, UNITS, stock} from '../src/game/data';
import {createResource, generateMap, validateMap} from '../src/game/map';
import {findPath, isWalkable} from '../src/game/pathfinding';
import {Engine} from '../src/game/engine';
import {DEFAULT_SETTINGS} from '../src/game/types';
import type {BuildingType, Entity, MatchSettings, TechId, UnitType, WorldMap} from '../src/game/types';

function blank(size = 20): WorldMap {
  return {size, tiles: Array(size * size).fill(0), starts: [{x: 1.5, y: 1.5}], generation: 1, seed: 'test'};
}
function building(id: number, type: BuildingType, x: number, y: number, owner = 0): Entity {
  return {...createResource(id, 'stone', x, y, 0), kind: 'building', type, owner, hp: BUILDINGS[type].hp, maxHp: BUILDINGS[type].hp};
}

describe('typed gameplay definitions', () => {
  it('defines four sequential ages and all three working civilization archetypes', () => {
    expect(AGE_NAMES).toEqual(['Stone Age', 'Tool Age', 'Bronze Age', 'Iron Age']);
    expect(Object.keys(CIVS)).toEqual(['river', 'highland', 'steppe']);
    expect(stock({wood: 50})).toEqual({food: 0, wood: 50, gold: 0, stone: 0});
  });
  it('has valid costs, times, production buildings, prerequisites and deliberate combat counters', () => {
    for (const definition of [...Object.values(UNITS), ...Object.values(BUILDINGS), ...Object.values(TECHS)]) {
      expect(definition.age).toBeGreaterThanOrEqual(1);
      expect(definition.age).toBeLessThanOrEqual(4);
      expect(definition.time).toBeGreaterThan(0);
      expect(Object.values(definition.cost).every(cost => cost > 0 && Number.isFinite(cost))).toBe(true);
    }
    for (const [type, unit] of Object.entries(UNITS)) {
      expect(BUILDINGS[unit.building].produces).toContain(type);
      expect(unit.speed).toBeGreaterThan(0);
      expect(unit.targets.length).toBeGreaterThan(0);
    }
    expect(UNITS.spearman.bonus!.cavalry).toBeGreaterThan(UNITS.cavalry.armor);
    expect(UNITS.cavalry.bonus!.archer).toBeGreaterThan(0);
    expect(UNITS.archer.bonus!.infantry).toBeGreaterThan(0);
    expect(UNITS.heavy.armor).toBeGreaterThan(UNITS.infantry.armor);
    expect(UNITS.siege.bonus!.building).toBeGreaterThan(UNITS.siege.damage);
    expect(TECHS.age2.requires).toContain('granary');
    expect(TECHS.age3.age).toBe(2);
    expect(TECHS.age4.requires).toContain('academy');
  });
});

describe('actual combat balance', () => {
  function oneHit(attackerType: UnitType, targetType: UnitType | 'towncenter', techs: TechId[] = []): number {
    const engine = new Engine({...DEFAULT_SETTINGS, size: 'small', peaceful: false});
    engine.state.entities = []; engine.state.map.tiles.fill(0);
    for (const player of engine.state.players) {delete player.ai; player.visible.fill(1); player.explored.fill(1);}
    engine.state.players[0]!.techs = techs;
    const attacker = engine.createUnit(0, attackerType, 20.5, 20.5);
    const target = targetType === 'towncenter'
      ? engine.createBuilding(1, 'towncenter', 25.5, 20.5)
      : engine.createUnit(1, targetType, attackerType === 'archer' || attackerType === 'siege' ? 24.5 : 21.5, 20.5);
    target.hp = target.maxHp = 1000;
    if (target.kind === 'unit') target.orders = [{type: 'hold', x: target.x, y: target.y}];
    expect(engine.command(0, {type: 'order', ids: [attacker.id], order: {type: 'attack', target: target.id, x: target.x, y: target.y}}).ok).toBe(true);
    engine.step(15);
    return 1000 - target.hp;
  }
  it('applies spearman, cavalry, archer and siege role bonuses through real attacks', () => {
    expect(oneHit('spearman', 'cavalry')).toBe(20);
    expect(oneHit('spearman', 'infantry')).toBe(4);
    expect(oneHit('cavalry', 'archer')).toBe(15);
    expect(oneHit('cavalry', 'siege')).toBe(18);
    expect(oneHit('archer', 'infantry')).toBe(7);
    expect(oneHit('archer', 'heavy')).toBe(1);
    expect(oneHit('siege', 'towncenter')).toBe(57);
    expect(oneHit('siege', 'infantry')).toBe(15);
  });
  it('uses researched attack bonuses in actual melee and projectile damage', () => {
    expect(oneHit('infantry', 'spearman', ['infantry'])).toBe(oneHit('infantry', 'spearman') + 2);
    expect(oneHit('archer', 'infantry', ['ranged'])).toBe(oneHit('archer', 'infantry') + 2);
  });
});

describe('seeded connected land generation', () => {
  it('reproduces terrain, resource positions, amounts and stable IDs', () => {
    const a = generateMap(DEFAULT_SETTINGS), b = generateMap(DEFAULT_SETTINGS);
    expect(a).toEqual(b);
    expect(a.resources.map(entity => entity.id)).toEqual(a.resources.map((_, index) => index + 1));
    expect(generateMap({...DEFAULT_SETTINGS, seed: 'another'}).map.tiles).not.toEqual(a.map.tiles);
  });
  it('keeps every start on connected land with every essential resource nearby across seeds and sizes', () => {
    for (const size of ['small', 'medium', 'large'] as const) for (let seed = 0; seed < 4; seed++) {
      const settings: MatchSettings = {...DEFAULT_SETTINGS, seed: `world-${seed}`, size, opponents: seed % 3 + 1};
      const {map, resources} = generateMap(settings);
      expect(validateMap(map), `${size}/${seed} land`).toBe(true);
      expect(map.starts).toHaveLength(settings.opponents + 1);
      for (const start of map.starts) {
        const nearby = resources.filter(resource => Math.hypot(resource.x - start.x, resource.y - start.y) < 17);
        for (const type of ['tree', 'berries', 'deer', 'gold', 'stone']) {
          expect(nearby.some(resource => resource.type === type), `${size}/${seed}/${type}`).toBe(true);
        }
        expect(nearby.every(resource => Math.hypot(resource.x - start.x, resource.y - start.y) >= 6.5)).toBe(true);
        expect(start.x % 1).toBe(0.5);
        expect(start.y % 1).toBe(0.5);
      }
      expect(new Set(resources.map(resource => `${resource.x},${resource.y}`)).size).toBe(resources.length);
      expect(resources.every(resource => resource.amount > 0 && map.tiles[Math.floor(resource.y) * map.size + Math.floor(resource.x)] !== 2)).toBe(true);
    }
  });
  it('scales finite deposits for abundant games without changing map layout', () => {
    const normal = generateMap(DEFAULT_SETTINGS), abundant = generateMap({...DEFAULT_SETTINGS, resources: 'abundant'});
    expect(abundant.map).toEqual(normal.map);
    expect(abundant.resources.map(resource => [resource.type, resource.x, resource.y])).toEqual(normal.resources.map(resource => [resource.type, resource.x, resource.y]));
    expect(abundant.resources[0]!.amount).toBeGreaterThan(normal.resources[0]!.amount);
  });
  it('rejects malformed terrain, disconnected starts and disconnected land pockets', () => {
    const map = blank(10);
    map.starts.push({x: 8.5, y: 8.5});
    for (let y = 0; y < 10; y++) map.tiles[y * 10 + 5] = 2;
    expect(validateMap(map)).toBe(false);
    expect(validateMap({...blank(), tiles: []})).toBe(false);
    expect(validateMap({...blank(), starts: [{x: NaN, y: 0}]})).toBe(false);
  });
});

describe('bounded grid navigation', () => {
  it('finds a tile-centered route around complete building footprints', () => {
    const map = blank(), entities = [building(1, 'towncenter', 8.5, 8.5)];
    const path = findPath(map, entities, {x: 3.5, y: 8.5}, {x: 14.5, y: 8.5}, 0);
    expect(path.length).toBeGreaterThan(11);
    expect(path.at(-1)).toEqual({x: 14.5, y: 8.5});
    expect(path.every(point => isWalkable(map, entities, point.x, point.y, 0))).toBe(true);
    expect(isWalkable(map, entities, 6.5, 6.5, 0)).toBe(false);
    expect(isWalkable(map, entities, 10.5, 10.5, 0)).toBe(false);
    expect(isWalkable(map, entities, 11.5, 10.5, 0)).toBe(true);
  });
  it('never cuts blocked diagonal corners', () => {
    const map = blank();
    const entities = [createResource(1, 'tree', 2.5, 1.5, 200), createResource(2, 'tree', 1.5, 2.5, 200)];
    const start = {x: 1.5, y: 1.5};
    const path = findPath(map, entities, start, {x: 5.5, y: 5.5}, 0);
    expect(path.length).toBeGreaterThan(0);
    let previous = start;
    for (const point of path) {
      if (point.x !== previous.x && point.y !== previous.y) {
        expect(isWalkable(map, entities, previous.x, point.y, 0)).toBe(true);
        expect(isWalkable(map, entities, point.x, previous.y, 0)).toBe(true);
      }
      previous = point;
    }
  });
  it('routes to an adjacent gather position and updates occupancy after depletion or destruction', () => {
    const map = blank(), tree = createResource(1, 'tree', 8.5, 8.5, 200);
    const path = findPath(map, [tree], {x: 1.5, y: 1.5}, tree, 0);
    expect(Math.hypot(path.at(-1)!.x - tree.x, path.at(-1)!.y - tree.y)).toBe(1);
    expect(isWalkable(map, [tree], 8.5, 8.5, 0)).toBe(false);
    tree.amount = 0;
    expect(isWalkable(map, [tree], 8.5, 8.5, 0)).toBe(true);
    tree.amount = 200; tree.hp = 0;
    expect(isWalkable(map, [tree], 8.5, 8.5, 0)).toBe(true);
  });
  it('reaches a usable building corner when the nearest cardinal interaction cells are sealed', () => {
    const map = blank(24), target = building(1, 'towncenter', 10.5, 10.5);
    const entities = [target];
    for (const [x, y] of [[9, 7], [11, 7], [10, 6], [10, 13], [7, 10], [13, 10]]) entities.push(building(entities.length + 1, 'wall', x! + 0.5, y! + 0.5));
    const path = findPath(map, entities, {x: 17.5, y: 17.5}, target, 0);
    expect(path.length).toBeGreaterThan(0);
    const end = path.at(-1)!;
    const edgeDistance = Math.hypot(Math.max(0, Math.abs(end.x - target.x) - 2.5), Math.max(0, Math.abs(end.y - target.y) - 2.5));
    expect(edgeDistance).toBeLessThanOrEqual(0.9);
    expect(path.every(point => isWalkable(map, entities, point.x, point.y, 0))).toBe(true);
  });
  it('enforces closed gate ownership and opens gates for every faction', () => {
    const map = blank(), gate = building(1, 'gate', 6, 6, 0);
    expect(isWalkable(map, [gate], 5.5, 5.5, 0)).toBe(true);
    expect(isWalkable(map, [gate], 5.5, 5.5, 1)).toBe(false);
    gate.open = true;
    expect(isWalkable(map, [gate], 5.5, 5.5, 1)).toBe(true);
  });
  it('returns safely for unreachable, bounded, outside and non-finite requests', () => {
    const map = blank(12), entities: Entity[] = [];
    for (let y = 0; y < map.size; y++) entities.push(building(y + 1, 'wall', 5.5, y + 0.5));
    expect(findPath(map, entities, {x: 1.5, y: 1.5}, {x: 9.5, y: 1.5}, 0)).toEqual([]);
    expect(findPath(blank(), [], {x: 1.5, y: 1.5}, {x: 18.5, y: 18.5}, 0, 1)).toEqual([]);
    expect(findPath(map, [], {x: NaN, y: 0}, {x: 3, y: 3}, 0)).toEqual([]);
    expect(findPath(map, [], {x: -1, y: 0}, {x: 3, y: 3}, 0)).toEqual([]);
    expect(isWalkable(map, [], -1, 0, 0)).toBe(false);
    expect(isWalkable(map, [], 12, 0, 0)).toBe(false);
    expect(isWalkable(map, [], NaN, 0, 0)).toBe(false);
  });
});
