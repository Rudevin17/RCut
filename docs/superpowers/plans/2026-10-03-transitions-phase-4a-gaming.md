# Transitions Phase 4a — Gaming Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 12 gaming transitions to RCut: 8 ported from gl-transitions and 4 RCut originals. They appear in the Gaming group of the Transitions tab and render in preview and export.

**Architecture:**
- Each transition is one WGSL file in `rust/crates/transitions/src/shaders/`, built on the shared prelude (`getFromColor`, `getToColor`, `progress`, `ratio`, `params0`, `params1`, `glsl_mod`; uv origin at the bottom-left). Each file is registered in `TRANSITION_SHADERS`.
- Each transition also has a TypeScript definition in `apps/web/src/transitions/definitions/`, registered in `TRANSITION_DEFINITIONS`.
- A new test checks that the TS shader ids match the Rust registry.
- `THIRD_PARTY_NOTICES.md` credits the ported shaders.

**Spec:** `docs/superpowers/specs/2026-10-03-transitions-design.md` (Transition pack, Phase 4)

## Global Constraints

- Branch `rcut-v1` in `D:\OpenCut`. Git identity is configured.
- Every commit message ends with a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ported shaders keep their original `Author` and `License` header lines.
- Ported transitions fix their tunable uniforms at the original defaults, stated in each file's header.
- Shader ids are kebab-case and must match exactly between Rust and TS. The ids are:
  - ported: `glitch-memories`, `datamosh-strip`, `parametric-glitch`, `doom-melt`, `lost-signal`, `tv-static`, `pixelize`, `block-dissolve`;
  - RCut originals: `rgb-split-slam`, `zoom-punch`, `spin-blur`, `shake-hit`.
- At most 8 shader params per transition (`params0`, `params1`).
- Rust uses rustfmt defaults. TypeScript uses tabs, double quotes, object-parameter functions, and `bun:test` tests in `__tests__/`.
- Do NOT use `sed -i` on existing files, and do NOT write files through shell heredocs. Use file-edit tools.
- Baseline: `bun test` 242 pass / 4 fail, tsc 0, `cargo test -p transitions` 2 pass.

---

## Task 1: Rust shaders (12 WGSL files)

**Files:**
- Create in `rust/crates/transitions/src/shaders/`: `glitch_memories.wgsl`, `datamosh_strip.wgsl`, `parametric_glitch.wgsl`, `doom_melt.wgsl`, `lost_signal.wgsl`, `tv_static.wgsl`, `pixelize.wgsl`, `block_dissolve.wgsl`, `rgb_split_slam.wgsl`, `zoom_punch.wgsl`, `spin_blur.wgsl`, `shake_hit.wgsl`
- Modify: `rust/crates/transitions/src/shaders.rs` (`TRANSITION_SHADERS`)

**Interfaces:**
- Produces the shader ids listed in Global Constraints.
- Parameters of the RCut originals:
  - `rgb-split-slam`: `params0.x` = intensity.
  - `zoom-punch`: `params0.x` = strength, `params0.y` = flash.
  - `spin-blur`: `params0.x` = turns, `params0.y` = blur.
  - `shake-hit`: `params0.x` = amount, `params0.y` = flash.

- [ ] **Step 1: Register the ids first (RED)**

In `shaders.rs`, append these entries to `TRANSITION_SHADERS`, after `glitch-displace`:
```rust
    ("glitch-memories", include_str!("shaders/glitch_memories.wgsl")),
    ("datamosh-strip", include_str!("shaders/datamosh_strip.wgsl")),
    ("parametric-glitch", include_str!("shaders/parametric_glitch.wgsl")),
    ("doom-melt", include_str!("shaders/doom_melt.wgsl")),
    ("lost-signal", include_str!("shaders/lost_signal.wgsl")),
    ("tv-static", include_str!("shaders/tv_static.wgsl")),
    ("pixelize", include_str!("shaders/pixelize.wgsl")),
    ("block-dissolve", include_str!("shaders/block_dissolve.wgsl")),
    ("rgb-split-slam", include_str!("shaders/rgb_split_slam.wgsl")),
    ("zoom-punch", include_str!("shaders/zoom_punch.wgsl")),
    ("spin-blur", include_str!("shaders/spin_blur.wgsl")),
    ("shake-hit", include_str!("shaders/shake_hit.wgsl")),
```
Run: `cd /d/OpenCut/rust && cargo test -p transitions 2>&1 | grep -E "error|test result" | head -3`
Expected: a compile error, because the files don't exist yet (RED).

