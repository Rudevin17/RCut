// Film Burn — ported from gl-transitions "FilmBurn.glsl"
// Author: Anastasia Dunbar
// License: MIT
// Uniform fixed at its default: Seed 2.31.
// RCut: the burn colour is scaled by the clips' coverage.

const FILM_BURN_SEED: f32 = 2.31;
const FILM_BURN_PI: f32 = 3.14159265358979323;
const FILM_BURN_REPEATS: f32 = 50.0;

fn film_burn_sigmoid(x: f32, a: f32) -> f32 {
    if (x > 0.5) {
        return 1.0 - pow(2.0 - x * 2.0, a) / 2.0;
    }
    return pow(x * 2.0, a) / 2.0;
}

fn film_burn_rand1(co: f32) -> f32 {
    return fract(sin(co * 24.9898 + FILM_BURN_SEED) * 43758.5453);
}

fn film_burn_rand2(co: vec2f) -> f32 {
    return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn film_burn_apow(a: f32, b: f32) -> f32 {
    return pow(abs(a), b) * sign(b);
}

fn film_burn_pow3(a: vec3f, b: vec3f) -> vec3f {
    return vec3f(film_burn_apow(a.r, b.r), film_burn_apow(a.g, b.g), film_burn_apow(a.b, b.b));
}

fn film_burn_smooth_mix(a: f32, b: f32, c: f32) -> f32 {
    return mix(a, b, film_burn_sigmoid(c, 2.0));
}

fn film_burn_random(co_in: vec2f, shft: f32) -> f32 {
    let co = co_in + 10.0;
    return film_burn_smooth_mix(
        fract(sin(dot(co, vec2f(12.9898 + floor(shft) * 0.5, 78.233 + FILM_BURN_SEED))) * 43758.5453),
        fract(sin(dot(co, vec2f(12.9898 + floor(shft + 1.0) * 0.5, 78.233 + FILM_BURN_SEED))) * 43758.5453),
        fract(shft),
    );
}

fn film_burn_smooth_random(co: vec2f, shft: f32) -> f32 {
    return film_burn_smooth_mix(
        film_burn_smooth_mix(
            film_burn_random(floor(co), shft),
            film_burn_random(floor(co + vec2f(1.0, 0.0)), shft),
            fract(co.x),
        ),
        film_burn_smooth_mix(
            film_burn_random(floor(co + vec2f(0.0, 1.0)), shft),
            film_burn_random(floor(co + vec2f(1.0, 1.0)), shft),
            fract(co.x),
        ),
        fract(co.y),
    );
}

fn film_burn_texture(p: vec2f) -> vec4f {
    return mix(getFromColor(p), getToColor(p), film_burn_sigmoid(progress, 10.0));
}

fn transition(p_in: vec2f) -> vec4f {
    var f = vec3f(0.0);
    for (var i = 0.0; i < 13.0; i = i + 1.0) {
        f = f + sin(p_in.x * film_burn_rand1(i) * 6.0 + progress * 8.0 + film_burn_rand1(i + 1.43))
            * sin(p_in.y * film_burn_rand1(i + 4.4) * 6.0 + progress * 6.0 + film_burn_rand1(i + 2.4));
        let spot = vec2f(
            film_burn_smooth_random(vec2f(progress * 1.3), i + 1.0),
            film_burn_smooth_random(vec2f(progress * 0.5), i + 6.25),
        );
        f = f + 1.0 - clamp(length(p_in - spot) * mix(20.0, 70.0, film_burn_rand1(i)), 0.0, 1.0);
    }
    f = (f + 4.0) / 11.0;
    f = film_burn_pow3(f * vec3f(1.0, 0.7, 0.6), vec3f(1.0, 2.0 - sin(progress * FILM_BURN_PI), 1.3));
    f = f * sin(progress * FILM_BURN_PI);

    let p = (p_in - 0.5)
        * (1.0 + film_burn_smooth_random(vec2f(progress * 5.0), 6.3) * sin(progress * FILM_BURN_PI) * 0.05)
        + 0.5;

    var blurred = vec4f(0.0);
    let blur_amount = sin(progress * FILM_BURN_PI) * 0.03;
    for (var i = 0.0; i < FILM_BURN_REPEATS; i = i + 1.0) {
        // The original passes degrees through degrees(); kept for identical output.
        let angle = degrees(i / FILM_BURN_REPEATS * 360.0);
        let q = vec2f(cos(angle), sin(angle)) * (film_burn_rand2(vec2f(i, p.x + p.y)) + blur_amount);
        blurred = blurred + film_burn_texture(p + q * blur_amount);
    }
    blurred = blurred / FILM_BURN_REPEATS;

    return blurred + vec4f(f * blurred.a, 0.0);
}
