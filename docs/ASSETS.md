# Asset and dependency manifest

No external art, fonts, sprite sheets, music, voices, maps, or commercial-game data are downloaded at runtime. Nothing has been extracted from Age of Empires or another commercial game.

| Material | Origin | License / redistribution |
| --- | --- | --- |
| Game source, interface, simulation, tests | Original repository work | Apache-2.0; see `LICENSE` |
| Terrain, unit silhouettes, buildings, icons, effects | Original Canvas drawing code | Apache-2.0 |
| `public/favicon.svg` | Original sun motif in SVG geometry | Apache-2.0 |
| Sound effects and synthesized ambience | Original Web Audio synthesis | Apache-2.0 |
| Maps | Seeded procedural generation | Apache-2.0 generator; saved maps in JSON |
| Fonts | Browser/system font stack | No font files redistributed |

There are no runtime package dependencies. Development packages retain their own licenses and are not original game assets.

| Tool | Purpose | Upstream license |
| --- | --- | --- |
| TypeScript | Strict type checking | Apache-2.0 |
| Vite | Development server/build | MIT |
| Vitest | Simulation tests | MIT |
| Playwright | Production-browser input tests | Apache-2.0 |
| tsx | TypeScript soak runner | MIT |
| Node.js type definitions | Development declarations | MIT |

See `package-lock.json` and installed license files for exact versions and transitive tooling. CI uses official GitHub checkout, setup-node, artifact, and Pages actions. Hosting remains subject to GitHub terms/free usage limits. No paid assets, APIs, telemetry, CDN font dependency, or subscription is included. LICENSE and this manifest are copied into both static Pages artifact roots.
