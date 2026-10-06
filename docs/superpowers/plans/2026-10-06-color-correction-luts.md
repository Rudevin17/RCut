# Color Correction + LUTs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Color** effect (basic grading) and a **LUT** effect (six built-in looks, `.cube` import into an app-wide library). Both work on clip effect stacks and effect layers, in preview and export.

**Architecture:**
- The Rust effect pipeline is generalised. It gets a named shader registry, a shared WGSL prelude, 16 generic param slots and a 3D LUT texture binding. Blur is ported onto it.
- On the web side, effect passes become `{ shader, params, lut? }`.
- Pure TypeScript modules parse `.cube` files and generate the built-in looks.
- A zustand + IndexedDB library stores imported LUTs.
- The renderer uploads the LUTs each frame uses (`registerLut`) before rendering.

**Tech Stack:** Rust (wgpu 29, naga 29 for tests), wasm-bindgen, TypeScript/React (Next.js), zustand, IndexedDB, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-06-color-correction-luts-design.md`. The exact colour maths, param order, ranges and look formulas are there.

## Global Constraints

**Repo and git**
- Work in `D:\OpenCut` on branch `main`.
- **Commit messages must NOT contain any Co-Authored-By line or Claude attribution.**
- Change files with the Edit/Write tools only. No scripts or heredocs, except `git commit -F -`.

**Code style**
- TypeScript: tabs, double quotes, object-parameter functions, `bun:test` tests in `__tests__/`.
- Rust: rustfmt, tests in `#[cfg(test)]`.
- Read components before using them (AGENTS.md).

**Baselines**

| Check | Expected |
|---|---|
| `cd /d/OpenCut && bun test` | 297 pass / 4 fail (pre-existing wasm load errors) |
| `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 \| grep -c "error TS"` | 0 |
| `cd /d/OpenCut/rust && cargo test -p effects` | passes |
| `cd /d/OpenCut/rust && cargo test -p transitions` | passes |

**WASM rebuild:** after changing Rust that the web app uses, run `cd /d/OpenCut && bun run build:wasm`.

**Shader ids:** `gaussian-blur`, `color-adjust`, `lut-3d`.

**Param slot layouts** (exactly as in the spec):
- **Color:** `[exposure, contrast/100, highlights/100, shadows/100, whites/100, blacks/100, saturation/100, vibrance/100, temperature/100, tint/100]`
- **LUT:** `[intensity/100, size, dMinR, dMinG, dMinB, dMaxR, dMaxG, dMaxB]`
- **Blur:** `[sigma, step, dirX, dirY]`

**Effect frames:** effect-pass inputs are premultiplied-alpha RGBA8 holding sRGB-encoded values. Colour shaders un-premultiply, work on the colour, then re-premultiply.

**LUT ids:**
- built-ins are `builtin:<slug>`;
- library LUTs use `crypto.randomUUID()`.

---

## Task 1: Generalised Rust effect pipeline, colour/LUT shaders, WASM LUT API

**Files:**
- Create: `rust/crates/effects/src/shaders.rs`
- Create: `rust/crates/effects/src/shaders/prelude.wgsl`
- Create: `rust/crates/effects/src/shaders/color_adjust.wgsl`
- Create: `rust/crates/effects/src/shaders/lut_3d.wgsl`
- Modify: `rust/crates/effects/src/shaders/gaussian_blur.wgsl`, porting it to the prelude
- Modify: `rust/crates/effects/src/effects.rs`
- Modify: `rust/crates/effects/src/types.rs`
- Modify: `rust/crates/effects/src/pipeline.rs`
- Modify: `rust/crates/effects/Cargo.toml`, adding the naga dev-dependency as in `crates/transitions/Cargo.toml`
- Modify: `rust/crates/compositor/src/frame.rs` (`EffectPassDescriptor`)
- Modify: `rust/crates/compositor/src/compositor.rs` (`map_effect_passes`, plus a `register_lut`/`has_lut` passthrough)
- Modify: `rust/wasm/src/effects.rs` (`EffectPassInput`, plus the `registerLut`/`hasLut` exports)

