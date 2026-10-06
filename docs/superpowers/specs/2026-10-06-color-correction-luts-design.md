# Color Correction + LUTs: Design

**Date:** 2026-10-06
**Status:** Design approved by the user, section by section.
**Roadmap:** sub-project 2 of `2026-10-04-pro-features-roadmap.md`. This work builds the general GPU effect foundation that #6 (clip effects and adjustment layers) will reuse.

## Goal

Add two new effects, **Color** and **LUT**:
- Color is basic grading: exposure, contrast, tone, saturation and white balance.
- LUT applies a 3D colour look. Users can import `.cube` files into an app-wide library, and RCut ships six looks of its own.

Both effects work wherever RCut effects already work:
- in a clip's effect stack;
- on an **effect layer** (an `EffectElement` on an effect track), which grades everything below it.

They also work identically in preview and export.

## Non-goals

- Colour wheels (lift/gamma/gain), curves, HSL qualifiers, scopes.
- 1D LUTs, `.3dl` or other LUT formats.
- Higher-precision intermediate frames. Frames between passes stay 8-bit.
- Sharing the LUT library between machines.

## Current state (verified 2026-10-06)

**Effect model (web)**
- An effect is `{ id, type, params, enabled }`.
- Visual elements carry `effects?: Effect[]`.
- `EffectElement { effectType }` on an `EffectTrack` renders as a `sceneEffect` frame item. It applies its passes to the composite of everything below it (`compositor/frame-descriptor.ts`).

**Effect definitions** (`apps/web/src/effects/definitions/`)
- Each definition is `{ type, name, keywords, params: ParamDefinition[], renderer: { passes: EffectPassTemplate[], buildPasses? } }`.
- A pass is `{ shader, uniforms: Record<string, number | number[]> }`.
- Blur is the only effect.

**Rust pipeline** (`rust/crates/effects/src/pipeline.rs`)
- Blur is hard-wired. There is one shader module, `gaussian_blur.wgsl`.
- `pack_effect_uniforms` accepts only `u_sigma`, `u_step` and `u_direction`.

**Frames**
- Frames are `Rgba8Unorm`/`Bgra8Unorm` textures. They are not sRGB-typed and hold sRGB-encoded values.

**Parameter types:** `number`, `boolean`, `color`, `select`, `text` and `font` (`params/index.ts`). There is no file or LUT parameter type yet.

## Design

### 1. Effects (user-facing)

**Color** (`type: "color"`, shader `color-adjust`)

| Param | Range | Default |
| --- | --- | --- |
| Exposure | −4 … +4 stops, step 0.05 | 0 |
| Contrast, Highlights, Shadows, Whites, Blacks | −100 … +100 | 0 |
| Saturation, Vibrance | −100 … +100 | 0 |
| Temperature, Tint | −100 … +100 | 0 |

With every value at its default, the effect must leave the image unchanged, apart from float rounding.

**LUT** (`type: "lut"`, shader `lut-3d`)
- `lut`: a new param type `"lut"` holding a library id string. It defaults to `"builtin:teal-orange"`.
- `intensity`: 0 … 100, default 100.

**Built-in looks.** RCut generates these in code at size 33, so no LUT files ship and nothing needs licensing:
- `builtin:teal-orange` (Teal & Orange)
- `builtin:warm-film` (Warm Film)
- `builtin:cool-night` (Cool Night)
- `builtin:black-white` (Black & White)
- `builtin:faded` (Faded)
- `builtin:vivid` (Vivid)

### 2. Colour maths

**Color shader.** Let `Y(c) = dot(c, (0.2126, 0.7152, 0.0722))`, and let each ±100 control `k` be normalised to `kN = k / 100`. The shader runs these steps in order:

1. **Decode.** `lin = srgb_to_linear(rgb)`.
2. **White balance.** `lin *= (1 + 0.25·tempN, 1 − 0.25·tintN, 1 − 0.25·tempN)`. Positive temperature is warmer; positive tint is more magenta.
3. **Exposure.** `lin *= 2^exposure`.
4. **Re-encode.** `x = linear_to_srgb(lin)`.
5. **Whites/Blacks (levels).** `lo = −0.1·blacksN` and `hi = 1 − 0.1·whitesN`. Then `x = (x − lo) / (hi − lo)`.
6. **Shadows/Highlights.**
   - `sMask = 1 − smoothstep(0, 0.5, Y(x))`
   - `hMask = smoothstep(0.5, 1, Y(x))`
   - `x += 0.25·shadowsN·sMask + 0.25·highlightsN·hMask`
7. **Contrast.** `x = (x − 0.5)·(1 + contrastN) + 0.5`.
8. **Saturation.** `x = mix(vec3(Y(x)), x, 1 + saturationN)`.
9. **Vibrance.** `sat = max(x) − min(x)`, then `x = mix(vec3(Y(x)), x, 1 + vibranceN·(1 − sat))`.
10. **Clamp.** `x = clamp(x, 0, 1)`. Alpha is unchanged.

**Packed params, in this order:** `[exposure, contrastN, highlightsN, shadowsN, whitesN, blacksN, saturationN, vibranceN, tempN, tintN]`.

**LUT shader.**
1. `u = clamp((x − domainMin) / (domainMax − domainMin), 0, 1)`.
2. `coord = u·(size − 1)/size + 0.5/size`. This samples texel centres.
3. `graded = textureSampleLevel(lut, sampler, coord, 0).rgb`, using hardware trilinear filtering.
4. `out = mix(x, graded, intensity)`.

**Packed params:** `[intensity (0–1), size, dMinR, dMinG, dMinB, dMaxR, dMaxG, dMaxB]`.

**Built-in look formulas.** Input `c` is sRGB-encoded in [0, 1]. Every output is clamped to [0, 1].

| Look | Formula |
| --- | --- |
| black-white | `vec3(Y)` |
| vivid | `mix(vec3(Y), c, 1.35)`, then contrast `(x − 0.5)·1.1 + 0.5` |
| faded | `x = 0.08 + c·0.84`, then `mix(vec3(Y(x)), x, 0.8)` |
| warm-film | `(r·1.06 + 0.02, g, b·0.9)`, then 30% blend toward `smoothstep(0, 1, x)` |
| cool-night | `(r·0.85, g·0.95, b·1.1 + 0.03)·0.9` |
| teal-orange | `c + (−0.04, 0.02, 0.06)·(1 − Y) + (0.08, 0.02, −0.06)·Y`, then `mix(vec3(Y), x, 1.1)` |

### 3. GPU pipeline (Rust)

**Shader registry.** `EFFECT_SHADERS: [(&str, &str)]` lists `gaussian-blur`, `color-adjust` and `lut-3d`, following the transitions pattern. One render pipeline is created per registered shader when the `EffectPipeline` is created. There are only three shaders, so creating them all up front is cheap and keeps `apply()` free of interior mutability.

**Uniform buffer:**
```
struct EffectUniforms {
    resolution: vec2f,
    _pad: vec2f,
    params: array<vec4f, 4>,
}
```
That is 16 float slots. Blur is ported to it: `params[0] = (sigma, step, dirX, dirY)`. Blur's output must stay pixel-identical.

**LUT binding.** Bind group 2 holds a `texture_3d<f32>` and a linear sampler, and is always bound. When a pass has no LUT, it gets a 1×1×1 placeholder.

**EffectPass (serde, camelCase):** `{ shader: String, params: Vec<f32>, lut: Option<String> }`.
- Unknown shaders return an error.
- Passes with more than 16 params return an error.

**LUT cache.**
- The compositor owns `HashMap<String, wgpu::Texture>`.
- WASM exports `registerLut({ id, size, data: Float32Array })`. `data` is RGB in `.cube` order: R fastest, then G, then B. It is uploaded as an `Rgba8Unorm` 3D texture, with x = R, y = G, z = B.
- WASM also exports `hasLut(id)`.
- A pass whose LUT is not registered is skipped and passes its input through. It is not an error.