- [ ] **Step 2: Ported shaders**

`glitch_memories.wgsl`:
```wgsl
// Glitch Memories — ported from gl-transitions "GlitchMemories.glsl"
// Author: Gunnar Roth (based on work from natewave)
// License: MIT

fn transition(p: vec2f) -> vec4f {
    let block = floor(p / vec2f(16.0));
    let uv_noise = block / vec2f(64.0) + floor(vec2f(progress) * vec2f(1200.0, 3500.0)) / vec2f(64.0);
    var dist = vec2f(0.0);
    if (progress > 0.0) {
        dist = (fract(uv_noise) - 0.5) * 0.3 * (1.0 - progress);
    }
    let red = p + dist * 0.2;
    let green = p + dist * 0.3;
    let blue = p + dist * 0.5;
    return vec4f(
        mix(getFromColor(red), getToColor(red), progress).r,
        mix(getFromColor(green), getToColor(green), progress).g,
        mix(getFromColor(blue), getToColor(blue), progress).b,
        1.0,
    );
}
```

`datamosh_strip.wgsl`:
```wgsl
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
```

`parametric_glitch.wgsl`:
```wgsl
// Parametric Glitch — ported from gl-transitions "parametric_glitch.glsl"
// Author: Yoni Maltsman @friendlyspinach
// License: MIT
// Uniforms fixed at their defaults: ampx 1.0, ampy 1.0.

fn transition(uv: vec2f) -> vec4f {
    let original = getFromColor(uv);
    let to_color = getToColor(uv);
    let sphere = original.r * original.r + original.g * original.g + original.b * original.b - 1.0;
    let spiral_x = cos(sphere - uv.x / (progress + 0.01));
    let spiral_y = sin(sphere - uv.y / (progress + 0.01));
    let st = vec2f(fract(uv.x * spiral_x), fract(uv.y * spiral_y));
    let diff = uv - st;
    let from_color = getFromColor(uv + progress * diff);
    return mix(from_color, to_color, progress);
}
```

`doom_melt.wgsl`:
```wgsl
// Doom Melt — ported from gl-transitions "DoomScreenTransition.glsl"
// Author: Zeh Fernando
// License: MIT
// Uniforms fixed at their defaults: bars 30, amplitude 2, noise 0.1, frequency 0.5, dripScale 0.5.

const DOOM_BARS: i32 = 30;
const DOOM_AMPLITUDE: f32 = 2.0;
const DOOM_NOISE: f32 = 0.1;
const DOOM_FREQUENCY: f32 = 0.5;
const DOOM_DRIP_SCALE: f32 = 0.5;

fn doom_rand(num: i32) -> f32 {
    let n = f32(num);
    return fract(glsl_mod(n * 67123.313, 12.0) * sin(n * 10.3) * cos(n));
}

fn doom_wave(num: i32) -> f32 {
    let x = f32(num) * DOOM_FREQUENCY * 0.1 * f32(DOOM_BARS);
    return cos(x * 0.5) * cos(x * 0.13) * sin((x + 10.0) * 0.3) / 2.0 + 0.5;
}

fn doom_drip(num: i32) -> f32 {
    return sin(f32(num) / f32(DOOM_BARS - 1) * 3.141592) * DOOM_DRIP_SCALE;
}

fn doom_pos(num: i32) -> f32 {
    return mix(doom_wave(num), doom_rand(num), DOOM_NOISE) + doom_drip(num);
}

fn transition(uv: vec2f) -> vec4f {
    let bar = i32(uv.x * f32(DOOM_BARS));
    let scale = 1.0 + doom_pos(bar) * DOOM_AMPLITUDE;
    let phase = progress * scale;
    if (phase + uv.y < 1.0) {
        return getFromColor(vec2f(uv.x, uv.y + phase));
    }
    return getToColor(uv);
}
```

