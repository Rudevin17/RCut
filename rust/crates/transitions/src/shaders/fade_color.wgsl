// Dip to Color — ported from gl-transitions "fadecolor.glsl"
// Author: gre
// License: MIT
// params0.xyz: colour (RGB, 0..1), params0.w: colour phase (original default 0.4).
// RCut: the dip colour is scaled by the clips' coverage so it does not cover lower tracks.

fn transition(uv: vec2f) -> vec4f {
    let from_color = getFromColor(uv);
    let to_color = getToColor(uv);
    let coverage = mix(from_color.a, to_color.a, progress);
    let color = vec4f(params0.xyz * coverage, coverage);
    let color_phase = params0.w;
    // GLSL smoothstep(1.0 - phase, 0.0, p) == 1.0 - smoothstep(0.0, 1.0 - phase, p)
    return mix(
        mix(color, from_color, 1.0 - smoothstep(0.0, 1.0 - color_phase, progress)),
        mix(color, to_color, smoothstep(color_phase, 1.0, progress)),
        progress,
    );
}