**Validation.** naga validates every effect shader in a unit test, as transitions already do.

### 4. Web side

**Effect types.**
- `EffectPass` becomes `{ shader: string; params: number[]; lut?: string }`.
- `EffectPassTemplate.uniforms` becomes `params(...) → number[]`, plus an optional `lut(...)`.
- Blur, `buildGaussianBlurPasses` and every other producer of passes (for example the blur background) are ported.

**Definitions.**
- `effects/definitions/color.ts` and `effects/definitions/lut.ts` are added to the registry. Both appear in the existing Effects panel automatically.
- The LUT definition's pass carries `lut: <id>`. Its params include the size and domain looked up from the library entry.

**Param type `"lut"`.**
- Add it to the `ParamDefinition` union.
- `PropertyParamField` renders a `LutParamField`:
  - a Select with two groups, **Built-in** and **My LUTs**;
  - **Import .cube…**, a hidden file input that accepts `.cube`;
  - a **Remove from library** button, shown when a custom LUT is selected;
  - a **LUT missing** note, shown when the id isn't found.

**Pure modules** (`apps/web/src/luts/`)
- `cube-parser.ts` provides `parseCubeLut({ text }) → { title, size, domainMin, domainMax, data: Float32Array }`.
  - It ignores comments (`#`) and blank lines, and reads `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN` and `DOMAIN_MAX`.
  - It requires exactly `size³` RGB rows.
  - It rejects `LUT_1D_SIZE`, sizes outside 2–65, wrong row counts and non-numeric values, each with a clear message.
- `builtin-looks.ts` provides `BUILTIN_LOOKS: Array<{ id, name }>` and `generateBuiltinLut({ id }) → { size: 33, domainMin: [0,0,0], domainMax: [1,1,1], data }`, using the formulas above.

**LUT library** (`apps/web/src/services/lut-library/`)
- **Storage.** IndexedDB database `rcut-luts`, store `luts`. Each record is `{ id, name, size, domainMin, domainMax, data: Float32Array, importedAt }`.
- **Store.** A zustand store `useLutLibrary` with `luts`, `load()`, `importFile({ file })` and `remove({ id })`.
  - `importFile` parses the file. The name comes from `TITLE`, or the file name if there is no title. It stores the LUT and returns its id.
- **Lookup.** `getLut({ id })` resolves built-ins by generating them once, with memoisation, and resolves library entries from memory.

**Registration with the renderer.**
- Before each frame is rendered, in both preview and export, the renderer collects the `lut` ids of the frame's passes.
- For each id that isn't registered yet, it calls `getLut` and then `registerLut`.
- It is the same code path for preview and export.

### 5. Errors

- A bad `.cube` file fails with a toast that carries the parser's message. Nothing is stored.
- A LUT id that can't be found (deleted from the library):
  - the pass is skipped, so the clip renders ungraded;
  - the panel shows **LUT missing**;
  - export doesn't fail.
- Deleting a library LUT that is in use is allowed. The effects that use it become "LUT missing".

## Testing

**bun:test**
- **Parser:**
  - a valid 2³ file with comments and a title;
  - `DOMAIN_MIN`/`DOMAIN_MAX`;
  - a wrong row count, a 1D LUT, a size above 65 and non-numeric values are all rejected.
- **Built-ins:**
  - black-white output has r = g = b;
  - every look keeps its outputs in [0, 1];
  - `data.length` is `33³·3`.
- **Packing:**
  - Color defaults pack to `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]`;
  - LUT packing carries the size and domain;
  - blur's packing matches its old values.

**cargo**
- naga validates all effect shaders.
- An uniform-layout size test.

**Manual, in `rcut.exe` (CDP)**
- Exposure +1 brightens the preview: the mean frame luminance rises.
- The Black & White LUT makes sampled pixels grey (r ≈ g ≈ b).
- An imported identity `.cube` produces no visible change.
- A Color effect on an effect layer affects every clip below it.
- An exported MP4 frame shows the grade: compare an ffmpeg-extracted frame with the preview.
