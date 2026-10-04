import {
	DIRECTION_OPTIONS,
	directionVector,
} from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const pushTransition: TransitionDefinition = {
	type: "push",
	name: "Push",
	group: "basic",
	keywords: ["push", "move", "shove"],
	shader: "push",
	defaultDurationSeconds: 0.5,
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			default: "left",
			options: DIRECTION_OPTIONS,
		},
	],
	toShaderParams: ({ params }) =>
		directionVector({ params, key: "direction", fallback: "left" }),
};
