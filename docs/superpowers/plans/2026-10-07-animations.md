# Animations (In / Out / Combo) + Keyframe Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CapCut-style one-click In/Out/Combo animation presets for visual clips and text boxes, plus a keyframe-all diamond and previous/next keyframe navigation.

**Architecture:**
- A pure `apps/web/src/motion/` module holds preset deltas, easing, phase maths, composition and split.
- Visual elements gain an optional `motion` field.
- The two render resolve sites apply motion on top of keyframed transform/opacity, so preview and export match.
- UI work:
  - a new Properties **Animation** tab;
  - a timeline band hint;
  - keyframe tools in the Transform section header, plus two actions bound to `[` and `]`.

**Tech Stack:** TypeScript, React (Next.js), zustand editor store, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-06-animations-design.md`. It holds the exact formulas.

## Global Constraints

**Repo and git**
- Repo `D:\OpenCut`, branch `main`.
- **Commit messages must NOT contain any Co-Authored-By line or Claude attribution.**
- Change files with Edit/Write only. Use no scripts or heredocs, except `git commit -F -`.

**Code style**
- TypeScript: tabs, double quotes, object-parameter functions.
- `bun:test` tests live in `__tests__/`.
- Read components before using them (AGENTS.md).
- Pure modules (`motion/*`) must not import `opencut-wasm`, `@/wasm` or React at runtime. Type-only imports are fine. Do not use `mock.module` in tests.

**Baselines**
- `cd /d/OpenCut && bun test` → 313 pass / 4 fail. The 4 are pre-existing wasm load errors.
- `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`.
- `cd /d/OpenCut && bun run build:web` succeeds.

**Units**
- Element times (`startTime`, `duration`, `localTime`) are **ticks**. `TICKS_PER_SECOND` comes from `@/wasm` (120000).
- Motion maths works in **seconds**. Convert at the call site.
- Position is canvas pixels relative to centre, with +y down.
- Canvas size at render time is `context.renderer.width` and `context.renderer.height`.

---

## Task 1: Pure motion module

**Files:**
- Create: `apps/web/src/motion/presets.ts`
- Create: `apps/web/src/motion/apply.ts`
- Create: `apps/web/src/motion/split.ts`
- Create: `apps/web/src/motion/index.ts`, which re-exports the three files above
- Test: `apps/web/src/motion/__tests__/presets.test.ts`
- Test: `apps/web/src/motion/__tests__/apply.test.ts`

**Interfaces:**
- `presets.ts` exports:
  - `MotionDelta` and `IDENTITY_DELTA`;
  - the easing functions;
  - `IN_PRESETS`, `OUT_PRESETS`, `COMBO_PRESETS`, each an array of `{ id, name, delta(args) }`;
  - the types `InPresetId`, `OutPresetId`, `ComboPresetId`.
- `apply.ts` exports:
  - `ElementMotion`;
  - `DEFAULT_IN_OUT_DURATION = 0.5` and `DEFAULT_COMBO_SPEED = 1`;
  - `resolveMotionPhases({ motion, duration })`;
  - `getMotionDelta({ motion, localTime, duration, canvas })`;
  - `applyMotion({ transform, opacity, motion, localTime, duration, canvas })`.
- `split.ts` exports `splitMotion({ motion }) → { left, right }`.

- [ ] **Step 1: Failing tests.**

`presets.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { COMBO_PRESETS, IDENTITY_DELTA, IN_PRESETS, OUT_PRESETS, backOut, bounceOut } from "@/motion/presets";

const canvas = { width: 1920, height: 1080 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const expectIdentity = (delta: typeof IDENTITY_DELTA) => {
	close(delta.dx, 0); close(delta.dy, 0); close(delta.scale, 1); close(delta.rotate, 0); close(delta.opacity, 1);
};

describe("easing", () => {
	test("backOut and bounceOut end at 1", () => {
		close(backOut(1), 1);
		close(bounceOut(1), 1);
		close(bounceOut(0), 0);
	});
});

describe("presets", () => {
	test("ids match the spec", () => {
		expect(IN_PRESETS.map((p) => p.id)).toEqual(["fade-in", "zoom-in", "zoom-out", "slide-left", "slide-right", "slide-top", "slide-bottom", "spin-in", "pop", "drop"]);
		expect(OUT_PRESETS.map((p) => p.id)).toEqual(["fade-out", "zoom-in", "zoom-out", "slide-left", "slide-right", "slide-top", "slide-bottom", "spin-out", "pop-out"]);
		expect(COMBO_PRESETS.map((p) => p.id)).toEqual(["pulse", "sway", "shake", "float", "wobble"]);
	});

	test("every In preset is identity at p = 1", () => {
		for (const preset of IN_PRESETS) expectIdentity(preset.delta({ p: 1, canvas }));
	});

	test("every Out preset is identity at q = 0", () => {
		for (const preset of OUT_PRESETS) expectIdentity(preset.delta({ q: 0, canvas }));
	});

	test("starting states", () => {
		const get = (id: string) => IN_PRESETS.find((p) => p.id === id)!;
		close(get("fade-in").delta({ p: 0, canvas }).opacity, 0);
		close(get("slide-left").delta({ p: 0, canvas }).dx, -1920);
		close(get("slide-bottom").delta({ p: 0, canvas }).dy, 1080);
		close(get("zoom-out").delta({ p: 0, canvas }).scale, 1.4);
		const out = (id: string) => OUT_PRESETS.find((p) => p.id === id)!;
		close(out("fade-out").delta({ q: 1, canvas }).opacity, 0);
		close(out("slide-top").delta({ q: 1, canvas }).dy, -1080);
	});

	test("fade-in is monotonic", () => {
		const fade = IN_PRESETS.find((p) => p.id === "fade-in")!;
		let last = -1;
		for (let i = 0; i <= 20; i++) {
			const value = fade.delta({ p: i / 20, canvas }).opacity;
			expect(value).toBeGreaterThanOrEqual(last);
			last = value;
		}
	});

	test("combo presets are identity at phase 0 and periodic over 2π", () => {
		for (const preset of COMBO_PRESETS) {
			expectIdentity(preset.delta({ phase: 0, canvas }));
			const a = preset.delta({ phase: 1.3, canvas });
			const b = preset.delta({ phase: 1.3 + 2 * Math.PI, canvas });
			close(a.dx, b.dx); close(a.dy, b.dy); close(a.scale, b.scale); close(a.rotate, b.rotate);
		}
	});
});
```

`apply.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { applyMotion, getMotionDelta, resolveMotionPhases } from "@/motion/apply";
import { splitMotion } from "@/motion/split";

const canvas = { width: 1920, height: 1080 };
const transform = { position: { x: 100, y: 50 }, scaleX: 2, scaleY: 1, rotate: 10 };

describe("resolveMotionPhases", () => {
	test("keeps durations that fit", () => {
		expect(resolveMotionPhases({ motion: { in: { preset: "fade-in", duration: 0.5 }, out: { preset: "fade-out", duration: 1 } }, duration: 4 })).toEqual({ inDur: 0.5, outDur: 1 });
	});

	test("squeezes overlapping In/Out proportionally", () => {
		expect(resolveMotionPhases({ motion: { in: { preset: "fade-in", duration: 2 }, out: { preset: "fade-out", duration: 2 } }, duration: 2 })).toEqual({ inDur: 1, outDur: 1 });
	});

	test("ignores invalid durations", () => {
		expect(resolveMotionPhases({ motion: { in: { preset: "fade-in", duration: 0 } }, duration: 3 })).toEqual({ inDur: 0, outDur: 0 });
	});
});

describe("getMotionDelta", () => {
	test("no motion is identity", () => {
		expect(getMotionDelta({ motion: undefined, localTime: 1, duration: 3, canvas })).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 });
	});

	test("In applies only during its window, Out only during its window", () => {
		const motion = { in: { preset: "fade-in" as const, duration: 1 }, out: { preset: "fade-out" as const, duration: 1 } };
		expect(getMotionDelta({ motion, localTime: 0, duration: 4, canvas }).opacity).toBeCloseTo(0, 6);
		expect(getMotionDelta({ motion, localTime: 2, duration: 4, canvas }).opacity).toBeCloseTo(1, 6);
		expect(getMotionDelta({ motion, localTime: 4, duration: 4, canvas }).opacity).toBeCloseTo(0, 6);
	});

	test("combo period is 2 / speed seconds", () => {
		const motion = { combo: { preset: "sway" as const, speed: 2 } };
		const a = getMotionDelta({ motion, localTime: 0.3, duration: 10, canvas });
		const b = getMotionDelta({ motion, localTime: 1.3, duration: 10, canvas });
		expect(a.rotate).toBeCloseTo(b.rotate, 6);
	});
});

describe("applyMotion", () => {
	test("composes deltas onto the keyframed transform and opacity", () => {
		const result = applyMotion({
			transform,
			opacity: 0.8,
			motion: { in: { preset: "slide-left", duration: 1 }, combo: { preset: "pulse", speed: 1 } },
			localTime: 0,
			duration: 4,
			canvas,
		});
		expect(result.transform.position.x).toBeCloseTo(100 - 1920, 6);
		expect(result.transform.position.y).toBeCloseTo(50, 6);
		expect(result.transform.scaleX).toBeCloseTo(2, 6);
		expect(result.transform.rotate).toBeCloseTo(10, 6);
		expect(result.opacity).toBeCloseTo(0.8, 6);
	});

	test("no motion returns the inputs unchanged", () => {
		const result = applyMotion({ transform, opacity: 0.5, motion: undefined, localTime: 1, duration: 2, canvas });
		expect(result.transform).toEqual(transform);
		expect(result.opacity).toBe(0.5);
	});
});

describe("splitMotion", () => {
	test("left keeps in+combo, right keeps out+combo", () => {
		const motion = { in: { preset: "fade-in" as const, duration: 1 }, out: { preset: "fade-out" as const, duration: 1 }, combo: { preset: "pulse" as const, speed: 1 } };
		expect(splitMotion({ motion })).toEqual({
			left: { in: motion.in, combo: motion.combo },
			right: { out: motion.out, combo: motion.combo },
		});
	});

	test("undefined stays undefined and empty halves become undefined", () => {
		expect(splitMotion({ motion: undefined })).toEqual({ left: undefined, right: undefined });
		expect(splitMotion({ motion: { in: { preset: "fade-in", duration: 1 } } })).toEqual({ left: { in: { preset: "fade-in", duration: 1 } }, right: undefined });
	});
});
```

Run `cd /d/OpenCut && bun test apps/web/src/motion/__tests__/` and confirm it FAILS (RED).

- [ ] **Step 2: `presets.ts`.**
```ts
export interface MotionDelta {
	dx: number;
	dy: number;
	scale: number;
	rotate: number;
	opacity: number;
}

export const IDENTITY_DELTA: MotionDelta = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };

type Canvas = { width: number; height: number };

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const delta = (patch: Partial<MotionDelta>): MotionDelta => ({ ...IDENTITY_DELTA, ...patch });

export const easeOutCubic = (p: number): number => 1 - (1 - p) ** 3;
export const easeInCubic = (q: number): number => q ** 3;
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
export const backOut = (p: number): number => 1 + BACK_C3 * (p - 1) ** 3 + BACK_C1 * (p - 1) ** 2;
export const backIn = (q: number): number => BACK_C3 * q ** 3 - BACK_C1 * q ** 2;

/** Robert Penner's bounce-out. */
export function bounceOut(p: number): number {
	const n1 = 7.5625;
	const d1 = 2.75;
	if (p < 1 / d1) return n1 * p * p;
	if (p < 2 / d1) {
		const x = p - 1.5 / d1;
		return n1 * x * x + 0.75;
	}
	if (p < 2.5 / d1) {
		const x = p - 2.25 / d1;
		return n1 * x * x + 0.9375;
	}
	const x = p - 2.625 / d1;
	return n1 * x * x + 0.984375;
}

