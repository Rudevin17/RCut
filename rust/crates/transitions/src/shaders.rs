//! WGSL sources for transitions. Each body defines `fn transition(uv: vec2f) -> vec4f`
//! and is compiled together with the shared prelude.

pub const PRELUDE: &str = include_str!("shaders/prelude.wgsl");

/// (shader id, WGSL body). Ids must match the TypeScript transition definitions.
pub const TRANSITION_SHADERS: &[(&str, &str)] = &[
    ("crossfade", include_str!("shaders/crossfade.wgsl")),
    ("whip-pan", include_str!("shaders/whip_pan.wgsl")),
    (
        "glitch-displace",
        include_str!("shaders/glitch_displace.wgsl"),
    ),
];

pub fn transition_shader_source(body: &str) -> String {
    format!("{PRELUDE}\n{body}")
}

#[cfg(test)]
mod tests {
    use super::{TRANSITION_SHADERS, transition_shader_source};

    #[test]
    fn every_transition_shader_is_valid_wgsl() {
        for (id, body) in TRANSITION_SHADERS {
            let source = transition_shader_source(body);
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
    fn shader_ids_are_unique() {
        let mut ids: Vec<&str> = TRANSITION_SHADERS.iter().map(|(id, _)| *id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), TRANSITION_SHADERS.len());
    }
}
