# Transitions Phase 3 — Editing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can browse transitions in a Transitions tab, apply one by dragging it onto a cut or by clicking it with a clip selected, see and select transition blocks on the timeline, edit duration, type and options in the Properties panel, and remove transitions with Delete. Undo and redo work throughout, and edits that break a cut clean up its transition automatically.

**Architecture:**
- **Pure editing helpers** (`transitions/edit.ts`) cover finding cuts, setting, updating and removing transitions, and reconciling transitions against the current clips. They are unit tested.
- **Every track write goes through `TimelineManager.updateTracks`**, which reconciles transitions. Any edit or undo therefore drops transitions whose cut is gone and clamps durations.
- **Undo/redo:** transition edits are `TracksSnapshotCommand`s.
- **Thumbnails** use a new WASM `applyTransition` export through a preview service that mirrors `effectPreviewService`.
- **Selection:** a selected transition lives in a small zustand store, not in the editor's element selection.

**Tech Stack:** TypeScript/React 19, zustand, Rust (wasm-bindgen) for one new export, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-03-transitions-design.md` (section 5, UI)

**Deviation from spec (approved scope cut):** duration is edited in the Properties panel, not by dragging the block's edges. Edge-dragging may come later.

## Global Constraints

- Work on branch `rcut-v1` in `D:\OpenCut`; git identity is configured.
- Every commit message ends with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Transition types and shader ids come only from `@/transitions/registry` (`TRANSITION_DEFINITIONS`, `getTransitionDefinition`, `getTransitionShaderParams`). Phase 2 shipped `crossfade`, `whip-pan` and `glitch-displace`.
- A cut means two clips on the same video track (main, or an overlay of type `video`) where `from.startTime + from.duration === to.startTime`. A cut holds at most one transition.
- Duration rules:
  - Default duration is `definition.defaultDurationSeconds`.
  - Durations are clamped to `min(fromDuration, toDuration)`.
  - Durations are stored in ticks (`MediaTime`).
  - The Properties UI shows seconds, with a minimum of 0.1 s.
- Pure modules under `apps/web/src/transitions/` (except `components/` and `actions.ts`) import only types from `@/wasm` and `@/timeline`. Importing `@/wasm` values breaks `bun test`.
- TypeScript style: tabs, double quotes, object-parameter functions, `bun:test` tests in `__tests__/`. Rust uses rustfmt defaults.
- Do NOT use `sed -i` on existing files, and do NOT write files with backslashes through shell heredocs (the shell collapses `\\`). Use file-edit tools.
- Current baseline:
  - `bun test` from repo root: 228 pass, 4 fail (pre-existing wasm-import failures).
  - `bunx tsc --noEmit` in `apps/web`: 0 errors.

---

## Task 1: Transition editing helpers + automatic reconciliation

**Files:**
- Create: `apps/web/src/transitions/edit.ts`
- Test: `apps/web/src/transitions/__tests__/edit.test.ts`
- Modify: `apps/web/src/core/managers/timeline-manager.ts` (`updateTracks`)

**Interfaces:**
- Produces:
  - `type Cut = { trackId: string; fromElementId: string; toElementId: string; time: number }`
  - `findCuts({ track }: { track: VideoTrack }): Cut[]`, ignoring hidden clips and sorted by time
  - `findCutNearTime({ track, time, tolerance }): Cut | null`, returning the nearest cut within `tolerance` ticks
  - `getElementCut({ track, elementId }): Cut | null`, preferring the clip's outgoing cut and falling back to its incoming cut
  - `getVideoTrackById({ tracks, trackId }): VideoTrack | null`
  - `setTransitionOnCut({ tracks, cut, transition }): SceneTracks`, which replaces any transition already on that cut
  - `updateTransition({ tracks, trackId, transitionId, patch }): SceneTracks`, where `patch: Partial<Pick<TrackTransition, "type" | "duration" | "params">>`
  - `removeTransition({ tracks, trackId, transitionId }): SceneTracks`
  - `reconcileTransitions({ tracks }): SceneTracks`, which returns the *same object* when nothing changes

- [ ] **Step 1: Write the failing tests**

`apps/web/src/transitions/__tests__/edit.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import type { SceneTracks, VideoElement, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	findCutNearTime,
	findCuts,
	getElementCut,
	getVideoTrackById,
	reconcileTransitions,
	removeTransition,
	setTransitionOnCut,
	updateTransition,
} from "@/transitions/edit";
import type { TrackTransition } from "@/transitions/types";

const t = (value: number) => value as MediaTime;

function clip({
	id,
	start,
	duration,
	hidden,
}: {
	id: string;
	start: number;
	duration: number;
	hidden?: boolean;
}): VideoElement {
	return {
		id,
		name: id,
		type: "video",
		mediaId: "m",
		startTime: t(start),
		duration: t(duration),
		trimStart: t(0),
		trimEnd: t(0),
		params: {},
		...(hidden ? { hidden: true } : {}),
	} as VideoElement;
}

function videoTrack({
	id = "main",
	elements,
	transitions = [],
}: {
	id?: string;
	elements: VideoElement[];
	transitions?: TrackTransition[];
}): VideoTrack {
	return { id, name: id, type: "video", elements, muted: false, hidden: false, transitions };
}

function sceneTracks({
	main,
	overlay = [],
}: {
	main: VideoTrack;
	overlay?: VideoTrack[];
}): SceneTracks {
	return { main, overlay, audio: [] };
}

const transition = (overrides: Partial<TrackTransition> = {}): TrackTransition => ({
	id: "tr",
	type: "crossfade",
	fromElementId: "a",
	toElementId: "b",
	duration: t(20),
	params: {},
	...overrides,
});

