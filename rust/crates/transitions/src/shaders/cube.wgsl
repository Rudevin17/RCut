// Cube — ported from gl-transitions "cube.glsl"
// Author: gre
// License: MIT
// Uniforms fixed at their defaults: persp 0.7, unzoom 0.3, reflection 0.4, floating 3.0.

const CUBE_PERSP: f32 = 0.7;
const CUBE_UNZOOM: f32 = 0.3;
const CUBE_REFLECTION: f32 = 0.4;
const CUBE_FLOATING: f32 = 3.0;

fn cube_project(p: vec2f) -> vec2f {
    return p * vec2f(1.0, -1.2) + vec2f(0.0, -CUBE_FLOATING / 100.0);
}

fn cube_in_bounds(p: vec2f) -> bool {
    return all(vec2f(0.0) < p) && all(p < vec2f(1.0));
}

fn cube_bg_color(pfr_in: vec2f, pto_in: vec2f) -> vec4f {
    var c = vec4f(0.0, 0.0, 0.0, 1.0);
    let pfr = cube_project(pfr_in);
    if (cube_in_bounds(pfr)) {
        c = c + mix(vec4f(0.0), getFromColor(pfr), CUBE_REFLECTION * mix(1.0, 0.0, pfr.y));
    }
    let pto = cube_project(pto_in);
    if (cube_in_bounds(pto)) {
        c = c + mix(vec4f(0.0), getToColor(pto), CUBE_REFLECTION * mix(1.0, 0.0, pto.y));
    }
    return c;
}

// p: the position, persp: the perspective in [0, 1], center: the x center in [0, 1] (0.5 excluded).
fn cube_xskew(p: vec2f, persp: f32, center: f32) -> vec2f {
    let x = mix(p.x, 1.0 - p.x, center);
    let side = select(-1.0, 1.0, center < 0.5);
    return (vec2f(x, (p.y - 0.5 * (1.0 - persp) * x) / (1.0 + (persp - 1.0) * x))
        - vec2f(0.5 - distance(center, 0.5), 0.0))
        * vec2f(0.5 / distance(center, 0.5) * side, 1.0)
        + vec2f(select(1.0, 0.0, center < 0.5), 0.0);
}

fn transition(op: vec2f) -> vec4f {
    let uz = CUBE_UNZOOM * 2.0 * (0.5 - distance(0.5, progress));
    let p = -uz * 0.5 + (1.0 + uz) * op;
    let from_p = cube_xskew(
        (p - vec2f(progress, 0.0)) / vec2f(1.0 - progress, 1.0),
        1.0 - mix(progress, 0.0, CUBE_PERSP),
        0.0,
    );
    let to_p = cube_xskew(p / vec2f(progress, 1.0), mix(pow(progress, 2.0), 1.0, CUBE_PERSP), 1.0);
    if (cube_in_bounds(from_p)) {
        return getFromColor(from_p);
    }
    if (cube_in_bounds(to_p)) {
        return getToColor(to_p);
    }
    return cube_bg_color(from_p, to_p);
}