export const IN_PRESETS = [
	{ id: "fade-in", name: "Fade In", delta: ({ p }: { p: number; canvas: Canvas }) => delta({ opacity: easeOutCubic(p) }) },
	{ id: "zoom-in", name: "Zoom In", delta: ({ p }: { p: number; canvas: Canvas }) => delta({ scale: mix(0.6, 1, easeOutCubic(p)), opacity: Math.min(1, 2 * p) }) },
	{ id: "zoom-out", name: "Zoom Out", delta: ({ p }: { p: number; canvas: Canvas }) => delta({ scale: mix(1.4, 1, easeOutCubic(p)), opacity: Math.min(1, 2 * p) }) },
	{ id: "slide-left", name: "Slide Left", delta: ({ p, canvas }: { p: number; canvas: Canvas }) => delta({ dx: mix(-canvas.width, 0, easeOutCubic(p)) }) },
	{ id: "slide-right", name: "Slide Right", delta: ({ p, canvas }: { p: number; canvas: Canvas }) => delta({ dx: mix(canvas.width, 0, easeOutCubic(p)) }) },
	{ id: "slide-top", name: "Slide Down", delta: ({ p, canvas }: { p: number; canvas: Canvas }) => delta({ dy: mix(-canvas.height, 0, easeOutCubic(p)) }) },
	{ id: "slide-bottom", name: "Slide Up", delta: ({ p, canvas }: { p: number; canvas: Canvas }) => delta({ dy: mix(canvas.height, 0, easeOutCubic(p)) }) },
	{ id: "spin-in", name: "Spin In", delta: ({ p }: { p: number; canvas: Canvas }) => delta({ rotate: mix(-180, 0, easeOutCubic(p)), scale: mix(0.3, 1, easeOutCubic(p)), opacity: Math.min(1, 2 * p) }) },
	{ id: "pop", name: "Pop", delta: ({ p }: { p: number; canvas: Canvas }) => delta({ scale: Math.max(0, backOut(p)), opacity: Math.min(1, 3 * p) }) },
	{ id: "drop", name: "Drop", delta: ({ p, canvas }: { p: number; canvas: Canvas }) => delta({ dy: mix(-0.25 * canvas.height, 0, bounceOut(p)), opacity: Math.min(1, 3 * p) }) },
] as const;

