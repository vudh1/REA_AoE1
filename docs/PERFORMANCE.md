# Performance report

The cloud runs below fail the 60 FPS / p95 ≤20 ms targets. Restored-code gameplay validation passed, but integrated 400-unit rendering still shows severe stalls under investigation. No representative integrated-GPU desktop or 30-minute real-time browser session has been measured. Do not claim “lag-free.”

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

This build contains 155,027 raw bytes / 53,442 summed gzip-equivalent bytes. Both Pages roots plus license manifests total 336,104 raw / 116,464 gzip-equivalent bytes. Actual GitHub transfer size is unverified. The raw report is `.local/browser-profile.json`. A material regression is being diagnosed before any further measured repeat; microbenchmarks alone do not establish integrated gameplay performance.

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
| Normal desktop 1080p / 200 units: 60 FPS, p95 ≤20 ms | Failed in historical headless software rendering; representative desktop unmeasured |
| Visible command acknowledgment ≤100 ms | One historical 64.2 ms sample; final profiler collects 10 samples |
| 400-unit crowded combat | Historical sample recorded above; optimized repeat pending |
| 30-minute match/restarts without worsening performance or unbounded memory | Accelerated simulation and short restart checks are distinct; real-time browser session pending |
| Initial playable compressed download <15 MB | Historical build ~53 kB gzip equivalent; final size pending |

Fresh restored validation passed 78 simulation tests/5 files in 4.34 seconds and 6 production-browser tests in 29.8 seconds. The browser tests cover root and `/aoe1/`, actual gather/deposit, construction, training, movement, attack/conquest, pause, local save/reload and restart. TypeScript and the production build passed.

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
