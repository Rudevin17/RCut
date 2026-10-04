// Zoom In/Out — ported from gl-transitions "zoomInOut.glsl"
// Author: OllyOllyOlly
// License: MIT

fn zoom_in_out(uv: vec2f, amount: f32) -> vec2f {
    return 0.5 + (uv - 0.5) * (1.0 - amount);
}

fn transition(uv: vec2f) -> vec4f {
    let zoom_from = smoothstep(0.0, 1.0, progress * 2.0);
    let zoom_to = smoothstep(0.0, 1.0, (1.0 - progress) * 2.0);
    let crossfade = smoothstep(0.4, 0.6, progress);
    return mix(
        getFromColor(zoom_in_out(uv, zoom_from)),
        getToColor(zoom_in_out(uv, zoom_to)),
        crossfade,
    );
}
