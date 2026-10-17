/** Engine-only counterpart of scripts/profile.mjs's developed 400-unit fixture.
 * Run: npx tsx scripts/profile-engine.ts [200|400] [ticks, default 600]
 * No renderer, DOM, artificial resource grants, AI disabling or rule changes.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {Engine} from '../src/game/engine';
import {DEFAULT_SETTINGS, type Entity, type UnitType} from '../src/game/types';

const total = Number(process.argv[2] ?? 400);
const ticks = Number(process.argv[3] ?? 600);
if (![200, 400].includes(total) || !Number.isInteger(ticks) || ticks < 1 || ticks > 12000) throw new Error('Expected 200|400 units and 1..12000 ticks');
const settings = {...DEFAULT_SETTINGS, seed: `PROFILE-${total}`, size: 'medium' as const, opponents: total === 200 ? 1 : 3, population: 150 as const, speed: 1, peaceful: false, tutorial: false, difficulty: 'normal' as const};
const engine = new Engine(settings), state = engine.state, center = state.map.size / 2;
const collision = engine as unknown as {canStand(unit: Entity, x: number, y: number): boolean};
const housing: number[] = [];
for (const player of state.players) {
  player.age = 4;
  const home = state.map.starts[player.id]!;
  let built = 0;
  for (let ring = 5; ring < 27 && built < 18; ring++) {
    for (let y = -ring; y <= ring && built < 18; y += 3) for (let x = -ring; x <= ring && built < 18; x += 3) {
      const ox = Math.floor(home.x + x), oy = Math.floor(home.y + y);
      if (!engine.canPlace(player.id, 'house', ox, oy).ok) continue;
      engine.createBuilding(player.id, 'house', ox + 1, oy + 1);
      engine.step(1);
      built++;
    }
  }
  housing.push(built);
}
const sides = [[-8, 0], [8, 0], [0, -8], [0, 8]];
let relocated = 0, relocationFailed = 0;
for (const player of state.players) {
  const owned = state.entities.filter(entity => entity.owner === player.id && entity.kind === 'unit').length;
  const count = total / state.players.length - owned;
  for (let i = 0; i < count; i++) {
    const types: UnitType[] = ['heavy', 'heavy', 'infantry', 'archer', 'cavalry'];
    const [dx, dy] = sides[player.id]!;
    const x = center + dx! + (i % 10 - 4.5) * 0.7;
    const y = center + dy! + (Math.floor(i / 10) - 4.5) * 0.7;
    const unit = engine.createUnit(player.id, types[i % types.length]!, x, y);
    if (!collision.canStand(unit, x, y)) {
      let found = false;
      for (let r = 1; r < 5 && !found; r++) for (let oy = -r; oy <= r && !found; oy++) for (let ox = -r; ox <= r && !found; ox++) {
        const nx = Math.floor(x + ox) + 0.5, ny = Math.floor(y + oy) + 0.5;
        if (collision.canStand(unit, nx, ny)) {unit.x = unit.prevX = nx; unit.y = unit.prevY = ny; found = true;}
      }
      if (found) relocated++; else relocationFailed++;
    }
  }
}
engine.step(1);
const invalidInitial = state.entities.filter(entity => entity.kind === 'unit' && !collision.canStand(entity, entity.x, entity.y)).map(entity => entity.id);
let accepted = 0;
for (const player of state.players) {
  const ids = state.entities.filter(entity => entity.owner === player.id && entity.kind === 'unit' && entity.type !== 'villager').map(entity => entity.id);
  if (engine.command(player.id, {type: 'order', ids, order: {type: 'attackMove', x: center, y: center}}).ok) accepted++;
}
const prepared = {target: total, units: state.entities.filter(entity => entity.kind === 'unit').length, tick: state.tick, housing, accepted, settings, relocated, relocationFailed, invalidInitial};
if (prepared.units !== total || accepted !== settings.opponents + 1) throw new Error(`Invalid fixture: ${JSON.stringify(prepared)}`);
const samples: {tick: number; ms: number; simulationMs: number; aiMs: number; pathQueue: number; units: number}[] = [];
const start = performance.now();
for (let i = 0; i < ticks; i++) {
  const before = performance.now(); engine.step(1); const ms = performance.now() - before;
  samples.push({tick: state.tick, ms, simulationMs: engine.metrics.simulationMs, aiMs: engine.metrics.aiMs, pathQueue: engine.metrics.pathQueue, units: state.entities.filter(entity => entity.kind === 'unit').length});
  if (state.result !== 'playing') break;
}
const elapsedMs = performance.now() - start;
const summarize = (subset: typeof samples) => {
  const sorted = subset.map(sample => sample.ms).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {ticks: subset.length, meanMs: subset.reduce((sum, sample) => sum + sample.ms, 0) / subset.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), maxMs: sorted.at(-1), maxAiMs: Math.max(...subset.map(sample => sample.aiMs)), maxPathQueue: Math.max(...subset.map(sample => sample.pathQueue))};
};
const report = {prepared, elapsedMs, summary: summarize(samples), first100: summarize(samples.slice(0, 100)), after100: samples.length > 100 ? summarize(samples.slice(100)) : null, worstTicks: [...samples].sort((a, b) => b.ms - a.ms).slice(0, 10), result: state.result, unitsEnd: samples.at(-1)?.units, samples};
const output = `.local/engine-profile-${total}.json`;
mkdirSync('.local', {recursive: true});
writeFileSync(output, JSON.stringify(report, null, 2));
const {samples: omitted, ...brief} = report;
console.log(JSON.stringify({...brief, output}, null, 2));