export const OUT_PRESETS = [
	{ id: "fade-out", name: "Fade Out", delta: ({ q }: { q: number; canvas: Canvas }) => delta({ opacity: 1 - easeInCubic(q) }) },
	{ id: "zoom-in", name: "Zoom In", delta: ({ q }: { q: number; canvas: Canvas }) => delta({ scale: mix(1, 1.4, easeInCubic(q)), opacity: 1 - easeInCubic(q) }) },
	{ id: "zoom-out", name: "Zoom Out", delta: ({ q }: { q: number; canvas: Canvas }) => delta({ scale: mix(1, 0.6, easeInCubic(q)), opacity: 1 - easeInCubic(q) }) },
	{ id: "slide-left", name: "Slide Left", delta: ({ q, canvas }: { q: number; canvas: Canvas }) => delta({ dx: mix(0, -canvas.width, easeInCubic(q)) }) },
	{ id: "slide-right", name: "Slide Right", delta: ({ q, canvas }: { q: number; canvas: Canvas }) => delta({ dx: mix(0, canvas.width, easeInCubic(q)) }) },
	{ id: "slide-top", name: "Slide Up", delta: ({ q, canvas }: { q: number; canvas: Canvas }) => delta({ dy: mix(0, -canvas.height, easeInCubic(q)) }) },
	{ id: "slide-bottom", name: "Slide Down", delta: ({ q, canvas }: { q: number; canvas: Canvas }) => delta({ dy: mix(0, canvas.height, easeInCubic(q)) }) },
	{ id: "spin-out", name: "Spin Out", delta: ({ q }: { q: number; canvas: Canvas }) => delta({ rotate: mix(0, 180, easeInCubic(q)), scale: mix(1, 0.3, easeInCubic(q)), opacity: 1 - easeInCubic(q) }) },
	{ id: "pop-out", name: "Pop Out", delta: ({ q }: { q: number; canvas: Canvas }) => delta({ scale: Math.max(0, 1 - backIn(q)), opacity: 1 - q }) },
] as const;

