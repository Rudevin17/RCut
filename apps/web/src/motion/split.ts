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