`lost_signal.wgsl`:
```wgsl
// Lost Signal — ported from gl-transitions "old_tv_lost_signal.glsl"
// Author: mernking (gitlab: Godswork)
// License: MIT

fn lost_signal_hash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn transition(uv: vec2f) -> vec4f {
    let p = progress;
    let strength = sin(p * 3.14159265);
    var color = mix(getFromColor(uv), getToColor(uv), p);

    // Horizontal tracking lines.
    let line_y = floor(uv.y * 120.0);
    let line = step(0.92, lost_signal_hash(vec2f(line_y, p * 20.0)));

    // Lines drift during the transition.
    let drift = sin(uv.y * 30.0 + p * 10.0) * 0.02 * strength;
    let shifted = mix(
        getFromColor(uv + vec2f(drift, 0.0)),
        getToColor(uv + vec2f(drift, 0.0)),
        p,
    );
    color = mix(color, shifted, line * strength);

    // Mild scanline darkening (CRT feel).
    let scan = sin(uv.y * 900.0) * 0.03;
    return vec4f(color.rgb - scan * strength, color.a);
}
```

`tv_static.wgsl`:
```wgsl
// TV Static — ported from gl-transitions "TVStatic.glsl"
// Author: Brandon Anzaldi
// License: MIT
// Uniform fixed at its default: offset 0.05.

const TV_STATIC_OFFSET: f32 = 0.05;

fn tv_static_noise(co: vec2f) -> f32 {
    let dt = dot(co * progress, vec2f(12.9898, 78.233));
    let sn = glsl_mod(dt, 3.14);
    return fract(sin(sn) * 43758.5453);
}

fn transition(p: vec2f) -> vec4f {
    if (progress < TV_STATIC_OFFSET) {
        return getFromColor(p);
    }
    if (progress > 1.0 - TV_STATIC_OFFSET) {
        return getToColor(p);
    }
    return vec4f(vec3f(tv_static_noise(p)), 1.0);
}
```

`pixelize.wgsl`:
```wgsl
// Pixelize — ported from gl-transitions "pixelize.glsl"
// Author: gre (forked from https://gist.github.com/benraziel/c528607361d90a072e98)
// License: MIT
// Uniforms fixed at their defaults: squaresMin 20, steps 50.

const PIXELIZE_SQUARES_MIN: f32 = 20.0;
const PIXELIZE_STEPS: f32 = 50.0;

fn transition(uv: vec2f) -> vec4f {
    let d = min(progress, 1.0 - progress);
    let dist = ceil(d * PIXELIZE_STEPS) / PIXELIZE_STEPS;
    let square_size = 2.0 * dist / vec2f(PIXELIZE_SQUARES_MIN);
    var p = uv;
    if (dist > 0.0) {
        p = (floor(uv / square_size) + 0.5) * square_size;
    }
    return mix(getFromColor(p), getToColor(p), progress);
}
```

`block_dissolve.wgsl`:
```wgsl
// Block Dissolve — ported from gl-transitions "BlockDissolve.glsl"
// Author: nwoeanhinnogaehr
// License: MIT
// Uniform fixed at its default: blocksize 0.02.

const BLOCK_DISSOLVE_SIZE: f32 = 0.02;

fn block_dissolve_rand(co: vec2f) -> f32 {
    return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn transition(uv: vec2f) -> vec4f {
    let threshold = block_dissolve_rand(floor(uv / BLOCK_DISSOLVE_SIZE));
    return mix(getFromColor(uv), getToColor(uv), step(threshold, progress));
}
```

