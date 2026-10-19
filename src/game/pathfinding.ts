import {BUILDINGS} from './data';
import type {BuildingType, Entity, Point, WorldMap} from './types';

function blocks(entity: Entity, owner: number, alliedOwners: readonly number[] = []): boolean {
  if (entity.hp <= 0) return false;
  if (entity.kind === 'resource') return entity.amount > 0;
  if (entity.kind !== 'building') return false;
  return entity.type !== 'gate' || (!entity.open && entity.owner !== owner && !alliedOwners.includes(entity.owner));
}

function contains(entity: Entity, x: number, y: number): boolean {
  if (entity.kind === 'resource') return Math.floor(entity.x) === x && Math.floor(entity.y) === y;
  const size = BUILDINGS[entity.type as BuildingType].size;
  return x + 0.5 >= entity.x - size / 2 && x + 0.5 < entity.x + size / 2 && y + 0.5 >= entity.y - size / 2 && y + 0.5 < entity.y + size / 2;
}

/** Moving units use local avoidance and do not invalidate the static navigation grid. */
export function isWalkable(map: WorldMap, entities: Entity[], x: number, y: number, owner: number, alliedOwners: readonly number[] = []): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= map.size || y >= map.size || map.tiles[y * map.size + x] === 2) return false;
  return !entities.some(entity => blocks(entity, owner, alliedOwners) && contains(entity, x, y));
}

function occupancy(map: WorldMap, entities: Entity[], owner: number, alliedOwners: readonly number[]): Uint8Array {
  const blocked = new Uint8Array(map.size * map.size);
  for (let i = 0; i < blocked.length; i++) if (map.tiles[i] === 2) blocked[i] = 1;
  for (const entity of entities) {
    if (!blocks(entity, owner, alliedOwners)) continue;
    if (entity.kind === 'resource') {
      const x = Math.floor(entity.x), y = Math.floor(entity.y);
      if (x >= 0 && y >= 0 && x < map.size && y < map.size) blocked[y * map.size + x] = 1;
    } else {
      const size = BUILDINGS[entity.type as BuildingType].size;
      const minX = Math.max(0, Math.ceil(entity.x - size / 2 - 0.5));
      const minY = Math.max(0, Math.ceil(entity.y - size / 2 - 0.5));
      const maxX = Math.min(map.size - 1, Math.ceil(entity.x + size / 2 - 0.5) - 1);
      const maxY = Math.min(map.size - 1, Math.ceil(entity.y + size / 2 - 0.5) - 1);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) blocked[y * map.size + x] = 1;
    }
  }
  return blocked;
}

class MinHeap {
  private values: {index: number; score: number}[] = [];
  get length(): number {return this.values.length;}
  push(index: number, score: number): void {
    let position = this.values.length;
    this.values.push({index, score});
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.values[parent]!.score <= score) break;
      this.values[position] = this.values[parent]!;
      position = parent;
    }
    this.values[position] = {index, score};
  }
  pop(): number {
    const result = this.values[0]!.index;
    const end = this.values.pop()!;
    if (!this.values.length) return result;
    let position = 0;
    while (true) {
      const left = position * 2 + 1, right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right]!.score < this.values[left]!.score ? right : left;
      if (this.values[child]!.score >= end.score) break;
      this.values[position] = this.values[child]!;
      position = child;
    }
    this.values[position] = end;
    return result;
  }
}

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

