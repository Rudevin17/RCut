// Slide — RCut original. The incoming clip slides in over the outgoing clip.
// params0.xy: direction the incoming clip moves, as a unit axis vector ((1, 0) = moves right).

fn transition(uv: vec2f) -> vec4f {
    let direction = params0.xy;
    let eased = progress * progress * (3.0 - 2.0 * progress);
    // The incoming frame starts one frame away, against its direction of travel.
    let to_uv = uv - direction * (eased - 1.0);
    if (all(to_uv >= vec2f(0.0)) && all(to_uv <= vec2f(1.0))) {
        return getToColor(to_uv);
    }
    return getFromColor(uv);
}
