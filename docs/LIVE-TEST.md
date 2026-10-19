# Published game verification

Run the same browser smoke checks against the public GitHub Pages site:

```bash
npm ci
node scripts/live-smoke.mjs
```

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
exceptions, failed HTTP assets, and mobile control bounds. The four screenshot
files are `dawn-live-menu.png`, `dawn-live-game.png`,
`dawn-live-mobile-menu.png`, and `dawn-live-mobile-game.png`.

## What the checks prove

- Both published entry paths start the actual packaged game.
- Real menus launch a configured match and the tutorial.
- Mouse selection and contextual orders gather finite timber and physically
  deposit it. Construction, unit production, Shift selection, movement, and
  combat affect the simulation.
- Pause freezes simulation. A browser-local save survives a real page reload.
- A 390 × 844 touch viewport can enter a match; the report measures the available
  HUD and command space and attempts native touch selection.
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
menu interaction produced no uncaught browser exceptions.

At 390 × 844, the original HUD had a serious layout defect: the pause button
ended at x = 502.7, outside the viewport, while the command column collapsed to
0 px. The original input implementation also relied on right-click for orders
and provided no touch command gesture. These findings justify responsive HUD
and touch-order regression checks; desktop-only startup does not establish
phone playability.
