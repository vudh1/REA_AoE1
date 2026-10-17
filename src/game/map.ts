import type {Entity, MatchSettings, Point, Resource, Terrain, WorldMap} from './types';

const GENERATION = 1;
type ResourceType = 'tree' | 'berries' | 'gold' | 'stone' | 'deer';
const RESOURCE_KIND: Record<ResourceType, Resource> = {tree: 'wood', berries: 'food', gold: 'gold', stone: 'stone', deer: 'food'};

/** Resource IDs are stable and sequential; callers allocate new game IDs after this list. */
export function createResource(id: number, type: ResourceType, x: number, y: number, amount: number): Entity {
  return {id, owner: -1, kind: 'resource', type, x, y, hp: 1, maxHp: 1, radius: type === 'tree' ? 0.35 : 0.4,
    completed: true, progress: 1, amount, resource: RESOURCE_KIND[type], carry: 0, orders: [], path: [],
    cooldown: 0, work: 0, queue: [], task: 'Available', facing: 0, prevX: x, prevY: y, stuck: 0, repath: 0, lastHit: -1000};
}

function hashSeed(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return value >>> 0 || 1;
}

function randomFor(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Tile centers are x+.5/y+.5. Start positions are Town Center centers, not footprint origins. */
export function generateMap(settings: MatchSettings): {map: WorldMap; resources: Entity[]} {
  const size = {small: 96, medium: 128, large: 160}[settings.size];
  const random = randomFor(`${GENERATION}:${settings.seed}:${settings.size}:${settings.opponents}`);
  const count = Math.max(2, Math.min(4, settings.opponents + 1));
  const margin = Math.floor(size * 0.24) + 0.5;
  const far = size - margin;
  const corners = [{x: margin, y: margin}, {x: far, y: far}, {x: far, y: margin}, {x: margin, y: far}];
  const starts = count === 3
    ? [corners[0]!, {x: far, y: Math.floor(size / 2) + 0.5}, corners[3]!]
    : corners.slice(0, count);
  const tiles: Terrain[] = Array.from({length: size * size}, () => random() < 0.1 ? 1 : 0);
  const map: WorldMap = {size, tiles, starts, generation: GENERATION, seed: settings.seed};

  // Small separated ponds never require transport. Wide land corridors connect every start.
  const ponds: Point[] = [];
  for (let trial = 0; trial < size / 7; trial++) {
    const center = {x: 8 + random() * (size - 16), y: 8 + random() * (size - 16)};
    if (starts.some(start => distance(start, center) < 21) || ponds.some(pond => distance(pond, center) < 15)) continue;
    ponds.push(center);
    const rx = 2 + random() * 3, ry = 2 + random() * 3;
    for (let y = Math.floor(center.y - ry - 1); y <= center.y + ry + 1; y++) {
      for (let x = Math.floor(center.x - rx - 1); x <= center.x + rx + 1; x++) {
        if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
        const oval = ((x + 0.5 - center.x) / rx) ** 2 + ((y + 0.5 - center.y) / ry) ** 2;
        if (oval < 0.8) tiles[y * size + x] = 2;
        else if (oval < 1.6) tiles[y * size + x] = 3;
      }
    }
  }
  for (const start of starts) {
    const steps = Math.ceil(distance(start, {x: size / 2, y: size / 2}));
    for (let step = 0; step <= steps; step++) {
      const x = Math.floor(start.x + (size / 2 - start.x) * step / steps);
      const y = Math.floor(start.y + (size / 2 - start.y) * step / steps);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) tiles[(y + dy) * size + x + dx] = 0;
    }
    for (let y = Math.floor(start.y - 16); y <= start.y + 16; y++) {
      for (let x = Math.floor(start.x - 16); x <= start.x + 16; x++) {
        if (x >= 0 && y >= 0 && x < size && y < size && distance(start, {x: x + 0.5, y: y + 0.5}) < 16) tiles[y * size + x] = 0;
      }
    }
  }
  // Repair isolated land pockets rather than retrying an unlucky seed forever.
  const connected = floodLand(map);
  for (let i = 0; i < tiles.length; i++) if (tiles[i] !== 2 && !connected[i]) tiles[i] = 2;

  const resources: Entity[] = [];
  const occupied = new Set<number>();
  const multiplier = settings.resources === 'abundant' ? 1.6 : 1;
  const amount: Record<ResourceType, number> = {tree: 220, berries: 220, deer: 180, gold: 700, stone: 600};
  const add = (type: ResourceType, x: number, y: number): boolean => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 3 || y < 3 || x >= size - 3 || y >= size - 3) return false;
    const index = y * size + x;
    if (tiles[index] === 2 || occupied.has(index)) return false;
    if (starts.some(start => distance(start, {x: x + 0.5, y: y + 0.5}) < 6.5)) return false;
    occupied.add(index);
    resources.push(createResource(resources.length + 1, type, x + 0.5, y + 0.5, Math.round(amount[type] * multiplier)));
    if (type === 'tree') tiles[index] = 1;
    return true;
  };
  const patch = (type: ResourceType, center: Point, n: number, radius: number): void => {
    let placed = 0;
    for (let attempt = 0; attempt < n * 20 && placed < n; attempt++) {
      const angle = random() * Math.PI * 2, length = Math.sqrt(random()) * radius;
      if (add(type, center.x + Math.cos(angle) * length, center.y + Math.sin(angle) * length)) placed++;
    }
  };
  for (const start of starts) {
    patch('tree', {x: start.x + 10, y: start.y - 1}, 30, 3.7);
    patch('tree', {x: start.x - 10, y: start.y + 4}, 20, 3.5);
    patch('berries', {x: start.x - 4, y: start.y + 8}, 7, 2);
    patch('deer', {x: start.x + 7, y: start.y + 7}, 4, 2.1);
    patch('gold', {x: start.x - 9, y: start.y - 5}, 6, 2);
    patch('stone', {x: start.x + 4, y: start.y - 10}, 5, 1.8);
  }
  // Expansion deposits sit beyond the guaranteed starting ring.
  for (let i = 0; i < Math.floor(size * size / 390); i++) {
    const center = {x: 6 + random() * (size - 12), y: 6 + random() * (size - 12)};
    if (starts.some(start => distance(start, center) < 18)) continue;
    patch('tree', center, 11 + Math.floor(random() * 12), 3.5 + random() * 1.5);
  }
  for (let i = 0; i < Math.floor(size * size / 850); i++) {
    const center = {x: 7 + random() * (size - 14), y: 7 + random() * (size - 14)};
    if (starts.some(start => distance(start, center) < 18)) continue;
    const type: ResourceType = i % 4 === 0 ? 'stone' : i % 4 === 1 ? 'gold' : i % 4 === 2 ? 'berries' : 'deer';
    patch(type, center, type === 'deer' ? 4 : 6, 2.5);
  }
  if (!validateMap(map)) throw new Error('Map generation could not preserve connected starting land.');
  return {map, resources};
}

