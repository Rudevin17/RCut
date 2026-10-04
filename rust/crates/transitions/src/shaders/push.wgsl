// Push — RCut original. The incoming clip pushes the outgoing clip off screen.
// params0.xy: push direction as a unit axis vector ((1, 0) = pushes right).

fn transition(uv: vec2f) -> vec4f {
    let direction = params0.xy;
    let eased = progress * progress * (3.0 - 2.0 * progress);
    let from_uv = uv - direction * eased;
    let to_uv = uv - direction * (eased - 1.0);
    if (all(to_uv >= vec2f(0.0)) && all(to_uv <= vec2f(1.0))) {
        return getToColor(to_uv);
    }
    return getFromColor(from_uv);
}
