# Transitions Phase 4b — Cinematic + Basic Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the planned transition pack. This batch adds 9 Cinematic transitions (Cross Zoom, Dreamy Zoom, Linear Blur, Film Burn, Overexposure, Swirl, Cube, Page Curl, Crosswarp) and 7 Basic ones (Dip to Black, Dip to White, Slide, Push, Zoom In/Out, Wipe, Circle). That brings RCut to 31 transitions.

**Architecture:** The same pattern as Phase 4a:
- one WGSL file per shader, registered in `TRANSITION_SHADERS`;
- one TypeScript definition per transition;
- credits for every ported shader.

Dip to Black and Dip to White share the `fade-color` shader. Direction options become a shared helper used by Whip Pan, Slide, Push and Wipe.

**Spec:** `docs/superpowers/specs/2026-10-03-transitions-design.md` (Transition pack)

## Global Constraints

- Work on branch `rcut-v1` in `D:\OpenCut`. Git identity is configured.
- Every commit message ends with a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ported shaders keep their `Author` and `License` lines. The tunable uniforms of a ported shader are fixed at its original defaults, as stated in each header. Page Curl is BSD 3-Clause (Hewlett-Packard), so its full notice goes in `THIRD_PARTY_NOTICES.md`.
- New shader ids:
  - ported: `fade-color`, `zoom-in-out`, `circle-open`, `cross-zoom`, `dreamy-zoom`, `linear-blur`, `film-burn`, `overexposure`, `swirl`, `cube`, `page-curl`, `crosswarp`
  - RCut originals: `slide`, `push`, `wipe`
- Shader params:
  - `fade-color`: `params0.xyz` is the colour and `params0.w` is the colour phase.
  - `slide` and `push`: `params0.xy` is a unit axis direction.
  - `wipe`: `params0.xy` is a unit axis direction and `params0.z` is the edge softness.
- Rust uses rustfmt defaults. TypeScript uses tabs, double quotes, object-parameter functions, and `bun:test` tests in `__tests__/`.
- Do NOT use `sed -i` on existing files, and do NOT write files through shell heredocs. Use file-edit tools.
- Baseline: `bun test` 244 pass / 4 fail, tsc 0, `cargo test -p transitions` 2 pass.

---

## Task 1: Rust shaders (15 WGSL files)

**Files:**
- Create in `rust/crates/transitions/src/shaders/`: `fade_color.wgsl`, `zoom_in_out.wgsl`, `circle_open.wgsl`, `cross_zoom.wgsl`, `dreamy_zoom.wgsl`, `linear_blur.wgsl`, `film_burn.wgsl`, `overexposure.wgsl`, `swirl.wgsl`, `cube.wgsl`, `page_curl.wgsl`, `crosswarp.wgsl`, `slide.wgsl`, `push.wgsl`, `wipe.wgsl`
- Modify: `rust/crates/transitions/src/shaders.rs`

- [ ] **Step 1: Register ids first (RED)**

Append to `TRANSITION_SHADERS` after `shake-hit`:
```rust
    ("fade-color", include_str!("shaders/fade_color.wgsl")),
    ("slide", include_str!("shaders/slide.wgsl")),
    ("push", include_str!("shaders/push.wgsl")),
    ("zoom-in-out", include_str!("shaders/zoom_in_out.wgsl")),
    ("wipe", include_str!("shaders/wipe.wgsl")),
    ("circle-open", include_str!("shaders/circle_open.wgsl")),
    ("cross-zoom", include_str!("shaders/cross_zoom.wgsl")),
    ("dreamy-zoom", include_str!("shaders/dreamy_zoom.wgsl")),
    ("linear-blur", include_str!("shaders/linear_blur.wgsl")),
    ("film-burn", include_str!("shaders/film_burn.wgsl")),
    ("overexposure", include_str!("shaders/overexposure.wgsl")),
    ("swirl", include_str!("shaders/swirl.wgsl")),
    ("cube", include_str!("shaders/cube.wgsl")),
    ("page-curl", include_str!("shaders/page_curl.wgsl")),
    ("crosswarp", include_str!("shaders/crosswarp.wgsl")),
```
Run `cd /d/OpenCut/rust && cargo test -p transitions 2>&1 | grep -E "error" | head -2`.
Expected: a missing-file compile error.

- [ ] **Step 2: Basic shaders**

`fade_color.wgsl`:
```wgsl
// Dip to Color — ported from gl-transitions "fadecolor.glsl"
// Author: gre
// License: MIT
// params0.xyz: colour (RGB, 0..1), params0.w: colour phase (original default 0.4).

fn transition(uv: vec2f) -> vec4f {
    let color = vec4f(params0.xyz, 1.0);
    let color_phase = params0.w;
    // GLSL smoothstep(1.0 - phase, 0.0, p) == 1.0 - smoothstep(0.0, 1.0 - phase, p)
    return mix(
        mix(color, getFromColor(uv), 1.0 - smoothstep(0.0, 1.0 - color_phase, progress)),
        mix(color, getToColor(uv), smoothstep(color_phase, 1.0, progress)),
        progress,
    );
}
```

`slide.wgsl`:
```wgsl
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
```

`push.wgsl`:
```wgsl
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
```

