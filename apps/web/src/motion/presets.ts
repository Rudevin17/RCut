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
