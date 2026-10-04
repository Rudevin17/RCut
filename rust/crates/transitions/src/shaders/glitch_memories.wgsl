// Glitch Memories — ported from gl-transitions "GlitchMemories.glsl"
// Author: Gunnar Roth (based on work from natewave)
// License: MIT
// RCut: alpha follows the clips' coverage instead of 1.0.

fn transition(p: vec2f) -> vec4f {
    let block = floor(p / vec2f(16.0));
    let uv_noise = block / vec2f(64.0) + floor(vec2f(progress) * vec2f(1200.0, 3500.0)) / vec2f(64.0);
    var dist = vec2f(0.0);
    if (progress > 0.0) {
        dist = (fract(uv_noise) - 0.5) * 0.3 * (1.0 - progress);
    }
    let red = p + dist * 0.2;
    let green = p + dist * 0.3;
    let blue = p + dist * 0.5;
    let red_color = mix(getFromColor(red), getToColor(red), progress);
    let green_color = mix(getFromColor(green), getToColor(green), progress);
    let blue_color = mix(getFromColor(blue), getToColor(blue), progress);
    return vec4f(
        red_color.r,
        green_color.g,
        blue_color.b,
        max(red_color.a, max(green_color.a, blue_color.a)),
    );
}