`zoom_in_out.wgsl`:
```wgsl
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
```

`wipe.wgsl`:
```wgsl
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
```

`circle_open.wgsl`:
```wgsl
// Circle — ported from gl-transitions "circleopen.glsl"
// Author: gre
// License: MIT
// Uniforms fixed at their defaults: smoothness 0.3, opening true.

const CIRCLE_SMOOTHNESS: f32 = 0.3;
const CIRCLE_SQRT_2: f32 = 1.414213562373;

fn transition(uv: vec2f) -> vec4f {
    let m = smoothstep(
        -CIRCLE_SMOOTHNESS,
        0.0,
        CIRCLE_SQRT_2 * distance(vec2f(0.5), uv) - progress * (1.0 + CIRCLE_SMOOTHNESS),
    );
    return mix(getFromColor(uv), getToColor(uv), 1.0 - m);
}
```

- [ ] **Step 3: Cinematic shaders**

`cross_zoom.wgsl`:
```wgsl
// Cross Zoom — ported from gl-transitions "CrossZoom.glsl"
// Author: rectalogic (ported by gre)
// License: MIT
// Uniform fixed at its default: strength 0.4.

const CROSS_ZOOM_STRENGTH: f32 = 0.4;
const CROSS_ZOOM_PI: f32 = 3.141592653589793;

fn cross_zoom_linear_ease(begin: f32, change: f32, duration: f32, time: f32) -> f32 {
    return change * time / duration + begin;
}

fn cross_zoom_exponential_ease_in_out(begin: f32, change: f32, duration: f32, time_in: f32) -> f32 {
    if (time_in == 0.0) {
        return begin;
    }
    if (time_in == duration) {
        return begin + change;
    }
    let time = time_in / (duration / 2.0);
    if (time < 1.0) {
        return change / 2.0 * pow(2.0, 10.0 * (time - 1.0)) + begin;
    }
    return change / 2.0 * (-pow(2.0, -10.0 * (time - 1.0)) + 2.0) + begin;
}

fn cross_zoom_sinusoidal_ease_in_out(begin: f32, change: f32, duration: f32, time: f32) -> f32 {
    return -change / 2.0 * (cos(CROSS_ZOOM_PI * time / duration) - 1.0) + begin;
}

fn cross_zoom_rand(co: vec2f) -> f32 {
    return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn transition(uv: vec2f) -> vec4f {
    // Linear interpolate center across center half of the image.
    let center = vec2f(cross_zoom_linear_ease(0.25, 0.5, 1.0, progress), 0.5);
    let dissolve = cross_zoom_exponential_ease_in_out(0.0, 1.0, 1.0, progress);
    // Mirrored sinusoidal loop: 0 -> strength -> 0.
    let strength = cross_zoom_sinusoidal_ease_in_out(0.0, CROSS_ZOOM_STRENGTH, 0.5, progress);

    var color = vec4f(0.0);
    var total = 0.0;
    let to_center = center - uv;
    // Randomize the lookups to hide the fixed number of samples.
    let offset = cross_zoom_rand(uv);
    for (var t = 0; t <= 40; t = t + 1) {
        let percent = (f32(t) + offset) / 40.0;
        let weight = 4.0 * (percent - percent * percent);
        let sample_uv = uv + to_center * percent * strength;
        color = color + mix(getFromColor(sample_uv), getToColor(sample_uv), dissolve) * weight;
        total = total + weight;
    }
    return color / total;
}
```

`dreamy_zoom.wgsl`:
```wgsl
// Dreamy Zoom — ported from gl-transitions "DreamyZoom.glsl"
// Author: Zeh Fernando
// License: MIT
// Uniforms fixed at their defaults: rotation 6, scale 1.2.
// DEG2RAD keeps the original's constant value.

const DREAMY_DEG2RAD: f32 = 0.03926990816987241548078304229099;
const DREAMY_ROTATION: f32 = 6.0;
const DREAMY_SCALE: f32 = 1.2;

fn transition(uv: vec2f) -> vec4f {
    let first_half = progress < 0.5;
    let phase = select((progress - 0.5) * 2.0, progress * 2.0, first_half);
    let angle_offset = select(
        mix(-DREAMY_ROTATION * DREAMY_DEG2RAD, 0.0, phase),
        mix(0.0, DREAMY_ROTATION * DREAMY_DEG2RAD, phase),
        first_half,
    );
    let new_scale = select(mix(DREAMY_SCALE, 1.0, phase), mix(1.0, DREAMY_SCALE, phase), first_half);

    let p = (uv - vec2f(0.5)) / new_scale * vec2f(ratio, 1.0);
    let angle = atan2(p.y, p.x) + angle_offset;
    let dist = length(p);
    let q = vec2f(cos(angle) * dist / ratio + 0.5, sin(angle) * dist + 0.5);

    var c = getToColor(q);
    if (first_half) {
        c = getFromColor(q);
    }
    let glow = select(mix(1.0, 0.0, phase), mix(0.0, 1.0, phase), first_half);
    return c + glow;
}
```

