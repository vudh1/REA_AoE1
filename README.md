# Dawn of Kingdoms

An original, single-player ancient-world browser RTS. One human civilization faces up to three local computer opponents. The entire game runs in the browser: economy, construction, pathfinding, fog, combat, research, procedural artwork, and synthesized audio. It has no backend, account, telemetry, paid API, or required runtime network service.

## Play and develop

Use Node.js 22 and npm. Dependencies are development tools; the production game has no runtime package dependencies.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Quick Skirmish starts one human versus one AI. Custom Skirmish changes seed, map, opponents, civilization, difficulty, resources, population, speed, and peaceful sandbox. Tutorial uses the same simulation. Desktop mouse and keyboard are the primary controls.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run soak -- --minutes=30
```

Browser tests use `/usr/bin/chromium` when present. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another installed executable, or `PLAYWRIGHT_USE_BUNDLED_CHROMIUM=1` to use Playwright's downloaded version. CI installs its matching Chromium and required Linux libraries.

Before the environment recovery, the simulation suite passed 78 tests across 5 files, the production Chromium gameplay suite passed 6 tests, and frozen-lock installation/type checking/build passed. These are historical results; restored-code validation and the optimized-renderer measurements are pending. See [the performance report](docs/PERFORMANCE.md) for evidence and limitations.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag | Select one / box-select units |
| Shift + left click | Add or remove selection |
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

- Intended repository URL: `https://vudh1.github.io/REA_AoE1/`
- Project subpath: `https://vudh1.github.io/REA_AoE1/aoe1/`

The separately requested `https://vudh1.github.io/aoe1/` belongs to another GitHub project path. A deployment from `REA_AoE1` cannot claim that sibling route. To use that exact URL, publish the static artifact from a repository named `aoe1`, or add its `aoe1/` directory to the `vudh1.github.io` user-site repository. Neither repository is modified automatically.

The earlier public-site verification request returned proxy HTTP 403 and GitHub API access was forbidden. The committed workflow is deployment configuration, not evidence that a site is live. See the final handoff for any later push/deployment status.

## Cost and limits

Hosting assumes a public repository eligible for free GitHub Pages and standard GitHub Actions usage within GitHub's published limits. No billing, paid runner, custom domain, database, external AI, paid library, or asset subscription is introduced. Hosting bandwidth, storage, build-time quotas, and service availability still apply. If free limits are exceeded, reduce usage or wait for renewal; the project never provisions a paid fallback. Development tools, hardware, internet, electricity, and Codex use are separate from the delivered game's operating requirements.

## Documentation and licenses

- [Architecture and simulation invariants](docs/ARCHITECTURE.md)
- [Asset and dependency manifest](docs/ASSETS.md)
- [Performance measurements, targets, and limitations](docs/PERFORMANCE.md)

Source and original procedural artwork/audio use the [Apache License 2.0](LICENSE). Dawn of Kingdoms is an independent game inspired by historical themes and classic RTS mechanics; it is not an official Age of Empires release and contains no commercial-game assets.

## Release scope and limitations

This release focuses on desktop single-player land skirmishes. Water is decorative and impassable; there are no naval units, multiplayer, diplomacy, campaign, or cloud saves. Art and sound use compact original procedural primitives. Balance and the target 20–40 minute match duration need player feedback. The initial headless software-renderer benchmark failed the frame-rate targets; an optimized renderer is being validated. Representative integrated-GPU desktop and 30-minute real-time browser measurements remain required. Do not interpret headless results as a universal 60 FPS guarantee.
