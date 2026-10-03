// Datamosh Strip — ported from gl-transitions "StripDatamoshGlitch.glsl"
// Author: bread
// License: MIT
// Uniforms fixed at their defaults: strength 1.0, horizontalBars 42, verticalSlits 18,
// tear 0.18, chroma 0.032, residue 0.62, noiseAmount 0.16, scanAmount 0.13, flashAmount 0.20.

const DM_STRENGTH: f32 = 1.0;
const DM_HORIZONTAL_BARS: f32 = 42.0;
const DM_VERTICAL_SLITS: f32 = 18.0;
const DM_TEAR: f32 = 0.18;
const DM_CHROMA: f32 = 0.032;
const DM_RESIDUE: f32 = 0.62;
const DM_NOISE_AMOUNT: f32 = 0.16;
const DM_SCAN_AMOUNT: f32 = 0.13;
const DM_FLASH_AMOUNT: f32 = 0.20;
const DM_PI: f32 = 3.141592653589793;

fn dm_hash1(n: f32) -> f32 {
    return fract(sin(n) * 43758.5453123);
}

fn dm_hash2(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn dm_sat(v: f32) -> f32 {
    return clamp(v, 0.0, 1.0);
}

fn dm_burst() -> f32 {
    return pow(max(0.0, sin(progress * DM_PI)), 0.42) * DM_STRENGTH;
}

fn dm_safe_uv(uv: vec2f) -> vec2f {
    return clamp(uv, vec2f(0.0), vec2f(1.0));
}

fn dm_stripe_y(uv: vec2f, density: f32, seed: f32, min_width: f32, max_width: f32) -> f32 {
    let y = uv.y * density + seed * 0.137;
    let id = floor(y);
    let f = fract(y);
    let c = dm_hash2(vec2f(id, seed));
    let w = mix(min_width, max_width, dm_hash2(vec2f(id + 9.17, seed + 2.31)));
    return 1.0 - smoothstep(w, w + 0.018, abs(f - c));
}

fn dm_stripe_x(uv: vec2f, density: f32, seed: f32, min_width: f32, max_width: f32) -> f32 {
    let x = uv.x * density + seed * 0.091;
    let id = floor(x);
    let f = fract(x);
    let c = dm_hash2(vec2f(id, seed + 41.0));
    let w = mix(min_width, max_width, dm_hash2(vec2f(id + 4.7, seed + 8.9)));
    return 1.0 - smoothstep(w, w + 0.012, abs(f - c));
}

fn dm_broken_gate(uv: vec2f, row: f32, rnd: f32, frame: f32) -> f32 {
    let segs = mix(1.0, 9.0, dm_hash2(vec2f(row, frame + 44.0)));
    let seg = floor(uv.x * segs);
    return step(0.16, dm_hash2(vec2f(seg, row + frame * 3.0 + rnd)));
}

fn dm_horizontal_mask(uv: vec2f, frame: f32) -> f32 {
    let r1 = floor((uv.y + dm_hash1(frame) * 0.031) * DM_HORIZONTAL_BARS * 0.38);
    let r2 = floor((uv.y + dm_hash1(frame + 2.0) * 0.013) * DM_HORIZONTAL_BARS);
    let r3 = floor((uv.y + dm_hash1(frame + 7.0) * 0.006) * DM_HORIZONTAL_BARS * 3.4);

    var thick = dm_stripe_y(uv, DM_HORIZONTAL_BARS * 0.38, frame + 1.0, 0.035, 0.22);
    var mid = dm_stripe_y(uv, DM_HORIZONTAL_BARS, frame + 4.0, 0.014, 0.11);
    var hair = dm_stripe_y(uv, DM_HORIZONTAL_BARS * 3.4, frame + 9.0, 0.004, 0.035);

    thick = thick * step(0.42, dm_hash2(vec2f(r1, frame + 10.0)));
    mid = mid * step(0.48, dm_hash2(vec2f(r2, frame + 20.0)));
    hair = hair * step(0.62, dm_hash2(vec2f(r3, frame + 30.0)));

    thick = thick * dm_broken_gate(uv, r1, dm_hash2(vec2f(r1, frame)), frame);
    mid = mid * dm_broken_gate(uv, r2, dm_hash2(vec2f(r2, frame)), frame + 3.0);

    return dm_sat(max(thick, max(mid, hair)));
}

fn dm_vertical_mask(uv: vec2f, frame: f32) -> f32 {
    let col = floor((uv.x + dm_hash1(frame + 12.0) * 0.017) * DM_VERTICAL_SLITS);
    let slit = dm_stripe_x(uv, DM_VERTICAL_SLITS, frame + 13.0, 0.01, 0.075)
        * step(0.66, dm_hash2(vec2f(col, frame + 19.0)));
    return dm_sat(slit);
}

fn dm_chroma_from(uv_in: vec2f, s: vec2f) -> vec4f {
    let uv = dm_safe_uv(uv_in);
    return vec4f(
        getFromColor(dm_safe_uv(uv + s)).r,
        getFromColor(uv).g,
        getFromColor(dm_safe_uv(uv - s)).b,
        1.0,
    );
}

fn dm_chroma_to(uv_in: vec2f, s: vec2f) -> vec4f {
    let uv = dm_safe_uv(uv_in);
    return vec4f(
        getToColor(dm_safe_uv(uv - s)).r,
        getToColor(uv).g,
        getToColor(dm_safe_uv(uv + s)).b,
        1.0,
    );
}

fn dm_distort_uv(uv: vec2f, dir: f32, b: f32, h: f32, v: f32, frame: f32) -> vec2f {
    let row = floor(uv.y * DM_HORIZONTAL_BARS);
    let col = floor(uv.x * DM_VERTICAL_SLITS);
    let row_rnd = dm_hash2(vec2f(row, frame));
    let col_rnd = dm_hash2(vec2f(col, frame + 27.0));

    let x_tear = (row_rnd - 0.5) * 2.0 * DM_TEAR * b * h
        + sin(uv.y * 120.0 + progress * 95.0) * 0.006 * b;
    let y_drag = (col_rnd - 0.5) * 0.13 * b * v;
    let micro = (dm_hash2(vec2f(row, col + frame)) - 0.5) * 0.018 * b * max(h, v);

    return uv + vec2f(x_tear * dir + micro, y_drag);
}

fn transition(uv: vec2f) -> vec4f {
    if (progress <= 0.0) {
        return getFromColor(uv);
    }
    if (progress >= 1.0) {
        return getToColor(uv);
    }

    let b = dm_burst();
    let frame = floor(progress * 30.0);

    let h = dm_horizontal_mask(uv, frame);
    let v = dm_vertical_mask(uv, frame);
    let glitch = dm_sat(max(h, v * 0.75));

    let row = floor(uv.y * DM_HORIZONTAL_BARS);
    let row_rnd = dm_hash2(vec2f(row, frame + 5.0));

    let band_delay = (row_rnd - 0.5) * 0.30 * h;
    let reveal = smoothstep(0.18, 0.84, progress + band_delay);

    let split = vec2f(DM_CHROMA * b * (1.0 + 1.7 * glitch), DM_CHROMA * 0.22 * b * v);

    let from_uv = dm_distort_uv(uv, 1.0, b, h, v, frame);
    let to_uv = dm_distort_uv(uv, -1.0, b, h, v, frame);

    var color = mix(dm_chroma_from(from_uv, split), dm_chroma_to(to_uv, split), reveal);

    // Horizontal time-slice residue: old/new frames dragged through uneven scan bands.
    let smear_uv = uv + vec2f(
        (row_rnd - 0.5) * 0.46 * b * h,
        (dm_hash2(vec2f(row, frame + 31.0)) - 0.5) * 0.045 * b * h,
    );
    let slice_reveal = smoothstep(0.28, 0.78, progress + (row_rnd - 0.5) * 0.22);
    let slice_color = mix(
        dm_chroma_from(smear_uv, split * 1.65),
        dm_chroma_to(smear_uv - vec2f((row_rnd - 0.5) * 0.18 * b, 0.0), split * 1.65),
        slice_reveal,
    );
    color = mix(color, slice_color, h * b * DM_RESIDUE);

    // Thin scan sparks and broken white lines.
    let hair_line = dm_stripe_y(uv, 190.0, frame + 55.0, 0.002, 0.012)
        * step(0.70, dm_hash2(vec2f(floor(uv.y * 190.0), frame + 56.0)));
    var rgb = color.rgb + vec3f(0.72, 0.90, 1.0) * hair_line * b * 0.28;

    let scan = 0.5 + 0.5 * sin(uv.y * 980.0 + progress * 130.0);
    rgb = rgb * (1.0 - DM_SCAN_AMOUNT * b * scan);

    let n_cell = floor(uv * vec2f(360.0 * ratio, 210.0));
    let n = dm_hash2(n_cell + vec2f(frame * 7.0, frame * 13.0));
    rgb = rgb + (n - 0.5) * DM_NOISE_AMOUNT * b * (0.55 + glitch);

    // Slight desaturation during the damage peak.
    let luma = dot(rgb, vec3f(0.299, 0.587, 0.114));
    rgb = mix(rgb, vec3f(luma), 0.18 * b * glitch);

    let strobe = step(0.78, dm_hash2(vec2f(frame, 3.14))) * pow(b, 1.65);
    rgb = rgb + vec3f(strobe * DM_FLASH_AMOUNT);

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
