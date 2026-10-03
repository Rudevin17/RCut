// Doom Melt — ported from gl-transitions "DoomScreenTransition.glsl"
// Author: Zeh Fernando
// License: MIT
// Uniforms fixed at their defaults: bars 30, amplitude 2, noise 0.1, frequency 0.5, dripScale 0.5.

const DOOM_BARS: i32 = 30;
const DOOM_AMPLITUDE: f32 = 2.0;
const DOOM_NOISE: f32 = 0.1;
const DOOM_FREQUENCY: f32 = 0.5;
const DOOM_DRIP_SCALE: f32 = 0.5;

fn doom_rand(num: i32) -> f32 {
    let n = f32(num);
    return fract(glsl_mod(n * 67123.313, 12.0) * sin(n * 10.3) * cos(n));
}

fn doom_wave(num: i32) -> f32 {
    let x = f32(num) * DOOM_FREQUENCY * 0.1 * f32(DOOM_BARS);
    return cos(x * 0.5) * cos(x * 0.13) * sin((x + 10.0) * 0.3) / 2.0 + 0.5;
}

fn doom_drip(num: i32) -> f32 {
    return sin(f32(num) / f32(DOOM_BARS - 1) * 3.141592) * DOOM_DRIP_SCALE;
}

fn doom_pos(num: i32) -> f32 {
    return mix(doom_wave(num), doom_rand(num), DOOM_NOISE) + doom_drip(num);
}

fn transition(uv: vec2f) -> vec4f {
    let bar = i32(uv.x * f32(DOOM_BARS));
    let scale = 1.0 + doom_pos(bar) * DOOM_AMPLITUDE;
    let phase = progress * scale;
    if (phase + uv.y < 1.0) {
        return getFromColor(vec2f(uv.x, uv.y + phase));
    }
    return getToColor(uv);
}