describe("findCuts", () => {
	test("returns adjacent visible pairs in time order", () => {
		const track = videoTrack({
			elements: [
				clip({ id: "c", start: 200, duration: 100 }),
				clip({ id: "a", start: 0, duration: 100 }),
				clip({ id: "b", start: 100, duration: 100 }),
				clip({ id: "d", start: 350, duration: 100 }),
			],
		});
		expect(findCuts({ track })).toEqual([
			{ trackId: "main", fromElementId: "a", toElementId: "b", time: 100 },
			{ trackId: "main", fromElementId: "b", toElementId: "c", time: 200 },
		]);
	});

	test("ignores hidden clips", () => {
		const track = videoTrack({
			elements: [
				clip({ id: "a", start: 0, duration: 100 }),
				clip({ id: "b", start: 100, duration: 100, hidden: true }),
			],
		});
		expect(findCuts({ track })).toEqual([]);
	});
});

describe("findCutNearTime", () => {
	const track = videoTrack({
		elements: [
			clip({ id: "a", start: 0, duration: 100 }),
			clip({ id: "b", start: 100, duration: 100 }),
			clip({ id: "c", start: 200, duration: 100 }),
		],
	});

	test("finds the nearest cut within tolerance", () => {
		expect(findCutNearTime({ track, time: 195, tolerance: 10 })?.toElementId).toBe("c");
		expect(findCutNearTime({ track, time: 104, tolerance: 10 })?.toElementId).toBe("b");
	});

	test("returns null outside tolerance", () => {
		expect(findCutNearTime({ track, time: 150, tolerance: 10 })).toBeNull();
	});
});

describe("getElementCut", () => {
	const track = videoTrack({
		elements: [
			clip({ id: "a", start: 0, duration: 100 }),
			clip({ id: "b", start: 100, duration: 100 }),
		],
	});

	test("prefers the outgoing cut", () => {
		expect(getElementCut({ track, elementId: "a" })?.toElementId).toBe("b");
	});

	test("falls back to the incoming cut", () => {
		expect(getElementCut({ track, elementId: "b" })?.fromElementId).toBe("a");
	});

	test("returns null for a clip without neighbours", () => {
		const lone = videoTrack({ elements: [clip({ id: "x", start: 0, duration: 10 })] });
		expect(getElementCut({ track: lone, elementId: "x" })).toBeNull();
	});
});

describe("transition edits", () => {
	const base = () =>
		sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
			}),
			overlay: [
				videoTrack({
					id: "ov",
					elements: [
						clip({ id: "x", start: 0, duration: 50 }),
						clip({ id: "y", start: 50, duration: 50 }),
					],
				}),
			],
		});

	test("setTransitionOnCut adds and replaces on the same cut", () => {
		const cut = { trackId: "main", fromElementId: "a", toElementId: "b", time: 100 };
		const once = setTransitionOnCut({ tracks: base(), cut, transition: transition({ id: "1" }) });
		const twice = setTransitionOnCut({
			tracks: once,
			cut,
			transition: transition({ id: "2", type: "whip-pan" }),
		});
		expect(twice.main.transitions).toEqual([transition({ id: "2", type: "whip-pan" })]);
	});

	test("setTransitionOnCut works on overlay video tracks", () => {
		const cut = { trackId: "ov", fromElementId: "x", toElementId: "y", time: 50 };
		const result = setTransitionOnCut({
			tracks: base(),
			cut,
			transition: transition({ fromElementId: "x", toElementId: "y" }),
		});
		expect(getVideoTrackById({ tracks: result, trackId: "ov" })?.transitions).toHaveLength(1);
		expect(result.main.transitions).toEqual([]);
	});

	test("updateTransition patches fields", () => {
		const tracks = sceneTracks({ main: { ...base().main, transitions: [transition()] } });
		const result = updateTransition({
			tracks,
			trackId: "main",
			transitionId: "tr",
			patch: { duration: t(40), params: { strength: 0.5 } },
		});
		expect(result.main.transitions?.[0]).toEqual(
			transition({ duration: t(40), params: { strength: 0.5 } }),
		);
	});

	test("removeTransition removes by id", () => {
		const tracks = sceneTracks({ main: { ...base().main, transitions: [transition()] } });
		expect(removeTransition({ tracks, trackId: "main", transitionId: "tr" }).main.transitions).toEqual([]);
	});
});

describe("reconcileTransitions", () => {
	test("returns the same object when nothing changes", () => {
		const tracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [transition()],
			}),
		});
		expect(reconcileTransitions({ tracks })).toBe(tracks);
	});

	test("drops transitions whose clips are no longer adjacent or missing", () => {
		const tracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 150, duration: 100 }),
				],
				transitions: [transition(), transition({ id: "gone", toElementId: "zzz" })],
			}),
		});
		expect(reconcileTransitions({ tracks }).main.transitions).toEqual([]);
	});

	test("clamps durations to the shorter clip", () => {
		const tracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 10 }),
					clip({ id: "b", start: 10, duration: 100 }),
				],
				transitions: [transition({ duration: t(50) })],
			}),
		});
		expect(reconcileTransitions({ tracks }).main.transitions?.[0].duration).toBe(t(10));
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/edit.test.ts`
Expected: FAIL, because `@/transitions/edit` cannot be resolved.

- [ ] **Step 3: Implement `apps/web/src/transitions/edit.ts`**

```ts
import type { SceneTracks, TimelineElement, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import type { TrackTransition } from "./types";

export interface Cut {
	trackId: string;
	fromElementId: string;
	toElementId: string;
	time: number;
}

function isHidden({ element }: { element: TimelineElement }): boolean {
	return "hidden" in element && element.hidden === true;
}

export function findCuts({ track }: { track: VideoTrack }): Cut[] {
	const elements = track.elements
		.filter((element) => !isHidden({ element }))
		.slice()
		.sort((a, b) => a.startTime - b.startTime);
	const cuts: Cut[] = [];
	for (let index = 1; index < elements.length; index++) {
		const from = elements[index - 1];
		const to = elements[index];
		const time = from.startTime + from.duration;
		if (time === to.startTime) {
			cuts.push({ trackId: track.id, fromElementId: from.id, toElementId: to.id, time });
		}
	}
	return cuts;
}

export function findCutNearTime({
	track,
	time,
	tolerance,
}: {
	track: VideoTrack;
	time: number;
	tolerance: number;
}): Cut | null {
	let nearest: Cut | null = null;
	for (const cut of findCuts({ track })) {
		const distance = Math.abs(cut.time - time);
		if (distance > tolerance) continue;
		if (!nearest || distance < Math.abs(nearest.time - time)) {
			nearest = cut;
		}
	}
	return nearest;
}

export function getElementCut({
	track,
	elementId,
}: {
	track: VideoTrack;
	elementId: string;
}): Cut | null {
	const cuts = findCuts({ track });
	return (
		cuts.find((cut) => cut.fromElementId === elementId) ??
		cuts.find((cut) => cut.toElementId === elementId) ??
		null
	);
}

export function getVideoTrackById({
	tracks,
	trackId,
}: {
	tracks: SceneTracks;
	trackId: string;
}): VideoTrack | null {
	if (tracks.main.id === trackId) return tracks.main;
	const overlay = tracks.overlay.find((track) => track.id === trackId);
	return overlay?.type === "video" ? overlay : null;
}

function mapVideoTrack({
	tracks,
	trackId,
	update,
}: {
	tracks: SceneTracks;
	trackId: string;
	update: (track: VideoTrack) => VideoTrack;
}): SceneTracks {
	if (tracks.main.id === trackId) {
		return { ...tracks, main: update(tracks.main) };
	}
	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.id === trackId && track.type === "video" ? update(track) : track,
		),
	};
}