**Interfaces it produces:**
- `EffectPass { shader: String, params: Vec<f32>, lut: Option<String> }`.
- `EffectPipeline` gains:
  - `register_lut(&mut self, context, id: &str, size: u32, data: &[f32])`;
  - `has_lut(&self, id) -> bool`.
- `Compositor` exposes the same two methods.
- The frame descriptor's `EffectPassDescriptor` serialises as `{ shader, params: number[], lut?: string }` (serde camelCase; `lut` is optional).
- WASM exports:
  - `registerLut({ id: string, size: number, data: Float32Array })`, which registers into **both** the GPU runtime's `EffectPipeline` and the compositor, if the compositor is initialised;
  - `hasLut(id: string): boolean`, which is true only when every initialised pipeline has the LUT.

- [ ] **Step 1: Failing tests.** In `shaders.rs`, write these tests first, so they fail to compile:
```rust
#[cfg(test)]
mod tests {
    use super::{EFFECT_SHADERS, effect_shader_source};

    #[test]
    fn every_effect_shader_is_valid_wgsl() {
        for (id, body) in EFFECT_SHADERS {
            let source = effect_shader_source(body);
            let module = naga::front::wgsl::parse_str(&source)
                .unwrap_or_else(|error| panic!("{id}: {}", error.emit_to_string(&source)));
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .unwrap_or_else(|error| panic!("{id}: {error:?}"));
        }
    }

    #[test]
    fn effect_shader_ids_are_unique_and_known() {
        let ids: Vec<&str> = EFFECT_SHADERS.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, ["gaussian-blur", "color-adjust", "lut-3d"]);
    }
}
```
Add this test to `pipeline.rs`:
```rust
#[cfg(test)]
mod tests {
    #[test]
    fn uniform_buffer_is_80_bytes() {
        assert_eq!(std::mem::size_of::<super::EffectUniformBuffer>(), 80);
    }
}
```

- [ ] **Step 2: Shaders.**

`shaders/prelude.wgsl`:
```wgsl
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    _pad: vec2f,
    params: array<vec4f, 4>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;
@group(2) @binding(0) var lut_texture: texture_3d<f32>;
@group(2) @binding(1) var lut_sampler: sampler;

fn param(index: u32) -> f32 {
    return uniforms.params[index / 4u][index % 4u];
}
```

`shaders/gaussian_blur.wgsl` becomes the old body without its struct and binding declarations:
```wgsl
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel_size = vec2f(1.0, 1.0) / uniforms.resolution;
    let sigma = param(0u);
    let step_size = param(1u);
    let direction = vec2f(param(2u), param(3u));

    var color = vec4f(0.0, 0.0, 0.0, 0.0);
    var total_weight = 0.0;

    for (var index = -30; index <= 30; index = index + 1) {
        let position = f32(index) * step_size;
        let weight = exp(-(position * position) / (2.0 * sigma * sigma));
        let sample_uv = input.tex_coord + (texel_size * direction * position);
        color = color + textureSample(input_texture, input_sampler, sample_uv) * weight;
        total_weight = total_weight + weight;
    }

    return color / total_weight;
}
```

`shaders/color_adjust.wgsl`:
```wgsl
// Basic grading. Params: [exposure, contrast, highlights, shadows, whites, blacks,
// saturation, vibrance, temperature, tint]. All but exposure are in -1..1.

fn srgb_to_linear(c: vec3f) -> vec3f {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3f(2.4));
    return select(high, low, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
    let low = c * 12.92;
    let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, c <= vec3f(0.0031308));
}

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    let alpha = source.a;
    if (alpha <= 0.0) {
        return vec4f(0.0);
    }
    var x = clamp(source.rgb / alpha, vec3f(0.0), vec3f(1.0));

    // White balance and exposure in linear light.
    var lin = srgb_to_linear(x);
    let temperature = param(8u);
    let tint = param(9u);
    lin = lin * vec3f(1.0 + 0.25 * temperature, 1.0 - 0.25 * tint, 1.0 - 0.25 * temperature);
    lin = lin * exp2(param(0u));
    x = linear_to_srgb(max(lin, vec3f(0.0)));

    // Whites/Blacks as levels.
    let lo = -0.1 * param(5u);
    let hi = 1.0 - 0.1 * param(4u);
    x = (x - lo) / (hi - lo);

    // Shadows/Highlights with smooth luminance masks.
    let tone = luma(x);
    let shadow_mask = 1.0 - smoothstep(0.0, 0.5, tone);
    let highlight_mask = smoothstep(0.5, 1.0, tone);
    x = x + 0.25 * param(3u) * shadow_mask + 0.25 * param(2u) * highlight_mask;

    // Contrast around mid grey.
    x = (x - 0.5) * (1.0 + param(1u)) + 0.5;

    // Saturation, then vibrance (stronger on less saturated colours).
    x = mix(vec3f(luma(x)), x, 1.0 + param(6u));
    let saturation = max(max(x.r, x.g), x.b) - min(min(x.r, x.g), x.b);
    x = mix(vec3f(luma(x)), x, 1.0 + param(7u) * (1.0 - saturation));

    x = clamp(x, vec3f(0.0), vec3f(1.0));
    return vec4f(x * alpha, alpha);
}
```

