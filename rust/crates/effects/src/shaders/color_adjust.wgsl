// Basic grading. Params: [exposure, contrast, highlights, shadows, whites, blacks,
// saturation, vibrance, temperature, tint]. All but exposure are in -1..1.

fn srgb_to_linear(c: vec3f) -> vec3f {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3f(2.4));
    return select(high, low, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
    let low = c * 12.92;
    let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, c <= vec3f(0.0031308));
}

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    let alpha = source.a;
    if (alpha <= 0.0) {
        return vec4f(0.0);
    }
    var x = clamp(source.rgb / alpha, vec3f(0.0), vec3f(1.0));

    // White balance and exposure in linear light.
    var lin = srgb_to_linear(x);
    let temperature = param(8u);
    let tint = param(9u);
    lin = lin * vec3f(1.0 + 0.25 * temperature, 1.0 - 0.25 * tint, 1.0 - 0.25 * temperature);
    lin = lin * exp2(param(0u));
    x = linear_to_srgb(max(lin, vec3f(0.0)));

    // Whites/Blacks as levels.
    let lo = -0.1 * param(5u);
    let hi = 1.0 - 0.1 * param(4u);
    x = (x - lo) / (hi - lo);

    // Shadows/Highlights with smooth luminance masks.
    let tone = luma(x);
    let shadow_mask = 1.0 - smoothstep(0.0, 0.5, tone);
    let highlight_mask = smoothstep(0.5, 1.0, tone);
    x = x + 0.25 * param(3u) * shadow_mask + 0.25 * param(2u) * highlight_mask;

    // Contrast around mid grey.
    x = (x - 0.5) * (1.0 + param(1u)) + 0.5;

    // Saturation, then vibrance (stronger on less saturated colours).
    x = mix(vec3f(luma(x)), x, 1.0 + param(6u));
    let saturation = max(max(x.r, x.g), x.b) - min(min(x.r, x.g), x.b);
    x = mix(vec3f(luma(x)), x, 1.0 + param(7u) * (1.0 - saturation));

    x = clamp(x, vec3f(0.0), vec3f(1.0));
    return vec4f(x * alpha, alpha);
}
