# Performance report

The final cloud run measured 28.14 FPS at 200 units and 19.20 FPS at 400 units, missing the 60 FPS / p95 ≤20 ms targets. Pointer command acknowledgment p95 was 73 ms. Gameplay validation passed. Representative integrated-GPU desktop and 30-minute real-time browser measurements remain unavailable; no “lag-free” claim is made.

## Final integrated measurement

Hardware: Xeon Platinum 8573C, 5 logical CPUs exposed with a 4-CPU cgroup quota, 32 GiB cgroup memory limit, Linux 6.18.55 x86_64. Browser: Chromium 154.0.8037.57 headless, ANGLE Vulkan SwiftShader software graphics. Display: 1920 ×1080, DPR 1, Medium graphics, zoom 0.8. Map: 128 ×128. Opponents: 1 and 3, normal difficulty, 1× game speed. AI, economy, pathfinding, fog and combat remained active.

The profiler prepares developed settlements and exactly 200 or 400 mixed units, submits real validated attack-move commands, warms up for 1.5 seconds, and measures 20 seconds. Combat reduces unit counts. These are repeatable combat fixtures, not evidence of natural population growth in a normal match. A separate Node audit confirmed 67 relocations and zero invalid spawns in the 400-unit fixture. The measured JavaScript asset was `index-BkfMZRRB.js`; the subsequent optional cleanup-marker correction is inactive with the profiler's default cleanup setting.

| Final atlas/HUD fixture | 200 units / 1 AI | 400 units / 3 AI |
| --- | --- | --- |
| Seed | PROFILE-200 | PROFILE-400 |
| Frames / elapsed | 564 / 20,040.7 ms | 384 / 20,002.7 ms |
| Mean FPS | 28.14 | 19.20 |
| Frame p50 / p95 / p99 | 16.7 / 100 / 183.3 ms | 33.4 / 150 / 200.1 ms |
| Worst raw frame interval | 283.3 ms | 383.4 ms |
| Per-tick simulation p95 | 22.3 ms | 29.8 ms |
| Rolling renderer CPU average at sample end | 11.14 ms | 12.25 ms |
| Units at sample start →end | 200 →163 | 400 →291 |
| Sampled JS heap start →end | 12.32 →32.14 MB | 70.07 →19.48 MB |
| Unit sprite atlas pages | 4 | 4 |
| Sprite cache hits / misses / evictions | 198,024 / 668 / 0 | 226,688 / 1,326 / 558 |

Ten actual pointer commands in a freshly restarted 24-unit match reached target-indicator Canvas rendering at p50 6.9 ms and p95/worst 73 ms. This measures Canvas completion, not physical display latency or command acknowledgment during the crowded combat fixtures. Ten restarts changed controlled-GC JS heap from 5,193,132 to 5,336,836 bytes; the following one-second sample advanced 21 simulation ticks. No uncaught exceptions occurred. JS heap can grow and shrink between collections; these snapshots do not measure GPU/native memory or establish a 30-minute memory bound.

The measured playable build was 155,993 raw bytes and 53,795 bytes summed per-file gzip equivalent, comfortably below the 15 MB initial-download budget. The dual-root Pages artifact, including two license/asset manifests, was 338,036 raw / 117,170 gzip-equivalent bytes. These are local build measurements, not verified GitHub transfer bytes. The [raw final report](results/browser-profile.json) records all samples and metadata. `.local/browser-profile.json` is the reproducible script's local output.

The subsequently delivered cleanup-enabled build (`index-BwKxjEXO.js`) is **156,496 raw / 53,955 gzip-equivalent bytes** for the playable files and **339,042 raw / 117,490 gzip-equivalent bytes** for the complete dual-root Pages artifact. Its JavaScript is 138,708 raw / 48,654 gzip bytes; CSS is 16,900 / 4,688. The saved raw profile deliberately retains the bytes of the build actually profiled.

The atlas and HUD changes eliminated multi-second stalls in this final sample; the frame-time target still failed. Short isolated probes produced higher FPS than full integrated runs. Cloud scheduling, software graphics, fixture duration, and cache state affect results; microbenchmarks do not establish full-game performance. No further unmeasured improvement is claimed.

## Recovered build: first integrated sprite-cache profile

This run used Xeon Platinum 8573C, 5 logical CPUs / 4-CPU quota, 32 GiB memory limit, Linux 6.18.55, the same Chromium 154.0.8037.57 and SwiftShader software graphics at 1920 ×1080, DPR 1, Medium. The host CPU changed from the historical 8370C, so this is not a controlled hardware before/after comparison. Both scenarios retained active AI/economy/combat and the fixture methodology below. The measured JavaScript asset was `index-0P1gfjMj.js`.

| Recovered first-cache fixture | 200 units / 1 AI | 400 units / 3 AI |
| --- | --- | --- |
| Frames / elapsed | 689 / 20,159.3 ms | 54 / 20,099.6 ms |
| Mean FPS | 34.18 | 2.69 |
| Frame p50 / p95 / p99 | 16.7 / 50 / 116.7 ms | 50.1 / 2,083.3 / 6,183.1 ms |
| Worst raw frame interval | 1,833.2 ms | 6,183.1 ms |
| Per-tick simulation p95 | 15 ms | 249.55 ms |
| Rolling renderer CPU average | 13.22 ms | 132.54 ms |
| Units at sample start →end | 200 →165 | 400 →394 |
| Sampled JS heap start →end | 12.56 →30.65 MB | 33.13 →34.78 MB |

Ten actual pointer commands reached Canvas target-indicator rendering at p50 12.9 ms and p95/worst 68.4 ms. Ten restarts changed controlled-GC JS heap from 5,146,424 to 5,343,700 bytes. The final one-second tick sample advanced only 9 ticks during stalls; this is not evidence of an extra simulation loop. No uncaught exceptions occurred. These memory snapshots do not establish a leak or a long-term bound.

