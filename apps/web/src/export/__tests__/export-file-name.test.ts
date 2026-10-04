import { describe, expect, test } from "bun:test";
import {
	getExportFileName,
	joinExportPath,
} from "@/export/export-file-name";

describe("getExportFileName", () => {
	test("appends the extension to the project name", () => {
		expect(
			getExportFileName({ projectName: "My project", extension: ".mp4" }),
		).toBe("My project.mp4");
	});

	test("replaces characters Windows does not allow", () => {
		expect(
			getExportFileName({
				projectName: 'a<b>:c"d/e\\f|g?h*i',
				extension: ".mp4",
			}),
		).toBe("a_b__c_d_e_f_g_h_i.mp4");
	});

	test("removes trailing dots and spaces", () => {
		expect(
			getExportFileName({ projectName: "Final cut. . ", extension: ".mp4" }),
		).toBe("Final cut.mp4");
	});

	test("falls back to Untitled for empty names", () => {
		expect(getExportFileName({ projectName: "   ", extension: ".mp4" })).toBe(
			"Untitled.mp4",
		);
		expect(getExportFileName({ projectName: "...", extension: ".mp4" })).toBe(
			"Untitled.mp4",
		);
	});
});

describe("joinExportPath", () => {
	test("joins with a backslash", () => {
		expect(joinExportPath({ folder: "D:\\Exports", fileName: "a.mp4" })).toBe(
			"D:\\Exports\\a.mp4",
		);
	});

	test("does not double a trailing separator", () => {
		expect(joinExportPath({ folder: "D:\\", fileName: "a.mp4" })).toBe(
			"D:\\a.mp4",
		);
	});
});
