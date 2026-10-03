# Transitions: Design

**Date:** 2026-10-03
**Status:** Approved (pending spec review)
**Builds on:** `2026-10-03-rcut-design.md`

## Goal

RCut gets professional video transitions between clips: a curated pack of about 30, including a gaming-oriented set. Transitions sit on cuts in the timeline, can be adjusted, and render identically in preview and export.

## Non-goals

- Extracting assets from proprietary editors (CapCut, Premiere, Resolve). Their transitions are proprietary and their terms forbid it.
- Audio crossfades/transitions (separate future feature).
- Transitions between clips on different tracks, or across gaps.
- Overlay/video-file transitions (light leaks, film burns as stock clips).
- Porting all 125 gl-transitions.
- Animated hover previews in the Transitions tab (static thumbnails in v1).

## Sources and licensing (verified 2026-10-03)

- **gl-transitions** (`github.com/gl-transitions/gl-transitions`): the repo is MIT-licensed and has 125 transitions in GLSL.
  - Each file declares its own license: 123 are MIT and 2 are BSD.
  - Ported shaders keep their author and license header.
  - `THIRD_PARTY_NOTICES.md` at the repo root lists every ported transition with its author and license.
- **Custom RCut shaders** are written for this project and have no third-party license.
- **Excluded:** Shadertoy, whose default license is CC BY-NC-SA 3.0, and any proprietary app assets.

## Behavior

- **Placement**
  - A transition sits on a **cut**, meaning two clips on the same video track (main or overlay) where clip A's end equals clip B's start.
  - Clips do not move, and the project duration does not change.
- **Timing**
  - With duration `d` and cut time `c`, the transition covers `[c − d/2, c + d/2]`, and `progress = (t − (c − d/2)) / d`, going from 0 to 1.
  - Clip A runs past its out point into its spare source footage (`trimEnd` handle).
  - Clip B starts before its in point using its `trimStart` handle.
  - If a clip has less spare footage than `d/2`, the missing part shows that clip's edge frame, held still.
- **Default and limits**
  - Default duration is 0.5 s.
  - Duration is clamped to `[0.1 s, min(durationA, durationB)]`.
- **Adding**
  - Drag a transition from the Transitions tab onto a cut. A valid cut highlights while hovering.
  - Or, with a clip selected, click a transition to apply it to that clip's outgoing cut. If there is no outgoing cut, the incoming one is used; if neither exists, a toast explains.
  - A cut has at most one transition. Applying a new one replaces the existing one.
- **Editing**
  - Selecting the transition block on the timeline shows **Duration** and the transition's own options in the Properties panel, e.g. direction, softness or intensity.
  - The Delete key removes it.
  - All changes go through the command system, so they support undo and redo.
- **Cleanup**
  - When an edit breaks a cut, its transition is removed in the same command. Examples: clip moved or deleted, gap created, or a trim that makes the clips no longer adjacent.
  - When an edit shortens a clip below the transition duration, the duration is clamped.
- **Audio:** unchanged; clips' audio still switches at the cut.
- **Export:** uses the same renderer, so transitions are included automatically.

## Transition pack (~31)

| Group | Transition | Source |
| --- | --- | --- |
| Basic | Crossfade | gl `fade` |
| Basic | Dip to Black / Dip to White | gl `fadecolor` (color param) |
| Basic | Slide (4 directions) | gl `Slides` / custom |
| Basic | Push | gl `x_axis_translation` / custom |
| Basic | Zoom In/Out | gl `zoomInOut` |
| Basic | Wipe (4 directions) | gl `wipeLeft`/`wipeRight`/`wipeUp`/`wipeDown` as one shader with a direction param |
| Basic | Circle / Iris | gl `circleopen` |
| Cinematic | Cross Zoom | gl `CrossZoom` |
| Cinematic | Dreamy Zoom | gl `DreamyZoom` |
| Cinematic | Linear Blur | gl `LinearBlur` |
| Cinematic | Film Burn | gl `FilmBurn` |
| Cinematic | Overexposure | gl `Overexposure` |
| Cinematic | Swirl | gl `Swirl` |
| Cinematic | Cube | gl `cube` |
| Cinematic | Page Curl | gl `InvertedPageCurl` |
| Cinematic | Crosswarp | gl `crosswarp` |
| Gaming | Glitch Displace | gl `GlitchDisplace` |
| Gaming | Glitch Memories | gl `GlitchMemories` |
| Gaming | Datamosh Strip | gl `StripDatamoshGlitch` |
| Gaming | Parametric Glitch | gl `parametric_glitch` |
| Gaming | Doom Melt | gl `DoomScreenTransition` |
| Gaming | Lost Signal | gl `old_tv_lost_signal` |
| Gaming | TV Static | gl `TVStatic` |
| Gaming | Pixelize | gl `pixelize` |
| Gaming | Block Dissolve | gl `BlockDissolve` |
| Gaming | RGB Split Slam | custom |
| Gaming | Whip Pan (4 directions) | custom |
| Gaming | Zoom Punch | custom |
| Gaming | Spin Blur | custom |
| Gaming | Shake Hit | custom |

The final list may change during porting if a shader doesn't translate well; any replacement goes to the user for approval.

## Design

### 1. Renderer build (one-time)

- Restore `rust/`, the root `Cargo.toml` and `Cargo.lock` from commit `cf5e79e9`. That commit is the source of the `opencut-wasm` 0.2.10 package the app uses today.
- Toolchain:
  - `rustup target add wasm32-unknown-unknown`
  - install `wasm-pack`