This earlier build contains 155,027 raw bytes / 53,442 summed gzip-equivalent bytes. Both Pages roots plus license manifests total 336,104 raw / 116,464 gzip-equivalent bytes. Actual GitHub transfer size is unverified. This observed stall run motivated the reusable sprite atlas and unchanged-HUD caching corrections above; it was not consistently reproduced in shorter probes.

## Historical preoptimization measurement

Recorded before the environment recovery, on Linux x86_64 / Debian 13, Intel Xeon Platinum 8370C @2.80 GHz, 5 exposed logical CPUs with a 4-CPU cgroup quota, 32 GiB cgroup memory limit, Chromium 154.0.8037.57 headless. Graphics: ANGLE Vulkan SwiftShader software renderer; 1920 ×1080, DPR 1, Medium graphics, zoom 0.8. This is not representative integrated graphics hardware.

Both 128 ×128 seeded scenarios ran ordinary simulation, economy, combat, fog and local AI. Debug setup prepared developed settlements (18 houses/player, age 4) and mixed armies; it did not claim naturally reaching that population in a normal match. All military received validated attack-move commands toward the center. AI remained active. Each measured sample followed 1.5 seconds of warmup and lasted about 20 seconds; combat deaths reduced populations.

| Preoptimization fixture | 200 units / 1 AI | 400 units / 3 AI |
| --- | --- | --- |
| Seed | PROFILE-200 | PROFILE-400 |
| Frames / elapsed | 361 / 20,038.8 ms | 357 / 20,047.7 ms |
| Mean FPS | 18.02 | 17.81 |
| Frame p50 / p95 / p99 | 50 / 116.6 / 183.4 ms | 50 / 83.4 / 133.3 ms |
| Worst raw frame interval | 483.3 ms | 183.4 ms |
| Per-tick simulation p95 | 18 ms | 14 ms |
| Rolling renderer CPU average | 11.07 ms | 11.72 ms |
| Units at sample start →end | 200 →163 | 399 →275 |
| Sampled JS heap start →end | 25.03 →19.41 MB | 37.35 →25.41 MB |

There were no uncaught browser exceptions. A single actual pointer command's target indicator reached Canvas rendering in 64.2 ms. Ten restarts changed controlled-GC JS heap from 5,027,480 to 5,079,584 bytes, with 20 simulation ticks over a measured second afterward. Those observations do not prove a 30-minute memory bound or a response-time percentile.

Historical one-game production size: 153,641 raw bytes and 53,045 bytes summed per-file gzip equivalent. Dual-root Pages artifact including both license/asset manifests: 333,734 raw bytes and 115,824 gzip-equivalent bytes. These are measured build bytes, not verified GitHub network transfer. The final optimized build may differ.

## Targets and outstanding checks

| Goal | Status |
| --- | --- |
| Normal desktop 1080p / 200 units: 60 FPS, p95 ≤20 ms | Failed on this cloud software renderer; representative desktop unmeasured |
| Visible command acknowledgment ≤100 ms | 10 fresh-start samples: p95/worst 73 ms to Canvas completion; crowded-combat latency unmeasured |
| 400-unit crowded combat | Final 19.20 FPS, p95 150 ms, worst 383.4 ms; target remains unmet |
| 30-minute match/restarts without worsening performance or unbounded memory | Accelerated simulation and short restart checks are distinct; real-time browser session pending |
| Initial playable compressed download <15 MB | Delivered ~54.0 kB gzip equivalent; actual hosted transfer unverified |

Validation passed 78 simulation tests/5 files in 4.12 seconds on the final reusable-install check and the final 6 production-browser tests in 23.2 seconds. The browser tests cover root and `/aoe1/`, actual gather/deposit, construction, training, movement, attack/conquest, pause, local save/reload and restart. Frozen-lock installation, TypeScript and the production build passed. A targeted real-pointer check verified the optional cleanup marker activates only after 20 simulation minutes and leaves fog/hidden-unit state intact.

The saved peaceful soak (`docs/results/soak-peaceful.json`) simulates 30 minutes on hard difficulty with all four seats controlled by identical AI, 180 invariant checks, 2,241 validated commands, no command rejections, and all four civilizations reaching Iron Age. The final combat soak (`docs/results/soak-combat.json`) ran 30 aggregate simulation minutes across two seeded matches: the first ended in legitimate defeat after 19.558 minutes, the second ran the remaining 10.442 minutes. It completed 181 invariant checks, 6,841 commands, zero command rejections, and 18 attack waves in 52.02 wall-clock seconds. These are accelerated headless simulations, not 30 minutes of browser rendering.

## Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run test:browser
npm run soak -- --minutes=30
npm run soak -- --minutes=30 --peaceful
npm run build
node scripts/package-pages.mjs --serve
# In another terminal while the production server runs:
npm run profile
```

`scripts/profile.mjs` runs 20-second 200- and 400-unit combat fixtures with genuine AI/commands, records untruncated rAF intervals, 10 actual pointer command-to-Canvas acknowledgment samples, ten restarts with controlled GC heap comparison, and exact build/artifact byte counts. It writes `.local/browser-profile.json`. Use `PROFILE_URL` to override the default `http://127.0.0.1:4173/aoe1/`. Browser selection matches the Playwright config.

The profiler's scenario constructors supply test armies/housing explicitly; they are not an AI economy progression test. One heap pair cannot establish or exclude a leak. Actual paint/display latency can exceed Canvas completion, and headless software graphics cannot establish a universal desktop FPS guarantee.