export function setTransitionOnCut({
	tracks,
	cut,
	transition,
}: {
	tracks: SceneTracks;
	cut: Cut;
	transition: TrackTransition;
}): SceneTracks {
	return mapVideoTrack({
		tracks,
		trackId: cut.trackId,
		update: (track) => ({
			...track,
			transitions: [
				...(track.transitions ?? []).filter(
					(existing) =>
						!(
							existing.fromElementId === cut.fromElementId &&
							existing.toElementId === cut.toElementId
						),
				),
				{ ...transition, fromElementId: cut.fromElementId, toElementId: cut.toElementId },
			],
		}),
	});
}

export function updateTransition({
	tracks,
	trackId,
	transitionId,
	patch,
}: {
	tracks: SceneTracks;
	trackId: string;
	transitionId: string;
	patch: Partial<Pick<TrackTransition, "type" | "duration" | "params">>;
}): SceneTracks {
	return mapVideoTrack({
		tracks,
		trackId,
		update: (track) => ({
			...track,
			transitions: (track.transitions ?? []).map((transition) =>
				transition.id === transitionId ? { ...transition, ...patch } : transition,
			),
		}),
	});
}

export function removeTransition({
	tracks,
	trackId,
	transitionId,
}: {
	tracks: SceneTracks;
	trackId: string;
	transitionId: string;
}): SceneTracks {
	return mapVideoTrack({
		tracks,
		trackId,
		update: (track) => ({
			...track,
			transitions: (track.transitions ?? []).filter(
				(transition) => transition.id !== transitionId,
			),
		}),
	});
}

