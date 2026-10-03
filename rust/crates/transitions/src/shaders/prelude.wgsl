// Shared prelude for transition shaders. Mirrors gl-transitions conventions:
// `progress` (0..1), `ratio` (width / height), `getFromColor` / `getToColor`,
// and uv with its origin at the bottom-left. Each transition defines
// `fn transition(uv: vec2f) -> vec4f`.

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct TransitionUniforms {
    resolution: vec2f,
    progress: f32,
    ratio: f32,
    params0: vec4f,
    params1: vec4f,
}

@group(0) @binding(0) var from_texture: texture_2d<f32>;
@group(0) @binding(1) var from_sampler: sampler;
@group(1) @binding(0) var to_texture: texture_2d<f32>;
@group(1) @binding(1) var to_sampler: sampler;
@group(2) @binding(0) var<uniform> uniforms: TransitionUniforms;

var<private> progress: f32;
var<private> ratio: f32;
var<private> params0: vec4f;
var<private> params1: vec4f;

// GLSL `mod` (floored), which differs from WGSL `%` for negative values.
fn glsl_mod(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

// Sampled with an explicit LOD so transitions may sample inside branches.
fn getFromColor(uv: vec2f) -> vec4f {
    return textureSampleLevel(from_texture, from_sampler, vec2f(uv.x, 1.0 - uv.y), 0.0);
}

fn getToColor(uv: vec2f) -> vec4f {
    return textureSampleLevel(to_texture, to_sampler, vec2f(uv.x, 1.0 - uv.y), 0.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    progress = uniforms.progress;
    ratio = uniforms.ratio;
    params0 = uniforms.params0;
    params1 = uniforms.params1;
    // Both sides are composited over transparent, so their colors are
    // premultiplied; return straight alpha because the compositor's blend
    // expects a straight-alpha layer.
    let color = transition(vec2f(input.tex_coord.x, 1.0 - input.tex_coord.y));
    let alpha = clamp(color.a, 0.0, 1.0);
    if (alpha <= 0.0) {
        return vec4f(0.0);
    }
    return vec4f(clamp(color.rgb / alpha, vec3f(0.0), vec3f(1.0)), alpha);
}
