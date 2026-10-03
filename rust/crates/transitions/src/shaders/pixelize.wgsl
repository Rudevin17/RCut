// Pixelize — ported from gl-transitions "pixelize.glsl"
// Author: gre (forked from https://gist.github.com/benraziel/c528607361d90a072e98)
// License: MIT
// Uniforms fixed at their defaults: squaresMin 20, steps 50.

const PIXELIZE_SQUARES_MIN: f32 = 20.0;
const PIXELIZE_STEPS: f32 = 50.0;

fn transition(uv: vec2f) -> vec4f {
    let d = min(progress, 1.0 - progress);
    let dist = ceil(d * PIXELIZE_STEPS) / PIXELIZE_STEPS;
    let square_size = 2.0 * dist / vec2f(PIXELIZE_SQUARES_MIN);
    var p = uv;
    if (dist > 0.0) {
        p = (floor(uv / square_size) + 0.5) * square_size;
    }
    return mix(getFromColor(p), getToColor(p), progress);
}
