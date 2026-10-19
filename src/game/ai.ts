import type { Engine } from './engine';
import { BUILDINGS, TECHS, UNITS } from './data';
import type { AIState, BuildingType, Command, Entity, Player, Point, Resource, Result, TechId, UnitType } from './types';

/** Everything remembered by the policy lives in the save, including its timers. */
interface Brain extends AIState {
  issuedCommands?: number;
  failedCommands?: number;
  lastFailure?: string;
  lastExplore?: number;
  attacks?: number;
}
const RESOURCES: Resource[] = ['food', 'wood', 'gold', 'stone'];
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const isWorker = (e: Entity) => e.kind === 'unit' && e.type === 'villager';
const isSoldier = (e: Entity) => e.kind === 'unit' && e.type !== 'villager' && e.type !== 'scout';
const idle = (e: Entity) => !e.orders.length || e.orders[0].type === 'hold';

function afford(player: Player, cost: Partial<Record<Resource, number>>, reserve = 0): boolean {
  return RESOURCES.every(r => player.resources[r] >= (cost[r] || 0) + (r === 'food' || r === 'wood' ? reserve : 0));
}

function issue(engine: Engine, player: Player, command: Command): Result {
  const brain = player.ai as Brain;
  const result = engine.command(player.id, command);
  brain.issuedCommands = (brain.issuedCommands || 0) + 1;
  if (!result.ok) {
    brain.failedCommands = (brain.failedCommands || 0) + 1;
    brain.lastFailure = result.reason;
  }
  return result;
}

/** Read the same current sight and last-seen snapshots that the human minimap uses. */
function knowledge(engine: Engine, player: Player): Entity[] {
  const known = new Map<number, Entity>();
  for (const remembered of Object.values(player.memory)) known.set(remembered.id, remembered);
  for (const entity of engine.state.entities) {
    if (entity.owner === player.id || engine.isVisible(player.id, entity)) known.set(entity.id, entity);
  }
  const size = engine.state.map.size;
  return [...known.values()].filter(entity => {
    const cell = Math.floor(entity.y) * size + Math.floor(entity.x);
    if (player.visible[cell] && entity.owner !== player.id) {
      return engine.state.entities.some(current => current.id === entity.id && engine.isVisible(player.id, current));
    }
    return entity.hp > 0;
  });
}

function build(engine: Engine, player: Player, type: BuildingType, anchor: Point, workers: Entity[]): boolean {
  const def = BUILDINGS[type];
  if (player.age < def.age || !afford(player, def.cost) || !workers.length) return false;
  if (engine.state.entities.some(e => e.owner === player.id && e.type === type && !e.completed)) return false;
  const size = engine.state.map.size;
  for (let ring = 0; ring < 13; ring++) {
    const radius = (type === 'farm' ? 3.7 : 4.8) + ring * 1.8;
    for (let direction = 0; direction < 16; direction++) {
      const angle = direction * 2.399963 + player.id * 0.63 + ring * 0.37;
      const x = Math.round(anchor.x + Math.cos(angle) * radius) + 0.5;
      const y = Math.round(anchor.y + Math.sin(angle) * radius) + 0.5;
      if (x < 2 || y < 2 || x > size - 2 || y > size - 2) continue;
      if ((type === 'granary' || type === 'storage') && dist({ x: Math.floor(x) + def.size / 2, y: Math.floor(y) + def.size / 2 }, anchor) >= 8.8) continue;
      if (!engine.canPlace(player.id, type, x, y).ok) continue;
      const builders = workers.filter(w => w.orders[0]?.type !== 'build' && w.orders[0]?.type !== 'repair')
        .sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }) + (idle(a) ? -4 : 0) - (idle(b) ? -4 : 0))
        .slice(0, type === 'towncenter' ? 3 : 1);
      if (!builders.length) return false;
      const result = issue(engine, player, { type: 'build', building: type, x, y, builders: builders.map(w => w.id) });
      if (result.ok) (player.ai as Brain).lastBuild = engine.state.tick;
      return result.ok;
    }
  }
  return false;
}

