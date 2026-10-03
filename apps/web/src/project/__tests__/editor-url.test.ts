import { describe, expect, test } from "bun:test";
import { getEditorUrl } from "@/project/editor-url";

describe("getEditorUrl", () => {
	test("builds a query-based editor URL", () => {
		expect(getEditorUrl({ projectId: "abc123" })).toBe("/editor/?id=abc123");
	});

	test("encodes unsafe characters in the project id", () => {
		expect(getEditorUrl({ projectId: "a b&c" })).toBe(
			"/editor/?id=a%20b%26c",
		);
	});
});