- [ ] **Step 3: RCut original shaders**

These four switch from the outgoing clip to the incoming one at the midpoint, under the effect.

`rgb_split_slam.wgsl`:
```wgsl
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
```

`zoom_punch.wgsl`:
```wgsl
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
```

`spin_blur.wgsl`:
```wgsl
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
```

`shake_hit.wgsl`:
```wgsl
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
```

- [ ] **Step 4: Verify (GREEN) and commit**

Run: `cd /d/OpenCut/rust && cargo test -p transitions 2>&1 | grep -E "test result|panicked"`
Expected: 2 passed. `every_transition_shader_is_valid_wgsl` validates all 15 shaders. If a shader fails, fix the WGSL rather than the test, keep the visual intent, and report the fix.

Run: `cd /d/OpenCut/rust && cargo fmt -p transitions --check && cargo check --target wasm32-unknown-unknown -p opencut-wasm 2>&1 | tail -1`
Expected: no fmt output, then `Finished`.

```bash
cd /d/OpenCut && git add rust/crates/transitions && git commit -q -F - <<'EOF'
feat(renderer): add gaming transition shaders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 2: TS definitions, registry consistency test, credits

**Files:**
- Create in `apps/web/src/transitions/definitions/`: `glitch-memories.ts`, `datamosh-strip.ts`, `parametric-glitch.ts`, `doom-melt.ts`, `lost-signal.ts`, `tv-static.ts`, `pixelize.ts`, `block-dissolve.ts`, `rgb-split-slam.ts`, `zoom-punch.ts`, `spin-blur.ts`, `shake-hit.ts`
- Create: `apps/web/src/transitions/definitions/shader-params.ts` (helper)
- Modify: `apps/web/src/transitions/definitions/index.ts`
- Modify: `apps/web/src/transitions/__tests__/registry.test.ts`
- Create: `THIRD_PARTY_NOTICES.md` (repo root)

**Interfaces:**
- Consumes the Task 1 shader ids and their param layout.

- [ ] **Step 1: Failing registry tests**

In `registry.test.ts`, replace the "registers the phase 2 transitions" test with:
```ts
	test("registers every transition shader in order", () => {
		expect(TRANSITION_DEFINITIONS.map((definition) => definition.shader)).toEqual([
			"crossfade",
			"whip-pan",
			"glitch-displace",
			"glitch-memories",
			"datamosh-strip",
			"parametric-glitch",
			"doom-melt",
			"lost-signal",
			"tv-static",
			"pixelize",
			"block-dissolve",
			"rgb-split-slam",
			"zoom-punch",
			"spin-blur",
			"shake-hit",
		]);
	});

	test("shader ids match the renderer's transition registry", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../../../../rust/crates/transitions/src/shaders.rs"),
			"utf8",
		);
		// rustfmt may wrap entries across lines, so allow whitespace between tokens.
		const rustIds = [...source.matchAll(/\(\s*"([a-z0-9-]+)",\s*include_str!/g)].map(
			(match) => match[1],
		);
		expect(TRANSITION_DEFINITIONS.map((definition) => definition.shader).sort()).toEqual(
			rustIds.sort(),
		);
	});

	test("RCut originals pack their params", () => {
		const pack = (type: string, params = {}) => {
			const definition = getTransitionDefinition({ type });
			if (!definition) throw new Error(`${type} missing`);
			return getTransitionShaderParams({ definition, params });
		};
		expect(pack("rgb-split-slam")).toEqual([1]);
		expect(pack("zoom-punch")).toEqual([1, 0.8]);
		expect(pack("spin-blur")).toEqual([0.5, 1]);
		expect(pack("shake-hit", { amount: 1.5 })).toEqual([1.5, 0.6]);
	});
```
and add these imports at the top:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/registry.test.ts`
Expected: FAIL. The list has only 3 entries, and the Rust ids don't match.

- [ ] **Step 2: Helper and definitions**

`shader-params.ts`:
```ts
import type { ParamValues } from "@/params";

export function numberParam({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
```

