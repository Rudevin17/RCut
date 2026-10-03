// Spin Blur — RCut original.
// Spins the outgoing clip away and the incoming clip in, with rotational blur.
// params0.x: turns over the whole transition, params0.y: blur amount.

const SPIN_SAMPLES: i32 = 20;
const SPIN_TAU: f32 = 6.28318531;

fn spin_rotate(uv: vec2f, angle: f32, zoom: f32) -> vec2f {
    let p = (uv - 0.5) * vec2f(ratio, 1.0) / zoom;
    let c = cos(angle);
    let s = sin(angle);
    let r = vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
    return r / vec2f(ratio, 1.0) + 0.5;
}

fn spin_sample(uv: vec2f) -> vec4f {
    if (progress < 0.5) {
        return getFromColor(uv);
    }
    return getToColor(uv);
}

fn transition(uv: vec2f) -> vec4f {
    let eased = progress * progress * (3.0 - 2.0 * progress);
    // The outgoing clip turns 0 -> turns/2; the incoming clip turns -turns/2 -> 0.
    let angle = (eased - select(1.0, 0.0, progress < 0.5)) * params0.x * SPIN_TAU;
    let peak = sin(progress * 3.14159265);
    let spread = peak * params0.y * 0.35;
    let zoom = 1.0 + 0.4 * peak;

    var color = vec4f(0.0);
    for (var i = 0; i < SPIN_SAMPLES; i = i + 1) {
        let offset = (f32(i) / f32(SPIN_SAMPLES - 1) - 0.5) * spread;
        color = color + spin_sample(spin_rotate(uv, -(angle + offset), zoom));
    }
    return color / f32(SPIN_SAMPLES);
}