/** Drops transitions whose cut no longer exists and clamps durations. */
export function reconcileTransitions({ tracks }: { tracks: SceneTracks }): SceneTracks {
	let changed = false;

	const reconcileTrack = (track: VideoTrack): VideoTrack => {
		if (!track.transitions?.length) return track;
		const elementsById = new Map(track.elements.map((element) => [element.id, element]));
		const next: TrackTransition[] = [];
		for (const transition of track.transitions) {
			const from = elementsById.get(transition.fromElementId);
			const to = elementsById.get(transition.toElementId);
			if (!from || !to || from.startTime + from.duration !== to.startTime) {
				changed = true;
				continue;
			}
			const maxDuration = Math.min(from.duration, to.duration);
			if (transition.duration > maxDuration) {
				changed = true;
				next.push({ ...transition, duration: maxDuration as MediaTime });
				continue;
			}
			next.push(transition);
		}
		return next.length === track.transitions.length &&
			next.every((transition, index) => transition === track.transitions?.[index])
			? track
			: { ...track, transitions: next };
	};

	const main = reconcileTrack(tracks.main);
	const overlay = tracks.overlay.map((track) =>
		track.type === "video" ? reconcileTrack(track) : track,
	);
	return changed ? { ...tracks, main, overlay } : tracks;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/edit.test.ts`
Expected: 14 pass, 0 fail.

- [ ] **Step 5: Reconcile on every track write**

In `apps/web/src/core/managers/timeline-manager.ts`, add `import { reconcileTransitions } from "@/transitions/edit";`. In `updateTracks`, change
`this.editor.scenes.updateSceneTracks({ tracks: newTracks });`
to:
```ts
		this.editor.scenes.updateSceneTracks({
			tracks: reconcileTransitions({ tracks: newTracks }),
		});
```
`updateTracks` is the only caller of `updateSceneTracks`; confirm with `grep -rn "updateSceneTracks(" apps/web/src`.

- [ ] **Step 6: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`.
Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"` → 242 pass, 4 fail.

```bash
cd /d/OpenCut && git add apps/web/src/transitions apps/web/src/core/managers/timeline-manager.ts && git commit -q -F - <<'EOF'
feat: transition editing helpers with automatic reconciliation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Transition thumbnails (WASM export + preview service)

**Files:**
- Create: `rust/wasm/src/transitions.rs`
- Modify: `rust/wasm/src/wasm.rs`, `rust/wasm/src/gpu.rs`, `rust/wasm/Cargo.toml`
- Modify: `apps/web/src/services/renderer/gpu-renderer.ts`
- Create: `apps/web/src/services/renderer/transition-preview.ts`

**Interfaces:**
- Produces: WASM `applyTransition({ from: OffscreenCanvas, to: OffscreenCanvas, width, height, shader: string, progress: number, params: number[] }): OffscreenCanvas`.
- Produces: `gpuRenderer.applyTransition({...same}) : OffscreenCanvas | null`, which returns `null` when the GPU is unavailable.
- Produces: `transitionPreviewService.renderPreview({ type, progress, targetCanvas })` and `transitionPreviewService.onPreviewImageReady({ callback }): () => void`.

- [ ] **Step 1: Rust export**

In `rust/wasm/Cargo.toml`, add under `[dependencies]`:
```toml
transitions = { version = "0.1.0", path = "../crates/transitions" }
```

In `rust/wasm/src/gpu.rs`:
- add `use transitions::TransitionPipeline;`;
- add `pub(crate) transitions: TransitionPipeline,` to `GpuRuntime`;
- in `initialize_gpu`, create `let transitions = TransitionPipeline::new(&context);` next to `effects` and include `transitions,` in the `GpuRuntime { ... }` literal.

Create `rust/wasm/src/transitions.rs`:
```rust
#![cfg(target_arch = "wasm32")]

use gpu::wgpu;
use js_sys::Object;
use transitions::ApplyTransitionOptions;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

use crate::gpu::{
    import_canvas_texture, read_f32_property, read_offscreen_canvas_property, read_property,
    read_serde_property, read_u32_property, render_texture_to_canvas, with_gpu_runtime,
};

/// Blends `from` into `to` with a transition shader. Used for transition thumbnails.
#[wasm_bindgen(js_name = applyTransition)]
pub fn apply_transition(options: JsValue) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    let object: Object = options
        .dyn_into()
        .map_err(|_| JsValue::from_str("applyTransition expects an options object"))?;
    let from = read_offscreen_canvas_property(&object, "from")?;
    let to = read_offscreen_canvas_property(&object, "to")?;
    let width = read_u32_property(&object, "width")?;
    let height = read_u32_property(&object, "height")?;
    let shader = read_property(&object, "shader")?
        .as_string()
        .ok_or_else(|| JsValue::from_str("Property 'shader' must be a string"))?;
    let progress = read_f32_property(&object, "progress")?;
    let params: Vec<f32> = read_serde_property(&object, "params")?;

    with_gpu_runtime(|runtime| {
        let from_texture =
            import_canvas_texture(&runtime.context, &from, width, height, "transition-preview-from");
        let to_texture =
            import_canvas_texture(&runtime.context, &to, width, height, "transition-preview-to");
        let mut encoder =
            runtime
                .context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("transition-preview-encoder"),
                });
        let output = runtime
            .transitions
            .apply_with_encoder(
                &runtime.context,
                &mut encoder,
                ApplyTransitionOptions {
                    from: &from_texture,
                    to: &to_texture,
                    width,
                    height,
                    shader: &shader,
                    progress,
                    params: &params,
                },
            )
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        runtime.context.queue().submit([encoder.finish()]);
        render_texture_to_canvas(&runtime.context, &output, width, height)
    })
}
```

In `rust/wasm/src/wasm.rs`, add:
```rust
#[cfg(target_arch = "wasm32")]
mod transitions;
```
next to the other modules, and:
```rust
#[cfg(target_arch = "wasm32")]
pub use transitions::*;
```
next to the other re-exports.

Run: `cd /d/OpenCut/rust && cargo check --target wasm32-unknown-unknown -p opencut-wasm 2>&1 | tail -2 && cargo fmt --check -p opencut-wasm` → `Finished`, with no fmt output.
Run: `cd /d/OpenCut && bun run build:wasm 2>&1 | tail -1 && grep -c "export function applyTransition" rust/wasm/pkg/opencut_wasm.d.ts` → `1`.

If a `crate::gpu` helper used above is private or differently named, make it `pub(crate)` or use the real name, and report it.

- [ ] **Step 2: TypeScript wrapper**

In `apps/web/src/services/renderer/gpu-renderer.ts`, add `applyTransition as applyTransitionWasm` to the `opencut-wasm` import, and add this method to `gpuRenderer`:
```ts
	applyTransition({
		from,
		to,
		width,
		height,
		shader,
		progress,
		params,
	}: {
		from: OffscreenCanvas;
		to: OffscreenCanvas;
		width: number;
		height: number;
		shader: string;
		progress: number;
		params: number[];
	}): OffscreenCanvas | null {
		if (!gpuAvailable) {
			return null;
		}
		return applyTransitionWasm({ from, to, width, height, shader, progress, params });
	},
```

- [ ] **Step 3: Preview service**

Create `apps/web/src/services/renderer/transition-preview.ts`:
```ts
import {
	getTransitionDefinition,
	getTransitionShaderParams,
} from "@/transitions/registry";
import { createCanvasSurface } from "./canvas-utils";
import { gpuRenderer } from "./gpu-renderer";

const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 90;
const PREVIEW_IMAGE_PATH = "/effects/preview.jpg";

class TransitionPreviewService {
	private image: HTMLImageElement | null = null;
	private sources: { from: OffscreenCanvas; to: OffscreenCanvas } | null = null;
	private readyCallbacks = new Set<() => void>();

	readonly PREVIEW_WIDTH = PREVIEW_WIDTH;
	readonly PREVIEW_HEIGHT = PREVIEW_HEIGHT;

	constructor() {
		this.loadImage();
	}

	onPreviewImageReady({ callback }: { callback: () => void }): () => void {
		this.readyCallbacks.add(callback);
		return () => this.readyCallbacks.delete(callback);
	}

	renderPreview({
		type,
		progress,
		targetCanvas,
	}: {
		type: string;
		progress: number;
		targetCanvas: HTMLCanvasElement;
	}): void {
		const context = targetCanvas.getContext("2d");
		if (!context) return;
		targetCanvas.width = PREVIEW_WIDTH;
		targetCanvas.height = PREVIEW_HEIGHT;

		const sources = this.getSources();
		const definition = getTransitionDefinition({ type });
		if (!sources || !definition) {
			context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
			return;
		}

		try {
			const result = gpuRenderer.applyTransition({
				from: sources.from,
				to: sources.to,
				width: PREVIEW_WIDTH,
				height: PREVIEW_HEIGHT,
				shader: definition.shader,
				progress,
				params: getTransitionShaderParams({ definition, params: {} }),
			});
			context.drawImage(result ?? (progress < 0.5 ? sources.from : sources.to), 0, 0);
		} catch (error) {
			console.warn("Failed to render transition preview", { type, error });
			context.drawImage(sources.from, 0, 0);
		}
	}

