// Crossfade — ported from gl-transitions "fade.glsl"
// Author: gre
// License: MIT

fn transition(uv: vec2f) -> vec4f {
    return mix(getFromColor(uv), getToColor(uv), progress);
}