Ported definitions have no params. Each file follows this shape (`glitch-memories.ts`):
```ts
import type { TransitionDefinition } from "@/transitions/types";

export const glitchMemoriesTransition: TransitionDefinition = {
	type: "glitch-memories",
	name: "Glitch Memories",
	group: "gaming",
	keywords: ["glitch", "rgb", "jitter"],
	shader: "glitch-memories",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
```
Create the remaining ported definitions the same way. Each uses `group: "gaming"`, `params: []` and `toShaderParams: () => []`:

| file / export | type & shader | name | keywords | defaultDurationSeconds |
| --- | --- | --- | --- | --- |
| `datamosh-strip.ts` / `datamoshStripTransition` | `datamosh-strip` | Datamosh Strip | `["datamosh", "glitch", "tear", "broadcast"]` | 0.8 |
| `parametric-glitch.ts` / `parametricGlitchTransition` | `parametric-glitch` | Parametric Glitch | `["glitch", "spiral", "warp"]` | 0.8 |
| `doom-melt.ts` / `doomMeltTransition` | `doom-melt` | Doom Melt | `["doom", "melt", "retro", "drip"]` | 1.0 |
| `lost-signal.ts` / `lostSignalTransition` | `lost-signal` | Lost Signal | `["tv", "signal", "vhs", "scanline"]` | 0.6 |
| `tv-static.ts` / `tvStaticTransition` | `tv-static` | TV Static | `["static", "noise", "tv"]` | 0.4 |
| `pixelize.ts` / `pixelizeTransition` | `pixelize` | Pixelize | `["pixel", "mosaic", "retro", "8-bit"]` | 0.8 |
| `block-dissolve.ts` / `blockDissolveTransition` | `block-dissolve` | Block Dissolve | `["blocks", "dissolve", "digital"]` | 0.8 |

RCut originals:

`rgb-split-slam.ts`:
```ts
import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const rgbSplitSlamTransition: TransitionDefinition = {
	type: "rgb-split-slam",
	name: "RGB Split Slam",
	group: "gaming",
	keywords: ["rgb", "chromatic", "impact", "hit", "punch"],
	shader: "rgb-split-slam",
	defaultDurationSeconds: 0.4,
	params: [
		{ key: "intensity", label: "Intensity", type: "number", default: 1, min: 0.2, max: 2, step: 0.1 },
	],
	toShaderParams: ({ params }) => [numberParam({ params, key: "intensity", fallback: 1 })],
};
```

`zoom-punch.ts`:
```ts
import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const zoomPunchTransition: TransitionDefinition = {
	type: "zoom-punch",
	name: "Zoom Punch",
	group: "gaming",
	keywords: ["zoom", "punch", "impact", "flash"],
	shader: "zoom-punch",
	defaultDurationSeconds: 0.4,
	params: [
		{ key: "strength", label: "Zoom", type: "number", default: 1, min: 0.2, max: 2, step: 0.1 },
		{ key: "flash", label: "Flash", type: "number", default: 0.8, min: 0, max: 1, step: 0.05 },
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "strength", fallback: 1 }),
		numberParam({ params, key: "flash", fallback: 0.8 }),
	],
};
```

`spin-blur.ts`:
```ts
import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const spinBlurTransition: TransitionDefinition = {
	type: "spin-blur",
	name: "Spin Blur",
	group: "gaming",
	keywords: ["spin", "rotate", "twirl", "motion blur"],
	shader: "spin-blur",
	defaultDurationSeconds: 0.5,
	params: [
		{ key: "turns", label: "Turns", type: "number", default: 0.5, min: 0.25, max: 2, step: 0.25 },
		{ key: "blur", label: "Blur", type: "number", default: 1, min: 0, max: 2, step: 0.1 },
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "turns", fallback: 0.5 }),
		numberParam({ params, key: "blur", fallback: 1 }),
	],
};
```

