// TV Static — ported from gl-transitions "TVStatic.glsl"
// Author: Brandon Anzaldi
// License: MIT
// Uniform fixed at its default: offset 0.05.

const TV_STATIC_OFFSET: f32 = 0.05;

fn tv_static_noise(co: vec2f) -> f32 {
    let dt = dot(co * progress, vec2f(12.9898, 78.233));
    let sn = glsl_mod(dt, 3.14);
    return fract(sin(sn) * 43758.5453);
}

fn transition(p: vec2f) -> vec4f {
    if (progress < TV_STATIC_OFFSET) {
        return getFromColor(p);
    }
    if (progress > 1.0 - TV_STATIC_OFFSET) {
        return getToColor(p);
    }
    return vec4f(vec3f(tv_static_noise(p)), 1.0);
}