function research(engine: Engine, player: Player, tech: TechId, buildings: Entity[]): boolean {
  const def = TECHS[tech];
  if (player.techs.includes(tech) || player.age < def.age || !afford(player, def.cost)) return false;
  if (def.requires?.some(type => !buildings.some(e => e.type === type && e.completed))) return false;
  if (buildings.some(e => e.queue.some(q => q.kind === 'tech' && q.type === tech))) return false;
  const lab = buildings.find(e => e.completed && e.type === def.building && !e.queue.length);
  return !!lab && issue(engine, player, { type: 'research', id: lab.id, tech }).ok;
}

function explore(engine: Engine, player: Player, from: Point): Point {
  const size = engine.state.map.size;
  const brain = player.ai as Brain;
  const clip = (v: number) => Math.max(3, Math.min(size - 4, v));
  const centerAngle = Math.atan2(size / 2 - from.y, size / 2 - from.x);
  for (let n = 0; n < 128; n++) {
    const index = (brain.scoutIndex + n) % 128;
    const radius = 12 + Math.floor(index / 16) * Math.max(5, size / 12);
    const angle = centerAngle + (index % 16) * Math.PI / 8;
    const point = { x: clip(from.x + Math.cos(angle) * radius), y: clip(from.y + Math.sin(angle) * radius) };
    if (!player.explored[Math.floor(point.y) * size + Math.floor(point.x)]) {
      brain.scoutIndex = index + 1;
      return point;
    }
  }
  brain.scoutIndex++;
  const index = brain.scoutIndex;
  return { x: clip(3 + ((index * 17) % (size - 6))), y: clip(3 + ((index * 29) % (size - 6))) };
}

function allocate(engine: Engine, player: Player, workers: Entity[], known: Entity[], home: Point, rebuilding = false): void {
  const sources = known.filter(e => e.amount > 0 && (e.kind === 'resource' || (e.type === 'farm' && e.owner === player.id && e.completed)));
  const byId = new Map(sources.map(e => [e.id, e]));
  const counts: Record<Resource, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
  for (const worker of workers) {
    const order = worker.orders[0];
    const target = order?.target === undefined ? undefined : byId.get(order.target);
    if (target?.resource && (order?.type === 'gather' || order?.type === 'deposit')) counts[target.resource]++;
    else if (worker.carryType && worker.carry > 0) counts[worker.carryType]++;
  }
  const ageCost = player.age < 4 ? TECHS[`age${player.age + 1}` as TechId].cost : {};
  const weights: Record<Resource, number> = {
    food: player.resources.food < Math.max(200, (ageCost.food || 0) + 100) ? 0.48 : 0.24,
    wood: player.resources.wood < 180 ? 0.48 : player.resources.wood > 650 ? 0.23 : 0.34,
    gold: player.age >= 2 ? (player.resources.gold < Math.max(250, (ageCost.gold || 0) + 100) ? 0.37 : 0.19) : 0.02,
    stone: player.age >= 2 ? 0.06 : 0.02,
  };
  if (player.resources.stone > 450) weights.stone = 0;
  if (player.resources.gold > 1500) weights.gold *= 0.45;
  if (rebuilding) {
    weights.food = 0.03;
    weights.wood = player.resources.wood < 300 ? 0.7 : 0.2;
    weights.stone = player.resources.stone < 150 ? 0.4 : 0.01;
    weights.gold = 0;
  }
  const available = new Set(sources.map(e => e.resource).filter((r): r is Resource => !!r));
  const sum = RESOURCES.reduce((total, r) => total + (available.has(r) ? weights[r] : 0), 0) || 1;
  for (const worker of workers) {
    const order = worker.orders[0];
    const routeFailed = worker.stuck > 3;
    const failedMove = order?.type === 'move' && routeFailed;
    if (order && (['build', 'repair'].includes(order.type) || order.type === 'move' && !failedMove || order.type === 'deposit' && !routeFailed)) continue;
    if (worker.carry > 0) {
      if ((idle(worker) || routeFailed) && worker.carryType) {
        const dropoff = engine.state.entities.filter(e => e.owner === player.id && e.kind === 'building' && e.completed && e.hp > 0 && BUILDINGS[e.type as BuildingType].dropoff?.includes(worker.carryType!) && !(routeFailed && order?.type === 'deposit' && e.id === order.target))
          .sort((a, b) => dist(worker, a) - dist(worker, b))[0];
        if (dropoff) issue(engine, player, { type: 'order', ids: [worker.id], order: { type: 'deposit', target: dropoff.id, x: dropoff.x, y: dropoff.y } });
      }
      continue;
    }
    const previous = order?.target === undefined ? undefined : byId.get(order.target);
    if (previous?.resource && order?.type === 'gather') {
      const excess = counts[previous.resource] - workers.length * weights[previous.resource] / sum;
      if (excess < 1.3 && !routeFailed) continue;
      counts[previous.resource]--;
    } else if (order && !idle(worker) && order.type !== 'gather' && !failedMove && !(order.type === 'deposit' && routeFailed)) continue;
    const ranked = RESOURCES.filter(r => available.has(r)).sort((a, b) =>
      (workers.length * weights[b] / sum - counts[b]) - (workers.length * weights[a] / sum - counts[a]));
    let assigned = false;
    for (const resource of ranked) {
      const candidates = sources.filter(e => e.resource === resource && !(routeFailed && e.id === order?.target))
        .sort((a, b) => dist(worker, a) + dist(home, a) * 0.2 - dist(worker, b) - dist(home, b) * 0.2);
      const source = candidates[routeFailed ? (Math.floor(engine.state.tick / 160) + worker.id) % Math.min(4, candidates.length || 1) : 0];
      if (!source) continue;
      const nextOrder = engine.isVisible(player.id, source)
        ? { type: 'gather' as const, target: source.id, x: source.x, y: source.y }
        : { type: 'move' as const, x: source.x, y: source.y };
      if (issue(engine, player, { type: 'order', ids: [worker.id], order: nextOrder }).ok) {
        counts[resource]++;
        assigned = true;
        break;
      }
    }
    if (!assigned && idle(worker)) {
      const point = explore(engine, player, home);
      issue(engine, player, { type: 'order', ids: [worker.id], order: { type: 'move', ...point } });
      break;
    }
  }
}