`shake-hit.ts`:
```ts
import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const shakeHitTransition: TransitionDefinition = {
	type: "shake-hit",
	name: "Shake Hit",
	group: "gaming",
	keywords: ["shake", "camera", "impact", "flash", "hit"],
	shader: "shake-hit",
	defaultDurationSeconds: 0.35,
	params: [
		{ key: "amount", label: "Shake", type: "number", default: 1, min: 0.2, max: 2, step: 0.1 },
		{ key: "flash", label: "Flash", type: "number", default: 0.6, min: 0, max: 1, step: 0.05 },
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "amount", fallback: 1 }),
		numberParam({ params, key: "flash", fallback: 0.6 }),
	],
};
```

In `definitions/index.ts`, import every new definition and extend `TRANSITION_DEFINITIONS` in exactly this order: crossfade, whipPan, glitchDisplace, glitchMemories, datamoshStrip, parametricGlitch, doomMelt, lostSignal, tvStatic, pixelize, blockDissolve, rgbSplitSlam, zoomPunch, spinBlur, shakeHit.

Write each `params` array across multiple lines if the repo formatter would wrap it. Prettier/tab style is fine; keep it consistent with `whip-pan.ts`.

- [ ] **Step 3: Credits**

Create `THIRD_PARTY_NOTICES.md` at the repo root:
````markdown
# Third-party notices

## gl-transitions

Some RCut transitions are WGSL ports of shaders from
[gl-transitions](https://github.com/gl-transitions/gl-transitions).
Each ported shader keeps its original author and license header in
`rust/crates/transitions/src/shaders/`.

| RCut transition | Original shader | Author | License |
| --- | --- | --- | --- |
| Crossfade | `fade.glsl` | gre | MIT |
| Glitch Displace | `GlitchDisplace.glsl` | Matt DesLauriers | MIT |
| Glitch Memories | `GlitchMemories.glsl` | Gunnar Roth (based on work from natewave) | MIT |
| Datamosh Strip | `StripDatamoshGlitch.glsl` | bread | MIT |
| Parametric Glitch | `parametric_glitch.glsl` | Yoni Maltsman | MIT |
| Doom Melt | `DoomScreenTransition.glsl` | Zeh Fernando | MIT |
| Lost Signal | `old_tv_lost_signal.glsl` | mernking (Godswork) | MIT |
| TV Static | `TVStatic.glsl` | Brandon Anzaldi | MIT |
| Pixelize | `pixelize.glsl` | gre (forked from benraziel) | MIT |
| Block Dissolve | `BlockDissolve.glsl` | nwoeanhinnogaehr | MIT |

The gl-transitions repository is distributed under the MIT License:

```
MIT License

Copyright (c) 2017-present gl-transitions contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
````
Verify the LICENSE text against the upstream file:
`curl -s https://raw.githubusercontent.com/gl-transitions/gl-transitions/master/LICENSE`
Copy it exactly if it differs.

- [ ] **Step 4: Verify and commit**

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/registry.test.ts`. Expected: all pass.
Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: `0`.
Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`. Expected: 244 pass, 4 fail (+2 net new tests).
Run: `cd /d/OpenCut && bun run build:web 2>&1 | tail -2`. Expected: succeeds.

```bash
cd /d/OpenCut && git add apps/web/src/transitions THIRD_PARTY_NOTICES.md && git commit -q -F - <<'EOF'
feat: gaming transition pack definitions and credits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Visual review (controller + user)

- [ ] **Step 1:** Build the release and profiling exes.
- [ ] **Step 2:** Use CDP to create "RCut gaming pack test": 13 clips alternating between `test.mp4` and `2026-07-13 20-10-21.mp4`, with one of the 12 new transitions on each cut. Capture each transition at 25%, 50% and 75% into a contact sheet. Check every one visually; flag shaders that look broken (black, frozen, or nothing happening).
- [ ] **Step 3:** The user reviews the batch in `rcut.exe` and approves it, or asks for tweaks. Tweaks go back to Task 1 for the shader and Task 2 for the param defaults.