`shaders/lut_3d.wgsl`:
```wgsl
// 3D LUT. Params: [intensity, size, domainMin.rgb, domainMax.rgb].

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    let alpha = source.a;
    if (alpha <= 0.0) {
        return vec4f(0.0);
    }
    let x = clamp(source.rgb / alpha, vec3f(0.0), vec3f(1.0));
    let intensity = param(0u);
    let size = param(1u);
    let domain_min = vec3f(param(2u), param(3u), param(4u));
    let domain_max = vec3f(param(5u), param(6u), param(7u));
    let u = clamp((x - domain_min) / (domain_max - domain_min), vec3f(0.0), vec3f(1.0));
    // Sample texel centres so 0 and 1 map exactly to the first and last LUT entries.
    let coord = u * (size - 1.0) / size + 0.5 / size;
    let graded = textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).rgb;
    return vec4f(mix(x, graded, intensity) * alpha, alpha);
}
```

`shaders.rs`:
```rust
//! Effect shaders. Each body is appended to the shared prelude.

pub const EFFECT_PRELUDE: &str = include_str!("shaders/prelude.wgsl");

pub const EFFECT_SHADERS: [(&str, &str); 3] = [
    ("gaussian-blur", include_str!("shaders/gaussian_blur.wgsl")),
    ("color-adjust", include_str!("shaders/color_adjust.wgsl")),
    ("lut-3d", include_str!("shaders/lut_3d.wgsl")),
];

pub fn effect_shader_source(body: &str) -> String {
    format!("{EFFECT_PRELUDE}\n{body}")
}
```

- [ ] **Step 3: Pipeline.**

**`types.rs`:**
- Change to `pub struct EffectPass { pub shader: String, pub params: Vec<f32>, pub lut: Option<String> }`.
- Remove `UniformValue`.
- Export `MAX_EFFECT_PARAMS: usize = 16`.

**`pipeline.rs`:**
- **Uniforms:** `#[repr(C)] #[derive(Clone, Copy, Pod, Zeroable)] struct EffectUniformBuffer { resolution: [f32; 2], pad: [f32; 2], params: [[f32; 4]; 4] }`. `pack_effect_uniforms` copies `pass.params` into the 16 slots, padding with zeros. More than 16 params returns `EffectsError::TooManyParams { shader, count }`.
- **Remove dead variants:** remove the `MissingUniform`, `InvalidNumberUniform`, `InvalidVectorUniform` and `UnsupportedUniform` error variants, and the uniform readers.
- **LUT bind group layout** (group 2): binding 0 is a `texture_3d` (float, filterable, `TextureViewDimension::D3`) and binding 1 is a filtering sampler. The pipeline layout becomes `[texture_sampler, uniform, lut]`.
- **Pipelines:** for every `(id, body)` in `EFFECT_SHADERS`, create one shader module from `effect_shader_source(body)` and one render pipeline, using the same vertex state, targets and primitive state as today. Store them in `HashMap<String, wgpu::RenderPipeline>`.
- **Placeholder LUT:** in `new()`, create a 1×1×1 `Rgba8Unorm` 3D texture holding white, plus its bind group. It is used whenever a pass has no `lut`.
- **`register_lut(&mut self, context, id, size, data)`:**
  1. Create a `size³` 3D `Rgba8Unorm` texture with `TEXTURE_BINDING | COPY_DST`.
  2. Convert `data` (RGB f32, R fastest) to RGBA8, using `(v.clamp(0,1)·255).round()` and alpha 255.
  3. Upload with `queue.write_texture`, using `bytes_per_row = size·4` and `rows_per_image = size`.
  4. Build a bind group with `context.linear_sampler()`.
  5. Store it in `luts: HashMap<String, wgpu::BindGroup>`. Registering the same id again replaces it.
