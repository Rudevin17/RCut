import { describe, expect, test } from "bun:test";
import { COMBO_PRESETS, IDENTITY_DELTA, IN_PRESETS, OUT_PRESETS, backOut, bounceOut } from "@/motion/presets";

const canvas = { width: 1920, height: 1080 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const expectIdentity = (delta: typeof IDENTITY_DELTA) => {
	close(delta.dx, 0); close(delta.dy, 0); close(delta.scale, 1); close(delta.rotate, 0); close(delta.opacity, 1);
};

describe("easing", () => {
	test("backOut and bounceOut end at 1", () => {
		close(backOut(1), 1);
		close(bounceOut(1), 1);
		close(bounceOut(0), 0);
	});
});

describe("presets", () => {
	test("ids match the spec", () => {
		expect(IN_PRESETS.map((p) => p.id)).toEqual(["fade-in", "zoom-in", "zoom-out", "slide-left", "slide-right", "slide-top", "slide-bottom", "spin-in", "pop", "drop"]);
		expect(OUT_PRESETS.map((p) => p.id)).toEqual(["fade-out", "zoom-in", "zoom-out", "slide-left", "slide-right", "slide-top", "slide-bottom", "spin-out", "pop-out"]);
		expect(COMBO_PRESETS.map((p) => p.id)).toEqual(["pulse", "sway", "shake", "float", "wobble"]);
	});

	test("every In preset is identity at p = 1", () => {
		for (const preset of IN_PRESETS) expectIdentity(preset.delta({ p: 1, canvas }));
	});

	test("every Out preset is identity at q = 0", () => {
		for (const preset of OUT_PRESETS) expectIdentity(preset.delta({ q: 0, canvas }));
	});

	test("starting states", () => {
		const get = (id: string) => IN_PRESETS.find((p) => p.id === id)!;
		close(get("fade-in").delta({ p: 0, canvas }).opacity, 0);
		close(get("slide-left").delta({ p: 0, canvas }).dx, -1920);
		close(get("slide-bottom").delta({ p: 0, canvas }).dy, 1080);
		close(get("zoom-out").delta({ p: 0, canvas }).scale, 1.4);
		const out = (id: string) => OUT_PRESETS.find((p) => p.id === id)!;
		close(out("fade-out").delta({ q: 1, canvas }).opacity, 0);
		close(out("slide-top").delta({ q: 1, canvas }).dy, -1080);
	});

	test("fade-in is monotonic", () => {
		const fade = IN_PRESETS.find((p) => p.id === "fade-in")!;
		let last = -1;
		for (let i = 0; i <= 20; i++) {
			const value = fade.delta({ p: i / 20, canvas }).opacity;
			expect(value).toBeGreaterThanOrEqual(last);
			last = value;
		}
	});

	test("combo presets are identity at phase 0 and periodic over 2π", () => {
		for (const preset of COMBO_PRESETS) {
			expectIdentity(preset.delta({ phase: 0, canvas }));
			const a = preset.delta({ phase: 1.3, canvas });
			const b = preset.delta({ phase: 1.3 + 2 * Math.PI, canvas });
			close(a.dx, b.dx); close(a.dy, b.dy); close(a.scale, b.scale); close(a.rotate, b.rotate);
		}
	});
});
