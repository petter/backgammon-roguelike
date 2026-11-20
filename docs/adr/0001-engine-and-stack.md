# ADR 0001: Engine and stack

- Status: accepted
- Date: 2026-11-20

## Context

Backgammon roguelike: core loop is backgammon (get all pieces home), plus drawing and playing cards each turn.

Constraints:

- Playable in the browser.
- Code-only workflow. No editor-driven development (scene editors, inspectors).
- Gameplay is 2D, but effects should feel 3D: board shake, pieces hopping, card slams.

## Decision

Three.js + TypeScript + Vite. Real 3D scene, mostly fixed top-down camera.

| Concern | Choice |
| --- | --- |
| Language | TypeScript |
| Build / dev server | Vite |
| Rendering | Plain `three` (no React Three Fiber) |
| Tweens / juice | GSAP |
| Physics | None at first; tween hops. Rapier later only if real dice tumbling is wanted |
| UI (hand, card picks, shop, menus) | DOM/CSS overlay to start |
| Tests | Vitest |

## Architecture

- Pure TS game core: state, rules, legal moves, card effects, seeded RNG. No rendering imports; runs headless.
- Core emits events (`pieceMoved`, `cardPlayed`, `hit`). Renderer queues animations from them.
- Enables run seeds, replays, AI opponents, balance sims.

## Why 3D instead of faked 2D

- Shake, hops, dice tumbles and card slams are cheap in 3D: move the camera or the meshes; lighting, shadows and parallax come free.
- In 2D each effect is hand-faked (scale tricks, fake shadows, skew). Cost grows with every new card effect.
- Board logic stays 2D (24 points, bar, home). Slight camera tilt and low FOV keep it reading as a board game.
- Assets are primitives: cylinders, boxes, cubes. No modelling pipeline.

## Alternatives rejected

- **Unity**: editor effectively mandatory (scenes and prefabs are GUID-laden YAML), heavy web builds, slow export-and-test loop. Its strengths go unused here.
- **Godot**: closest contender, and scenes are text, but the engine's grain is the editor. Large wasm payload on web. GDScript has weaker typing and test tooling than TS for a rules-heavy game.
- **Babylon.js**: code-only and viable, but heavier than needed.
- **PixiJS / Phaser**: only if flat sprite art with limited 3D feel were acceptable.
- **Rust + Bevy**: code-only, but slow compiles, bigger wasm, immature UI.

## Consequences

- No export step: dev build is what ships. Sub-second hot reload.
- Game core testable headless, including bulk run simulations.
- No visual editors for particles, shaders or animation timelines; all authored in code.
- Desktop/Steam release remains possible by wrapping in Tauri or Electron.

## Revisit if

- Primary target becomes Steam or consoles, with browser secondary.
- Visual editors for particles, shaders or animation become necessary.
- The game needs heavy 3D content (characters, environments).