- **`has_lut`** is a plain lookup.
- **`apply_with_encoder`:**
  - Drop passes whose `lut` is `Some(id)` with an unregistered id.
  - If nothing is left, create a render texture, blit `source` into it with `context.encode_texture_blit_to_view`, and return it. Do not error.
  - Otherwise run the remaining passes as today, binding group 2 to the pass's LUT bind group or the placeholder.
  - An unknown shader still returns `UnknownEffectShader`.

**`effects.rs`:** add `mod shaders;` and `pub use shaders::{EFFECT_SHADERS, effect_shader_source};`. Re-export `MAX_EFFECT_PARAMS`.

**Compositor:**
- `frame.rs`: `EffectPassDescriptor { pub shader: String, pub params: Vec<f32>, #[serde(default)] pub lut: Option<String> }`. Remove `EffectUniformValueDescriptor`.
- `compositor.rs`: `map_effect_passes` maps the three fields directly. Add `register_lut` and `has_lut` methods that delegate to `self.effects`.

**WASM (`rust/wasm/src/effects.rs`):**
- `EffectPassInput { shader, params: Vec<f32>, #[serde(default)] lut: Option<String> }`. Remove `EffectUniformInput`.
- Add `#[wasm_bindgen(js_name = registerLut)] pub fn register_lut(options: JsValue) -> Result<(), JsValue>`.
  - It reads `id` (string), `size` (u32) and `data` (a `Float32Array`; convert with `js_sys::Float32Array::from(value).to_vec()`).
  - It validates `data.len() == size³·3`.
  - It registers into `runtime.effects`, and into the compositor if one exists. Read `rust/wasm/src/compositor.rs` for how the compositor singleton is stored and borrowed.
- Add `#[wasm_bindgen(js_name = hasLut)] pub fn has_lut(id: String) -> bool`.
- Match the crate's existing patterns for `read_*_property`.

- [ ] **Step 4: Verify.**
  - `cd /d/OpenCut/rust && cargo test -p effects 2>&1 | grep "test result"` → passes, including the 3 new tests.
  - `cargo test -p transitions` → passes.
  - `cargo test -p compositor` → passes, if the crate has tests.
  - `cargo check --target wasm32-unknown-unknown -p opencut-wasm` → `Finished`.
  - `cargo fmt --check` → clean.
  - `cd /d/OpenCut && bun run build:wasm` → succeeds.

  The web app won't typecheck until Task 3. That is expected; do not fix TypeScript in this task.

- [ ] **Step 5: Commit** (no Co-Authored-By): `feat(renderer): general effect pipeline with colour and 3D LUT shaders`

---

## Task 2: Pure LUT modules (cube parser, built-in looks)

**Files:**
- Create: `apps/web/src/luts/cube-parser.ts`
- Create: `apps/web/src/luts/builtin-looks.ts`
- Test: `apps/web/src/luts/__tests__/cube-parser.test.ts`
- Test: `apps/web/src/luts/__tests__/builtin-looks.test.ts`

**Interfaces it produces:**
- `type Rgb = [number, number, number]`
- `interface LutData { size: number; domainMin: Rgb; domainMax: Rgb; data: Float32Array }`
- `interface CubeLut extends LutData { title: string | null }`
- `class CubeParseError extends Error`
- `parseCubeLut({ text }): CubeLut`
- `BUILTIN_LOOKS: Array<{ id: string; name: string }>`
- `isBuiltinLutId(id: string): boolean`
- `getBuiltinLut({ id }): LutData | null`, memoised

- [ ] **Step 1: Failing tests.**

`cube-parser.test.ts`:
```ts
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
```

`builtin-looks.test.ts`:
```ts
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
```

Run `cd /d/OpenCut && bun test apps/web/src/luts/__tests__/`. It should FAIL because the modules are missing (RED).