function economy(engine: Engine, player: Player, own: Entity[], known: Entity[], home: Point, threatened: boolean): void {
  const workers = own.filter(isWorker);
  const buildings = own.filter(e => e.kind === 'building');
  const has = (type: BuildingType) => buildings.some(e => e.type === type);
  const population = engine.population(player.id);
  const tc = buildings.find(e => e.type === 'towncenter' && e.completed);
  for (const foundation of buildings.filter(e => !e.completed).slice(0, 2)) {
    if (workers.some(w => w.orders.some(order => order.type === 'build' && order.target === foundation.id))) continue;
    const replacement = workers.filter(w => w.orders[0]?.type !== 'build' && w.orders[0]?.type !== 'repair')
      .sort((a, b) => dist(a, foundation) - dist(b, foundation))[0];
    if (replacement) issue(engine, player, { type: 'order', ids: [replacement.id], order: { type: 'build', target: foundation.id, x: foundation.x, y: foundation.y } });
  }
  if (!tc) {
    if (!has('towncenter')) {
      const canRecover = afford(player, BUILDINGS.towncenter.cost);
      if (canRecover) build(engine, player, 'towncenter', home, workers);
      else if (!has('storage')) build(engine, player, 'storage', home, workers);
      else if (!has('granary') && workers.some(w => w.carryType === 'food' && w.carry > 0) && player.resources.wood > 150) build(engine, player, 'granary', home, workers);
    }
    allocate(engine, player, workers, known, home, true);
    return;
  }
  const damaged = buildings.find(e => e.completed && ['towncenter', 'tower'].includes(e.type) && e.hp < e.maxHp * 0.72);
  if (damaged && player.resources.wood > 35 && !workers.some(w => w.orders[0]?.type === 'repair' && w.orders[0].target === damaged.id)) {
    const repairer = workers.filter(w => w.orders[0]?.type !== 'build').sort((a, b) => dist(a, damaged) - dist(b, damaged))[0];
    if (repairer) issue(engine, player, { type: 'order', ids: [repairer.id], order: { type: 'repair', target: damaged.id, x: damaged.x, y: damaged.y } });
  }
  if (population.cap - population.current - population.reserved <= 3 && population.cap < engine.state.settings.population) build(engine, player, 'house', home, workers);
  const workerGoal = Math.min(Math.floor(engine.state.settings.population * 0.48), [0, 17, 26, 34, 40][player.age]);
  if (!tc.queue.length) {
    const queued = buildings.reduce((n, b) => n + b.queue.filter(q => q.type === 'villager').length, 0);
    if (workers.length + queued < workerGoal && population.current + population.reserved < population.cap && afford(player, UNITS.villager.cost)) {
      issue(engine, player, { type: 'train', ids: [tc.id], unit: 'villager' });
    } else if (!own.some(e => e.type === 'scout') && workers.length >= 8 && population.current + population.reserved < population.cap && afford(player, UNITS.scout.cost, 35)) {
      issue(engine, player, { type: 'train', ids: [tc.id], unit: 'scout' });
    }
  }
  const food = known.filter(e => e.kind === 'resource' && e.resource === 'food' && e.amount > 0);
  const wood = known.filter(e => e.resource === 'wood' && e.amount > 0);
  const nearestFood = food.sort((a, b) => dist(a, home) - dist(b, home))[0];
  const nearestWood = wood.sort((a, b) => dist(a, home) - dist(b, home))[0];
  if (!has('granary') && workers.length >= 6) build(engine, player, 'granary', nearestFood || home, workers);
  else if (!has('storage') && workers.length >= 8) build(engine, player, 'storage', nearestWood || home, workers);
  else if (!has('barracks') && workers.length >= 9) build(engine, player, 'barracks', home, workers);
  else if (player.age >= 2 && !has('market')) build(engine, player, 'market', home, workers);
  else if (player.age >= 2 && !has('range')) build(engine, player, 'range', home, workers);
  else if (player.age >= 3 && !has('stable')) build(engine, player, 'stable', home, workers);
  else if (player.age >= 3 && !has('workshop')) build(engine, player, 'workshop', home, workers);
  else if (player.age >= 3 && !has('academy')) build(engine, player, 'academy', home, workers);
  const farms = buildings.filter(e => e.type === 'farm' && e.amount > 0);
  const localFood = food.filter(e => dist(e, home) < 15).reduce((sum, e) => sum + e.amount, 0);
  const desiredFarms = Math.max(2, Math.floor(workers.length * 0.22));
  if (player.age >= 2 && farms.length < desiredFarms && (localFood < 600 || engine.state.tick > 20 * 420)) build(engine, player, 'farm', home, workers);
  if (workers.length > 18 && engine.state.tick - (player.ai?.lastBuild || 0) > 240) {
    const assigned = new Map<number, number>();
    for (const worker of workers) {
      const target = worker.orders.find(order => order.type === 'gather')?.target;
      if (target !== undefined) assigned.set(target, (assigned.get(target) || 0) + 1);
    }
    const remote = known.filter(e => e.kind === 'resource' && e.amount > 100 && (assigned.get(e.id) || 0) >= 2)
      .find(e => !buildings.some(b => b.completed && BUILDINGS[b.type as BuildingType]?.dropoff?.includes(e.resource!) && dist(b, e) < 9));
    if (remote) build(engine, player, remote.resource === 'food' ? 'granary' : 'storage', remote, workers);
  }
  if (threatened && player.age >= 2 && !has('tower')) build(engine, player, 'tower', home, workers);
  allocate(engine, player, workers, known, home);
  const nextAge = `age${player.age + 1}` as TechId;
  if (player.age < 4 && workers.length >= Math.min(workerGoal - 1, 22)) research(engine, player, nextAge, buildings);
  const queueingAge = buildings.some(b => b.queue.some(q => q.kind === 'tech' && String(q.type).startsWith('age')));
  if ((player.age >= 2 || queueingAge) && player.resources.food > 180 && player.resources.wood > 160) {
    const upgrades: TechId[] = player.age >= 4 ? ['gather', 'carry', 'health', 'armor', 'infantry', 'ranged', 'durability', 'tower'] : ['gather', 'carry'];
    for (const tech of upgrades) if (research(engine, player, tech, buildings)) break;
  }
}