/** Bounded A*. A blocked destination becomes its nearest reachable interaction tile. */
export function findPath(map: WorldMap, entities: Entity[], start: Point, goal: Point, owner: number, maxNodes = 2500, alliedOwners: readonly number[] = []): Point[] {
  if (![start.x, start.y, goal.x, goal.y].every(Number.isFinite) || maxNodes < 1) return [];
  const size = map.size, length = size * size;
  const sx = Math.floor(start.x), sy = Math.floor(start.y);
  if (sx < 0 || sy < 0 || sx >= size || sy >= size) return [];
  const gx = Math.max(0, Math.min(size - 1, Math.floor(goal.x))), gy = Math.max(0, Math.min(size - 1, Math.floor(goal.y)));
  const from = sy * size + sx, to = gy * size + gx;
  if (from === to) return [];
  const blocked = occupancy(map, entities, owner, alliedOwners);
  blocked[from] = 0; // Permit recovery from a newly placed obstacle under the unit.
  const interaction = blocked[to] === 1;
  const goals = new Uint8Array(length);
  const candidates: Point[] = [];
  const addGoal = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size || blocked[y * size + x] || goals[y * size + x]) return;
    goals[y * size + x] = 1;
    candidates.push({x, y});
  };
  if (!interaction) addGoal(gx, gy);
  else {
    const obstacle = entities.find(entity => blocks(entity, owner, alliedOwners) && contains(entity, gx, gy));
    if (obstacle) {
      const radius = obstacle.kind === 'building' ? BUILDINGS[obstacle.type as BuildingType].size / 2 : 0.5;
      const minX = Math.ceil(obstacle.x - radius - 0.5), maxX = Math.ceil(obstacle.x + radius - 0.5) - 1;
      const minY = Math.ceil(obstacle.y - radius - 0.5), maxY = Math.ceil(obstacle.y + radius - 0.5) - 1;
      // Search the entire usable perimeter. Geometrically closest cells may be
      // sealed pockets while a building's corners remain reachable for workers.
      for (let y = minY - 1; y <= maxY + 1; y++) for (let x = minX - 1; x <= maxX + 1; x++) {
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
        // Resource corners are beyond a villager's gathering reach.
        if (obstacle.kind === 'resource' && x !== gx && y !== gy) continue;
        addGoal(x, y);
      }
    } else {
      // A move into decorative water approaches a reachable bank. The bound
      // covers generated ponds and prevents unbounded destination adjustment.
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (DIRECTIONS.slice(0, 4).some(([ox, oy]) => x + ox >= 0 && y + oy >= 0 && x + ox < size && y + oy < size && map.tiles[(y + oy) * size + x + ox] === 2)) addGoal(x, y);
      }
    }
    if (!candidates.length) return [];
  }
  if (goals[from]) return [];
  const heuristicCache = new Float64Array(length); heuristicCache.fill(-1);
  const heuristic = (x: number, y: number): number => {
    const index = y * size + x;
    if (heuristicCache[index]! >= 0) return heuristicCache[index]!;
    let nearest = Infinity;
    for (const candidate of candidates) {
      const dx = Math.abs(candidate.x - x), dy = Math.abs(candidate.y - y);
      nearest = Math.min(nearest, Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
    }
    heuristicCache[index] = nearest;
    return nearest;
  };
  const scores = new Float64Array(length); scores.fill(Infinity); scores[from] = 0;
  const parents = new Int32Array(length); parents.fill(-1);
  const closed = new Uint8Array(length);
  const open = new MinHeap(); open.push(from, heuristic(sx, sy));
  let expanded = 0, destination = -1;
  while (open.length && expanded < Math.min(maxNodes, length)) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1; expanded++;
    if (goals[current]) {destination = current; break;}
    const x = current % size, y = Math.floor(current / size);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (blocked[next] || closed[next]) continue;
      if (dx && dy && (blocked[y * size + nx] || blocked[ny * size + x])) continue;
      const score = scores[current]! + (dx && dy ? Math.SQRT2 : 1);
      if (score >= scores[next]!) continue;
      scores[next] = score; parents[next] = current;
      open.push(next, score + heuristic(nx, ny));
    }
  }
  if (destination < 0) return [];
  const path: Point[] = [];
  for (let index = destination; index !== from; index = parents[index]!) {
    if (index < 0 || path.length > length) return [];
    path.push({x: index % size + 0.5, y: Math.floor(index / size) + 0.5});
  }
  return path.reverse();
}
