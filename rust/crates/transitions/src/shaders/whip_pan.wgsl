// Whip Pan — RCut original.
// params0.xy: pan direction as a unit axis vector ((1, 0) pans right, (0, 1) pans up).
// params0.z: motion blur strength as a fraction of the frame.

const WHIP_SAMPLES: i32 = 24;
const WHIP_PI: f32 = 3.14159265;

// The outgoing frame occupies [0, 1] along the pan axis and the incoming
// frame sits right after it, so panning by 1 lands exactly on the incoming frame.
fn whip_sample(q: vec2f, direction: vec2f) -> vec4f {
    let in_from = (direction.x > 0.0 && q.x <= 1.0) || (direction.x < 0.0 && q.x >= 0.0)
        || (direction.y > 0.0 && q.y <= 1.0) || (direction.y < 0.0 && q.y >= 0.0);
    if (in_from) {
        return getFromColor(q);
    }
    return getToColor(q - direction);
}

fn transition(uv: vec2f) -> vec4f {
    let direction = params0.xy;
    let eased = progress * progress * (3.0 - 2.0 * progress);
    let blur = sin(progress * WHIP_PI) * params0.z;
    var color = vec4f(0.0);
    for (var i = 0; i < WHIP_SAMPLES; i = i + 1) {
        let offset = (f32(i) / f32(WHIP_SAMPLES - 1) - 0.5) * blur;
        color = color + whip_sample(uv + direction * (eased + offset), direction);
    }
    return color / f32(WHIP_SAMPLES);
}
