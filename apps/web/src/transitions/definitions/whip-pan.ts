import type { TransitionDefinition } from "@/transitions/types";

const DIRECTION_VECTORS: Record<string, [number, number]> = {
	left: [-1, 0],
	right: [1, 0],
	up: [0, 1],
	down: [0, -1],
};

export const whipPanTransition: TransitionDefinition = {
	type: "whip-pan",
	name: "Whip Pan",
	group: "gaming",
	keywords: ["swipe", "motion blur", "fast", "slide"],
	shader: "whip-pan",
	defaultDurationSeconds: 0.35,
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			default: "right",
			options: [
				{ value: "left", label: "Left" },
				{ value: "right", label: "Right" },
				{ value: "up", label: "Up" },
				{ value: "down", label: "Down" },
			],
		},
		{
			key: "strength",
			label: "Blur",
			type: "number",
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.05,
		},
	],
	toShaderParams: ({ params }) => {
		const [x, y] =
			DIRECTION_VECTORS[String(params.direction)] ?? DIRECTION_VECTORS.right;
		const strength = typeof params.strength === "number" ? params.strength : 0.25;
		return [x, y, strength];
	},
};
