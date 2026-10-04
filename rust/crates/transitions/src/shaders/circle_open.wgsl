// Circle — ported from gl-transitions "circleopen.glsl"
// Author: gre
// License: MIT
// Uniforms fixed at their defaults: smoothness 0.3, opening true.

const CIRCLE_SMOOTHNESS: f32 = 0.3;
const CIRCLE_SQRT_2: f32 = 1.414213562373;

fn transition(uv: vec2f) -> vec4f {
    let m = smoothstep(
        -CIRCLE_SMOOTHNESS,
        0.0,
        CIRCLE_SQRT_2 * distance(vec2f(0.5), uv) - progress * (1.0 + CIRCLE_SMOOTHNESS),
    );
    return mix(getFromColor(uv), getToColor(uv), 1.0 - m);
}
