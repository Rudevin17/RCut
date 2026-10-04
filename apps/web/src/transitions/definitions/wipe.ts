import {
	DIRECTION_OPTIONS,
	directionVector,
	numberParam,
} from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const wipeTransition: TransitionDefinition = {
	type: "wipe",
	name: "Wipe",
	group: "basic",
	keywords: ["wipe", "reveal", "sweep"],
	shader: "wipe",
	defaultDurationSeconds: 0.6,
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			default: "right",
			options: DIRECTION_OPTIONS,
		},
		{
			key: "softness",
			label: "Softness",
			type: "number",
			default: 0.1,
			min: 0,
			max: 0.5,
			step: 0.05,
		},
	],
	toShaderParams: ({ params }) => [
		...directionVector({ params, key: "direction", fallback: "right" }),
		numberParam({ params, key: "softness", fallback: 0.1 }),
	],
};
