import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const shakeHitTransition: TransitionDefinition = {
	type: "shake-hit",
	name: "Shake Hit",
	group: "gaming",
	keywords: ["shake", "camera", "impact", "flash", "hit"],
	shader: "shake-hit",
	defaultDurationSeconds: 0.35,
	params: [
		{
			key: "amount",
			label: "Shake",
			type: "number",
			default: 1,
			min: 0.2,
			max: 2,
			step: 0.1,
		},
		{
			key: "flash",
			label: "Flash",
			type: "number",
			default: 0.6,
			min: 0,
			max: 1,
			step: 0.05,
		},
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "amount", fallback: 1 }),
		numberParam({ params, key: "flash", fallback: 0.6 }),
	],
};
