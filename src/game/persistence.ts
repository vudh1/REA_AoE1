import type { AIState, Entity, GameEvent, GameState, MatchSettings, Order, Player, Point, Projectile, QueueItem, Result, Stats, Stock, WorldMap } from './types';

const PREFIX = 'dawn-of-kingdoms:save:';
const MAX_SAVE_BYTES = 16 * 1024 * 1024;
const MAX_ENTITIES = 15_000;
const UNIT_TYPES = ['villager','scout','infantry','spearman','archer','cavalry','heavy','siege'] as const;
const BUILDING_TYPES = ['towncenter','house','granary','storage','farm','market','barracks','range','stable','workshop','tower','wall','gate','academy'] as const;
const RESOURCE_TYPES = ['tree','berries','gold','stone','deer'] as const;
const RESOURCES = ['food','wood','gold','stone'] as const;
const TECHS = ['gather','carry','infantry','ranged','armor','health','durability','tower','age2','age3','age4'] as const;
const CIVS = ['river','highland','steppe'] as const;
type ObjectValue = Record<string, unknown>;

function fail(path: string, message: string): never { throw new Error(`Invalid save: ${path} ${message}.`); }
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as ObjectValue;
}
function number(value: unknown, path: string, min = -1e12, max = 1e12, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(path, `must be a ${integer ? 'whole ' : ''}number between ${min} and ${max}`);
  }
  return value as number;
}
function text(value: unknown, path: string, max = 256): string {
  if (typeof value !== 'string' || value.length > max) fail(path, `must be text of at most ${max} characters`);
  return value as string;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be true or false');
  return value as boolean;
}
function choice<T extends string | number>(value: unknown, values: readonly T[], path: string): T {
  if (!values.includes(value as T)) fail(path, 'contains an unsupported value');
  return value as T;
}
function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must contain ${min} to ${max} items`);
  for (let i = 0; i < (value as unknown[]).length; i++) {
    if (!Object.hasOwn(value as unknown[], i)) fail(`${path}[${i}]`, 'must not be missing');
  }
  return value as unknown[];
}
function id(value: unknown, path: string): number { return number(value, path, 1, 1e9, true); }
function point(value: unknown, path: string, size: number): Point {
  const v = object(value, path);
  return {x: number(v.x, `${path}.x`, 0, size), y: number(v.y, `${path}.y`, 0, size)};
}
function stock(value: unknown, path: string): Stock {
  const v = object(value, path);
  return {food: number(v.food, `${path}.food`, 0, 1e9), wood: number(v.wood, `${path}.wood`, 0, 1e9), gold: number(v.gold, `${path}.gold`, 0, 1e9), stone: number(v.stone, `${path}.stone`, 0, 1e9)};
}
function color(value: unknown, path: string): string {
  const c = text(value, path, 7);
  if (!/^#[0-9a-f]{6}$/i.test(c)) fail(path, 'must be a six-digit hex color');
  return c;
}
function settings(value: unknown): MatchSettings {
  const v = object(value, 'settings');
  return {
    seed: text(v.seed, 'settings.seed', 256), size: choice(v.size, ['small','medium','large'], 'settings.size'),
    opponents: number(v.opponents, 'settings.opponents', 0, 3, true), ...(v.allies !== undefined ? {allies: number(v.allies, 'settings.allies', 0, 1, true)} : {}), difficulty: choice(v.difficulty, ['easy','normal','hard'], 'settings.difficulty'),
    resources: choice(v.resources, ['standard','abundant'], 'settings.resources'), population: choice(v.population, [50,100,150], 'settings.population'),
    civ: choice(v.civ, CIVS, 'settings.civ'), aiCiv: choice(v.aiCiv, [...CIVS,'random'], 'settings.aiCiv'), color: color(v.color, 'settings.color'),
    speed: number(v.speed, 'settings.speed', 0.25, 8), peaceful: bool(v.peaceful, 'settings.peaceful'), tutorial: bool(v.tutorial, 'settings.tutorial'), cleanup: bool(v.cleanup, 'settings.cleanup'),
  };
}
function worldMap(value: unknown): WorldMap {
  const v = object(value, 'map'), size = number(v.size, 'map.size', 16, 256, true);
  const tiles = array(v.tiles, 'map.tiles', size * size, size * size).map((t, i) => choice(t, [0,1,2,3] as const, `map.tiles[${i}]`));
  const starts = array(v.starts, 'map.starts', 8, 1).map((p, i) => point(p, `map.starts[${i}]`, size));
  return {size, tiles, starts, generation: number(v.generation, 'map.generation', 0, 1e12, true), seed: text(v.seed, 'map.seed', 256)};
}
function order(value: unknown, path: string, size: number): Order {
  const v = object(value, path);
  const result: Order = {...point(v, path, size), type: choice(v.type, ['move','attackMove','attack','gather','build','repair','deposit','hold','stop'], `${path}.type`)};
  if (v.target !== undefined) result.target = id(v.target, `${path}.target`);
  if (v.resource !== undefined) result.resource = choice(v.resource, RESOURCES, `${path}.resource`);
  if (v.automatic !== undefined) result.automatic = bool(v.automatic, `${path}.automatic`);
  return result;
}
function queueItem(value: unknown, path: string): QueueItem {
  const v = object(value, path), kind = choice(v.kind, ['unit','tech'], `${path}.kind`);
  const time = number(v.time, `${path}.time`, 0.001, 1e6);
  return {
    kind, type: kind === 'unit' ? choice(v.type, UNIT_TYPES, `${path}.type`) : choice(v.type, TECHS, `${path}.type`),
    progress: number(v.progress, `${path}.progress`, 0, time + 1), time, cost: stock(v.cost, `${path}.cost`),
    population: number(v.population, `${path}.population`, 0, kind === 'tech' ? 0 : 150, true),
  };
}
function entity(value: unknown, path: string, size: number, playerCount: number): Entity {
  const v = object(value, path), kind = choice(v.kind, ['unit','building','resource'], `${path}.kind`);
  const maxHp = number(v.maxHp, `${path}.maxHp`, 0, 1e7);
  const owner = number(v.owner, `${path}.owner`, kind === 'resource' ? -1 : 0, kind === 'resource' ? -1 : playerCount - 1, true);
  const result: Entity = {
    id: id(v.id, `${path}.id`), owner, kind,
    type: kind === 'unit' ? choice(v.type, UNIT_TYPES, `${path}.type`) : kind === 'building' ? choice(v.type, BUILDING_TYPES, `${path}.type`) : choice(v.type, RESOURCE_TYPES, `${path}.type`),
    ...point(v, path, size), hp: number(v.hp, `${path}.hp`, -1e7, maxHp), maxHp,
    radius: number(v.radius, `${path}.radius`, 0, 32), completed: bool(v.completed, `${path}.completed`), progress: number(v.progress, `${path}.progress`, 0, 1e6),
    amount: number(v.amount, `${path}.amount`, 0, 1e9), carry: number(v.carry, `${path}.carry`, 0, 1e6),
    orders: array(v.orders, `${path}.orders`, 256).map((o, i) => order(o, `${path}.orders[${i}]`, size)),
    path: array(v.path, `${path}.path`, size * size).map((p, i) => point(p, `${path}.path[${i}]`, size)),
    cooldown: number(v.cooldown, `${path}.cooldown`, -1e9, 1e9), work: number(v.work, `${path}.work`, -1e9, 1e9),
    queue: array(v.queue, `${path}.queue`, 100).map((q, i) => queueItem(q, `${path}.queue[${i}]`)),
    task: text(v.task, `${path}.task`, 128), facing: number(v.facing, `${path}.facing`, -1e6, 1e6),
    prevX: number(v.prevX, `${path}.prevX`, 0, size), prevY: number(v.prevY, `${path}.prevY`, 0, size),
    stuck: number(v.stuck, `${path}.stuck`, -1e9, 1e9), repath: number(v.repath, `${path}.repath`, -1e9, 1e9), lastHit: number(v.lastHit, `${path}.lastHit`, -1e12, 1e12),
  };
  if (v.resource !== undefined) result.resource = choice(v.resource, RESOURCES, `${path}.resource`);
  if (v.carryType !== undefined) result.carryType = choice(v.carryType, RESOURCES, `${path}.carryType`);
  if (v.rally !== undefined) result.rally = point(v.rally, `${path}.rally`, size);
  if (v.home !== undefined) result.home = point(v.home, `${path}.home`, size);
  if (v.open !== undefined) result.open = bool(v.open, `${path}.open`);
  if (kind !== 'building' && result.queue.length) fail(`${path}.queue`, 'must be empty for units and resources');
  return result;
}
function stats(value: unknown, path: string): Stats {
  const v = object(value, path);
  return {
    gathered: number(v.gathered, `${path}.gathered`, 0, 1e12), trained: number(v.trained, `${path}.trained`, 0, 1e9, true),
    lost: number(v.lost, `${path}.lost`, 0, 1e9, true), kills: number(v.kills, `${path}.kills`, 0, 1e9, true),
    built: number(v.built, `${path}.built`, 0, 1e9, true), destroyed: number(v.destroyed, `${path}.destroyed`, 0, 1e9, true),
  };
}
function ai(value: unknown, path: string, size: number): AIState {
  const v = object(value, path);
  const result: AIState & {issuedCommands?: number; failedCommands?: number; lastFailure?: string; lastExplore?: number; attacks?: number} = {
    nextDecision: number(v.nextDecision, `${path}.nextDecision`, -1e12, 1e12), phase: text(v.phase, `${path}.phase`, 64),
    nextAttack: number(v.nextAttack, `${path}.nextAttack`, -1e12, 1e12), scoutIndex: number(v.scoutIndex, `${path}.scoutIndex`, 0, 1e9, true), lastBuild: number(v.lastBuild, `${path}.lastBuild`, -1e12, 1e12),
  };
  if (v.target !== undefined) result.target = point(v.target, `${path}.target`, size);
  if (v.issuedCommands !== undefined) result.issuedCommands = number(v.issuedCommands, `${path}.issuedCommands`, 0, 1e12, true);
  if (v.failedCommands !== undefined) result.failedCommands = number(v.failedCommands, `${path}.failedCommands`, 0, 1e12, true);
  if (v.lastFailure !== undefined) result.lastFailure = text(v.lastFailure, `${path}.lastFailure`, 512);
  if (v.lastExplore !== undefined) result.lastExplore = number(v.lastExplore, `${path}.lastExplore`, 0, 1e12, true);
  if (v.attacks !== undefined) result.attacks = number(v.attacks, `${path}.attacks`, 0, 1e9, true);
  return result;
}
function player(value: unknown, index: number, size: number, playerCount: number): Player {
  const path = `players[${index}]`, v = object(value, path);
  const techs = array(v.techs, `${path}.techs`, TECHS.length).map((t, i) => choice(t, TECHS, `${path}.techs[${i}]`));
  if (new Set(techs).size !== techs.length) fail(`${path}.techs`, 'contains duplicate research');
  const memoryInput = object(v.memory, `${path}.memory`), memory: Record<string, Entity> = Object.create(null);
  const entries = Object.entries(memoryInput);
  if (entries.length > MAX_ENTITIES) fail(`${path}.memory`, 'contains too many entities');
  for (const [key, item] of entries) {
    if (!/^[1-9]\d{0,9}$/.test(key)) fail(`${path}.memory`, 'contains an invalid entity key');
    const e = entity(item, `${path}.memory[${key}]`, size, playerCount);
    if (e.id !== Number(key)) fail(`${path}.memory[${key}]`, 'has a mismatched entity id');
    memory[key] = e;
  }
  const result: Player = {
    id: number(v.id, `${path}.id`, index, index, true), name: text(v.name, `${path}.name`, 80), civ: choice(v.civ, CIVS, `${path}.civ`), color: color(v.color, `${path}.color`),
    age: number(v.age, `${path}.age`, 1, 4, true), resources: stock(v.resources, `${path}.resources`), techs, defeated: bool(v.defeated, `${path}.defeated`), stats: stats(v.stats, `${path}.stats`),
    explored: array(v.explored, `${path}.explored`, size * size, size * size).map((v, i) => number(v, `${path}.explored[${i}]`, 0, 1, true)),
    visible: array(v.visible, `${path}.visible`, size * size, size * size).map((v, i) => number(v, `${path}.visible[${i}]`, 0, 1, true)), memory,
  };
  if (v.team !== undefined) result.team = number(v.team, `${path}.team`, 0, playerCount - 1, true);
  if (v.ai !== undefined) result.ai = ai(v.ai, `${path}.ai`, size);
  return result;
}
function projectile(value: unknown, path: string, size: number, playerCount: number): Projectile {
  const v = object(value, path);
  const total = number(v.total, `${path}.total`, 0.001, 1e6);
  return {
    id: id(v.id, `${path}.id`), owner: number(v.owner, `${path}.owner`, 0, playerCount - 1, true), target: id(v.target, `${path}.target`),
    ...point(v, path, size), tx: number(v.tx, `${path}.tx`, 0, size), ty: number(v.ty, `${path}.ty`, 0, size),
    damage: number(v.damage, `${path}.damage`, 0, 1e7), life: number(v.life, `${path}.life`, -1, total + 1), total, style: text(v.style, `${path}.style`, 64),
  };
}
function gameEvent(value: unknown, path: string, size: number, playerCount: number, tick: number): GameEvent {
  const v = object(value, path);
  const result: GameEvent = {
    tick: number(v.tick, `${path}.tick`, 0, tick, true), type: text(v.type, `${path}.type`, 64),
    owner: number(v.owner, `${path}.owner`, -1, playerCount - 1, true), text: text(v.text, `${path}.text`, 2048),
  };
  if (v.x !== undefined) result.x = number(v.x, `${path}.x`, 0, size);
  if (v.y !== undefined) result.y = number(v.y, `${path}.y`, 0, size);
  if (v.entity !== undefined) result.entity = id(v.entity, `${path}.entity`);
  return result;
}

/** Validate and copy only known fields, so imported JSON cannot inject runtime properties. */
export function validateState(input: unknown): GameState {
  const v = object(input, 'root');
  if (v.version !== 1) fail('version', 'is unsupported (expected version 1)');
  const config = settings(v.settings), map = worldMap(v.map), tick = number(v.tick, 'tick', 0, 1e12, true);
  const playerInput = array(v.players, 'players', 8, 1), count = playerInput.length;
  if (count !== config.opponents + (config.allies ?? 0) + 1 || map.starts.length !== count) fail('players', 'must match the configured opponents and map starts');
  const entities = array(v.entities, 'entities', MAX_ENTITIES).map((e, i) => entity(e, `entities[${i}]`, map.size, count));
  const projectiles = array(v.projectiles, 'projectiles', MAX_ENTITIES).map((p, i) => projectile(p, `projectiles[${i}]`, map.size, count));
  const nextId = id(v.nextId, 'nextId'), seen = new Set<number>();
  for (const e of [...entities, ...projectiles]) {
    if (seen.has(e.id)) fail('entities', `contains duplicate id ${e.id}`);
    if (e.id >= nextId) fail('nextId', 'must exceed every active entity and projectile id');
    seen.add(e.id);
  }
  const players = playerInput.map((p, i) => player(p, i, map.size, count));
  const queuedResearch = players.map(p => new Set(p.techs));
  for (const e of entities) {
    for (const q of e.queue) {
      if (q.kind !== 'tech') continue;
      const research = queuedResearch[e.owner];
      if (research.has(q.type as typeof TECHS[number])) fail(`entities[${e.id}].queue`, 'contains research already completed or queued');
      research.add(q.type as typeof TECHS[number]);
    }
  }
  return {
    version: 1, settings: config, map, tick, nextId, rng: number(v.rng, 'rng', 0, 0xffffffff, true), entities,
    players, projectiles,
    events: array(v.events, 'events', 10_000).map((e, i) => gameEvent(e, `events[${i}]`, map.size, count, tick)),
    paused: bool(v.paused, 'paused'), result: choice(v.result, ['playing','victory','defeat'], 'result'), tutorialStep: number(v.tutorialStep, 'tutorialStep', 0, 1000, true),
  };
}

export function encodeSave(state: GameState): string {
  const json = JSON.stringify(validateState(state));
  if (json.length > MAX_SAVE_BYTES) throw new Error('Save is too large (maximum 16 MB).');
  return json;
}
export function decodeSave(json: string): GameState {
  if (typeof json !== 'string' || json.length > MAX_SAVE_BYTES) throw new Error('Save is too large or is not text (maximum 16 MB).');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Save is not valid JSON.'); }
  return validateState(value);
}
function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
function slotKey(slot: string): string {
  if (typeof slot !== 'string' || !slot.trim() || slot.length > 64) throw new Error('Save slot must contain 1 to 64 characters.');
  return PREFIX + encodeURIComponent(slot);
}

export function saveLocal(slot: string, state: GameState): Result {
  try {
    const key = slotKey(slot), local = storage();
    if (!local) return {ok: false, reason: 'Browser storage is unavailable. Export a save file instead.'};
    const validated = validateState(state), envelope = JSON.stringify({savedAt: Date.now(), state: validated});
    if (envelope.length > MAX_SAVE_BYTES) throw new Error('Save is too large (maximum 16 MB).');
    local.setItem(key, envelope);
    return {ok: true};
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unable to store the save.';
    return {ok: false, reason: /quota/i.test(reason) ? 'Browser storage is full. Remove an older save or export a save file.' : reason};
  }
}
export function loadLocal(slot: string): GameState | null {
  const local = storage();
  if (!local) return null;
  const raw = local.getItem(slotKey(slot));
  if (raw === null) return null;
  if (raw.length > MAX_SAVE_BYTES + 128) throw new Error('Stored save is too large.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Stored save is not valid JSON.'); }
  const envelope = object(value, 'stored save');
  number(envelope.savedAt, 'stored save.savedAt', 0, Number.MAX_SAFE_INTEGER, true);
  return validateState(envelope.state);
}
export function listSaves(): {slot: string; tick: number; seed: string; savedAt: number}[] {
  const local = storage(), saves: {slot: string; tick: number; seed: string; savedAt: number}[] = [];
  if (!local) return saves;
  try {
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const slot = decodeURIComponent(key.slice(PREFIX.length)), state = loadLocal(slot);
        const envelope = JSON.parse(local.getItem(key)!) as {savedAt: number};
        if (state) saves.push({slot, tick: state.tick, seed: state.settings.seed, savedAt: envelope.savedAt});
      } catch { /* A corrupt slot must not hide the remaining valid saves. */ }
    }
  } catch { /* Restricted browser storage is equivalent to no available saves. */ }
  return saves.sort((a, b) => b.savedAt - a.savedAt || a.slot.localeCompare(b.slot));
}
export function removeSave(slot: string): void { storage()?.removeItem(slotKey(slot)); }
