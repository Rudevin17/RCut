// RGB Split Slam — RCut original.
// A punch-in zoom with chromatic split and shake that peaks on the cut.
// params0.x: intensity.

fn slam_sample(uv: vec2f) -> vec4f {
    if (progress < 0.5) {
        return getFromColor(uv);
    }
    return getToColor(uv);
}

fn transition(uv: vec2f) -> vec4f {
    let intensity = params0.x;
    let peak = 1.0 - abs(progress * 2.0 - 1.0);
    let hit = peak * peak * intensity;
    let zoom = 1.0 - 0.18 * hit;
    let shake = vec2f(sin(progress * 97.0), cos(progress * 131.0)) * 0.015 * hit;
    let base = (uv - 0.5) * zoom + 0.5 + shake;
    let split = vec2f(0.035 * hit, 0.0);
    let rgb = vec3f(
        slam_sample(base + split).r,
        slam_sample(base).g,
        slam_sample(base - split).b,
    );
    let flash = smoothstep(0.85, 1.0, peak) * 0.35 * intensity;
    return vec4f(clamp(rgb + flash, vec3f(0.0), vec3f(1.0)), 1.0);
}
