// 3D LUT. Params: [intensity, size, domainMin.rgb, domainMax.rgb].

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    let alpha = source.a;
    if (alpha <= 0.0) {
        return vec4f(0.0);
    }
    let x = clamp(source.rgb / alpha, vec3f(0.0), vec3f(1.0));
    let intensity = param(0u);
    let size = param(1u);
    let domain_min = vec3f(param(2u), param(3u), param(4u));
    let domain_max = vec3f(param(5u), param(6u), param(7u));
    let u = clamp((x - domain_min) / (domain_max - domain_min), vec3f(0.0), vec3f(1.0));
    // Sample texel centres so 0 and 1 map exactly to the first and last LUT entries.
    let coord = u * (size - 1.0) / size + 0.5 / size;
    let graded = textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).rgb;
    return vec4f(mix(x, graded, intensity) * alpha, alpha);
}