- [ ] **Step 2: `cube-parser.ts`.**
```ts
export type Rgb = [number, number, number];

export interface LutData {
	size: number;
	domainMin: Rgb;
	domainMax: Rgb;
	/** RGB triples in .cube order: red changes fastest, then green, then blue. */
	data: Float32Array;
}

export interface CubeLut extends LutData {
	title: string | null;
}

export class CubeParseError extends Error {}

const MIN_SIZE = 2;
const MAX_SIZE = 65;

function parseTriple({ parts, line }: { parts: string[]; line: string }): Rgb {
	const values = parts.slice(0, 3).map(Number);
	if (values.length < 3 || values.some((value) => !Number.isFinite(value))) {
		throw new CubeParseError(`Invalid numbers in line: "${line}"`);
	}
	return [values[0], values[1], values[2]];
}

/** Parses an Adobe/Resolve .cube 3D LUT. */
export function parseCubeLut({ text }: { text: string }): CubeLut {
	let title: string | null = null;
	let size: number | null = null;
	let domainMin: Rgb = [0, 0, 0];
	let domainMax: Rgb = [1, 1, 1];
	const values: number[] = [];

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const parts = line.split(/\s+/);
		const keyword = parts[0];

		if (keyword === "TITLE") {
			title = line.slice("TITLE".length).trim().replace(/^"|"$/g, "") || null;
			continue;
		}
		if (keyword === "LUT_1D_SIZE") {
			throw new CubeParseError("1D LUTs aren't supported. Use a 3D .cube LUT.");
		}
		if (keyword === "LUT_3D_SIZE") {
			const parsed = Number(parts[1]);
			if (!Number.isInteger(parsed) || parsed < MIN_SIZE || parsed > MAX_SIZE) {
				throw new CubeParseError(`LUT size must be between ${MIN_SIZE} and ${MAX_SIZE} (got ${parts[1]}).`);
			}
			size = parsed;
			continue;
		}
		if (keyword === "DOMAIN_MIN") {
			domainMin = parseTriple({ parts: parts.slice(1), line });
			continue;
		}
		if (keyword === "DOMAIN_MAX") {
			domainMax = parseTriple({ parts: parts.slice(1), line });
			continue;
		}
		// Other keywords (e.g. LUT_3D_INPUT_RANGE) are ignored.
		if (/^[A-Za-z_]/.test(keyword)) continue;

		values.push(...parseTriple({ parts, line }));
	}

	if (size === null) throw new CubeParseError("Missing LUT_3D_SIZE.");
	if (domainMax.some((max, channel) => max <= domainMin[channel])) {
		throw new CubeParseError("DOMAIN_MAX must be greater than DOMAIN_MIN on every channel.");
	}
	const expectedRows = size ** 3;
	if (values.length !== expectedRows * 3) {
		throw new CubeParseError(
			`Expected ${expectedRows} color rows for a ${size}³ LUT, found ${values.length / 3}.`,
		);
	}
	return { title, size, domainMin, domainMax, data: Float32Array.from(values) };
}
```

- [ ] **Step 3: `builtin-looks.ts`.** The formulas are taken verbatim from the spec.
```ts
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
```

- [ ] **Step 4: Verify.**
  - Run `bun test apps/web/src/luts/__tests__/` and confirm all pass (GREEN).
  - Run tsc. Only Task 1's expected pass-type errors may remain, and those come from Task 3's files. Report the count; don't fix them here.

- [ ] **Step 5: Commit** (no Co-Authored-By): `feat(luts): .cube parser and built-in looks`

---

## Task 3: Web effect passes, Color/LUT definitions, LUT library, renderer registration

