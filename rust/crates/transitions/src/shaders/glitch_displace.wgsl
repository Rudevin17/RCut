// Glitch Displace — ported from gl-transitions "GlitchDisplace.glsl"
// Author: Matt DesLauriers
// License: MIT
// (The original computes three voronoi values it never uses; they are omitted.)
// RCut: the gray glitch layer takes its alpha from the samples it is built from, not 1.0.

fn glitch_displace(tex: vec4f, tex_coord: vec2f, dot_depth: f32, texture_depth: f32, strength: f32) -> vec2f {
    let dis = tex * dot_depth + 1.0 - tex * texture_depth;
    let dx = (dis.x - 1.0 + texture_depth * dot_depth) * strength;
    let dy = (dis.y - 1.0 + texture_depth * dot_depth) * strength;
    return tex_coord + vec2f(dx, dy);
}

fn glitch_ease1(t: f32) -> f32 {
    if (t == 0.0 || t == 1.0) {
        return t;
    }
    if (t < 0.5) {
        return 0.5 * pow(2.0, 20.0 * t - 10.0);
    }
    return -0.5 * pow(2.0, 10.0 - t * 20.0) + 1.0;
}

fn glitch_ease2(t: f32) -> f32 {
    if (t == 1.0) {
        return t;
    }
    return 1.0 - pow(2.0, -10.0 * t);
}

fn transition(uv: vec2f) -> vec4f {
    var color1 = getFromColor(uv);
    var color2 = getToColor(uv);
    let disp = glitch_displace(color1, uv, 0.33, 0.7, 1.0 - glitch_ease1(progress));
    let disp2 = glitch_displace(color2, uv, 0.33, 0.5, glitch_ease2(progress));
    let d_color1 = getToColor(disp);
    let d_color2_source = getFromColor(disp2);
    let val = glitch_ease1(progress);
    let d_min = min(d_color2_source, d_color1);
    let gray = vec3f(dot(d_min.rgb, vec3f(0.299, 0.587, 0.114)));
    let d_color2 = vec4f(gray, d_min.a) * 2.0;
    color1 = mix(color1, d_color2, smoothstep(0.0, 0.5, progress));
    // GLSL smoothstep(1.0, 0.5, p) == 1.0 - smoothstep(0.5, 1.0, p)
    color2 = mix(color2, d_color1, 1.0 - smoothstep(0.5, 1.0, progress));
    return mix(color1, color2, val);
}
