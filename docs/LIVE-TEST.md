# Published game verification

Run the same browser smoke checks against the public GitHub Pages site:

```bash
npm ci
node scripts/live-smoke.mjs
```

The default target is `https://vudh1.github.io/aoe1/`.

Published build `b44c9c3` passed all 11 smoke checks at that address with
`LIVE_REQUIRE_TOUCH=1`, Chromium 154, and normal HTTPS certificate verification.

Set `LIVE_URL` to test another deployed address or a local Pages package. The
target must end in the deployment directory, for example
`LIVE_URL=http://127.0.0.1:4173/`. The script checks that directory and its nested
`aoe1/` entry. Set `LIVE_OUTPUT` to change the artifact directory (default `/tmp`).
Use `LIVE_REQUIRE_TOUCH=1` to require usable phone controls as well as record the
mobile layout survey.

The script runs real Chromium, preserves HTTPS certificate verification, and
uses an existing `HTTPS_PROXY`/`HTTP_PROXY` for remote targets when supplied. It
uses `/usr/bin/chromium` when available; otherwise install Playwright Chromium or
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. In a managed network, Chromium must
trust the environment's provided proxy CA. Configure that trust using the
environment's supported browser trust process; do not disable certificate or
hostname verification. Proxy credentials and CA material are never written into
the repository or report.

The report, `dawn-live-report.json`, records each result, browser version, runtime
exceptions, failed HTTP assets, and mobile control bounds. Screenshot files are
`dawn-live-menu.png`, `dawn-live-game.png`, `dawn-live-inventory.png`,
`dawn-live-mobile-menu.png`, and `dawn-live-mobile-game.png`.

## What the checks prove

- Both published entry paths start the actual packaged game.
- Real menus launch a configured match and the tutorial.
- A quick skirmish creates an allied settlement and an enemy settlement. Their
  original workers move, collect finite resources, and deposit them without any
  player orders. Contextual commands cannot attack or damage allied workers.
- Mouse selection and contextual orders gather finite timber and physically
  deposit it. Construction, unit production, Shift selection, movement, and
  combat affect the simulation.
- Pause freezes simulation. A browser-local save survives a real page reload.
- The illustrated selection portrait and all 37 inventory cards decode their
  bundled atlas. Available and age-locked units show their current requirements.
- A 390 × 844 touch viewport can enter a match; the report measures the available
  HUD and command space and attempts native touch selection and movement.
- No tested page produces an uncaught exception or a missing HTTP asset.

The economy checks accelerate ordinary simulation ticks after issuing real
pointer orders. The conquest check creates a small combat fixture through the
documented `__DAWN__` development interface; it tests hit detection, damage,
elimination, and the result screen without claiming a completed normal AI match.
This is a functional and layout check, not a performance benchmark or a test on
physical iPhone hardware.

## Initial published-site findings

The original deployment at `https://vudh1.github.io/REA_AoE1/` and its nested
`aoe1/` path returned HTTP 200 and started successfully in Chromium 154, with
HTTPS verification enabled. At a desktop viewport of 1440 × 900, startup and
menu interaction produced no uncaught browser exceptions. The initial smoke
suite also passed real-pointer timber gathering and drop-off (wood increased
from 240 to 300), construction, unit training, group movement, conquest, custom
settings, tutorial, pause, and local-save reload. No requested game asset failed
to load. The report's mobile entry was a survey, not a claim of phone playability.

At 390 × 844, the original HUD had a serious layout defect: the pause button
ended at x = 502.7, outside the viewport, while the command column collapsed to
0 px. The original input implementation also relied on right-click for orders
and provided no touch command gesture. These findings justify responsive HUD
and touch-order regression checks; desktop-only startup does not establish
phone playability.

## Improved build validation

All 10 Playwright browser tests passed against the production Pages package,
including both entry paths, real desktop economy and combat controls, autonomous
enemy and allied workers, friendly-fire protection, all illustrated catalog
cards, pause, and save restoration. The phone regression uses native touch to
select and move a villager, swipe the camera without accidentally issuing an
order, place and complete a house, and open Pause. The pause button stays inside
the 390 × 844 viewport and the command panel retains usable width.

Playwright preserves the managed environment's existing proxy bypasses and adds
`127.0.0.1` and `localhost` for its local web-server readiness checks. Without
that bypass, a proxy-generated response could be mistaken for an already
running local server. A fresh-server startup check passed with the normal
`npm run test:browser` command after this configuration fix.

## Canonical deployment result

The deployed game loaded `index-Cd3PxM_v.js`, `index-BQCUhrrg.css`, and the
1254 × 1254 illustrated atlas with HTTP 200 at both the canonical address and
its nested `aoe1/` entry. All 11 live checks passed with zero uncaught browser
exceptions and zero failed game assets.

The untouched enemy and allied settlements moved their original workers and
physically deposited 270 and 280 resources, respectively, during the autonomy
check. A real player timber order increased the wood stockpile from 240 to 290.
Construction, training, group movement, combat, allied-unit protection, custom
settings, tutorial, pause, and save restoration also passed. All 37 inventory
cards displayed a decoded atlas; the available Villager and age-locked Heavy
Infantry showed the expected availability.

At 390 × 844, native touch selected a villager, issued a movement command, and
reached the touched destination. The command panel measured 264 px wide and the
44 × 44 pause button remained inside the viewport. A separate fresh-page check
confirmed the brand stayed within the header (y = 11.5–39.5 inside y = 0–99),
above the match ribbon (y = 106–136).

The local artifacts are `.local/live/dawn-live-report.json`,
`.local/live/dawn-live-game.png`, `.local/live/dawn-live-inventory.png`,
`.local/live/dawn-live-mobile-game.png`, and
`.local/live/live-phone-header.png`. These generated files are ignored by Git.
The report includes successful asset URLs so a future verification can identify
which deployed bundle it actually exercised. This result covers Chromium with
touch emulation; it does not claim testing on physical iPhone Safari.
