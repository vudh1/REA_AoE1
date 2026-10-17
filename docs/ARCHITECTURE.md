# Architecture

Strict TypeScript and Vite provide a deterministic local simulation, original isometric Canvas renderer, and DOM menus/HUD. There is no server or per-frame React state. Entities have stable numeric IDs; definitions describe units, buildings, technologies, and civilizations.

Human input and local AI submit the same typed validated commands. A fixed 20 Hz simulation drives movement, gathering, construction, combat, queues, research, and strategic decisions. Rendering interpolates movement. Catch-up is bounded; hidden tabs pause.

| Module | Responsibility |
| --- | --- |
| `src/game/types.ts`, `data.ts` | Typed state/commands and gameplay definitions |
| `src/game/engine.ts` | Simulation, commands, economy, construction, production, combat, conquest |
| `src/game/map.ts`, `pathfinding.ts` | Seeded connected land, resources, walkability and bounded A* |
| `src/game/ai.ts` | Staggered economy, building, scouting, production and military decisions |
| `src/game/persistence.ts` | Version-1 JSON validation and save support |
| `src/render/renderer.ts` | Isometric caches, culling, fog/memory, animation and minimap |
| `src/ui/audio.ts`, `icons.ts` | Original synthesis and vector icons |
| `src/main.ts` | Menus/HUD, tutorial, input, scheduling, local storage and lifecycle |

## Invariants

| Area | Contract |
| --- | --- |
| Resource accounting | Check affordability before one atomic deduction. Carry finite stock; credit the owner only at a compatible completed drop-off. Refund reservations once. Balances stay finite and nonnegative. |
| Population | Living and reserved queued units count against housing and match maximum. Queue acceptance reserves resources/population; cancellation releases both; production converts one reservation to one living unit. |
| Construction | Check terrain, exploration, footprints, prerequisites and affordability before a foundation. Unfinished buildings give no completed benefits or sight. Cancellation refunds 75%; destruction refunds nothing. Command footprint coordinates are top-left; rendering uses centers. |
| Destruction | Dead entities cannot act. Update occupancy/spatial data. Destroyed queues lose reserved costs and release population. Conquest counts living owned units/buildings, including foundations. |
| Visibility | Each player owns exploration, visibility, and last-known memory. Neither human nor AI can directly target hidden enemies. Hidden live changes must not update remembered state. |
| Commands | Centrally validate ownership, visibility, prerequisites, affordability and destinations for both human and AI. No AI resource credit/free spawn bypass. |
| Saves | Validate versioned simulation JSON and PRNG state; never serialize DOM, Canvas or audio. Rebuild derived caches on load. Effects derive from saved technologies to prevent double application. |
| Pause/restart | Stop all gameplay clocks on pause. Restart replaces the match without duplicate listeners, simulation loops or AI timers. |

## Delivery and validation

Vite emits relative URLs (`base: './'`). `scripts/package-pages.mjs` copies the build to the artifact root and nested `aoe1/`, with license/asset manifests. The production test server serves files without SPA fallbacks, so missing assets fail. Hosting needs no special headers, backend, remote API, or shared-memory support.

Vitest covers simulation and seeded AI. Playwright uses real pointer/keyboard input for commands, with `window.__DAWN__` for deterministic scenario preparation and outcome assertions. `npm run soak` accelerates seeded simulations and checks invariants. `npm run profile` records real raw rAF intervals, Canvas command acknowledgment, developed-army fixtures, and controlled-GC restart comparisons; see `PERFORMANCE.md` for methodology and limitations. A contract or target is not a claim that every acceptance check has passed.