**Files:**
- Modify: `apps/web/src/effects/types.ts`
- Modify: `apps/web/src/effects/index.ts`
- Modify: `apps/web/src/effects/definitions/blur.ts`
- Modify: `apps/web/src/effects/definitions/index.ts`
- Create: `apps/web/src/effects/definitions/color.ts`
- Create: `apps/web/src/effects/definitions/lut.ts`
- Create: `apps/web/src/services/lut-library/index.ts`
- Create: `apps/web/src/services/renderer/compositor/lut-registration.ts`
- Modify: `apps/web/src/services/renderer/compositor/wasm-compositor.ts`. Call registration before `renderFrame`.
- Modify: `apps/web/src/services/renderer/gpu-renderer.ts`. Change `serializeEffectPasses` to `{ shader, params, lut }`, and register LUTs before `applyEffectPasses`.
- Modify: the TS frame-descriptor types for effect passes in `services/renderer/compositor/types.ts`, and every producer found by grep.
- Modify: `apps/web/src/params/index.ts`. Add `LutParamDefinition` (`type: "lut"`, `default: string`, `channels?: LeafChannelLayout<string>`, the same shape as Font) to the union. Fix every exhaustive switch tsc flags, treating `"lut"` like `"font"`.
- Modify: `apps/web/src/components/providers/editor-provider.tsx`. `await useLutLibrary.getState().load()` before `loadProject`.
- Test: `apps/web/src/effects/__tests__/color-lut-definitions.test.ts`

**Interfaces it produces:**
- `EffectPass = { shader: string; params: number[]; lut?: string }`
- `EffectPassTemplate = { shader; params(args): number[]; lut?(args): string | undefined }`
- `getLut({ id }): LutData | null`, which resolves built-ins and library entries synchronously
- `useLutLibrary`: a zustand store with:
  - `luts: Array<{ id: string; name: string }>`
  - `loaded: boolean`
  - `load(): Promise<void>`, idempotent
  - `importFile({ file }): Promise<string>`, which returns the new id and throws `CubeParseError` on bad files
  - `remove({ id }): Promise<void>`
- `ensureLutsRegistered({ passes }: { passes: EffectPass[] }): void`
  1. For each distinct `pass.lut` where `!hasLut(id)`, call `getLut`.
  2. If it's found, `registerLut({ id, size, data })`.

- [ ] **Step 1: Failing tests.** Write `color-lut-definitions.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { buildDefaultParamValues } from "@/params/registry";
import { resolveEffectPasses } from "@/effects";
import { colorEffectDefinition } from "@/effects/definitions/color";
import { lutEffectDefinition } from "@/effects/definitions/lut";
import { blurEffectDefinition } from "@/effects/definitions/blur";

const resolve = (definition: typeof colorEffectDefinition, params = {}) =>
	resolveEffectPasses({
		definition,
		effectParams: { ...buildDefaultParamValues(definition.params), ...params },
		width: 1920,
		height: 1080,
	});

describe("color effect", () => {
	test("defaults are a no-op pass", () => {
		expect(resolve(colorEffectDefinition)).toEqual([{ shader: "color-adjust", params: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
	});

	test("packs controls in spec order, normalised", () => {
		const [pass] = resolve(colorEffectDefinition, {
			exposure: 1.5, contrast: 20, highlights: -30, shadows: 40, whites: 10,
			blacks: -10, saturation: 50, vibrance: -50, temperature: 100, tint: -100,
		});
		expect(pass.params).toEqual([1.5, 0.2, -0.3, 0.4, 0.1, -0.1, 0.5, -0.5, 1, -1]);
	});
});

describe("lut effect", () => {
	test("built-in default packs intensity, size and domain with the LUT id", () => {
		expect(resolve(lutEffectDefinition)).toEqual([
			{ shader: "lut-3d", lut: "builtin:teal-orange", params: [1, 33, 0, 0, 0, 1, 1, 1] },
		]);
		expect(resolve(lutEffectDefinition, { intensity: 40 })[0].params[0]).toBeCloseTo(0.4, 6);
	});

	test("an unknown LUT id produces no pass", () => {
		expect(resolve(lutEffectDefinition, { lut: "missing-id" })).toEqual([]);
	});
});

describe("blur effect", () => {
	test("keeps its sigma, step and direction in the generic params", () => {
		const passes = resolve(blurEffectDefinition, { intensity: 15 });
		expect(passes.every((pass) => pass.shader === "gaussian-blur" && pass.params.length === 4)).toBe(true);
		expect(passes[0].params.slice(2)).toEqual([1, 0]);
		expect(passes[1].params.slice(2)).toEqual([0, 1]);
	});
});
```
Run it. It should FAIL (RED).

