# Animations (In / Out / Combo) + Keyframe Tools: Design

**Date:** 2026-10-06
**Status:** Design approved by the user, section by section.
**Roadmap:** inserted before #3 (audio) at the user's request. Freeze frame moves to #4 (Pro editing tools).

## Goal

Add CapCut-style one-click animations to every visual clip and to text boxes:
- **In** plays at the clip's start.
- **Out** plays at the clip's end.
- **Combo** loops for the whole clip.

Also make keyframing quicker with two tools:
- a **keyframe-all** diamond for transform properties;
- **previous/next keyframe** navigation.

## Non-goals

- Per-letter text animation (typewriter, word pop). That comes with animated captions (#8).
- Animating blur, colour or other effect parameters from presets. Presets touch transform and opacity only.
- Freeze frame and reverse. Both move to #4.
- Baking presets into keyframes.

## Current state (verified 2026-10-06)

- **Keyframes** are stored per element in `animations` channels (`apps/web/src/animation/`). Paths include `transform.positionX`/`positionY`/`scaleX`/`scaleY`/`rotate` and `opacity`. Interpolation can be linear, hold or bezier, and there's a graph editor (`timeline/components/graph-editor/`).
- **Render resolution** of transform and opacity happens in `services/renderer/resolve.ts`, at two sites: around lines 180–190 for media sources and around 368–373 for text/graphics. Both call `resolveTransformAtTime` and `resolveOpacityAtTime`.
- **Transform conventions:**
  - Position is in canvas pixels, relative to the centre; +y is down (`centerY = height/2 + position.y`).
  - Scale is a factor.
  - Rotate is in degrees.
- **Other callers.** Preview handles, bounds and the text edit overlay also call `resolveTransformAtTime`. These stay preset-free.
- **Shortcuts already taken:**
  - playback: space/k (play), j/l (seek), left/right, shift+left/right, home/enter, end;
  - editing: s (split), q/w (split-left/right), n (snapping);
  - ctrl shortcuts.
- **Free:** `[` and `]`.

## Design

### 1. Data

Visual elements (video, image, sticker, graphic, text) gain an optional field:
```ts
interface ElementMotion {
	in?: { preset: InPresetId; duration: number };    // seconds
	out?: { preset: OutPresetId; duration: number };  // seconds
	combo?: { preset: ComboPresetId; speed: number }; // 0.25–4, default 1
}
// on the element: motion?: ElementMotion
```

- In and Out default to a duration of 0.5 s. The UI range is 0.1–3 s.
- A missing `motion` field means no animation. Old projects are unchanged, so no migration is needed.

### 2. Maths

All of this is pure TypeScript in `apps/web/src/motion/` and unit-tested.

**The delta.** Each preset returns a delta: `{ dx, dy, scale, rotate, opacity }`. The identity is `{ 0, 0, 1, 0, 1 }`. The variables used below:
- `W` and `H` are the canvas width and height in pixels.
- `mix(a, b, t) = a + (b − a)·t`.

**Phases.** With a clip of duration `D` seconds and local time `t`:
- `inDur` and `outDur` are clamped to `D`.
- If `inDur + outDur > D`, both are scaled by `D / (inDur + outDur)`.
- In progress is `p = clamp(t / inDur, 0, 1)`. It applies only while `t < inDur`; otherwise In is identity.
- Out progress is `q = clamp((t − (D − outDur)) / outDur, 0, 1)`. It applies only while `t > D − outDur`.
- Combo phase is `φ = 2π · t · speed / 2`, so one cycle lasts 2 s at speed 1.

**Easing.**
- In uses `e = 1 − (1 − p)³` (ease-out).
- Out uses `e = q³` (ease-in).
- `backOut(p) = 1 + 2.70158·(p − 1)³ + 1.70158·(p − 1)²`.
- `backIn(q) = 2.70158·q³ − 1.70158·q²`.
- `bounceOut` is the standard Penner bounce.

**In presets** (`p`, `e`). Each one is identity at `p = 1`.

| id | delta |
| --- | --- |
| `fade-in` | `opacity = e` |
| `zoom-in` | `scale = mix(0.6, 1, e)`, `opacity = min(1, 2p)` |
| `zoom-out` | `scale = mix(1.4, 1, e)`, `opacity = min(1, 2p)` |
| `slide-left` | `dx = mix(−W, 0, e)` (enters from the left) |
| `slide-right` | `dx = mix(W, 0, e)` |
| `slide-top` | `dy = mix(−H, 0, e)` |
| `slide-bottom` | `dy = mix(H, 0, e)` |
| `spin-in` | `rotate = mix(−180, 0, e)`, `scale = mix(0.3, 1, e)`, `opacity = min(1, 2p)` |
| `pop` | `scale = max(0, backOut(p))`, `opacity = min(1, 3p)` |
| `drop` | `dy = mix(−0.25H, 0, bounceOut(p))`, `opacity = min(1, 3p)` |

**Out presets** (`q`, `e`). Each one is identity at `q = 0`.

| id | delta |
| --- | --- |
| `fade-out` | `opacity = 1 − e` |
| `zoom-in` | `scale = mix(1, 1.4, e)`, `opacity = 1 − e` |
| `zoom-out` | `scale = mix(1, 0.6, e)`, `opacity = 1 − e` |
| `slide-left` | `dx = mix(0, −W, e)` (exits to the left) |
| `slide-right` | `dx = mix(0, W, e)` |
| `slide-top` | `dy = mix(0, −H, e)` |
| `slide-bottom` | `dy = mix(0, H, e)` |
| `spin-out` | `rotate = mix(0, 180, e)`, `scale = mix(1, 0.3, e)`, `opacity = 1 − e` |
| `pop-out` | `scale = max(0, 1 − backIn(q))`, `opacity = 1 − q` |

**Combo presets** (`φ`). Each one is periodic.

| id | delta |
| --- | --- |
| `pulse` | `scale = 1 + 0.06·sin φ` |
| `sway` | `rotate = 6·sin φ` |
| `shake` | `dx = 0.01W·sin 7φ`, `dy = 0.01H·sin 11φ` |
| `float` | `dy = 0.02H·sin φ` |
| `wobble` | `rotate = 4·sin 2φ`, `scale = 1 + 0.03·sin φ` |

**Composition.** `applyMotion({ transform, opacity, motion, localTime, duration, canvas })` combines the In, Out and Combo deltas with the keyframed values:
- position: `x += Σdx` and `y += Σdy`;
- scale: `scaleX` and `scaleY` are each multiplied by `Πscale`;
- rotate: `rotate += Σrotate`;
- opacity: `opacity ×= Πopacity`.

**Where it applies.** Only the two render sites in `services/renderer/resolve.ts` call it, so preview and export match. Preview handles, bounds and the text edit overlay keep the preset-free transform.

### 3. UI

**Animation tab in Properties** (`components/editor/panels/properties/`). It's registered for video, image, sticker, graphic and text elements, with its own tab icon.
- **Segmented control:** In | Out | Combo.
- **Preset grid:** a **None** tile first, then the group's presets as labelled tiles. The selected tile is highlighted.
- **Sliders:** Duration (0.1–3 s, step 0.05) for In and Out; Speed (0.25–4, step 0.05) for Combo. These use the existing slider + number field.
- **Changes:** go through the element preview/commit path (`useElementPreview`), so each choice and each slider release is one undo step.
- **Auto-play on pick:**
  - In plays from the clip start for `inDur + 0.3` s.
  - Out plays from `end − outDur − 0.3` s to the end.
  - Combo plays for 2 s.

  Playback pauses afterwards and the playhead returns to where it was.

**Timeline hint:** a clip with In or Out shows a translucent band at its start or end, as wide as the animation.

**Keyframe tools** go in the Transform section header of the element params tab:
- **◇ Keyframe-all.** It works on `transform.positionX`, `positionY`, `scaleX`, `scaleY`, `rotate` and `opacity` at the playhead.
  - **Icon state:** filled when all six have a keyframe there, half when only some do, empty when none do.
  - **Click when all six have one:** removes all six keyframes, as one undo step.
  - **Click otherwise:** adds the missing keyframes, using the current resolved keyframed values so nothing moves, as one undo step.
- **‹ › buttons.** They jump the playhead to the selected element's previous or next keyframe time, across all of its animation channels.
  - Shortcuts: **`[`** (previous) and **`]`** (next), registered as actions so they show in the shortcuts help.
  - The buttons are disabled when there is no keyframe in that direction.

### 4. Edge cases

- **Trim:** Out follows the new end, because it's computed from the current duration.
- **Split:**
  - the left half keeps `in` and `combo` and drops `out`;
  - the right half keeps `out` and `combo` and drops `in`.
- **Clips inside transitions:** both sides use the same resolve path, so presets apply.
- **Duration 0 or invalid:** treated as no animation for that slot.

## Testing

**bun:test**
- Every In preset is identity at `p = 1`. Every Out preset is identity at `q = 0`.
- Fade and slide presets are monotonic.
- The overlap squeeze.
- Combo is periodic: `t` and `t + 2/speed` give the same result.
- Composition with a keyframed transform.
- Keyframe-all decisions: all → remove, some → add the missing ones, none → add all.
- Previous/next keyframe lookup across channels.
- Splitting copies `motion` correctly.

**Manual, in `rcut.exe`, over CDP**
- Preview screenshots at In and Out midpoints show the expected motion: Fade In opacity, a Slide offset.
- An exported MP4 frame shows the same thing.
- A Combo clip moves over time.
- Keyframe-all followed by `]` / `[` lands on its keyframe.