export const COMBO_PRESETS = [
	{ id: "pulse", name: "Pulse", delta: ({ phase }: { phase: number; canvas: Canvas }) => delta({ scale: 1 + 0.06 * Math.sin(phase) }) },
	{ id: "sway", name: "Sway", delta: ({ phase }: { phase: number; canvas: Canvas }) => delta({ rotate: 6 * Math.sin(phase) }) },
	{ id: "shake", name: "Shake", delta: ({ phase, canvas }: { phase: number; canvas: Canvas }) => delta({ dx: 0.01 * canvas.width * Math.sin(7 * phase), dy: 0.01 * canvas.height * Math.sin(11 * phase) }) },
	{ id: "float", name: "Float", delta: ({ phase, canvas }: { phase: number; canvas: Canvas }) => delta({ dy: 0.02 * canvas.height * Math.sin(phase) }) },
	{ id: "wobble", name: "Wobble", delta: ({ phase }: { phase: number; canvas: Canvas }) => delta({ rotate: 4 * Math.sin(2 * phase), scale: 1 + 0.03 * Math.sin(phase) }) },
] as const;

export type InPresetId = (typeof IN_PRESETS)[number]["id"];
export type OutPresetId = (typeof OUT_PRESETS)[number]["id"];
export type ComboPresetId = (typeof COMBO_PRESETS)[number]["id"];
```

Display names follow the direction of motion. `slide-top` *enters* from the top, so the In name is "Slide Down". The Out `slide-top` *exits* upward, so it's "Slide Up". The ids stay as the spec defines them.

- [ ] **Step 3: `apply.ts`.**
```ts
import type { Transform } from "@/rendering";
import {
	COMBO_PRESETS,
	IDENTITY_DELTA,
	IN_PRESETS,
	OUT_PRESETS,
	type ComboPresetId,
	type InPresetId,
	type MotionDelta,
	type OutPresetId,
} from "@/motion/presets";