`linear_blur.wgsl`:
```wgsl
// Linear Blur — ported from gl-transitions "LinearBlur.glsl"
// Author: gre
// License: MIT
// Uniform fixed at its default: intensity 0.1.

const LINEAR_BLUR_INTENSITY: f32 = 0.1;
const LINEAR_BLUR_PASSES: i32 = 6;

fn transition(uv: vec2f) -> vec4f {
    var c1 = vec4f(0.0);
    var c2 = vec4f(0.0);
    let disp = LINEAR_BLUR_INTENSITY * (0.5 - distance(0.5, progress));
    for (var xi = 0; xi < LINEAR_BLUR_PASSES; xi = xi + 1) {
        let x = f32(xi) / f32(LINEAR_BLUR_PASSES) - 0.5;
        for (var yi = 0; yi < LINEAR_BLUR_PASSES; yi = yi + 1) {
            let y = f32(yi) / f32(LINEAR_BLUR_PASSES) - 0.5;
            let offset = disp * vec2f(x, y);
            c1 = c1 + getFromColor(uv + offset);
            c2 = c2 + getToColor(uv + offset);
        }
    }
    let count = f32(LINEAR_BLUR_PASSES * LINEAR_BLUR_PASSES);
    return mix(c1 / count, c2 / count, progress);
}
```

`film_burn.wgsl`:
```wgsl
// Film Burn — ported from gl-transitions "FilmBurn.glsl"
// Author: Anastasia Dunbar
// License: MIT
// Uniform fixed at its default: Seed 2.31.

const FILM_BURN_SEED: f32 = 2.31;
const FILM_BURN_PI: f32 = 3.14159265358979323;
const FILM_BURN_REPEATS: f32 = 50.0;

fn film_burn_sigmoid(x: f32, a: f32) -> f32 {
    if (x > 0.5) {
        return 1.0 - pow(2.0 - x * 2.0, a) / 2.0;
    }
    return pow(x * 2.0, a) / 2.0;
}

fn film_burn_rand1(co: f32) -> f32 {
    return fract(sin(co * 24.9898 + FILM_BURN_SEED) * 43758.5453);
}

fn film_burn_rand2(co: vec2f) -> f32 {
    return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn film_burn_apow(a: f32, b: f32) -> f32 {
    return pow(abs(a), b) * sign(b);
}

fn film_burn_pow3(a: vec3f, b: vec3f) -> vec3f {
    return vec3f(film_burn_apow(a.r, b.r), film_burn_apow(a.g, b.g), film_burn_apow(a.b, b.b));
}

fn film_burn_smooth_mix(a: f32, b: f32, c: f32) -> f32 {
    return mix(a, b, film_burn_sigmoid(c, 2.0));
}

fn film_burn_random(co_in: vec2f, shft: f32) -> f32 {
    let co = co_in + 10.0;
    return film_burn_smooth_mix(
        fract(sin(dot(co, vec2f(12.9898 + floor(shft) * 0.5, 78.233 + FILM_BURN_SEED))) * 43758.5453),
        fract(sin(dot(co, vec2f(12.9898 + floor(shft + 1.0) * 0.5, 78.233 + FILM_BURN_SEED))) * 43758.5453),
        fract(shft),
    );
}

fn film_burn_smooth_random(co: vec2f, shft: f32) -> f32 {
    return film_burn_smooth_mix(
        film_burn_smooth_mix(
            film_burn_random(floor(co), shft),
            film_burn_random(floor(co + vec2f(1.0, 0.0)), shft),
            fract(co.x),
        ),
        film_burn_smooth_mix(
            film_burn_random(floor(co + vec2f(0.0, 1.0)), shft),
            film_burn_random(floor(co + vec2f(1.0, 1.0)), shft),
            fract(co.x),
        ),
        fract(co.y),
    );
}

fn film_burn_texture(p: vec2f) -> vec4f {
    return mix(getFromColor(p), getToColor(p), film_burn_sigmoid(progress, 10.0));
}

fn transition(p_in: vec2f) -> vec4f {
    var f = vec3f(0.0);
    for (var i = 0.0; i < 13.0; i = i + 1.0) {
        f = f + sin(p_in.x * film_burn_rand1(i) * 6.0 + progress * 8.0 + film_burn_rand1(i + 1.43))
            * sin(p_in.y * film_burn_rand1(i + 4.4) * 6.0 + progress * 6.0 + film_burn_rand1(i + 2.4));
        let spot = vec2f(
            film_burn_smooth_random(vec2f(progress * 1.3), i + 1.0),
            film_burn_smooth_random(vec2f(progress * 0.5), i + 6.25),
        );
        f = f + 1.0 - clamp(length(p_in - spot) * mix(20.0, 70.0, film_burn_rand1(i)), 0.0, 1.0);
    }
    f = (f + 4.0) / 11.0;
    f = film_burn_pow3(f * vec3f(1.0, 0.7, 0.6), vec3f(1.0, 2.0 - sin(progress * FILM_BURN_PI), 1.3));
    f = f * sin(progress * FILM_BURN_PI);

    let p = (p_in - 0.5)
        * (1.0 + film_burn_smooth_random(vec2f(progress * 5.0), 6.3) * sin(progress * FILM_BURN_PI) * 0.05)
        + 0.5;

    var blurred = vec4f(0.0);
    let blur_amount = sin(progress * FILM_BURN_PI) * 0.03;
    for (var i = 0.0; i < FILM_BURN_REPEATS; i = i + 1.0) {
        // The original passes degrees through degrees(); kept for identical output.
        let angle = degrees(i / FILM_BURN_REPEATS * 360.0);
        let q = vec2f(cos(angle), sin(angle)) * (film_burn_rand2(vec2f(i, p.x + p.y)) + blur_amount);
        blurred = blurred + film_burn_texture(p + q * blur_amount);
    }
    blurred = blurred / FILM_BURN_REPEATS;

    return blurred + vec4f(f, 0.0);
}
```

