/** Accelerated headless matches: npm run soak -- --minutes=30 [--peaceful] [--allies=0|1]. */
import { Engine } from '../src/game/engine';
import { DEFAULT_SETTINGS, type AIState, type Command, type Resource } from '../src/game/types';

const argument = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const minutes = Number(argument('minutes') || 30);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error('minutes must be between 0 and 240');
const seed = argument('seed') || 'AURELIA-SOAK-2026';
const peaceful = process.argv.includes('--peaceful');
const allies = Number(argument('allies') ?? 0);
if (allies !== 0 && allies !== 1) throw new Error('allies must be 0 or 1');
const difficulty = (argument('difficulty') || 'hard') as 'easy' | 'normal' | 'hard';
if (!['easy', 'normal', 'hard'].includes(difficulty)) throw new Error('Invalid difficulty');
const settings = {...DEFAULT_SETTINGS, seed, size: 'small' as const, opponents: 3, allies, population: 100 as const, difficulty, peaceful};
const targetTicks = Math.ceil(minutes * 60 * 20);
let simulatedTicks = 0, maxEntities = 0, maxPopulation = 0, checks = 0, commands = 0, failures = 0, attacks = 0;
let nextReport = 6000;
const failedReasons: Record<string, number> = {};
const matches: unknown[] = [];
const start = performance.now();

while (simulatedTicks < targetTicks) {
  const engine = new Engine({...settings, seed: `${seed}:${matches.length}`});
  // The harness gives the human seat the identical policy, never resources or units.
  for (const player of engine.state.players) player.ai = { nextDecision: player.id * 7, phase: 'opening', nextAttack: 0, scoutIndex: 0, lastBuild: 0 };
  const command = engine.command.bind(engine);
  engine.command = (owner: number, request: Command) => {
    commands++;
    const result = command(owner, request);
    if (!result.ok) {
      failures++;
      const reason = result.reason || 'Unknown failure';
      failedReasons[reason] = (failedReasons[reason] || 0) + 1;
    }
    return result;
  };
  const highAges = engine.state.players.map(p => p.age);
  let previousTick = 0;
  while (engine.state.result === 'playing' && simulatedTicks < targetTicks) {
    engine.step(Math.min(200, targetTicks - simulatedTicks));
    const elapsed = engine.state.tick - previousTick;
    if (!elapsed) throw new Error('Simulation stopped without a match result');
    simulatedTicks += elapsed;
    previousTick = engine.state.tick;
    checks++;
    const ids = new Set<number>();
    maxEntities = Math.max(maxEntities, engine.state.entities.length);
    for (const entity of engine.state.entities) {
      if (ids.has(entity.id)) throw new Error(`Duplicate entity ${entity.id}`);
      ids.add(entity.id);
      for (const value of [entity.x, entity.y, entity.hp, entity.maxHp, entity.progress, entity.amount, entity.carry]) if (!Number.isFinite(value)) throw new Error(`Non-finite entity ${entity.id}`);
      if (entity.x < 0 || entity.y < 0 || entity.x >= engine.state.map.size || entity.y >= engine.state.map.size) throw new Error(`Entity ${entity.id} left map`);
      if (entity.hp <= 0 || entity.hp > entity.maxHp + 0.001 || entity.carry < -0.001 || entity.amount < -0.001) throw new Error(`Invalid entity health/resources ${entity.id}`);
      for (const queue of entity.queue) {
        if (queue.progress < 0 || queue.progress > queue.time + 0.1) throw new Error(`Invalid production progress ${entity.id}`);
        if (Object.values(queue.cost).some(cost => cost < 0 || !Number.isFinite(cost))) throw new Error(`Invalid production cost ${entity.id}`);
      }
    }
    for (const player of engine.state.players) {
      highAges[player.id] = Math.max(highAges[player.id]!, player.age);
      for (const resource of ['food', 'wood', 'gold', 'stone'] as Resource[]) if (!Number.isFinite(player.resources[resource]) || player.resources[resource] < -0.001) throw new Error(`Invalid ${resource} for player ${player.id}`);
      const pop = engine.population(player.id);
      if (pop.current + pop.reserved > engine.state.settings.population) throw new Error(`Global population limit exceeded by ${player.id}`);
      maxPopulation = Math.max(maxPopulation, pop.current);
      if (player.age < 1 || player.age > 4 || new Set(player.techs).size !== player.techs.length) throw new Error(`Invalid progression for player ${player.id}`);
      if (player.visible.some((v, index) => v && !player.explored[index])) throw new Error(`Unexplored visible cell for ${player.id}`);
    }
    if (simulatedTicks >= nextReport) {
      process.stderr.write(`Soak ${(simulatedTicks / 1200).toFixed(1)}/${minutes} min; ages ${engine.state.players.map(p => p.age).join(',')}; ${engine.state.entities.length} entities\n`);
      nextReport += 6000;
    }
  }
  matches.push({
    seed: engine.state.settings.seed,
    settings: engine.state.settings,
    simulatedMinutes: Number((engine.state.tick / 1200).toFixed(3)),
    result: engine.state.result,
    players: engine.state.players.map(player => {
      const brain = player.ai as AIState & { attacks?: number };
      attacks += brain.attacks || 0;
      return { id: player.id, team: player.team ?? player.id, age: highAges[player.id], population: engine.population(player.id), resources: player.resources, stats: player.stats, attacks: brain.attacks || 0, defeated: player.defeated };
    }),
  });
}
console.log(JSON.stringify({
  seed, peaceful, difficulty, allies, settings, requestedMinutes: minutes, simulatedMinutes: simulatedTicks / 1200,
  wallSeconds: Number(((performance.now() - start) / 1000).toFixed(3)),
  invariantChecks: checks, maxEntities, maxPopulation, commands, failures, failedReasons, attacks, matches,
}, null, 2));