export const DEFAULT_IN_OUT_DURATION = 0.5;
export const DEFAULT_COMBO_SPEED = 1;
/** One combo cycle lasts this many seconds at speed 1. */
const COMBO_PERIOD_SECONDS = 2;

export interface ElementMotion {
	in?: { preset: InPresetId; duration: number };
	out?: { preset: OutPresetId; duration: number };
	combo?: { preset: ComboPresetId; speed: number };
}

type Canvas = { width: number; height: number };

const validDuration = (value: number | undefined): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** In/Out lengths in seconds, clamped to the clip and squeezed proportionally when they would overlap. */
export function resolveMotionPhases({
	motion,
	duration,
}: {
	motion: ElementMotion | undefined;
	duration: number;
}): { inDur: number; outDur: number } {
	let inDur = Math.min(validDuration(motion?.in?.duration), duration);
	let outDur = Math.min(validDuration(motion?.out?.duration), duration);
	const total = inDur + outDur;
	if (total > duration && total > 0) {
		inDur *= duration / total;
		outDur *= duration / total;
	}
	return { inDur, outDur };
}

function combine(a: MotionDelta, b: MotionDelta): MotionDelta {
	return {
		dx: a.dx + b.dx,
		dy: a.dy + b.dy,
		scale: a.scale * b.scale,
		rotate: a.rotate + b.rotate,
		opacity: a.opacity * b.opacity,
	};
}

