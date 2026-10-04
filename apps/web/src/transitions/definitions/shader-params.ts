import type { ParamValues } from "@/params";

export function numberParam({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type Direction = "left" | "right" | "up" | "down";

const DIRECTION_VECTORS = new Map<string, [number, number]>([
	["left", [-1, 0]],
	["right", [1, 0]],
	["up", [0, 1]],
	["down", [0, -1]],
]);

export const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
	{ value: "up", label: "Up" },
	{ value: "down", label: "Down" },
];

/** Unit axis vector for a direction param; unknown values fall back safely. */
export function directionVector({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: Direction;
}): [number, number] {
	const value = params[key];
	return (
		(typeof value === "string" ? DIRECTION_VECTORS.get(value) : undefined) ??
		DIRECTION_VECTORS.get(fallback) ??
		[1, 0]
	);
}
