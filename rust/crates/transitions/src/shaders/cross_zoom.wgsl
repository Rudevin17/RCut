// Cross Zoom — ported from gl-transitions "CrossZoom.glsl"
// Author: rectalogic (ported by gre)
// License: MIT
// Uniform fixed at its default: strength 0.4.

const CROSS_ZOOM_STRENGTH: f32 = 0.4;
const CROSS_ZOOM_PI: f32 = 3.141592653589793;

fn cross_zoom_linear_ease(begin: f32, change: f32, duration: f32, time: f32) -> f32 {
    return change * time / duration + begin;
}

fn cross_zoom_exponential_ease_in_out(begin: f32, change: f32, duration: f32, time_in: f32) -> f32 {
    if (time_in == 0.0) {
        return begin;
    }
    if (time_in == duration) {
        return begin + change;
    }
    let time = time_in / (duration / 2.0);
    if (time < 1.0) {
        return change / 2.0 * pow(2.0, 10.0 * (time - 1.0)) + begin;
    }
    return change / 2.0 * (-pow(2.0, -10.0 * (time - 1.0)) + 2.0) + begin;
}

fn cross_zoom_sinusoidal_ease_in_out(begin: f32, change: f32, duration: f32, time: f32) -> f32 {
    return -change / 2.0 * (cos(CROSS_ZOOM_PI * time / duration) - 1.0) + begin;
}

fn cross_zoom_rand(co: vec2f) -> f32 {
    return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn transition(uv: vec2f) -> vec4f {
    // Linear interpolate center across center half of the image.
    let center = vec2f(cross_zoom_linear_ease(0.25, 0.5, 1.0, progress), 0.5);
    let dissolve = cross_zoom_exponential_ease_in_out(0.0, 1.0, 1.0, progress);
    // Mirrored sinusoidal loop: 0 -> strength -> 0.
    let strength = cross_zoom_sinusoidal_ease_in_out(0.0, CROSS_ZOOM_STRENGTH, 0.5, progress);

    var color = vec4f(0.0);
    var total = 0.0;
    let to_center = center - uv;
    // Randomize the lookups to hide the fixed number of samples.
    let offset = cross_zoom_rand(uv);
    for (var t = 0; t <= 40; t = t + 1) {
        let percent = (f32(t) + offset) / 40.0;
        let weight = 4.0 * (percent - percent * percent);
        let sample_uv = uv + to_center * percent * strength;
        color = color + mix(getFromColor(sample_uv), getToColor(sample_uv), dissolve) * weight;
        total = total + weight;
    }
    return color / total;
}