/** Combined In/Out/Combo delta at `localTime` (seconds) for a clip of `duration` seconds. */
export function getMotionDelta({
	motion,
	localTime,
	duration,
	canvas,
}: {
	motion: ElementMotion | undefined;
	localTime: number;
	duration: number;
	canvas: Canvas;
}): MotionDelta {
	if (!motion) return IDENTITY_DELTA;
	const { inDur, outDur } = resolveMotionPhases({ motion, duration });
	let result = IDENTITY_DELTA;

	const inPreset = motion.in && IN_PRESETS.find((preset) => preset.id === motion.in?.preset);
	if (inPreset && inDur > 0 && localTime < inDur) {
		result = combine(result, inPreset.delta({ p: Math.min(1, Math.max(0, localTime / inDur)), canvas }));
	}

	const outPreset = motion.out && OUT_PRESETS.find((preset) => preset.id === motion.out?.preset);
	const outStart = duration - outDur;
	if (outPreset && outDur > 0 && localTime > outStart) {
		result = combine(result, outPreset.delta({ q: Math.min(1, Math.max(0, (localTime - outStart) / outDur)), canvas }));
	}

	const comboPreset = motion.combo && COMBO_PRESETS.find((preset) => preset.id === motion.combo?.preset);
	if (comboPreset) {
		const speed = validDuration(motion.combo?.speed) || DEFAULT_COMBO_SPEED;
		const phase = (2 * Math.PI * localTime * speed) / COMBO_PERIOD_SECONDS;
		result = combine(result, comboPreset.delta({ phase, canvas }));
	}
	return result;
}

/** Applies the clip's motion on top of its keyframed transform and opacity. */
export function applyMotion({
	transform,
	opacity,
	motion,
	localTime,
	duration,
	canvas,
}: {
	transform: Transform;
	opacity: number;
	motion: ElementMotion | undefined;
	localTime: number;
	duration: number;
	canvas: Canvas;
}): { transform: Transform; opacity: number } {
	if (!motion) return { transform, opacity };
	const delta = getMotionDelta({ motion, localTime, duration, canvas });
	return {
		transform: {
			...transform,
			position: { x: transform.position.x + delta.dx, y: transform.position.y + delta.dy },
			scaleX: transform.scaleX * delta.scale,
			scaleY: transform.scaleY * delta.scale,
			rotate: transform.rotate + delta.rotate,
		},
		opacity: opacity * delta.opacity,
	};
}
```
If `@/rendering`'s `index.ts` pulls in runtime modules that bun can't load, import the type from the file that declares it, or redeclare the four-field shape locally as `type Transform = {...}`. Report which you chose.

- [ ] **Step 4: `split.ts` and `index.ts`.**
```ts
import type { ElementMotion } from "@/motion/apply";

const orUndefined = (motion: ElementMotion): ElementMotion | undefined =>
	Object.keys(motion).length > 0 ? motion : undefined;

