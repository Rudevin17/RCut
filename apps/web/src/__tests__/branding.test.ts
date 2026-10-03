import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dir, "..");
const ALLOWED_PACKAGE = /opencut-wasm/gi;
const SELF = "branding.test.ts";

function listSourceFiles({ dir }: { dir: string }): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return listSourceFiles({ dir: path });
		return /\.(ts|tsx|css)$/.test(name) && name !== SELF ? [path] : [];
	});
}

describe("branding", () => {
	test("source has no upstream OpenCut branding", () => {
		const offenders = listSourceFiles({ dir: SRC_DIR }).filter((file) =>
			/opencut/i.test(readFileSync(file, "utf8").replace(ALLOWED_PACKAGE, "")),
		);
		expect(offenders).toEqual([]);
	});
});
