// Overexposure — ported from gl-transitions "Overexposure.glsl"
// Author: Ben Zhang
// License: MIT
// Uniform fixed at its default: strength 0.6.

const OVEREXPOSURE_STRENGTH: f32 = 0.6;
const OVEREXPOSURE_PI: f32 = 3.141592653589793;

fn transition(uv: vec2f) -> vec4f {
    let from_color = getFromColor(uv);
    let to_color = getToColor(uv);
    let from_m = 1.0 - progress + sin(OVEREXPOSURE_PI * progress) * OVEREXPOSURE_STRENGTH;
    let to_m = progress + sin(OVEREXPOSURE_PI * progress) * OVEREXPOSURE_STRENGTH;
    return vec4f(
        from_color.rgb * from_color.a * from_m + to_color.rgb * to_color.a * to_m,
        mix(from_color.a, to_color.a, progress),
    );
}
