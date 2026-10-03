// Glitch Memories — ported from gl-transitions "GlitchMemories.glsl"
// Author: Gunnar Roth (based on work from natewave)
// License: MIT

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
    return vec4f(
        mix(getFromColor(red), getToColor(red), progress).r,
        mix(getFromColor(green), getToColor(green), progress).g,
        mix(getFromColor(blue), getToColor(blue), progress).b,
        1.0,
    );
}
