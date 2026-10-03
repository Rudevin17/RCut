// Parametric Glitch — ported from gl-transitions "parametric_glitch.glsl"
// Author: Yoni Maltsman @friendlyspinach
// License: MIT
// Uniforms fixed at their defaults: ampx 1.0, ampy 1.0.

fn transition(uv: vec2f) -> vec4f {
    let original = getFromColor(uv);
    let to_color = getToColor(uv);
    let sphere = original.r * original.r + original.g * original.g + original.b * original.b - 1.0;
    let spiral_x = cos(sphere - uv.x / (progress + 0.01));
    let spiral_y = sin(sphere - uv.y / (progress + 0.01));
    let st = vec2f(fract(uv.x * spiral_x), fract(uv.y * spiral_y));
    let diff = uv - st;
    let from_color = getFromColor(uv + progress * diff);
    return mix(from_color, to_color, progress);
}