`overexposure.wgsl`:
```wgsl
// Overexposure — ported from gl-transitions "Overexposure.glsl"
// Author: Ben Zhang
// License: MIT
// Uniform fixed at its default: strength 0.6.

const OVEREXPOSURE_STRENGTH: f32 = 0.6;
const OVEREXPOSURE_PI: f32 = 3.141592653589793;

fn transition(uv: vec2f) -> vec4f {
    let from_color = getFromColor(uv);
    let to_color = getToColor(uv);
    let from_m = 1.0 - progress + sin(OVEREXPOSURE_PI * progress) * OVEREXPOSURE_STRENGTH;
    let to_m = progress + sin(OVEREXPOSURE_PI * progress) * OVEREXPOSURE_STRENGTH;
    return vec4f(
        from_color.rgb * from_color.a * from_m + to_color.rgb * to_color.a * to_m,
        mix(from_color.a, to_color.a, progress),
    );
}
```

`swirl.wgsl`:
```wgsl
// Swirl — ported from gl-transitions "Swirl.glsl"
// Author: Sergey Kosarevsky (ported by gre)
// License: MIT

fn transition(uv_in: vec2f) -> vec4f {
    let radius = 1.0;
    let t = progress;
    var uv = uv_in - vec2f(0.5);
    let dist = length(uv);
    if (dist < radius) {
        let percent = (radius - dist) / radius;
        let a = select(mix(1.0, 0.0, (t - 0.5) / 0.5), mix(0.0, 1.0, t / 0.5), t <= 0.5);
        let theta = percent * percent * a * 8.0 * 3.14159;
        let s = sin(theta);
        let c = cos(theta);
        uv = vec2f(dot(uv, vec2f(c, -s)), dot(uv, vec2f(s, c)));
    }
    uv = uv + vec2f(0.5);
    return mix(getFromColor(uv), getToColor(uv), t);
}
```

`cube.wgsl`:
```wgsl
// Cube — ported from gl-transitions "cube.glsl"
// Author: gre
// License: MIT
// Uniforms fixed at their defaults: persp 0.7, unzoom 0.3, reflection 0.4, floating 3.0.

const CUBE_PERSP: f32 = 0.7;
const CUBE_UNZOOM: f32 = 0.3;
const CUBE_REFLECTION: f32 = 0.4;
const CUBE_FLOATING: f32 = 3.0;

fn cube_project(p: vec2f) -> vec2f {
    return p * vec2f(1.0, -1.2) + vec2f(0.0, -CUBE_FLOATING / 100.0);
}

fn cube_in_bounds(p: vec2f) -> bool {
    return all(vec2f(0.0) < p) && all(p < vec2f(1.0));
}

fn cube_bg_color(pfr_in: vec2f, pto_in: vec2f) -> vec4f {
    var c = vec4f(0.0, 0.0, 0.0, 1.0);
    let pfr = cube_project(pfr_in);
    if (cube_in_bounds(pfr)) {
        c = c + mix(vec4f(0.0), getFromColor(pfr), CUBE_REFLECTION * mix(1.0, 0.0, pfr.y));
    }
    let pto = cube_project(pto_in);
    if (cube_in_bounds(pto)) {
        c = c + mix(vec4f(0.0), getToColor(pto), CUBE_REFLECTION * mix(1.0, 0.0, pto.y));
    }
    return c;
}

// p: the position, persp: the perspective in [0, 1], center: the x center in [0, 1] (0.5 excluded).
fn cube_xskew(p: vec2f, persp: f32, center: f32) -> vec2f {
    let x = mix(p.x, 1.0 - p.x, center);
    let side = select(-1.0, 1.0, center < 0.5);
    return (vec2f(x, (p.y - 0.5 * (1.0 - persp) * x) / (1.0 + (persp - 1.0) * x))
        - vec2f(0.5 - distance(center, 0.5), 0.0))
        * vec2f(0.5 / distance(center, 0.5) * side, 1.0)
        + vec2f(select(1.0, 0.0, center < 0.5), 0.0);
}

fn transition(op: vec2f) -> vec4f {
    let uz = CUBE_UNZOOM * 2.0 * (0.5 - distance(0.5, progress));
    let p = -uz * 0.5 + (1.0 + uz) * op;
    let from_p = cube_xskew(
        (p - vec2f(progress, 0.0)) / vec2f(1.0 - progress, 1.0),
        1.0 - mix(progress, 0.0, CUBE_PERSP),
        0.0,
    );
    let to_p = cube_xskew(p / vec2f(progress, 1.0), mix(pow(progress, 2.0), 1.0, CUBE_PERSP), 1.0);
    if (cube_in_bounds(from_p)) {
        return getFromColor(from_p);
    }
    if (cube_in_bounds(to_p)) {
        return getToColor(to_p);
    }
    return cube_bg_color(from_p, to_p);
}
```