- [ ] **Step 2: Types and blur port.**
  - `effects/types.ts`: drop `EffectUniformValue`, set the `EffectPass` and `EffectPassTemplate` shapes above, and keep `buildPasses`.
  - `effects/index.ts` `resolveEffectPasses`:
    ```ts
    return definition.renderer.passes.map((pass) => {
    	const lut = pass.lut?.({ effectParams, width, height });
    	return {
    		shader: pass.shader,
    		params: pass.params({ effectParams, width, height }),
    		...(lut ? { lut } : {}),
    	};
    });
    ```
  - `blur.ts`: every `uniforms` block becomes `params` with the values in this order: `[sigma, step, dirX, dirY]`. That covers `buildGaussianBlurPasses` and both templates. Grep for other producers of `{ shader: ... uniforms: ... }`, for example the blur background, and port them too.

- [ ] **Step 3: Definitions.**

`effects/definitions/color.ts`:
```ts
import type { NumberParamDefinition, ParamValues } from "@/params";
import type { EffectDefinition } from "@/effects/types";

const toneParam = (key: string, label: string): NumberParamDefinition => ({
	key, label, type: "number", default: 0, min: -100, max: 100, step: 1,
});

function readNumber({ params, key }: { params: ParamValues; key: string }): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const NORMALISED_KEYS = [
	"contrast", "highlights", "shadows", "whites", "blacks",
	"saturation", "vibrance", "temperature", "tint",
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
```
Read `params/index.ts` first to check `NumberParamDefinition`'s required fields, such as `BaseParamDefinition`. Adjust `toneParam` to satisfy the type without changing the values.

`effects/definitions/lut.ts`:
```ts
import type { EffectDefinition } from "@/effects/types";
import { getLut } from "@/services/lut-library";

export const DEFAULT_LUT_ID = "builtin:teal-orange";

export const lutEffectDefinition: EffectDefinition = {
	type: "lut",
	name: "LUT",
	keywords: ["lut", "look", "cube", "grade", "film", "cinematic"],
	params: [
		{ key: "lut", label: "Look", type: "lut", default: DEFAULT_LUT_ID },
		{ key: "intensity", label: "Intensity", type: "number", default: 100, min: 0, max: 100, step: 1 },
	],
	renderer: {
		passes: [],
		buildPasses: ({ effectParams }) => {
			const id = typeof effectParams.lut === "string" ? effectParams.lut : "";
			const lut = getLut({ id });
			if (!lut) return [];
			const rawIntensity = effectParams.intensity;
			const intensity = typeof rawIntensity === "number" && Number.isFinite(rawIntensity) ? rawIntensity : 100;
			return [
				{
					shader: "lut-3d",
					lut: id,
					params: [intensity / 100, lut.size, ...lut.domainMin, ...lut.domainMax],
				},
			];
		},
	},
};
```
Register both in `definitions/index.ts` after blur, following its existing pattern.

- [ ] **Step 4: LUT library** (`services/lut-library/index.ts`).
  - **Storage:** use IndexedDB database `rcut-luts`, object store `luts`, keyPath `id`. Read `apps/web/src/services/storage/` first. Reuse its IndexedDB adapter if it fits; if not, write a minimal `openDb()` with `indexedDB.open("rcut-luts", 1)` and `onupgradeneeded` creating the store.
  - **In memory:** keep the records in `const records = new Map<string, LutRecord>()`, where `LutRecord` is `{ id, name, size, domainMin, domainMax, data: Float32Array, importedAt }`.
  - **`getLut({ id })`:** `isBuiltinLutId(id) ? getBuiltinLut({ id }) : (records.get(id) ?? null)`.
  - **`useLutLibrary`** (zustand):
    - **`load()`:** no-op when already loaded. Otherwise read every record into `records`, then set `luts` to the sorted list of `{ id, name }` and set `loaded: true`.
    - **`importFile({ file })`:**
      1. `parseCubeLut({ text: await file.text() })`.
      2. The name is the parsed `title`, or the file name without `.cube`.
      3. The id is `crypto.randomUUID()`.
      4. Put the record into IndexedDB, then into `records`, then into `luts`.
      5. Return the id.
    - **`remove({ id })`:** delete the record from IndexedDB, `records` and `luts`.
  - Nothing may touch IndexedDB at import time, because bun tests import `getLut` through the LUT definition.