	private loadImage(): void {
		if (typeof window === "undefined") return;
		const image = new Image();
		image.onload = () => {
			this.sources = null;
			for (const callback of this.readyCallbacks) callback();
		};
		image.src = PREVIEW_IMAGE_PATH;
		this.image = image;
	}

	private getSources(): { from: OffscreenCanvas; to: OffscreenCanvas } | null {
		if (this.sources) return this.sources;
		if (!this.image?.complete || (this.image.naturalWidth ?? 0) === 0) return null;

		const from = createCanvasSurface({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
		from.context.drawImage(this.image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

		// The incoming side is the same image mirrored and colour-shifted so the
		// transition between them is visible.
		const to = createCanvasSurface({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
		to.context.filter = "hue-rotate(150deg) saturate(1.4)";
		to.context.translate(PREVIEW_WIDTH, 0);
		to.context.scale(-1, 1);
		to.context.drawImage(this.image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

		this.sources = { from: from.canvas, to: to.canvas };
		return this.sources;
	}
}

export const transitionPreviewService = new TransitionPreviewService();
```

If `createCanvasSurface` returns different property names, follow `effect-preview.ts`'s use of it.

- [ ] **Step 4: Verify and commit**

- Run `bunx tsc --noEmit` in `apps/web`. Expected: 0 errors.
- Run `bun test`. Expected: 242 pass, 4 fail.
- Run `bun run build:web`. Expected: succeeds.

```bash
cd /d/OpenCut && git add rust apps/web/src/services/renderer && git commit -q -F - <<'EOF'
feat: render transition thumbnails via applyTransition

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Transitions tab, selection store, and click-to-apply

**Files:**
- Create: `apps/web/src/transitions/selection-store.ts`
- Create: `apps/web/src/transitions/actions.ts`
- Create: `apps/web/src/transitions/components/transitions-view.tsx`
- Modify: `apps/web/src/timeline/drag.ts` (`TransitionDragData`)
- Modify: `apps/web/src/timeline/controllers/drag-drop-controller.ts` (type narrowing only in this task)
- Modify: `apps/web/src/components/editor/panels/assets/index.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: Task 1 (`getElementCut`, `setTransitionOnCut`, `Cut`), Task 2 (`transitionPreviewService`), and the registry.
- Produces:
  - `useTransitionSelectionStore`, with state `{ selected: TransitionRef | null; select(ref); clear() }`, where `TransitionRef = { trackId: string; transitionId: string }`.
  - `addTransitionAtCut({ cut, type }): void`, which runs a command and selects the new transition.
  - `applyTransitionToSelectedClip({ type }): boolean`.
  - `updateTrackTransition({ trackId, transitionId, patch }): void`.
  - `removeTrackTransition({ trackId, transitionId }): void`.
  - `TransitionDragData { type: "transition"; id; name; transitionType: string }` in the `TimelineDragData` union.

- [ ] **Step 1: Selection store**

`apps/web/src/transitions/selection-store.ts`:
```ts
"use client";

import { create } from "zustand";

export interface TransitionRef {
	trackId: string;
	transitionId: string;
}

interface TransitionSelectionState {
	selected: TransitionRef | null;
	select: (ref: TransitionRef) => void;
	clear: () => void;
}

export const useTransitionSelectionStore = create<TransitionSelectionState>()((set) => ({
	selected: null,
	select: (ref) => set({ selected: ref }),
	clear: () => set({ selected: null }),
}));
```

- [ ] **Step 2: Actions (editor-bound, run through the command system)**

`apps/web/src/transitions/actions.ts`:
```ts
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import { EditorCore } from "@/core";
import { generateUUID } from "@/utils/id";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import type { SceneTracks } from "@/timeline";
import {
	type Cut,
	getElementCut,
	getVideoTrackById,
	removeTransition,
	setTransitionOnCut,
	updateTransition,
} from "./edit";
import { getTransitionDefinition } from "./registry";
import { useTransitionSelectionStore } from "./selection-store";
import type { TrackTransition } from "./types";

function commitTracks({ before, after }: { before: SceneTracks; after: SceneTracks }): void {
	EditorCore.getInstance().command.execute({
		command: new TracksSnapshotCommand({ before, after }),
	});
}

export function addTransitionAtCut({ cut, type }: { cut: Cut; type: string }): void {
	const definition = getTransitionDefinition({ type });
	if (!definition) return;

	const editor = EditorCore.getInstance();
	const before = editor.scenes.getActiveScene().tracks;
	const id = generateUUID();
	const after = setTransitionOnCut({
		tracks: before,
		cut,
		transition: {
			id,
			type,
			fromElementId: cut.fromElementId,
			toElementId: cut.toElementId,
			duration: Math.round(definition.defaultDurationSeconds * TICKS_PER_SECOND) as MediaTime,
			params: {},
		},
	});
	commitTracks({ before, after });
	editor.selection.clearSelection();
	useTransitionSelectionStore.getState().select({ trackId: cut.trackId, transitionId: id });
}

/** Applies a transition to the selected clip's outgoing cut (or incoming, if last). */
export function applyTransitionToSelectedClip({ type }: { type: string }): boolean {
	const editor = EditorCore.getInstance();
	const [selected] = editor.selection.getSelectedElements();
	if (!selected) return false;

	const track = getVideoTrackById({
		tracks: editor.scenes.getActiveScene().tracks,
		trackId: selected.trackId,
	});
	const cut = track ? getElementCut({ track, elementId: selected.elementId }) : null;
	if (!cut) return false;

	addTransitionAtCut({ cut, type });
	return true;
}

export function updateTrackTransition({
	trackId,
	transitionId,
	patch,
}: {
	trackId: string;
	transitionId: string;
	patch: Partial<Pick<TrackTransition, "type" | "duration" | "params">>;
}): void {
	const before = EditorCore.getInstance().scenes.getActiveScene().tracks;
	commitTracks({ before, after: updateTransition({ tracks: before, trackId, transitionId, patch }) });
}

export function removeTrackTransition({
	trackId,
	transitionId,
}: {
	trackId: string;
	transitionId: string;
}): void {
	const before = EditorCore.getInstance().scenes.getActiveScene().tracks;
	commitTracks({ before, after: removeTransition({ tracks: before, trackId, transitionId }) });
	useTransitionSelectionStore.getState().clear();
}
```
Use the real selection API names: check `core/managers/selection-manager.ts`, e.g. `getSelectedElements()` or an equivalent getter. Also check `editor.command.execute` as used in `core/managers/media-manager.ts`, and `generateUUID` from `@/utils/id`. Adapt minimally and report.

- [ ] **Step 3: Drag data type**

In `apps/web/src/timeline/drag.ts`, add:
```ts
export interface TransitionDragData extends BaseDragData {
	type: "transition";
	transitionType: string;
}
```
and add `| TransitionDragData` to `TimelineDragData`.

In `drag-drop-controller.ts`:
- Define `type ElementDragData = Exclude<TimelineDragData, TransitionDragData>;`.
- Type the element-only helpers' `dragData` parameters as `ElementDragData` (`elementTypeFromDrag`, `getTargetElementTypesForDrag`, `getDurationForDrag`, `executeAssetDrop`).
- In `onDragOver` and `onDrop`, add an early `if (dragData.type === "transition") { ...; return; }` before those helpers are called. In this task the branch only does `event.dataTransfer.dropEffect = "none"` (dragover) or returns (drop). Task 4 fills it in.

tsc must compile with no new errors.

- [ ] **Step 4: Transitions tab**

`apps/web/src/transitions/components/transitions-view.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Input } from "@/components/ui/input";
import { transitionPreviewService } from "@/services/renderer/transition-preview";
import { applyTransitionToSelectedClip } from "@/transitions/actions";
import { TRANSITION_DEFINITIONS } from "@/transitions/registry";
import type { TransitionDefinition, TransitionGroup } from "@/transitions/types";

const GROUPS: Array<{ group: TransitionGroup; label: string }> = [
	{ group: "basic", label: "Basic" },
	{ group: "cinematic", label: "Cinematic" },
	{ group: "gaming", label: "Gaming" },
];

export function TransitionsView() {
	const [query, setQuery] = useState("");
	const normalized = query.trim().toLowerCase();
	const matches = (definition: TransitionDefinition) =>
		!normalized ||
		definition.name.toLowerCase().includes(normalized) ||
		definition.keywords.some((keyword) => keyword.includes(normalized));

	return (
		<PanelView title="Transitions">
			<div className="flex flex-col gap-4">
				<Input
					placeholder="Search transitions"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				{GROUPS.map(({ group, label }) => {
					const definitions = TRANSITION_DEFINITIONS.filter(
						(definition) => definition.group === group && matches(definition),
					);
					if (definitions.length === 0) return null;
					return (
						<section key={group} className="flex flex-col gap-2">
							<h3 className="text-muted-foreground text-xs font-medium">{label}</h3>
							<div
								className="grid gap-2"
								style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
							>
								{definitions.map((definition) => (
									<TransitionItem key={definition.type} definition={definition} />
								))}
							</div>
						</section>
					);
				})}
			</div>
		</PanelView>
	);
}

function TransitionPreviewCanvas({ type }: { type: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const frameRef = useRef<number | null>(null);

	const render = useCallback(
		(progress: number) => {
			if (canvasRef.current) {
				transitionPreviewService.renderPreview({
					type,
					progress,
					targetCanvas: canvasRef.current,
				});
			}
		},
		[type],
	);

	useEffect(() => {
		render(0.5);
		return transitionPreviewService.onPreviewImageReady({ callback: () => render(0.5) });
	}, [render]);

	const startAnimation = () => {
		const start = performance.now();
		const tick = (now: number) => {
			render(((now - start) % 1200) / 1200);
			frameRef.current = requestAnimationFrame(tick);
		};
		frameRef.current = requestAnimationFrame(tick);
	};

	const stopAnimation = () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		render(0.5);
	};

	useEffect(() => () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="size-full"
			onMouseEnter={startAnimation}
			onMouseLeave={stopAnimation}
		/>
	);
}

function TransitionItem({ definition }: { definition: TransitionDefinition }) {
	const handleAdd = useCallback(() => {
		if (!applyTransitionToSelectedClip({ type: definition.type })) {
			toast.info("Select a clip next to a cut, or drag the transition onto a cut");
		}
	}, [definition.type]);

	return (
		<DraggableItem
			name={definition.name}
			preview={<TransitionPreviewCanvas type={definition.type} />}
			dragData={{
				id: definition.type,
				name: definition.name,
				type: "transition",
				transitionType: definition.type,
			}}
			onAddToTimeline={handleAdd}
			aspectRatio={16 / 9}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
```
Match `DraggableItem`'s real props: read `components/editor/panels/assets/draggable-item.tsx`. If `Input` lives elsewhere, use the repo's input component.

In `apps/web/src/components/editor/panels/assets/index.tsx`, replace the `transitions:` placeholder entry with `transitions: <TransitionsView />,` and import it.

- [ ] **Step 5: Verify and commit**

- `bunx tsc --noEmit` → 0.
- `bun test` → 242 pass, 4 fail.
- `bun run build:web` → succeeds.

```bash
cd /d/OpenCut && git add apps/web/src && git commit -q -F - <<'EOF'
feat: transitions tab with thumbnails and click-to-apply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Timeline — transition blocks, drop onto cuts

**Files:**
- Create: `apps/web/src/transitions/components/transition-blocks.tsx`
- Modify: `apps/web/src/timeline/components/drop-target.ts` (export `getTrackAtY`)
- Modify: `apps/web/src/timeline/controllers/drag-drop-controller.ts`
- Modify: `apps/web/src/timeline/hooks/use-timeline-drag-drop.ts`
- Modify: `apps/web/src/timeline/components/timeline-track.tsx`
- Modify: `apps/web/src/timeline/components/index.tsx`

**Interfaces:**
- Consumes:
  - `findCutNearTime`, `Cut` (Task 1);
  - `addTransitionAtCut`, `useTransitionSelectionStore` (Task 3);
  - `planTrackTransitions` (Phase 2);
  - `timelineTimeToPixels` (`@/timeline/pixel-utils`).

- [ ] **Step 1: Transition blocks**

`apps/web/src/transitions/components/transition-blocks.tsx` renders, for a video track, one block per planned transition:
- Position: `left = timelineTimeToPixels({ time: window.start, zoomLevel })`, `width = max(12, timelineTimeToPixels({ time: window.end - window.start, zoomLevel }))`. The block is centred vertically in the track.
- Look: a rounded, semi-transparent pill above the clips. It shows the definition's name when wider than 56 px, and otherwise only an icon (use the same icon as the Transitions tab in `assets-panel-store.tsx`: `ArrowRightDoubleIcon`).
- Selected state: when `useTransitionSelectionStore` holds this transition *and* no clips are selected, show a visible ring.
- Interaction:
  - `onMouseDown` calls `event.stopPropagation()`, so the track doesn't start a box selection.
  - `onClick` calls `editor.selection.clearSelection()` and then `select({ trackId: track.id, transitionId })`.
  - Add `title={definition.name}` and an `aria-label`.
- Z-order: the block's z-index must be above the clip elements. Read `timeline/components/layers.ts` and use or extend `TIMELINE_LAYERS`.
- `highlightedCutTime`: when set, render a 3 px glowing vertical bar at `timelineTimeToPixels({ time: highlightedCutTime, zoomLevel })`, centred, full track height. This is the drop target highlight.

```tsx
"use client";

import { ArrowRightDoubleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEditor } from "@/editor/use-editor";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import type { VideoTrack } from "@/timeline";
import { getTransitionDefinition } from "@/transitions/registry";
import { useTransitionSelectionStore } from "@/transitions/selection-store";
import { planTrackTransitions } from "@/transitions/timing";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { cn } from "@/utils/ui";

const MIN_BLOCK_WIDTH_PX = 12;
const LABEL_MIN_WIDTH_PX = 56;

export function TransitionBlocks({
	track,
	zoomLevel,
	highlightedCutTime,
	zIndex,
}: {
	track: VideoTrack;
	zoomLevel: number;
	highlightedCutTime: number | null;
	zIndex: number;
}) {
	const editor = useEditor();
	const selected = useTransitionSelectionStore((state) => state.selected);
	const select = useTransitionSelectionStore((state) => state.select);
	const { selectedElements } = useElementSelection();
	const { transitions } = planTrackTransitions({ track });

	return (
		<>
			{transitions.map(({ transition, window }) => {
				const definition = getTransitionDefinition({ type: transition.type });
				const left = timelineTimeToPixels({ time: window.start, zoomLevel });
				const width = Math.max(
					MIN_BLOCK_WIDTH_PX,
					timelineTimeToPixels({ time: window.end - window.start, zoomLevel }),
				);
				const isSelected =
					selectedElements.length === 0 &&
					selected?.trackId === track.id &&
					selected.transitionId === transition.id;
				const name = definition?.name ?? "Transition";
				return (
					<button
						key={transition.id}
						type="button"
						title={name}
						aria-label={`${name} transition`}
						className={cn(
							"absolute top-1/2 flex h-5 -translate-y-1/2 items-center justify-center gap-1 overflow-hidden rounded-full border border-white/40 bg-black/60 px-1.5 text-[10px] text-white backdrop-blur-sm",
							isSelected && "ring-primary ring-2",
						)}
						style={{ left, width, zIndex }}
						onMouseDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							editor.selection.clearSelection();
							select({ trackId: track.id, transitionId: transition.id });
						}}
					>
						<HugeiconsIcon icon={ArrowRightDoubleIcon} className="size-3 shrink-0" />
						{width >= LABEL_MIN_WIDTH_PX && <span className="truncate">{name}</span>}
					</button>
				);
			})}
			{highlightedCutTime !== null && (
				<div
					className="bg-primary pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full shadow-[0_0_8px] shadow-primary"
					style={{
						left: timelineTimeToPixels({ time: highlightedCutTime, zoomLevel }),
						zIndex,
					}}
				/>
			)}
		</>
	);
}
```
Adjust class tokens to the repo's Tailwind theme if a token such as `ring-primary` or `shadow-primary` doesn't exist. Check `app/globals.css`.

- [ ] **Step 2: Render blocks in tracks**

In `timeline-track.tsx`:
- Add the prop `highlightedCutTime?: number | null` (default `null`).
- Inside the inner content `<div>`, after the elements map, render `{track.type === "video" && <TransitionBlocks track={track} zoomLevel={zoomLevel} highlightedCutTime={highlightedCutTime} zIndex={...} />}`. Use the z-index from Step 1.

- [ ] **Step 3: Drop onto cuts**

In `drop-target.ts`, export `getTrackAtY`.

In `drag-drop-controller.ts`:
- Add a field to the `"over"` state: `transitionCut: Cut | null`. `setOver` takes it, defaulting to `null` for element drags.
- Add the getter `get transitionCut(): Cut | null`.
- In `onDragOver`'s transition branch:
  1. Compute coords.
  2. Get `orderedTracks({ sceneTracks: this.config.getSceneTracks() })`.
  3. Get `trackAtMouse = getTrackAtY({ mouseY: coords.mouseY, tracks })`.
  4. If the track exists and is `type === "video"`, convert the mouse position to time: `time = (coords.mouseX / getTimelinePixelsPerSecond({ zoomLevel: this.config.zoomLevel })) * TICKS_PER_SECOND`.
  5. Find the cut: `cut = findCutNearTime({ track, time, tolerance: (16 / pxPerSecond) * TICKS_PER_SECOND })`.
  6. Call `this.setOver({ dropTarget: null, elementType: null, transitionCut: cut })`.
  7. Set `event.dataTransfer.dropEffect = cut ? "copy" : "none"`.
- In `onDrop`'s transition branch, read the current `transitionCut` before `setIdle()`. If set, call `addTransitionAtCut({ cut, type: dragData.transitionType })`.

Match `getMouseTimelineCoords`' coordinate space. It is the same space `computeDropTarget` uses with `BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel`, so mouseX is timeline content pixels.

In `use-timeline-drag-drop.ts`, return `transitionCut: controller.transitionCut`.

In `timeline/components/index.tsx`, pass `transitionCut` from the hook down to `TimelineTrackRows`, the same way `dropTarget` is passed. In the row loop, give `TimelineTrackContent`:
```tsx
highlightedCutTime={
	isDragOver && transitionCut?.trackId === track.id ? transitionCut.time : null
}
```

- [ ] **Step 4: Verify and commit**

- `bunx tsc --noEmit` → 0.
- `bun test` → 242 pass, 4 fail.
- `bun run build:web` → succeeds.

```bash
cd /d/OpenCut && git add apps/web/src && git commit -q -F - <<'EOF'
feat: transition blocks on the timeline and drop onto cuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Properties panel and Delete key

**Files:**
- Create: `apps/web/src/transitions/components/transition-properties.tsx`
- Modify: `apps/web/src/components/editor/panels/properties/index.tsx`
- Modify: `apps/web/src/actions/use-editor-actions.ts` (`delete-selected`)

**Interfaces:**
- Consumes:
  - `useTransitionSelectionStore`, `updateTrackTransition`, `removeTrackTransition` (Task 3);
  - `getVideoTrackById` (Task 1);
  - the registry;
  - `PropertyParamField` (`@/components/editor/panels/properties/components/property-param-field`).

- [ ] **Step 1: Transition properties**

`transition-properties.tsx` renders the selected transition's settings:
- **Missing transition:** find the transition from `useEditor((e) => e.scenes.getActiveSceneOrNull())` via `getVideoTrackById` and `transitions.find`. If it no longer exists (for example after an undo or a reconcile), call `useTransitionSelectionStore.getState().clear()` in an effect and render nothing.
- **Header:** "Transition".
- **Type field:** a `SelectParamDefinition` built from `TRANSITION_DEFINITIONS`, with options `{ value: type, label: name }`. Committing a new type calls `updateTrackTransition({ ..., patch: { type, params: {} } })`.
- **Duration field:** a `NumberParamDefinition` in seconds: `{ key: "duration", label: "Duration", type: "number", default: definition.defaultDurationSeconds, min: 0.1, max: maxSeconds, step: 0.05 }`.
  - `maxSeconds` is `min(from.duration, to.duration) / TICKS_PER_SECOND`, using the transition's clips from the track.
  - The value is `transition.duration / TICKS_PER_SECOND`.
  - Commit sends `patch: { duration: Math.round(seconds * TICKS_PER_SECOND) as MediaTime }`.
- **Option fields:** one `PropertyParamField` per `definition.params`, with value `transition.params[key] ?? param.default`. Commit sends `patch: { params: { ...transition.params, [key]: value } }`.
- **Remove button:** a "Remove transition" button that calls `removeTrackTransition`.
- **Drafts:** each field previews into a local draft and commits once. Use a `useRef<ParamValues>` draft plus a re-render trigger. `onPreview(value)` stores `draft[key] = value`. `onCommit()` applies `draft[key]` through the action and then deletes it. The displayed value is `draft[key] ?? storedValue`.

Follow the visual structure of `effects/components/effects-tab.tsx`: `Section`, `SectionContent`, `SectionFields`, separators and padding.

- [ ] **Step 2: Show it in the Properties panel**

In `components/editor/panels/properties/index.tsx`, read `const selectedTransition = useTransitionSelectionStore((s) => s.selected);` at the top, before any early return. Then, before `if (selectedElements.length === 0)`, add:
```tsx
	if (selectedTransition && selectedElements.length === 0) {
		return (
			<div className="panel bg-background flex h-full flex-col overflow-hidden rounded-sm border">
				<TransitionProperties selection={selectedTransition} />
			</div>
		);
	}
```
Wrap the content in `ScrollArea` if the panel's other branches do.

- [ ] **Step 3: Delete key**

In `use-editor-actions.ts`'s `delete-selected` handler, before the `switch`, add:
```ts
			const selectedTransition = useTransitionSelectionStore.getState().selected;
			if (selectedTransition && selectedElements.length === 0) {
				removeTrackTransition(selectedTransition);
				return;
			}
```
Import `useTransitionSelectionStore` and `removeTrackTransition`. `removeTrackTransition` takes `{ trackId, transitionId }`, which is the same shape as `TransitionRef`.

- [ ] **Step 4: Verify and commit**

- `bunx tsc --noEmit` → 0.
- `bun test` → 242 pass, 4 fail.
- `bun run build:web` → succeeds.

```bash
cd /d/OpenCut && git add apps/web/src && git commit -q -F - <<'EOF'
feat: edit and delete transitions from the properties panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 6: End-to-end verification (controller + user)

**Files:** none unless a check fails.

- [ ] **Step 1: Build**

Build the release exe with `bun run build:desktop`, and the CDP profiling exe.

- [ ] **Step 2: Scripted checks in "RCut transitions test"**

Run these through CDP:
1. Open the Transitions tab. Screenshot the panel: groups are shown and thumbnails render (not blank).
2. Select clip A with `editor.selection.setSelectedElements`, then click the "Whip Pan" tile's add button. Assert that the main track now has a `whip-pan` transition on A→B, replacing the crossfade.
3. Screenshot the timeline: transition blocks are visible on cuts and the selected one has a ring.
4. Screenshot the Properties panel, which should show Type, Duration and Direction/Blur. Change Duration by dispatching input in the number field, or call `updateTrackTransition` and assert the stored duration.
5. Press Delete with the transition selected. Assert it is removed. Press Ctrl+Z and assert it is restored.
6. Move clip B (via `editor.timeline` APIs) so A and B are no longer adjacent. Assert that the A→B transition is removed. Undo and assert it is back.

- [ ] **Step 3: User checks in `rcut.exe`**

The user, in their own project:
1. Splits a clip, drags a transition from the Transitions tab onto the cut, and confirms the cut highlights while hovering.
2. Selects the block and changes Duration and the Whip Pan direction.
3. Deletes the transition, then undoes.
4. Exports.

Expected: everything behaves as described, and the export contains the transitions.
