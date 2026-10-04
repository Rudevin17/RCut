// Dreamy Zoom — ported from gl-transitions "DreamyZoom.glsl"
// Author: Zeh Fernando
// License: MIT
// Uniforms fixed at their defaults: rotation 6, scale 1.2.
// DEG2RAD keeps the original's constant value.

const DREAMY_DEG2RAD: f32 = 0.03926990816987241548078304229099;
const DREAMY_ROTATION: f32 = 6.0;
const DREAMY_SCALE: f32 = 1.2;

fn transition(uv: vec2f) -> vec4f {
    let first_half = progress < 0.5;
    let phase = select((progress - 0.5) * 2.0, progress * 2.0, first_half);
    let angle_offset = select(
        mix(-DREAMY_ROTATION * DREAMY_DEG2RAD, 0.0, phase),
        mix(0.0, DREAMY_ROTATION * DREAMY_DEG2RAD, phase),
        first_half,
    );
    let new_scale = select(mix(DREAMY_SCALE, 1.0, phase), mix(1.0, DREAMY_SCALE, phase), first_half);

    let p = (uv - vec2f(0.5)) / new_scale * vec2f(ratio, 1.0);
    let angle = atan2(p.y, p.x) + angle_offset;
    let dist = length(p);
    let q = vec2f(cos(angle) * dist / ratio + 0.5, sin(angle) * dist + 0.5);

    var c = getToColor(q);
    if (first_half) {
        c = getFromColor(q);
    }
    let glow = select(mix(1.0, 0.0, phase), mix(0.0, 1.0, phase), first_half);
    return c + glow;
}