`page_curl.wgsl`:
```wgsl
// Page Curl — ported from gl-transitions "InvertedPageCurl.glsl"
// Author: Hewlett-Packard (adapted by Sergey Kosarevsky)
// License: BSD 3 Clause
// Copyright (c) 2010 Hewlett-Packard Development Company, L.P. All rights reserved.
// The full BSD 3-Clause notice is reproduced in THIRD_PARTY_NOTICES.md.
// (Dead code from the original's behindSurface, whose results were always overwritten, is omitted.)

const CURL_MIN_AMOUNT: f32 = -0.16;
const CURL_MAX_AMOUNT: f32 = 1.5;
const CURL_PI: f32 = 3.141592653589793;
const CURL_SCALE: f32 = 512.0;
const CURL_SHARPNESS: f32 = 3.0;
const CURL_CYLINDER_RADIUS: f32 = 1.0 / CURL_PI / 2.0;

var<private> curl_amount: f32;
var<private> curl_cylinder_center: f32;
var<private> curl_cylinder_angle: f32;

fn curl_hit_point(hit_angle: f32, point_in: vec3f, rrotation: mat3x3f) -> vec3f {
    var point = point_in;
    point.y = hit_angle / (2.0 * CURL_PI);
    return rrotation * point;
}

fn curl_anti_alias(color1: vec4f, color2: vec4f, distance_in: f32) -> vec4f {
    let d = distance_in * CURL_SCALE;
    if (d < 0.0) {
        return color2;
    }
    if (d > 2.0) {
        return color1;
    }
    let dd = pow(1.0 - d / 2.0, CURL_SHARPNESS);
    return (color2 - color1) * dd + color1;
}

fn curl_distance_to_edge(point: vec3f) -> f32 {
    var dx = abs(select(point.x, 1.0 - point.x, point.x > 0.5));
    var dy = abs(select(point.y, 1.0 - point.y, point.y > 0.5));
    if (point.x < 0.0) {
        dx = -point.x;
    }
    if (point.x > 1.0) {
        dx = point.x - 1.0;
    }
    if (point.y < 0.0) {
        dy = -point.y;
    }
    if (point.y > 1.0) {
        dy = point.y - 1.0;
    }
    if ((point.x < 0.0 || point.x > 1.0) && (point.y < 0.0 || point.y > 1.0)) {
        return sqrt(dx * dx + dy * dy);
    }
    return min(dx, dy);
}

fn curl_see_through(yc: f32, p: vec2f, rotation: mat3x3f, rrotation: mat3x3f) -> vec4f {
    let hit_angle = CURL_PI - (acos(clamp(yc / CURL_CYLINDER_RADIUS, -1.0, 1.0)) - curl_cylinder_angle);
    let point = curl_hit_point(hit_angle, rotation * vec3f(p, 1.0), rrotation);
    if (yc <= 0.0 && (point.x < 0.0 || point.y < 0.0 || point.x > 1.0 || point.y > 1.0)) {
        return getToColor(p);
    }
    if (yc > 0.0) {
        return getFromColor(p);
    }
    let color = getFromColor(point.xy);
    return curl_anti_alias(color, vec4f(0.0), curl_distance_to_edge(point));
}

fn curl_see_through_with_shadow(
    yc: f32,
    p: vec2f,
    point: vec3f,
    rotation: mat3x3f,
    rrotation: mat3x3f,
) -> vec4f {
    var shadow = (1.0 - curl_distance_to_edge(point) * 30.0) / 3.0;
    if (shadow < 0.0) {
        shadow = 0.0;
    } else {
        shadow = shadow * curl_amount;
    }
    let shadow_color = curl_see_through(yc, p, rotation, rrotation);
    return vec4f(shadow_color.rgb - shadow, shadow_color.a);
}

fn curl_backside(yc: f32, point: vec3f) -> vec4f {
    let color = getFromColor(point.xy);
    var gray = (color.r + color.b + color.g) / 15.0;
    gray = gray + (8.0 / 10.0)
        * (pow(max(0.0, 1.0 - abs(yc / CURL_CYLINDER_RADIUS)), 2.0 / 10.0) / 2.0 + (5.0 / 10.0));
    return vec4f(vec3f(gray), color.a);
}

fn curl_behind_surface(p: vec2f, yc_in: f32, point_in: vec3f, rrotation: mat3x3f) -> vec4f {
    let yc = -CURL_CYLINDER_RADIUS - CURL_CYLINDER_RADIUS - yc_in;
    let hit_angle = (acos(clamp(yc / CURL_CYLINDER_RADIUS, -1.0, 1.0)) + curl_cylinder_angle) - CURL_PI;
    let point = curl_hit_point(hit_angle, point_in, rrotation);

    var shado = 0.0;
    if (yc < 0.0 && point.x >= 0.0 && point.y >= 0.0 && point.x <= 1.0 && point.y <= 1.0
        && (hit_angle < CURL_PI || curl_amount > 0.5)) {
        let dx = point.x - 0.5;
        let dy = point.y - 0.5;
        shado = 1.0 - (sqrt(dx * dx + dy * dy) / (71.0 / 100.0));
        let nyc = -yc / CURL_CYLINDER_RADIUS;
        shado = shado * nyc * nyc * nyc * 0.5;
    }
    return vec4f(getToColor(p).rgb - shado, 1.0);
}

fn transition(p: vec2f) -> vec4f {
    curl_amount = progress * (CURL_MAX_AMOUNT - CURL_MIN_AMOUNT) + CURL_MIN_AMOUNT;
    curl_cylinder_center = curl_amount;
    curl_cylinder_angle = 2.0 * CURL_PI * curl_amount;

    let angle = 100.0 * CURL_PI / 180.0;
    let c1 = cos(-angle);
    let s1 = sin(-angle);
    let rotation = mat3x3f(
        vec3f(c1, s1, 0.0),
        vec3f(-s1, c1, 0.0),
        vec3f(-0.801, 0.8900, 1.0),
    );
    let c2 = cos(angle);
    let s2 = sin(angle);
    let rrotation = mat3x3f(
        vec3f(c2, s2, 0.0),
        vec3f(-s2, c2, 0.0),
        vec3f(0.98500, 0.985, 1.0),
    );

    var point = rotation * vec3f(p, 1.0);
    let yc = point.y - curl_cylinder_center;

    if (yc < -CURL_CYLINDER_RADIUS) {
        // Behind surface
        return curl_behind_surface(p, yc, point, rrotation);
    }
    if (yc > CURL_CYLINDER_RADIUS) {
        // Flat surface
        return getFromColor(p);
    }

    let hit_angle = (acos(clamp(yc / CURL_CYLINDER_RADIUS, -1.0, 1.0)) + curl_cylinder_angle) - CURL_PI;
    let hit_angle_mod = glsl_mod(hit_angle, 2.0 * CURL_PI);
    if ((hit_angle_mod > CURL_PI && curl_amount < 0.5) || (hit_angle_mod > CURL_PI / 2.0 && curl_amount < 0.0)) {
        return curl_see_through(yc, p, rotation, rrotation);
    }

    point = curl_hit_point(hit_angle, point, rrotation);
    if (point.x < 0.0 || point.y < 0.0 || point.x > 1.0 || point.y > 1.0) {
        return curl_see_through_with_shadow(yc, p, point, rotation, rrotation);
    }

    var color = curl_backside(yc, point);
    var other_color = getFromColor(p);
    if (yc < 0.0) {
        let dx2 = point.x - 0.5;
        let dy2 = point.y - 0.5;
        let nyc2 = -yc / CURL_CYLINDER_RADIUS;
        let shado = (1.0 - (sqrt(dx2 * dx2 + dy2 * dy2) / 0.71)) * nyc2 * nyc2 * nyc2 * 0.5;
        other_color = vec4f(0.0, 0.0, 0.0, shado);
    }
    color = curl_anti_alias(color, other_color, CURL_CYLINDER_RADIUS - abs(yc));

    let cl = curl_see_through_with_shadow(yc, p, point, rotation, rrotation);
    return curl_anti_alias(color, cl, curl_distance_to_edge(point));
}
```

