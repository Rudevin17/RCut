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
    (
        "glitch-memories",
        include_str!("shaders/glitch_memories.wgsl"),
    ),
    (
        "datamosh-strip",
        include_str!("shaders/datamosh_strip.wgsl"),
    ),
    (
        "parametric-glitch",
        include_str!("shaders/parametric_glitch.wgsl"),
    ),
    ("doom-melt", include_str!("shaders/doom_melt.wgsl")),
    ("lost-signal", include_str!("shaders/lost_signal.wgsl")),
    ("tv-static", include_str!("shaders/tv_static.wgsl")),
    ("pixelize", include_str!("shaders/pixelize.wgsl")),
    (
        "block-dissolve",
        include_str!("shaders/block_dissolve.wgsl"),
    ),
    (
        "rgb-split-slam",
        include_str!("shaders/rgb_split_slam.wgsl"),
    ),
    ("zoom-punch", include_str!("shaders/zoom_punch.wgsl")),
    ("spin-blur", include_str!("shaders/spin_blur.wgsl")),
    ("shake-hit", include_str!("shaders/shake_hit.wgsl")),
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
