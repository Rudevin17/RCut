// Lost Signal — ported from gl-transitions "old_tv_lost_signal.glsl"
// Author: mernking (gitlab: Godswork)
// License: MIT
// RCut: the scanline offset is scaled by the clips' coverage.

fn lost_signal_hash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn transition(uv: vec2f) -> vec4f {
    let p = progress;
    let strength = sin(p * 3.14159265);
    var color = mix(getFromColor(uv), getToColor(uv), p);

    // Horizontal tracking lines.
    let line_y = floor(uv.y * 120.0);
    let line = step(0.92, lost_signal_hash(vec2f(line_y, p * 20.0)));

    // Lines drift during the transition.
    let drift = sin(uv.y * 30.0 + p * 10.0) * 0.02 * strength;
    let shifted = mix(
        getFromColor(uv + vec2f(drift, 0.0)),
        getToColor(uv + vec2f(drift, 0.0)),
        p,
    );
    color = mix(color, shifted, line * strength);

    // Mild scanline darkening (CRT feel).
    let scan = sin(uv.y * 900.0) * 0.03;
    return vec4f(color.rgb - scan * strength * color.a, color.a);
}