`crosswarp.wgsl`:
```wgsl
// Crosswarp — ported from gl-transitions "crosswarp.glsl"
// Author: Eke Péter <peterekepeter@gmail.com>
// License: MIT

fn transition(p: vec2f) -> vec4f {
    let x = smoothstep(0.0, 1.0, progress * 2.0 + p.x - 1.0);
    return mix(getFromColor((p - 0.5) * (1.0 - x) + 0.5), getToColor((p - 0.5) * x + 0.5), x);
}
```

- [ ] **Step 4: Verify (GREEN) and commit**

Run: `cd /d/OpenCut/rust && cargo test -p transitions 2>&1 | grep -E "test result|panicked"`.
Expected: 2 passed, with all 30 shaders valid. If naga rejects a shader, fix the WGSL rather than the test, keep its intent, and report it.

Run: `cd /d/OpenCut/rust && cargo fmt -p transitions --check && cargo check --target wasm32-unknown-unknown -p opencut-wasm 2>&1 | tail -1`.
Expected: clean, then `Finished`.

```bash
cd /d/OpenCut && git add rust/crates/transitions && git commit -q -F - <<'EOF'
feat(renderer): add cinematic and basic transition shaders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Definitions, shared direction helper, tests, credits

**Files:**
- Modify: `apps/web/src/transitions/definitions/shader-params.ts` (direction helper)
- Modify: `apps/web/src/transitions/definitions/whip-pan.ts` (use the helper)
- Create in `apps/web/src/transitions/definitions/`: `dip-to-black.ts`, `dip-to-white.ts`, `slide.ts`, `push.ts`, `zoom-in-out.ts`, `wipe.ts`, `circle.ts`, `cross-zoom.ts`, `dreamy-zoom.ts`, `linear-blur.ts`, `film-burn.ts`, `overexposure.ts`, `swirl.ts`, `cube.ts`, `page-curl.ts`, `crosswarp.ts`
- Modify: `apps/web/src/transitions/definitions/index.ts`
- Modify: `apps/web/src/transitions/__tests__/registry.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Failing tests**

In `registry.test.ts`:

