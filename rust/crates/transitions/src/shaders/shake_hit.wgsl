// Shake Hit — RCut original.
// Camera shake with motion blur and a flash on the cut.
// params0.x: shake amount, params0.y: flash amount.

const SHAKE_SAMPLES: i32 = 8;

fn shake_sample(uv: vec2f) -> vec4f {
    if (progress < 0.5) {
        return getFromColor(uv);
    }
    return getToColor(uv);
}

fn transition(uv: vec2f) -> vec4f {
    let peak = 1.0 - abs(progress * 2.0 - 1.0);
    let amount = pow(peak, 1.5) * params0.x;
    let t = progress * 40.0;
    let offset = vec2f(
        sin(t * 1.7) + sin(t * 3.1) * 0.5,
        cos(t * 2.3) + sin(t * 4.7) * 0.5,
    ) * 0.02 * amount;
    // A slight zoom keeps the shaken frame's edges off screen.
    let p = (uv - 0.5) * (1.0 - 0.06 * amount) + 0.5 + offset;

    var color = vec4f(0.0);
    for (var i = 0; i < SHAKE_SAMPLES; i = i + 1) {
        let k = f32(i) / f32(SHAKE_SAMPLES - 1) - 0.5;
        color = color + shake_sample(p + offset * k * 1.5);
    }
    color = color / f32(SHAKE_SAMPLES);

    let flash = pow(peak, 8.0) * params0.y;
    return vec4f(mix(color.rgb, vec3f(1.0), flash), 1.0);
}
