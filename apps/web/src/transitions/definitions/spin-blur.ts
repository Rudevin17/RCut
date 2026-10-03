import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const spinBlurTransition: TransitionDefinition = {
	type: "spin-blur",
	name: "Spin Blur",
	group: "gaming",
	keywords: ["spin", "rotate", "twirl", "motion blur"],
	shader: "spin-blur",
	defaultDurationSeconds: 0.5,
	params: [
		{
			key: "turns",
			label: "Turns",
			type: "number",
			default: 0.5,
			min: 0.25,
			max: 2,
			step: 0.25,
		},
		{
			key: "blur",
			label: "Blur",
			type: "number",
			default: 1,
			min: 0,
			max: 2,
			step: 0.1,
		},
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "turns", fallback: 0.5 }),
		numberParam({ params, key: "blur", fallback: 1 }),
	],
};
