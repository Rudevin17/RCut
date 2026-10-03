// Block Dissolve — ported from gl-transitions "BlockDissolve.glsl"
// Author: nwoeanhinnogaehr
// License: MIT
// Uniform fixed at its default: blocksize 0.02.

const BLOCK_DISSOLVE_SIZE: f32 = 0.02;

fn block_dissolve_rand(co: vec2f) -> f32 {
    return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn transition(uv: vec2f) -> vec4f {
    let threshold = block_dissolve_rand(floor(uv / BLOCK_DISSOLVE_SIZE));
    return mix(getFromColor(uv), getToColor(uv), step(threshold, progress));
}
