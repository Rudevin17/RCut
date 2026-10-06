import { describe, expect, test } from "bun:test";
import { BUILTIN_LOOKS, getBuiltinLut, isBuiltinLutId } from "@/luts/builtin-looks";

describe("built-in looks", () => {
	test("lists the six looks", () => {
		expect(BUILTIN_LOOKS.map((look) => look.id)).toEqual([
			"builtin:teal-orange",
			"builtin:warm-film",
			"builtin:cool-night",
			"builtin:black-white",
			"builtin:faded",
			"builtin:vivid",
		]);
		expect(isBuiltinLutId("builtin:vivid")).toBe(true);
		expect(isBuiltinLutId("1234")).toBe(false);
	});

	test("every look is a 33³ LUT with values in [0, 1]", () => {
		for (const { id } of BUILTIN_LOOKS) {
			const lut = getBuiltinLut({ id });
			if (!lut) throw new Error(`${id} missing`);
			expect(lut.size).toBe(33);
			expect(lut.data.length).toBe(33 ** 3 * 3);
			expect(lut.data.every((value) => value >= 0 && value <= 1)).toBe(true);
		}
	});

	test("black & white is neutral everywhere", () => {
		const lut = getBuiltinLut({ id: "builtin:black-white" });
		if (!lut) throw new Error("missing");
		for (let i = 0; i < lut.data.length; i += 3) {
			expect(lut.data[i]).toBeCloseTo(lut.data[i + 1], 6);
			expect(lut.data[i + 1]).toBeCloseTo(lut.data[i + 2], 6);
		}
	});

	test("entries are in .cube order (red changes fastest)", () => {
		const lut = getBuiltinLut({ id: "builtin:black-white" });
		if (!lut) throw new Error("missing");
		// Entry 1 is input (1/32, 0, 0) → luma 0.2126/32.
		expect(lut.data[3]).toBeCloseTo(0.2126 / 32, 5);
	});

	test("unknown ids return null and results are memoised", () => {
		expect(getBuiltinLut({ id: "builtin:nope" })).toBeNull();
		expect(getBuiltinLut({ id: "builtin:vivid" })).toBe(getBuiltinLut({ id: "builtin:vivid" }));
	});
});