function floodLand(map: WorldMap): Uint8Array {
  const visited = new Uint8Array(map.size * map.size);
  const start = map.starts[0];
  if (!start) return visited;
  const index = Math.floor(start.y) * map.size + Math.floor(start.x);
  if (map.tiles[index] === 2 || map.tiles[index] === undefined) return visited;
  const queue = new Int32Array(map.size * map.size);
  let head = 0, tail = 1;
  queue[0] = index; visited[index] = 1;
  while (head < tail) {
    const current = queue[head++]!;
    const x = current % map.size, y = Math.floor(current / map.size);
    for (const next of [x > 0 ? current - 1 : -1, x + 1 < map.size ? current + 1 : -1, y > 0 ? current - map.size : -1, y + 1 < map.size ? current + map.size : -1]) {
      if (next >= 0 && !visited[next] && map.tiles[next] !== 2) {visited[next] = 1; queue[tail++] = next;}
    }
  }
  return visited;
}

export function validateMap(map: WorldMap): boolean {
  if (!Number.isInteger(map.size) || map.size < 8 || map.tiles.length !== map.size * map.size || map.starts.length < 1) return false;
  if (map.tiles.some(tile => tile !== 0 && tile !== 1 && tile !== 2 && tile !== 3)) return false;
  if (map.starts.some(start => !Number.isFinite(start.x) || !Number.isFinite(start.y) || start.x < 0 || start.y < 0 || start.x >= map.size || start.y >= map.size)) return false;
  const connected = floodLand(map);
  if (map.starts.some(start => !connected[Math.floor(start.y) * map.size + Math.floor(start.x)])) return false;
  return map.tiles.every((tile, index) => tile === 2 || connected[index] === 1);
}
