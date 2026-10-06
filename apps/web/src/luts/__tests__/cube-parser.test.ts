import { describe, expect, test } from "bun:test";
import { CubeParseError, parseCubeLut } from "@/luts/cube-parser";

const identity2 = [
	"# a comment",
	'TITLE "Identity"',
	"LUT_3D_SIZE 2",
	"",
	"0 0 0", "1 0 0", "0 1 0", "1 1 0",
	"0 0 1", "1 0 1", "0 1 1", "1 1 1",
].join("\n");

describe("parseCubeLut", () => {
	test("parses a 2³ LUT with comments and a title", () => {
		const lut = parseCubeLut({ text: identity2 });
		expect(lut.title).toBe("Identity");
		expect(lut.size).toBe(2);
		expect(lut.domainMin).toEqual([0, 0, 0]);
		expect(lut.domainMax).toEqual([1, 1, 1]);
		expect(Array.from(lut.data.slice(0, 6))).toEqual([0, 0, 0, 1, 0, 0]);
		expect(lut.data.length).toBe(24);
	});

	test("reads DOMAIN_MIN and DOMAIN_MAX and accepts CRLF", () => {
		const text = identity2.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 2\r\nDOMAIN_MIN 0 0 0\r\nDOMAIN_MAX 2 2 2");
		const lut = parseCubeLut({ text });
		expect(lut.domainMax).toEqual([2, 2, 2]);
	});

	test("rejects 1D LUTs", () => {
		expect(() => parseCubeLut({ text: "LUT_1D_SIZE 4\n0 0 0" })).toThrow(CubeParseError);
	});

	test("rejects sizes outside 2..65 and missing sizes", () => {
		expect(() => parseCubeLut({ text: "LUT_3D_SIZE 66" })).toThrow("between 2 and 65");
		expect(() => parseCubeLut({ text: "0 0 0" })).toThrow("LUT_3D_SIZE");
	});

	test("rejects the wrong number of rows", () => {
		expect(() => parseCubeLut({ text: "LUT_3D_SIZE 2\n0 0 0" })).toThrow("Expected 8");
	});

	test("rejects non-numeric values and an empty domain", () => {
		expect(() => parseCubeLut({ text: identity2.replace("1 1 1", "a b c") })).toThrow(CubeParseError);
		expect(() => parseCubeLut({ text: identity2.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 2\nDOMAIN_MAX 0 1 1") })).toThrow("DOMAIN");
	});
});
