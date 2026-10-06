import type { NumberParamDefinition, ParamValues } from "@/params";
import type { EffectDefinition } from "@/effects/types";

const toneParam = (key: string, label: string): NumberParamDefinition => ({
	key,
	label,
	type: "number",
	default: 0,
	min: -100,
	max: 100,
	step: 1,
});

function readNumber({ params, key }: { params: ParamValues; key: string }): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Controls after exposure, in the order the `color-adjust` shader reads them. Sent as -1..1. */
const NORMALISED_KEYS = [
	"contrast",
	"highlights",
	"shadows",
	"whites",
	"blacks",
	"saturation",
	"vibrance",
	"temperature",
	"tint",
] as const;

export const colorEffectDefinition: EffectDefinition = {
	type: "color",
	name: "Color",
	keywords: ["color", "grade", "exposure", "contrast", "saturation", "white balance", "temperature"],
	params: [
		{ key: "exposure", label: "Exposure", type: "number", default: 0, min: -4, max: 4, step: 0.05 },
		toneParam("contrast", "Contrast"),
		toneParam("highlights", "Highlights"),
		toneParam("shadows", "Shadows"),
		toneParam("whites", "Whites"),
		toneParam("blacks", "Blacks"),
		toneParam("saturation", "Saturation"),
		toneParam("vibrance", "Vibrance"),
		toneParam("temperature", "Temperature"),
		toneParam("tint", "Tint"),
	],
	renderer: {
		passes: [
			{
				shader: "color-adjust",
				params: ({ effectParams }) => [
					readNumber({ params: effectParams, key: "exposure" }),
					...NORMALISED_KEYS.map((key) => readNumber({ params: effectParams, key }) / 100),
				],
			},
		],
	},
};
