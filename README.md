# Dawn of Kingdoms

An original, single-player ancient-world browser RTS. One human civilization plays alongside an optional allied village and faces up to three independent computer opponents. The entire game runs in the browser: economy, construction, pathfinding, fog, combat, research, procedural artwork, and synthesized audio. It has no backend, account, telemetry, paid API, or required runtime network service.

## Play and develop

Use Node.js 22 and npm. Dependencies are development tools; the production game has no runtime package dependencies.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Quick Skirmish creates your village, one allied village and one enemy village automatically. Each computer village starts with its own Town Center, five villagers and a scout; workers gather finite resources, carry cargo home, deposit it, and pay normal building/training costs. Allies share scouting, defend visible friendly settlements, pass friendly gates and never damage teammates. Enemy civilizations remain independent rivals. Custom Skirmish changes seed, map, opponents, allies, civilization, difficulty, resources, population, speed, and peaceful sandbox. Tutorial uses the same simulation. Desktop mouse/keyboard and touch controls are supported. On a phone, tap to select, tap **Order**, then tap a target; swipe to pan, and use **+ / −** to zoom.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run soak -- --minutes=30
# Include an allied village and three enemies in the soak:
npm run soak -- --minutes=30 --allies=1
```

Browser tests use `/usr/bin/chromium` when present. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another installed executable, or `PLAYWRIGHT_USE_BUNDLED_CHROMIUM=1` to use Playwright's downloaded version. CI installs its matching Chromium and required Linux libraries.

Validation passed **99 simulation tests across 6 files** and **10 production Chromium gameplay tests**, including autonomous allied/enemy economies, team-safe commands, all 37 catalog entries, and native phone selection/orders/panning/construction, with TypeScript checking and a production build also passing. At 1080p on the documented headless software renderer, final crowded-combat profiles measured **28.14 FPS / 200 units** and **19.20 FPS / 400 units**; the 60 FPS target remains unmet. Pointer acknowledgment p95 at match start was **73 ms** across 10 samples. See [the performance report](docs/PERFORMANCE.md) for frame percentiles, memory observations, reproducible scenarios, and remaining real-device checks.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag | Select one / box-select units |
| Shift + left click | Add or remove selection |
| Double click / double tap a unit | Select visible units of that type |
| Touch Select / Order | Tap to select / issue contextual commands |
| Touch swipe / + and − | Pan / zoom |
| Shift + click a training button | Queue up to five units using normal costs |
| I / illustrated inventory button | Open the pictured catalog of resources, units, buildings and technologies |
| Right click | Contextual move, attack, gather, construct, repair, or deposit |
| Shift + right click | Queue contextual orders |
| Mouse wheel | Zoom |
| Middle drag / arrow keys | Pan camera |
| H | Select and center the Town Center |
| Space | Cycle idle villagers |
| A, then click | Attack-move |
| S | Stop selected units |
| B | Show villager construction commands in the HUD |
| P | Pause / resume |
| F3 | Toggle the development performance overlay |
| Ctrl + 1–9 / 1–9 | Assign / recall control group |
| Double-tap group number | Center its units |
| Escape | Cancel placement or close/pause |

Use the contextual HUD to construct, train, research, set stances, and cancel queue entries. Building previews explain invalid placement; tooltips show costs and prerequisites. Production reserves population immediately. Canceled foundations return 75% of their original cost; destroyed buildings lose their queues and reserved costs. Manual queue cancellation refunds its reserved cost once.

## Save and load

Pause to save a local slot or export versioned JSON. Continue resumes the newest local save; Load also imports JSON. Saves stay in this browser and origin. Browser storage may be cleared, unavailable, or full; export important matches. Root and nested `/aoe1/` saves share origin storage. Pausing and hidden tabs stop simulation rather than catching up elapsed real time.

## GitHub Pages deployment

The repository default branch is `main`. `.github/workflows/pages.yml` installs from the lockfile, checks TypeScript, runs simulation tests, builds, and runs real Chromium gameplay tests before native Pages deployment. In **Settings → Pages → Build and deployment**, select **GitHub Actions**, then push to `main` or run the workflow. Pages deployment permission and the `github-pages` environment must permit deployment.

```sh
npm run build
node scripts/package-pages.mjs
# Optional local production check:
node scripts/package-pages.mjs --serve
# In a second terminal, while that server runs:
npm run profile
```

Vite uses relative asset URLs. The Pages artifact serves the same game at the project root and nested `aoe1/` directory. Both roots include LICENSE and ASSETS.md attribution files.

- Canonical endpoint: **https://vudh1.github.io/aoe1/** (lowercase).
- Nested compatibility path: `https://vudh1.github.io/aoe1/aoe1/`.
- Repository: `https://github.com/vudh1/aoe1`.

The repository was renamed from `REA_AoE1` to exactly `aoe1`. GitHub Pages now reports the lowercase canonical URL, and Git remotes use the renamed repository. Relative asset paths support both artifact roots. Existing browser saves stay on the same `vudh1.github.io` origin. Redeploy the Pages workflow after a rename; the previous path can remain in browser or CDN caches briefly.

The published pre-upgrade game was tested in Chromium with normal TLS verification: finite wood gathering/deposit, construction/training/group movement, conquest, custom/tutorial, pause and save/reload all worked without missing assets or uncaught exceptions. See [live-site test notes](docs/LIVE-TEST.md) for that baseline and subsequent canonical-site validation.

## Cost and limits

Hosting assumes a public repository eligible for free GitHub Pages and standard GitHub Actions usage within GitHub's published limits. No billing, paid runner, custom domain, database, external AI, paid library, or asset subscription is introduced. Hosting bandwidth, storage, build-time quotas, and service availability still apply. If free limits are exceeded, reduce usage or wait for renewal; the project never provisions a paid fallback. Development tools, hardware, internet, electricity, and Codex use are separate from the delivered game's operating requirements.

## Documentation and licenses

- [Architecture and simulation invariants](docs/ARCHITECTURE.md)
- [Asset and dependency manifest](docs/ASSETS.md)
- [Performance measurements, targets, and limitations](docs/PERFORMANCE.md)

Source and original artwork/audio use the [Apache License 2.0](LICENSE). Dawn of Kingdoms is an independent game inspired by historical themes and classic RTS mechanics; it is not an official Age of Empires release and contains no commercial-game assets.

## Release scope and limitations

This release focuses on single-player land skirmishes with mouse, keyboard and phone touch controls. Water is decorative and impassable; there are no naval units, multiplayer, in-match diplomacy changes, campaign, or cloud saves. World art uses original cached Canvas sprites with ancient courtyard buildings, worker tool animations and visible cargo. Thirty-six original painted inventory illustrations are bundled locally; the catalog shows actual costs, prerequisites and availability. Sound uses synthesized Web Audio. Balance and the target 20–40 minute match duration need player feedback. The final headless software-renderer measurements miss the frame-rate targets. Low/Auto graphics reduce cosmetic cost; Custom Game offers Small maps, one rival, and a 50-person cap for smaller matches. Representative integrated-GPU desktop and 30-minute real-time browser measurements remain required. No universal 60 FPS guarantee is made.