- [ ] **Step 5: Renderer registration.**
  - `lut-registration.ts` exports `ensureLutsRegistered({ passes })`. It uses the `hasLut` and `registerLut` exports from `opencut-wasm`. Check how other modules import WASM functions, for example `gpu-renderer.ts` and `applyEffectPasses`.
  - In `wasm-compositor.ts`, before `renderFrame(frame)`, collect every pass from every frame item's `effectPassGroups` (layers and `sceneEffect`), then call `ensureLutsRegistered`. Read the frame item types to find every field that carries passes.
  - In `gpu-renderer.ts`, call `ensureLutsRegistered({ passes })` before `applyEffectPasses`. Change `serializeEffectPasses` to map passes as `{ shader, params, lut }`.
  - Fix every other TS producer or consumer of the old `uniforms` shape that tsc reports.

- [ ] **Step 6: Param type and editor load.**
  - Add `LutParamDefinition` to `params/index.ts`.
  - Wherever tsc reports a non-exhaustive param-type switch, treat `"lut"` like `"font"`. This covers default values, serialisation and any non-animatable handling. Leave rendering in `PropertyParamField` as an unhandled fallthrough for now; Task 4 adds the field.
  - In `editor-provider.tsx`'s `loadProject`, `await useLutLibrary.getState().load()` before `editor.project.loadProject`, inside the existing try.

- [ ] **Step 7: Verify.**
  - The new tests pass.
  - tsc → `0`.
  - Root `bun test` → no new failures. The baseline is 297 pass / 4 pre-existing failures, plus the Task 2 and Task 3 tests.
  - `bun run build:wasm && bun run build:web` → succeeds.

- [ ] **Step 8: Commit** (no Co-Authored-By): `feat(effects): color and LUT effects with an app-wide LUT library`

---

## Task 4: LUT picker field in Properties

**Files:**
- Create: `apps/web/src/components/editor/panels/properties/components/lut-param-field.tsx`
- Modify: `apps/web/src/components/editor/panels/properties/components/property-param-field.tsx`. Add the `param.type === "lut"` branch, following how the `font` branch passes its value and its change handler.

**Behaviour:**
- **Select:** shows the current LUT's name.
  - Built-in names come from `BUILTIN_LOOKS`; library names come from `useLutLibrary().luts`.
  - If the id isn't found in either list, the trigger reads **"LUT missing"** in the destructive text colour.
  - The list has two groups, **Built-in** and **My LUTs**. Show the My LUTs group only when it is non-empty.
- **Import .cube…:** a button that clicks a hidden `<input type="file" accept=".cube">`.
  - On a chosen file, call `importFile({ file })`, then set the param to the returned id.
  - On a `CubeParseError` (or any error), show `toast.error("Couldn't import LUT", { description: error.message })`.
  - Reset the input value afterwards, so the same file can be picked again.
- **Remove:** when a library LUT (not a built-in) is selected, show an icon button with `aria-label` `Remove ${name} from library`. It calls `remove({ id })`. The param keeps its id, so the field then shows "LUT missing", as the spec requires.

Read the existing `select.tsx`, `button.tsx` and the `font` branch first, and match the styling of neighbouring fields.

**Verify:**
- tsc → `0`.
- Root `bun test` → no new failures.
- `bun run build:web` → succeeds.

**Commit** (no Co-Authored-By): `feat(effects): LUT picker with import and remove`

---

## Task 5: Real-app verification (controller)

- [ ] **Build:** release and profiling exes.
- [ ] **Over CDP, using the test project's clip:**
  - Add a Color effect with exposure +1. The mean luminance of the preview region rises versus no effect.
  - Add a LUT effect with `builtin:black-white`. Sampled preview pixels have r ≈ g ≈ b.
  - Import an identity `.cube` (generated to the scratchpad) through `useLutLibrary.getState().importFile`. A LUT effect using it leaves the preview unchanged within ±2/255.
  - Put a Color effect on an effect-track element over two clips. Both clips change.
- [ ] **Export:** export with a Black & White LUT, extract a frame with ffmpeg, and check that its pixels are neutral grey.
- [ ] **Blur parity:** compare a blur-effect screenshot before and after the change.
- [ ] **User review.**
