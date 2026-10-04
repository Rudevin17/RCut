// Swirl — ported from gl-transitions "Swirl.glsl"
// Author: Sergey Kosarevsky (ported by gre)
// License: MIT

fn transition(uv_in: vec2f) -> vec4f {
    let radius = 1.0;
    let t = progress;
    var uv = uv_in - vec2f(0.5);
    let dist = length(uv);
    if (dist < radius) {
        let percent = (radius - dist) / radius;
        let a = select(mix(1.0, 0.0, (t - 0.5) / 0.5), mix(0.0, 1.0, t / 0.5), t <= 0.5);
        let theta = percent * percent * a * 8.0 * 3.14159;
        let s = sin(theta);
        let c = cos(theta);
        uv = vec2f(dot(uv, vec2f(c, -s)), dot(uv, vec2f(s, c)));
    }
    uv = uv + vec2f(0.5);
    return mix(getFromColor(uv), getToColor(uv), t);
}
