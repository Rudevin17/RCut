import type { LutData, Rgb } from "@/luts/cube-parser";

const BUILTIN_SIZE = 33;
const BUILTIN_PREFIX = "builtin:";

export const BUILTIN_LOOKS: Array<{ id: string; name: string }> = [
	{ id: "builtin:teal-orange", name: "Teal & Orange" },
	{ id: "builtin:warm-film", name: "Warm Film" },
	{ id: "builtin:cool-night", name: "Cool Night" },
	{ id: "builtin:black-white", name: "Black & White" },
	{ id: "builtin:faded", name: "Faded" },
	{ id: "builtin:vivid", name: "Vivid" },
];

const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smooth = (value: number): number => value * value * (3 - 2 * value);
/** mix(vec3(Y), c, amount) */
const towardGrey = (c: Rgb, amount: number): Rgb => {
	const y = luma(c);
	return [y + (c[0] - y) * amount, y + (c[1] - y) * amount, y + (c[2] - y) * amount];
};
const map = (c: Rgb, fn: (value: number) => number): Rgb => [fn(c[0]), fn(c[1]), fn(c[2])];

const LOOK_FUNCTIONS: Record<string, (c: Rgb) => Rgb> = {
	"builtin:black-white": (c) => {
		const y = luma(c);
		return [y, y, y];
	},
	"builtin:vivid": (c) => map(towardGrey(c, 1.35), (v) => (v - 0.5) * 1.1 + 0.5),
	"builtin:faded": (c) => towardGrey(map(c, (v) => 0.08 + v * 0.84), 0.8),
	"builtin:warm-film": (c) =>
		map([c[0] * 1.06 + 0.02, c[1], c[2] * 0.9], (v) => v + (smooth(clamp01(v)) - v) * 0.3),
	"builtin:cool-night": (c) => [c[0] * 0.85 * 0.9, c[1] * 0.95 * 0.9, (c[2] * 1.1 + 0.03) * 0.9],
	"builtin:teal-orange": (c) => {
		const y = luma(c);
		return towardGrey(
			[
				c[0] - 0.04 * (1 - y) + 0.08 * y,
				c[1] + 0.02 * (1 - y) + 0.02 * y,
				c[2] + 0.06 * (1 - y) - 0.06 * y,
			],
			1.1,
		);
	},
};

const cache = new Map<string, LutData>();

export function isBuiltinLutId(id: string): boolean {
	return id.startsWith(BUILTIN_PREFIX);
}

/** Generates (once) the LUT for a built-in look, in .cube order (red fastest). */
export function getBuiltinLut({ id }: { id: string }): LutData | null {
	const cached = cache.get(id);
	if (cached) return cached;
	const look = LOOK_FUNCTIONS[id];
	if (!look) return null;

	const size = BUILTIN_SIZE;
	const data = new Float32Array(size ** 3 * 3);
	let offset = 0;
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const out = look([r / (size - 1), g / (size - 1), b / (size - 1)]);
				data[offset++] = clamp01(out[0]);
				data[offset++] = clamp01(out[1]);
				data[offset++] = clamp01(out[2]);
			}
		}
	}
	const lut: LutData = { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
	cache.set(id, lut);
	return lut;
}