function military(engine: Engine, player: Player, own: Entity[], known: Entity[], home: Point): void {
  const brain = player.ai as Brain;
  const soldiers = own.filter(isSoldier);
  const visibleEnemies = known.filter(e => engine.isHostile(player.id, e.owner) && e.hp > 0 && engine.isVisible(player.id, e));
  // Allied settlements are considered only through the sight/memory supplied by the engine.
  const friendlyBuildings = known.filter(e => e.kind === 'building' && e.hp > 0 && engine.areAllied(player.id, e.owner));
  const threats = engine.state.settings.peaceful ? [] : visibleEnemies.filter(e => e.kind === 'unit' && friendlyBuildings.some(b => dist(b, e) < 11));
  const refuge = (unit: Entity): Point => friendlyBuildings.filter(b => b.completed && b.type === 'towncenter' && !visibleEnemies.some(enemy => dist(enemy, b) < 6))
    .sort((a, b) => dist(a, unit) - dist(b, unit))[0] || home;
  const threatened = threats.length > 0;
  const workerCount = own.filter(isWorker).length;
  const desired = engine.state.settings.peaceful ? Math.min(9, player.age * 2 + 1)
    : player.age === 1 ? (threatened ? 8 : 3) : player.age === 2 ? 9 : player.age === 3 ? 15 : engine.state.settings.population - workerCount - 2;
  const waitingAge = player.age < 4 && workerCount >= (player.age === 1 ? 15 : player.age === 2 ? 23 : 29);
  const kinds: UnitType[] = player.age >= 4 ? ['heavy', 'archer', 'cavalry', 'siege', 'spearman']
    : player.age >= 3 ? ['cavalry', 'archer', 'siege', 'spearman', 'infantry']
      : player.age >= 2 ? ['archer', 'spearman', 'infantry'] : ['infantry'];
  const pending = own.reduce((sum, e) => sum + e.queue.filter(q => q.kind === 'unit' && q.type !== 'villager' && q.type !== 'scout').length, 0);
  const fit = (entity: Entity) => entity.hp > entity.maxHp * 0.3 || engine.state.tick - entity.lastHit > 600;
  if (soldiers.filter(fit).length + pending < desired) {
    const ranked = [...kinds].sort((a, b) => own.filter(e => e.type === a).length / (a === 'siege' ? 0.45 : 1) - own.filter(e => e.type === b).length / (b === 'siege' ? 0.45 : 1));
    for (const kind of ranked) {
      const def = UNITS[kind];
      const building = own.find(e => e.kind === 'building' && e.type === def.building && e.completed && !e.queue.length);
      if (!building || player.age < def.age || !afford(player, def.cost, waitingAge && !threatened ? 120 : 25)) continue;
      const pop = engine.population(player.id);
      if (pop.current + pop.reserved + def.population > pop.cap) continue;
      issue(engine, player, { type: 'train', ids: [building.id], unit: kind });
    }
  }
  if (threatened) {
    brain.phase = 'defend';
    const target = threats.sort((a, b) => dist(a, home) - dist(b, home))[0];
    for (const worker of own.filter(isWorker)) {
      const shelter = refuge(worker);
      if (threats.some(enemy => dist(worker, enemy) < 5) && dist(worker, shelter) > 3) issue(engine, player, { type: 'order', ids: [worker.id], order: { type: 'move', x: shelter.x, y: shelter.y } });
    }
    const defenders = soldiers.filter(fit);
    if (defenders.length) issue(engine, player, { type: 'order', ids: defenders.map(e => e.id), order: { type: 'attackMove', x: target.x, y: target.y } });
  } else if (!engine.state.settings.peaceful) {
    const threshold = engine.state.settings.difficulty === 'easy' ? 8 : engine.state.settings.difficulty === 'hard' ? 5 : 6;
    const ready = soldiers.filter(fit);
    if (ready.length >= threshold && (engine.state.tick >= brain.nextAttack || brain.phase === 'attack')) {
      const enemies = known.filter(e => engine.isHostile(player.id, e.owner) && e.hp > 0 && e.kind !== 'resource');
      const enemyBuildings = enemies.filter(e => e.kind === 'building');
      const targets = enemyBuildings.length ? enemyBuildings : enemies;
      const target = targets.sort((a, b) => dist(a, home) - dist(b, home))[0];
      const prior = brain.target;
      const destination = target || (prior && !player.visible[Math.floor(prior.y) * engine.state.map.size + Math.floor(prior.x)] ? prior : explore(engine, player, home));
      const changed = !prior || dist(prior, destination) > 3;
      const attackers = ready.filter(e => idle(e) || changed || (e.orders[0]?.type !== 'attackMove' && e.orders[0]?.type !== 'attack'));
      if (attackers.length) issue(engine, player, { type: 'order', ids: attackers.map(e => e.id), order: { type: 'attackMove', x: destination.x, y: destination.y } });
      if (brain.phase !== 'attack') brain.attacks = (brain.attacks || 0) + 1;
      brain.target = { x: destination.x, y: destination.y };
      brain.phase = 'attack';
      brain.nextAttack = engine.state.tick + (engine.state.settings.difficulty === 'easy' ? 2400 : 1600);
    } else if (ready.length < Math.ceil(threshold / 2)) {
      brain.phase = 'recover';
      const returning = ready.filter(e => idle(e) && dist(e, home) > 6);
      if (returning.length) issue(engine, player, { type: 'order', ids: returning.map(e => e.id), order: { type: 'move', x: home.x, y: home.y } });
    }
  }
  const wounded = soldiers.filter(e => e.hp <= e.maxHp * 0.24 && engine.state.tick - e.lastHit <= 600 && dist(e, home) > 5 && e.orders[0]?.type !== 'move');
  for (const soldier of wounded) {
    const shelter = refuge(soldier);
    issue(engine, player, { type: 'order', ids: [soldier.id], order: { type: 'move', x: shelter.x, y: shelter.y } });
  }
  const scout = own.find(e => e.type === 'scout') || (!soldiers.length ? undefined : soldiers[0]);
  if (scout && !threatened && (idle(scout) || (scout.type === 'scout' && engine.state.tick - (brain.lastExplore || 0) > 600))) {
    const point = explore(engine, player, home);
    issue(engine, player, { type: 'order', ids: [scout.id], order: { type: 'attackMove', ...point } });
    brain.lastExplore = engine.state.tick;
  }
}

/** No resource grants, hidden-map queries, spawning, or difficulty-specific combat rules. */
export function updateAI(engine: Engine): void {
  for (const player of engine.state.players) {
    if (!player.ai || player.defeated) continue;
    const brain = player.ai as Brain;
    if (engine.state.tick < brain.nextDecision) continue;
    const interval = engine.state.settings.difficulty === 'hard' ? 20 : engine.state.settings.difficulty === 'easy' ? 60 : 40;
    brain.nextDecision = engine.state.tick + interval + (brain.issuedCommands === undefined ? player.id * 3 : 0);
    const own = engine.state.entities.filter(e => e.owner === player.id && e.hp > 0);
    if (!own.length) continue;
    const home = own.find(e => e.type === 'towncenter') || own.find(isWorker) || own[0];
    const known = knowledge(engine, player);
    const threatened = !engine.state.settings.peaceful && known.some(e => engine.isHostile(player.id, e.owner) && e.kind === 'unit' && engine.isVisible(player.id, e) && dist(e, home) < 12);
    economy(engine, player, own, known, home, threatened);
    military(engine, player, own, known, home);
  }
}