(a) Replace the ordered list in "registers every transition shader in order" with:
```ts
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
			"fade-color",
			"fade-color",
			"slide",
			"push",
			"zoom-in-out",
			"wipe",
			"circle-open",
			"cross-zoom",
			"dreamy-zoom",
			"linear-blur",
			"film-burn",
			"overexposure",
			"swirl",
			"cube",
			"page-curl",
			"crosswarp",
```

(b) In "shader ids match the renderer's transition registry", compare unique shader ids, because Dip to Black and Dip to White share one. Change the expectation to:
```ts
		const shaderIds = [...new Set(TRANSITION_DEFINITIONS.map((definition) => definition.shader))];
		expect(shaderIds.sort()).toEqual(rustIds.sort());
```

(c) Add a test:
```ts
	test("basic transitions pack their params", () => {
		const pack = (type: string, params = {}) => {
			const definition = getTransitionDefinition({ type });
			if (!definition) throw new Error(`${type} missing`);
			return getTransitionShaderParams({ definition, params });
		};
		expect(pack("dip-to-black")).toEqual([0, 0, 0, 0.4]);
		expect(pack("dip-to-white")).toEqual([1, 1, 1, 0.4]);
		expect(pack("slide")).toEqual([-1, 0]);
		expect(pack("push", { direction: "up" })).toEqual([0, 1]);
		expect(pack("wipe")).toEqual([1, 0, 0.1]);
		expect(pack("whip-pan", { direction: "constructor" })).toEqual([1, 0, 0.25]);
	});
```
The last assertion locks in the safe fallback for unknown direction strings.

Run `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/registry.test.ts`. It should FAIL (RED).

- [ ] **Step 2: Shared direction helper**

Append to `shader-params.ts`:
```ts
export type Direction = "left" | "right" | "up" | "down";

const DIRECTION_VECTORS = new Map<string, [number, number]>([
	["left", [-1, 0]],
	["right", [1, 0]],
	["up", [0, 1]],
	["down", [0, -1]],
]);

export const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
	{ value: "up", label: "Up" },
	{ value: "down", label: "Down" },
];

/** Unit axis vector for a direction param; unknown values fall back safely. */
export function directionVector({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: Direction;
}): [number, number] {
	const value = params[key];
	return (
		(typeof value === "string" ? DIRECTION_VECTORS.get(value) : undefined) ??
		DIRECTION_VECTORS.get(fallback) ??
		[1, 0]
	);
}
```

Update `whip-pan.ts`:
- Delete its local `DIRECTION_VECTORS`.
- Use `options: DIRECTION_OPTIONS` in the direction param.
- Set `toShaderParams` to:
```ts
	toShaderParams: ({ params }) => [
		...directionVector({ params, key: "direction", fallback: "right" }),
		numberParam({ params, key: "strength", fallback: 0.25 }),
	],
```
Import `DIRECTION_OPTIONS`, `directionVector` and `numberParam` from `@/transitions/definitions/shader-params`.

- [ ] **Step 3: Definitions**

Param-less definitions follow the existing `crossfade.ts` shape (`params: []`, `toShaderParams: () => []`):

| file / export | type | shader | name | group | keywords | defaultDurationSeconds |
| --- | --- | --- | --- | --- | --- | --- |
| `zoom-in-out.ts` / `zoomInOutTransition` | `zoom-in-out` | `zoom-in-out` | Zoom In/Out | basic | `["zoom", "scale"]` | 0.6 |
| `circle.ts` / `circleTransition` | `circle` | `circle-open` | Circle | basic | `["circle", "iris", "reveal"]` | 0.8 |
| `cross-zoom.ts` / `crossZoomTransition` | `cross-zoom` | `cross-zoom` | Cross Zoom | cinematic | `["zoom", "blur", "dissolve"]` | 1.0 |
| `dreamy-zoom.ts` / `dreamyZoomTransition` | `dreamy-zoom` | `dreamy-zoom` | Dreamy Zoom | cinematic | `["dream", "zoom", "glow", "rotate"]` | 0.8 |
| `linear-blur.ts` / `linearBlurTransition` | `linear-blur` | `linear-blur` | Linear Blur | cinematic | `["blur", "soft", "dissolve"]` | 0.6 |
| `film-burn.ts` / `filmBurnTransition` | `film-burn` | `film-burn` | Film Burn | cinematic | `["film", "burn", "light leak", "vintage"]` | 1.2 |
| `overexposure.ts` / `overexposureTransition` | `overexposure` | `overexposure` | Overexposure | cinematic | `["flash", "bright", "exposure"]` | 0.8 |
| `swirl.ts` / `swirlTransition` | `swirl` | `swirl` | Swirl | cinematic | `["swirl", "twist", "spiral"]` | 1.0 |
| `cube.ts` / `cubeTransition` | `cube` | `cube` | Cube | cinematic | `["cube", "3d", "rotate"]` | 1.0 |
| `page-curl.ts` / `pageCurlTransition` | `page-curl` | `page-curl` | Page Curl | cinematic | `["page", "curl", "flip", "book"]` | 1.2 |
| `crosswarp.ts` / `crosswarpTransition` | `crosswarp` | `crosswarp` | Crosswarp | cinematic | `["warp", "stretch"]` | 0.8 |

