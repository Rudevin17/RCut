// Zoom Punch — RCut original.
// Rushes into the outgoing clip with a radial blur, flashes on the cut,
// and lands out of the incoming clip.
// params0.x: zoom strength, params0.y: flash amount.

const PUNCH_SAMPLES: i32 = 16;

fn punch_sample(uv: vec2f) -> vec4f {
    if (progress < 0.5) {
        return getFromColor(uv);
    }
    return getToColor(uv);
}

fn transition(uv: vec2f) -> vec4f {
    let strength = params0.x;
    let flash_amount = params0.y;
    let half_progress = select((progress - 0.5) * 2.0, progress * 2.0, progress < 0.5);
    let t = select(
        (1.0 - half_progress) * (1.0 - half_progress),
        half_progress * half_progress,
        progress < 0.5,
    );
    let scale = 1.0 + 2.0 * strength * t;
    let blur = t * 0.12 * strength;

    var color = vec4f(0.0);
    for (var i = 0; i < PUNCH_SAMPLES; i = i + 1) {
        let k = 1.0 - blur * f32(i) / f32(PUNCH_SAMPLES - 1);
        color = color + punch_sample((uv - 0.5) / scale * k + 0.5);
    }
    color = color / f32(PUNCH_SAMPLES);

    let flash = pow(1.0 - abs(progress * 2.0 - 1.0), 6.0) * flash_amount;
    return vec4f(mix(color.rgb, vec3f(1.0), flash), 1.0);
}
