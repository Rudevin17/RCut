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
