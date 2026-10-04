// Crosswarp — ported from gl-transitions "crosswarp.glsl"
// Author: Eke Péter <peterekepeter@gmail.com>
// License: MIT

fn transition(p: vec2f) -> vec4f {
    let x = smoothstep(0.0, 1.0, progress * 2.0 + p.x - 1.0);
    return mix(getFromColor((p - 0.5) * (1.0 - x) + 0.5), getToColor((p - 0.5) * x + 0.5), x);
}