Definitions with parameters:

`dip-to-black.ts`:
```ts
import type { TransitionDefinition } from "@/transitions/types";

export const dipToBlackTransition: TransitionDefinition = {
	type: "dip-to-black",
	name: "Dip to Black",
	group: "basic",
	keywords: ["fade", "black", "dip"],
	shader: "fade-color",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [0, 0, 0, 0.4],
};
```

`dip-to-white.ts`: the same shape with `type: "dip-to-white"`, `name: "Dip to White"`, `keywords: ["fade", "white", "flash", "dip"]` and `toShaderParams: () => [1, 1, 1, 0.4]`. Export it as `dipToWhiteTransition`.

`slide.ts`:
```ts
import {
	DIRECTION_OPTIONS,
	directionVector,
} from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const slideTransition: TransitionDefinition = {
	type: "slide",
	name: "Slide",
	group: "basic",
	keywords: ["slide", "move", "cover"],
	shader: "slide",
	defaultDurationSeconds: 0.5,
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			default: "left",
			options: DIRECTION_OPTIONS,
		},
	],
	toShaderParams: ({ params }) =>
		directionVector({ params, key: "direction", fallback: "left" }),
};
```

`push.ts`: the same shape as `slide.ts`, with `type`/`shader` `"push"`, `name: "Push"`, `keywords: ["push", "move", "shove"]` and `defaultDurationSeconds: 0.5`. Export it as `pushTransition`.

`wipe.ts`:
```ts
import {
	DIRECTION_OPTIONS,
	directionVector,
	numberParam,
} from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const wipeTransition: TransitionDefinition = {
	type: "wipe",
	name: "Wipe",
	group: "basic",
	keywords: ["wipe", "reveal", "sweep"],
	shader: "wipe",
	defaultDurationSeconds: 0.6,
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			default: "right",
			options: DIRECTION_OPTIONS,
		},
		{ key: "softness", label: "Softness", type: "number", default: 0.1, min: 0, max: 0.5, step: 0.05 },
	],
	toShaderParams: ({ params }) => [
		...directionVector({ params, key: "direction", fallback: "right" }),
		numberParam({ params, key: "softness", fallback: 0.1 }),
	],
};
```

In `definitions/index.ts`, extend `TRANSITION_DEFINITIONS` after `shakeHitTransition`, in this exact order: dipToBlack, dipToWhite, slide, push, zoomInOut, wipe, circle, crossZoom, dreamyZoom, linearBlur, filmBurn, overexposure, swirl, cube, pageCurl, crosswarp.

- [ ] **Step 4: Credits**

In `THIRD_PARTY_NOTICES.md`, add these rows to the gl-transitions table after Block Dissolve:
```markdown
| Dip to Black / Dip to White | `fadecolor.glsl` | gre | MIT |
| Zoom In/Out | `zoomInOut.glsl` | OllyOllyOlly | MIT |
| Circle | `circleopen.glsl` | gre | MIT |
| Cross Zoom | `CrossZoom.glsl` | rectalogic (ported by gre) | MIT |
| Dreamy Zoom | `DreamyZoom.glsl` | Zeh Fernando | MIT |
| Linear Blur | `LinearBlur.glsl` | gre | MIT |
| Film Burn | `FilmBurn.glsl` | Anastasia Dunbar | MIT |
| Overexposure | `Overexposure.glsl` | Ben Zhang | MIT |
| Swirl | `Swirl.glsl` | Sergey Kosarevsky (ported by gre) | MIT |
| Cube | `cube.glsl` | gre | MIT |
| Crosswarp | `crosswarp.glsl` | Eke Péter | MIT |
| Page Curl | `InvertedPageCurl.glsl` | Hewlett-Packard (adapted by Sergey Kosarevsky) | BSD 3-Clause (below) |
```

Then append a section at the end of the file:
````markdown
## Page Curl (BSD 3-Clause)

Page Curl is a WGSL port of `InvertedPageCurl.glsl`, distributed under this license:

```
Copyright (c) 2010 Hewlett-Packard Development Company, L.P. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
     copyright notice, this list of conditions and the following disclaimer
     in the documentation and/or other materials provided with the
     distribution.
   * Neither the name of Hewlett-Packard nor the names of its
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
````
Check the notice against the upstream file header with `curl -s https://raw.githubusercontent.com/gl-transitions/gl-transitions/master/transitions/InvertedPageCurl.glsl` and copy it exactly.

- [ ] **Step 5: Verify and commit**

- `bun test apps/web/src/transitions/__tests__/registry.test.ts` → all pass.
- tsc → 0.
- Full `bun test` → 245 pass, 4 fail.
- `bun run build:web` → succeeds.

```bash
cd /d/OpenCut && git add apps/web/src/transitions THIRD_PARTY_NOTICES.md && git commit -q -F - <<'EOF'
feat: cinematic and basic transition definitions and credits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Visual review (controller + user)

- [ ] **Step 1:** Build the release exe and the profiling exe.
- [ ] **Step 2:** Create "RCut cinematic & basic test" via CDP with the 16 new types, one per cut. Capture each at 25%, 50% and 75%, and check them visually.
- [ ] **Step 3:** The user reviews the batch in `rcut.exe`.