- Avoid the Cargo workspace conflict with `apps/desktop/src-tauri`, which was the original reason for deleting the root `Cargo.toml`. Either keep the workspace inside `rust/`, or add `apps/desktop/src-tauri` to `exclude`; the plan decides after inspecting.
- Build `rust/wasm` with `wasm-pack build --target bundler`.
- Make the web app consume the local build through a workspace/file dependency instead of the npm `opencut-wasm` package. The package name `opencut-wasm` stays.
- Root script `build:wasm`. `build:web` depends on an up-to-date wasm build.
- Gate: the existing tests, a preview check and an export check all behave as before, before any transition work starts.

### 2. Transition GPU pipeline (Rust)

- New crate `rust/crates/transitions`, alongside `effects`.
- `TransitionPipeline::apply({ from, to, width, height, shader, progress, uniforms })` renders one full-screen pass.
- The pass binds `from` and `to` textures, a sampler, and a uniform buffer: progress, aspect ratio, and the transition params.
- Shaders are WGSL files in `rust/crates/transitions/src/shaders/`, one per transition. A shared prelude provides `getFromColor(uv)`, `getToColor(uv)`, `progress` and `ratio`, so ports stay close to the GLSL originals.
- Shader IDs are kebab-case strings, e.g. `"glitch-displace"`. Unknown IDs return an error.
- The Rust compositor gains a `transition` frame item: `{ shader, progress, params, fromItems, toItems }`. It composites each side's items onto a transparent texture, runs the transition shader, and blends the result into the scene. This means no extra JS↔GPU copies and no separate WASM export. A standalone export can be added later if thumbnails need it.

### 3. Timeline data (TypeScript)

- `VideoTrack` gains `transitions: TrackTransition[]`, where `TrackTransition = { id, fromElementId, toElementId, type, duration: MediaTime, params: ParamValues }`.
- A storage migration adds `transitions: []` to existing projects.
- Pure functions in `apps/web/src/transitions/`, all unit-tested:
  - `findCuts({ track })` returns adjacent element pairs.
  - `getTransitionWindow({ transition, track })` returns `{ start, end }`.
  - `getActiveTransition({ track, time })`
  - `reconcileTransitions({ track })` drops transitions whose cut is gone and clamps durations.
  - `getHandleTimes(...)` returns the source time for A and B at time `t`, held still at the source edges.
- Transition definitions live in `apps/web/src/transitions/definitions/`, mirroring `effects/definitions/`: `{ type, name, group, keywords, shader, params, defaultDuration }`, plus a registry.
- `reconcileTransitions` runs inside existing element move/trim/delete commands. New commands handle add, update and remove transition.

### 4. Renderer integration (TypeScript)

- In `services/renderer`, when a track has an active transition at time `t`, scene building emits a `TransitionNode` instead of the two element nodes for that window.
- The `TransitionNode` renders A at its handle time and B at its handle time, each to an offscreen canvas, using the existing element rendering.
- It then calls `applyTransition` and composites the result where the clips would have been drawn.
- The blur background (`background.type === "blur"`) uses the transition output as its source during the window.

### 5. UI

- **Transitions tab** (`components/editor/panels/assets`): it replaces the placeholder with a grouped grid (Basic / Cinematic / Gaming) and search. Each tile shows the name and a static thumbnail, rendered once by the transition shader at progress 0.5 on two built-in sample images and cached.
- **Timeline:** a drop target on cuts and a transition block straddling the cut, which is selectable, deletable and can be dragged to change its duration.
- **Properties panel:** Duration plus the definition's params, using the existing param controls.

## Phases (each independently testable)

1. **Renderer build:** restore the source, set up the toolchain, build locally, and run the parity gate.
2. **Pipeline + first 3:** the Rust transition crate, the `applyTransition` WASM export, the data model, the pure timing functions, the renderer integration, and Crossfade, Whip Pan and Glitch Displace. Verified with a test project, where transitions are added through a dev-only helper or a minimal command, in both preview and export.
3. **Timeline UI:** the Transitions tab, drop on cut, the block, the properties panel, and undo/redo.
4. **Rest of the pack:** port and add the remaining transitions in batches, with the user reviewing each batch visually.

## Testing

- **Rust:** every transition shader compiles. Validate the WGSL with `naga` in a unit test over the shader directory. Uniform layout tests cover the pipeline.
- **bun:test:** `findCuts`, the transition window and progress, handle-time clamping (no spare footage → held still), `reconcileTransitions` on move, delete, trim and gap, duration clamping, and the migration.
- **Manual in `rcut.exe`:**
  - every transition in preview;
  - an exported MP4 containing transitions;
  - a clip with no spare footage;
  - undo/redo;
  - the blur background during a transition;
  - a transition on an overlay track.

## Risks

- **GLSL→WGSL porting:** some shaders use GLSL-only idioms such as `mod` semantics, integer loops and `texture` LOD. Each port is checked visually, and shaders that don't translate cleanly are swapped for others, with user approval.
- **Restoring the Rust workspace:** a root Cargo workspace previously conflicted with the Tauri crate, and Phase 1 must resolve this cleanly.
- **Rendering cost:** two clips plus a transition pass per frame during transitions. This is acceptable at 1080p on the user's GPU and is measured in Phase 2 with the CDP profiling approach used for the playback fix.