/** Left half keeps In and Combo; right half keeps Out and Combo. */
export function splitMotion({
	motion,
}: {
	motion: ElementMotion | undefined;
}): { left: ElementMotion | undefined; right: ElementMotion | undefined } {
	if (!motion) return { left: undefined, right: undefined };
	return {
		left: orUndefined({
			...(motion.in ? { in: motion.in } : {}),
			...(motion.combo ? { combo: motion.combo } : {}),
		}),
		right: orUndefined({
			...(motion.out ? { out: motion.out } : {}),
			...(motion.combo ? { combo: motion.combo } : {}),
		}),
	};
}
```
`index.ts` re-exports everything from `./presets`, `./apply` and `./split`.

- [ ] **Step 5: Verify.**
  - `bun test apps/web/src/motion/__tests__/` passes (GREEN).
  - tsc → `0`.
  - Root `bun test` shows no new failures.
- [ ] **Step 6: Commit** (no Co-Authored-By): `feat(motion): In/Out/Combo preset maths`

---

## Task 2: Render integration, element field, split

**Files:**
- Modify: `apps/web/src/timeline/types.ts`. Add `motion?: ElementMotion` (type import from `@/motion`) to `VideoElement`, `ImageElement`, `TextElement`, `StickerElement` and `GraphicElement`.
- Modify: `apps/web/src/services/renderer/scene-builder.ts`. Pass `motion: element.motion` into the node params of every visual node (video, image, sticker, graphic and text). Add `motion?: ElementMotion` to those node param types (`services/renderer/nodes/*`); read them first.
- Modify: `apps/web/src/services/renderer/resolve.ts`, at both sites (~180-190 for media sources, ~368-373 for text/graphics). Replace the resolved transform and opacity with:
  ```ts
  const motioned = applyMotion({
  	transform,
  	opacity,
  	motion: params.motion,
  	localTime: localTime / TICKS_PER_SECOND,
  	duration: params.duration / TICKS_PER_SECOND,
  	canvas: { width: context.renderer.width, height: context.renderer.height },
  });
  ```
  Adapt `params` and `node.params` and the duration field name to each site. The text site uses `node.params.duration`. Then use `motioned.transform` and `motioned.opacity` wherever the old values were used.
- Modify: `apps/web/src/commands/timeline/element/split-elements.ts`. Wherever halves are built, set `motion` from `splitMotion({ motion: element.motion })`:
  - the left half, including `retainSide === "left"`, gets `motion: left`;
  - the right half gets `motion: right`.

  Omit the key when the value is `undefined`; follow the `retimeRef` spread pattern. Only visual elements have `motion`, so guard as the file does for `retime`.

**Verify:**
- tsc → `0`.
- Root `bun test` shows no new failures.
- `bun run build:web` passes.

**Commit** (no Co-Authored-By): `feat(motion): apply clip animations in preview and export`

---

## Task 3: Keyframe tools (keyframe-all, previous/next)

**Files:**
- Create: `apps/web/src/motion/keyframe-tools.ts`, pure, using `@/animation` query helpers (type imports, plus runtime helpers that don't reach wasm; verify).
- Test: `apps/web/src/motion/__tests__/keyframe-tools.test.ts`
- Modify: the Transform section of `components/editor/panels/properties/components/element-params-tab.tsx` (and/or `registry.tsx`'s `buildTransformTab`). Read both first.
- Modify: `apps/web/src/actions/keybinding.ts`. Add `"["` and `"]"` to `KEYS`.
- Modify: `apps/web/src/actions/definitions.ts`. Add actions `keyframe-previous` (`["["]`) and `keyframe-next` (`["]"]`), with labels and categories matching neighbours.
- Modify: `apps/web/src/actions/use-editor-actions.ts`. Add the handlers.

**Interfaces** (`keyframe-tools.ts`):
- `KEYFRAME_ALL_PATHS = ["transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY", "transform.rotate", "opacity"] as const`
- `getKeyframeAllState({ animations, localTime }): "all" | "some" | "none"`. It uses `getKeyframeAtTime` for each path.
- `findAdjacentKeyframeTime({ animations, localTime, direction }): number | null`.
  - `direction` is `"previous"` or `"next"`.
  - It considers every keyframe time across every channel of the element; read `getElementKeyframes` in `animation/keyframe-query.ts` to collect them.
  - It returns the nearest time strictly before or after `localTime`, in local ticks, or `null` if there is none.

**Tests:** build `animations` objects with the real helpers (`upsertPathKeyframe`, or whatever the existing animation tests use; read `animation/__tests__/`). Cover:
- all six paths keyed at t → `"all"`;
- one path keyed → `"some"`;
- none → `"none"`;
- adjacent previous/next across two channels;
- `null` at the ends.

**Keyframe-all button** (Transform section header):
- **State:** `getKeyframeAllState` decides it. The icon is filled for `all`, half for `some` (`fill-primary/50`, or a half icon if Hugeicons has one) and outline for `none`. It is disabled when the playhead is outside the clip.
- **Click when the state is `all`:** call `editor.timeline.removeKeyframes` with the six keyframe ids at the playhead. That is one call, so one undo.
- **Click otherwise:** call `editor.timeline.upsertKeyframes` for each path that has no keyframe at the playhead. Each value is the current resolved keyframed value at the playhead, from `resolveTransformAtTime` / `resolveOpacityAtTime` with the element's base params, the same way the param fields compute `resolvedValue`. Read `use-keyframed-param-property.ts` and its caller. One call, so one undo.

**‹ › buttons:**
- They sit next to the diamond.
- Each calls `findAdjacentKeyframeTime`, then `editor.playback.seek({ time: element.startTime + localKeyTime })`.
- They are disabled when it returns `null`.
- The `[` / `]` actions do the same for the single selected element. With no selection or several selected, they do nothing.

Check how `use-keybindings` maps `KeyboardEvent.key` to `KEYS`. If `"["` and `"]"` can't match cleanly, use `alt+left` / `alt+right` instead and report the change.

**Verify:**
- tests pass;
- tsc → `0`;
- root tests show no new failures;
- `build:web` passes.

**Commit** (no Co-Authored-By): `feat(keyframes): keyframe-all diamond and previous/next keyframe navigation`

---

## Task 4: Animation tab UI and timeline band

**Files:**
- Create: `apps/web/src/motion/components/animation-tab.tsx`
- Modify: `components/editor/panels/properties/registry.tsx`. Add `buildAnimationTab({ element })` (an icon such as Hugeicons `AnimationIcon` or a similar existing one; check the package) to the tab lists for video, image, sticker, graphic and text elements, after Transform.
- Modify: `apps/web/src/timeline/components/timeline-element.tsx`. Add the In/Out bands.

**Animation tab:**
- **Segmented control:** In | Out | Combo, as local state. Use an existing toggle-group or tabs component from `components/ui`; read it first.
- **Grid of tiles:**
  - "None" comes first, then the group's presets (`IN_PRESETS`, `OUT_PRESETS`, `COMBO_PRESETS` names).
  - The selected tile has `bg-accent`, with a ring for the current preset.
  - Use 3 columns and small `Button`s. Each shows the name only.
- **Slider:**
  - In and Out: **Duration**, 0.1–3, step 0.05, default `DEFAULT_IN_OUT_DURATION`.
  - Combo: **Speed**, 0.25–4, step 0.05, default 1.
  - Render it through `PropertyParamField`, with a synthetic `NumberParamDefinition` that has `slider: true`. That reuses the slider + number box.
  - Show the slider only when a preset is chosen.
- **Updates:** use `useElementPreview({ trackId, elementId, fallback: element })`.
  - **Choosing a tile:** `previewUpdates({ motion: next })`, then `commit()`.
  - **Slider changes:** `onPreview` → `previewUpdates({ motion: next })`, and `onCommit` → `commit()`.
  - **Choosing None:** removes that slot. If all slots end up empty, set `motion: undefined`.
- **Auto-play on pick** (not on slider moves):
  1. Remember the playhead.
  2. Seek to the clip start (In), to `end − outDur − 0.3 s` (Out), or to the current position (Combo).
  3. `editor.playback.play()`.
  4. After `(inDur + 0.3)` s, `outDur + 0.3` s, or 2 s respectively, `pause()` and seek back.
  5. Cancel any pending timer on unmount, or on the next pick.
  - Use `resolveMotionPhases` with the clip duration (seconds) for the lengths.
  - Read the playback manager's methods: `play`, `pause`, `seek`, `getCurrentTime`.

**Timeline band:**
- In `timeline-element.tsx`, when the element has `motion.in` or `motion.out`, render absolutely positioned translucent bands (e.g. `bg-primary/20`, `pointer-events-none`) at the start and end of the clip block.
- Width = `resolveMotionPhases(...)` seconds × the timeline's pixels-per-second. Read how the component computes the block width from duration and zoom, and use the same scale.

**Verify:**
- tsc → `0`;
- root tests show no new failures;
- `build:web` passes.

**Commit** (no Co-Authored-By): `feat(motion): Animation tab with In/Out/Combo presets and timeline bands`

---

## Task 5: Real-app verification (controller)

- [ ] Build the release and profiling exes.
- [ ] Over CDP, on a copy of "RCut export test", set `motion` on clip 0:
  - `in: fade-in 1 s`, `out: slide-left 1 s`;
  - `combo: pulse` on clip 1.
- [ ] Measure with screenshots and ffmpeg `signalstats`:
  - at t = 0.1 s, the frame is darker than at t = 1.5 s (fade in);
  - near the clip 0 end, the content is shifted left (compare with t = 1.5 s);
  - clip 1 at two Combo phases differs.
- [ ] Export, then check that the same frames in the MP4 show the same effects.
- [ ] UI screenshot of the Animation tab, the timeline bands, and the keyframe-all diamond and arrows.
- [ ] Keyframe-all: click it (via CDP) → `"all"`, then `[` / `]` jumps.
- [ ] User review.
