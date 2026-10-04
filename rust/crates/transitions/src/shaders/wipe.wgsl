// Wipe — RCut original. A soft edge sweeps across, revealing the incoming clip.
// params0.xy: sweep direction as a unit axis vector ((1, 0) = left to right).
// params0.z: edge softness.

fn transition(uv: vec2f) -> vec4f {
    let direction = params0.xy;
    let softness = max(params0.z, 0.0001);
    // Position along the sweep: 0 at the starting edge, 1 at the far edge.
    let along = dot(uv - 0.5, direction) + 0.5;
    let edge = progress * (1.0 + softness);
    let reveal = 1.0 - smoothstep(edge - softness, edge, along);
    return mix(getFromColor(uv), getToColor(uv), reveal);
}
