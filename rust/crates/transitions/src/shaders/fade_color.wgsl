// Dip to Color — ported from gl-transitions "fadecolor.glsl"
// Author: gre
// License: MIT
// params0.xyz: colour (RGB, 0..1), params0.w: colour phase (original default 0.4).

fn transition(uv: vec2f) -> vec4f {
    let color = vec4f(params0.xyz, 1.0);
    let color_phase = params0.w;
    // GLSL smoothstep(1.0 - phase, 0.0, p) == 1.0 - smoothstep(0.0, 1.0 - phase, p)
    return mix(
        mix(color, getFromColor(uv), 1.0 - smoothstep(0.0, 1.0 - color_phase, progress)),
        mix(color, getToColor(uv), smoothstep(color_phase, 1.0, progress)),
        progress,
    );
}
