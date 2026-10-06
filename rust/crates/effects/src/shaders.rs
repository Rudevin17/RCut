//! Effect shaders. Each body is appended to the shared prelude.

pub const EFFECT_PRELUDE: &str = include_str!("shaders/prelude.wgsl");

pub const EFFECT_SHADERS: [(&str, &str); 3] = [
    ("gaussian-blur", include_str!("shaders/gaussian_blur.wgsl")),
    ("color-adjust", include_str!("shaders/color_adjust.wgsl")),
    ("lut-3d", include_str!("shaders/lut_3d.wgsl")),
];

pub fn effect_shader_source(body: &str) -> String {
    format!("{EFFECT_PRELUDE}\n{body}")
}

#[cfg(test)]
mod tests {
    use super::{EFFECT_SHADERS, effect_shader_source};

    #[test]
    fn every_effect_shader_is_valid_wgsl() {
        for (id, body) in EFFECT_SHADERS {
            let source = effect_shader_source(body);
            let module = naga::front::wgsl::parse_str(&source)
                .unwrap_or_else(|error| panic!("{id}: {}", error.emit_to_string(&source)));
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .unwrap_or_else(|error| panic!("{id}: {error:?}"));
        }
    }

    #[test]
    fn effect_shader_ids_are_unique_and_known() {
        let ids: Vec<&str> = EFFECT_SHADERS.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, ["gaussian-blur", "color-adjust", "lut-3d"]);
    }
}
