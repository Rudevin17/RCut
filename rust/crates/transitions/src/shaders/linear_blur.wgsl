// Linear Blur — ported from gl-transitions "LinearBlur.glsl"
// Author: gre
// License: MIT
// Uniform fixed at its default: intensity 0.1.

const LINEAR_BLUR_INTENSITY: f32 = 0.1;
const LINEAR_BLUR_PASSES: i32 = 6;

fn transition(uv: vec2f) -> vec4f {
    var c1 = vec4f(0.0);
    var c2 = vec4f(0.0);
    let disp = LINEAR_BLUR_INTENSITY * (0.5 - distance(0.5, progress));
    for (var xi = 0; xi < LINEAR_BLUR_PASSES; xi = xi + 1) {
        let x = f32(xi) / f32(LINEAR_BLUR_PASSES) - 0.5;
        for (var yi = 0; yi < LINEAR_BLUR_PASSES; yi = yi + 1) {
            let y = f32(yi) / f32(LINEAR_BLUR_PASSES) - 0.5;
            let offset = disp * vec2f(x, y);
            c1 = c1 + getFromColor(uv + offset);
            c2 = c2 + getToColor(uv + offset);
        }
    }
    let count = f32(LINEAR_BLUR_PASSES * LINEAR_BLUR_PASSES);
    return mix(c1 / count, c2 / count, progress);
}
