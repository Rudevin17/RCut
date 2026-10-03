import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const zoomPunchTransition: TransitionDefinition = {
	type: "zoom-punch",
	name: "Zoom Punch",
	group: "gaming",
	keywords: ["zoom", "punch", "impact", "flash"],
	shader: "zoom-punch",
	defaultDurationSeconds: 0.4,
	params: [
		{
			key: "strength",
			label: "Zoom",
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
			default: 0.8,
			min: 0,
			max: 1,
			step: 0.05,
		},
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "strength", fallback: 1 }),
		numberParam({ params, key: "flash", fallback: 0.8 }),
	],
};
