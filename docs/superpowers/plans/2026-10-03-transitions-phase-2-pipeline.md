# Transitions Phase 2 — Pipeline + First Three Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transitions between adjacent clips render in preview and export. This phase covers the GPU pipeline, the data model, timing and renderer integration, plus Crossfade, Whip Pan and Glitch Displace. There is no UI yet; that is Phase 3.

**Architecture:**
- **Rust renderer.** A new `transitions` crate holds one WGSL shader per transition. Each shader shares a prelude that mirrors gl-transitions' conventions (`getFromColor`, `getToColor`, `progress`, `ratio`).
- **Compositor.** The Rust compositor gains a `transition` frame item. It composites the outgoing and incoming clips' items into two textures, runs the transition shader on them, and blends the result into the scene.
- **TypeScript side.**
  - Video tracks carry `transitions`.
  - A pure planner computes each transition's window and handles, plus the visible ranges of the clips it touches.
  - The scene builder hides the clips inside the window and adds a `TransitionNode` holding copies of both clips, including their blur backgrounds on the main track.

**Tech Stack:** Rust (wgpu 29, naga 29 for validation, serde), wasm-pack, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-03-transitions-design.md`

## Global Constraints

- Work on branch `rcut-v1` in `D:\OpenCut`. Git identity is configured.
- Every commit message ends with a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Transition shader IDs are exactly `crossfade`, `whip-pan` and `glitch-displace`. TypeScript definitions must use the same strings.
- Transitions take at most 8 shader params (`MAX_TRANSITION_PARAMS = 8`).
- Ported shaders keep their original `Author` and `License` header lines.
- Timing:
  - A transition sits centred on the cut between two adjacent clips on the same video track: window `[cut − d/2, cut + d/2)`.
  - Its duration is clamped to `min(fromDuration, toDuration)`.
  - Missing handle footage holds the edge frame.
- `VideoTrack.transitions` is optional (`transitions?: TrackTransition[]`), so no storage migration is needed.
- Timing and planner modules import only types from `@/wasm`. Importing `@/wasm` values breaks `bun test` in this repo, which is why there are 4 pre-existing failures.
- Rust: rustfmt defaults; crates use `edition = "2024"` like their siblings.
- TypeScript: tabs, double quotes, object-parameter functions, and `bun:test` tests in `__tests__/` folders.
- Do NOT use `sed -i` on existing files, and do NOT write files containing backslashes through shell heredocs (this shell collapses `\\`). Use a file-edit tool.
- Current baseline:
  - `bun test` from the repo root: 208 pass, 4 fail.
  - `bunx tsc --noEmit` in `apps/web`: 0 errors.

---

## Task 1: Rust `transitions` crate (pipeline + 3 shaders)

**Files:**
- Create: `rust/crates/transitions/Cargo.toml`
- Create: `rust/crates/transitions/src/transitions.rs`, `src/pipeline.rs`, `src/shaders.rs`
- Create: `rust/crates/transitions/src/shaders/prelude.wgsl`, `crossfade.wgsl`, `whip_pan.wgsl`, `glitch_displace.wgsl`
- Modify: `rust/Cargo.toml` (workspace members)

**Interfaces:**
- Produces: `transitions::TransitionPipeline::new(&GpuContext)` and `TransitionPipeline::apply_with_encoder(&self, &GpuContext, &mut wgpu::CommandEncoder, ApplyTransitionOptions) -> Result<wgpu::Texture, TransitionsError>`.
  - `ApplyTransitionOptions { from: &Texture, to: &Texture, width: u32, height: u32, shader: &str, progress: f32, params: &[f32] }`.
- Produces: `TRANSITION_SHADERS: &[(&str, &str)]` and `MAX_TRANSITION_PARAMS`.

- [ ] **Step 1: Crate manifest and workspace**

`rust/crates/transitions/Cargo.toml`:
```toml
[package]
name = "transitions"
version = "0.1.0"
edition = "2024"

[lib]
path = "src/transitions.rs"
crate-type = ["rlib"]

[dependencies]
bytemuck = { version = "1.25.0", features = ["derive"] }
gpu = { version = "0.1.0", path = "../gpu" }
thiserror = "2.0.18"
wgpu = "29.0.1"

[dev-dependencies]
naga = { version = "29.0.1", features = ["wgsl-in"] }
```

In `rust/Cargo.toml`, add `"crates/transitions",` to `members`, after `"crates/time",`.

- [ ] **Step 2: Shaders**

`rust/crates/transitions/src/shaders/prelude.wgsl`:
```wgsl
// Shared prelude for transition shaders. Mirrors gl-transitions conventions:
// `progress` (0..1), `ratio` (width / height), `getFromColor` / `getToColor`,
// and uv with its origin at the bottom-left. Each transition defines
// `fn transition(uv: vec2f) -> vec4f`.

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct TransitionUniforms {
    resolution: vec2f,
    progress: f32,
    ratio: f32,
    params0: vec4f,
    params1: vec4f,
}

@group(0) @binding(0) var from_texture: texture_2d<f32>;
@group(0) @binding(1) var from_sampler: sampler;
@group(1) @binding(0) var to_texture: texture_2d<f32>;
@group(1) @binding(1) var to_sampler: sampler;
@group(2) @binding(0) var<uniform> uniforms: TransitionUniforms;

var<private> progress: f32;
var<private> ratio: f32;
var<private> params0: vec4f;
var<private> params1: vec4f;

// GLSL `mod` (floored), which differs from WGSL `%` for negative values.
fn glsl_mod(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

// Sampled with an explicit LOD so transitions may sample inside branches.
fn getFromColor(uv: vec2f) -> vec4f {
    return textureSampleLevel(from_texture, from_sampler, vec2f(uv.x, 1.0 - uv.y), 0.0);
}

fn getToColor(uv: vec2f) -> vec4f {
    return textureSampleLevel(to_texture, to_sampler, vec2f(uv.x, 1.0 - uv.y), 0.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    progress = uniforms.progress;
    ratio = uniforms.ratio;
    params0 = uniforms.params0;
    params1 = uniforms.params1;
    return transition(vec2f(input.tex_coord.x, 1.0 - input.tex_coord.y));
}
```

`rust/crates/transitions/src/shaders/crossfade.wgsl`:
```wgsl
// Crossfade — ported from gl-transitions "fade.glsl"
// Author: gre
// License: MIT

fn transition(uv: vec2f) -> vec4f {
    return mix(getFromColor(uv), getToColor(uv), progress);
}
```

`rust/crates/transitions/src/shaders/whip_pan.wgsl`:
```wgsl
// Whip Pan — RCut original.
// params0.xy: pan direction as a unit axis vector ((1, 0) pans right, (0, 1) pans up).
// params0.z: motion blur strength as a fraction of the frame.

const WHIP_SAMPLES: i32 = 24;
const WHIP_PI: f32 = 3.14159265;

// The outgoing frame occupies [0, 1] along the pan axis and the incoming
// frame sits right after it, so panning by 1 lands exactly on the incoming frame.
fn whip_sample(q: vec2f, direction: vec2f) -> vec4f {
    let in_from = (direction.x > 0.0 && q.x <= 1.0) || (direction.x < 0.0 && q.x >= 0.0)
        || (direction.y > 0.0 && q.y <= 1.0) || (direction.y < 0.0 && q.y >= 0.0);
    if (in_from) {
        return getFromColor(q);
    }
    return getToColor(q - direction);
}

fn transition(uv: vec2f) -> vec4f {
    let direction = params0.xy;
    let eased = progress * progress * (3.0 - 2.0 * progress);
    let blur = sin(progress * WHIP_PI) * params0.z;
    var color = vec4f(0.0);
    for (var i = 0; i < WHIP_SAMPLES; i = i + 1) {
        let offset = (f32(i) / f32(WHIP_SAMPLES - 1) - 0.5) * blur;
        color = color + whip_sample(uv + direction * (eased + offset), direction);
    }
    return color / f32(WHIP_SAMPLES);
}
```

`rust/crates/transitions/src/shaders/glitch_displace.wgsl`:
```wgsl
// Glitch Displace — ported from gl-transitions "GlitchDisplace.glsl"
// Author: Matt DesLauriers
// License: MIT
// (The original computes three voronoi values it never uses; they are omitted.)

fn glitch_displace(tex: vec4f, tex_coord: vec2f, dot_depth: f32, texture_depth: f32, strength: f32) -> vec2f {
    let dis = tex * dot_depth + 1.0 - tex * texture_depth;
    let dx = (dis.x - 1.0 + texture_depth * dot_depth) * strength;
    let dy = (dis.y - 1.0 + texture_depth * dot_depth) * strength;
    return tex_coord + vec2f(dx, dy);
}

fn glitch_ease1(t: f32) -> f32 {
    if (t == 0.0 || t == 1.0) {
        return t;
    }
    if (t < 0.5) {
        return 0.5 * pow(2.0, 20.0 * t - 10.0);
    }
    return -0.5 * pow(2.0, 10.0 - t * 20.0) + 1.0;
}

fn glitch_ease2(t: f32) -> f32 {
    if (t == 1.0) {
        return t;
    }
    return 1.0 - pow(2.0, -10.0 * t);
}

fn transition(uv: vec2f) -> vec4f {
    var color1 = getFromColor(uv);
    var color2 = getToColor(uv);
    let disp = glitch_displace(color1, uv, 0.33, 0.7, 1.0 - glitch_ease1(progress));
    let disp2 = glitch_displace(color2, uv, 0.33, 0.5, glitch_ease2(progress));
    let d_color1 = getToColor(disp);
    let d_color2_source = getFromColor(disp2);
    let val = glitch_ease1(progress);
    let gray = vec3f(dot(min(d_color2_source, d_color1).rgb, vec3f(0.299, 0.587, 0.114)));
    let d_color2 = vec4f(gray, 1.0) * 2.0;
    color1 = mix(color1, d_color2, smoothstep(0.0, 0.5, progress));
    // GLSL smoothstep(1.0, 0.5, p) == 1.0 - smoothstep(0.5, 1.0, p)
    color2 = mix(color2, d_color1, 1.0 - smoothstep(0.5, 1.0, progress));
    return mix(color1, color2, val);
}
```

- [ ] **Step 3: `src/shaders.rs` with failing validation tests**

```rust
//! WGSL sources for transitions. Each body defines `fn transition(uv: vec2f) -> vec4f`
//! and is compiled together with the shared prelude.

pub const PRELUDE: &str = include_str!("shaders/prelude.wgsl");

/// (shader id, WGSL body). Ids must match the TypeScript transition definitions.
pub const TRANSITION_SHADERS: &[(&str, &str)] = &[
    ("crossfade", include_str!("shaders/crossfade.wgsl")),
    ("whip-pan", include_str!("shaders/whip_pan.wgsl")),
    ("glitch-displace", include_str!("shaders/glitch_displace.wgsl")),
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
```

Temporary `src/transitions.rs` (just enough to run the shader tests):
```rust
mod shaders;

pub use shaders::{TRANSITION_SHADERS, transition_shader_source};
```

To prove the validation test catches errors, temporarily break `crossfade.wgsl`, e.g. change `progress` to `progres`.
Run: `cd /d/OpenCut/rust && cargo test -p transitions 2>&1 | grep -E "test |panicked|test result"`
Expected: `every_transition_shader_is_valid_wgsl` FAILS and names `crossfade`. Revert the typo and run again.
Expected: 2 passed. If a real shader fails validation, fix the WGSL (not the test) and record it in the report.

- [ ] **Step 4: `src/pipeline.rs`**

```rust
use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::shaders::{TRANSITION_SHADERS, transition_shader_source};

pub const MAX_TRANSITION_PARAMS: usize = 8;

pub struct ApplyTransitionOptions<'a> {
    pub from: &'a wgpu::Texture,
    pub to: &'a wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub shader: &'a str,
    pub progress: f32,
    pub params: &'a [f32],
}

#[derive(Debug, Error)]
pub enum TransitionsError {
    #[error("Unknown transition shader '{shader}'")]
    UnknownTransitionShader { shader: String },
    #[error(
        "Transition '{shader}' received {count} params; at most {MAX_TRANSITION_PARAMS} are supported"
    )]
    TooManyParams { shader: String, count: usize },
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TransitionUniformBuffer {
    resolution: [f32; 2],
    progress: f32,
    ratio: f32,
    params: [f32; MAX_TRANSITION_PARAMS],
}

pub struct TransitionPipeline {
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
}

impl TransitionPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let uniform_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("transitions-uniform-bind-group-layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let vertex_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("transitions-fullscreen-shader"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        // `from` and `to` each use the shared texture + sampler layout.
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("transitions-pipeline-layout"),
            bind_group_layouts: &[
                Some(context.texture_sampler_bind_group_layout()),
                Some(context.texture_sampler_bind_group_layout()),
                Some(&uniform_bind_group_layout),
            ],
            immediate_size: 0,
        });

        let pipelines = TRANSITION_SHADERS
            .iter()
            .map(|(id, body)| {
                let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some(*id),
                    source: wgpu::ShaderSource::Wgsl(transition_shader_source(body).into()),
                });
                let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(*id),
                    layout: Some(&pipeline_layout),
                    vertex: wgpu::VertexState {
                        module: &vertex_shader_module,
                        entry_point: Some("vertex_main"),
                        buffers: &[wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &[wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x2,
                                offset: 0,
                                shader_location: 0,
                            }],
                        }],
                        compilation_options: wgpu::PipelineCompilationOptions::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("fragment_main"),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: context.texture_format(),
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                        compilation_options: wgpu::PipelineCompilationOptions::default(),
                    }),
                    primitive: wgpu::PrimitiveState::default(),
                    depth_stencil: None,
                    multisample: wgpu::MultisampleState::default(),
                    multiview_mask: None,
                    cache: None,
                });
                (id.to_string(), pipeline)
            })
            .collect();

        Self {
            uniform_bind_group_layout,
            pipelines,
        }
    }

    pub fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        ApplyTransitionOptions {
            from,
            to,
            width,
            height,
            shader,
            progress,
            params,
        }: ApplyTransitionOptions<'_>,
    ) -> Result<wgpu::Texture, TransitionsError> {
        let pipeline =
            self.pipelines
                .get(shader)
                .ok_or_else(|| TransitionsError::UnknownTransitionShader {
                    shader: shader.to_string(),
                })?;
        if params.len() > MAX_TRANSITION_PARAMS {
            return Err(TransitionsError::TooManyParams {
                shader: shader.to_string(),
                count: params.len(),
            });
        }
        let mut padded_params = [0.0; MAX_TRANSITION_PARAMS];
        padded_params[..params.len()].copy_from_slice(params);

        let device = context.device();
        let output = context.create_render_texture(width, height, "transition-output");
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());
        let from_view = from.create_view(&wgpu::TextureViewDescriptor::default());
        let to_view = to.create_view(&wgpu::TextureViewDescriptor::default());
        let texture_bind_group = |view: &wgpu::TextureView, label: &str| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(label),
                layout: context.texture_sampler_bind_group_layout(),
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                    },
                ],
            })
        };
        let from_bind_group = texture_bind_group(&from_view, "transition-from-bind-group");
        let to_bind_group = texture_bind_group(&to_view, "transition-to-bind-group");
        let uniforms = TransitionUniformBuffer {
            resolution: [width as f32, height as f32],
            progress,
            ratio: width as f32 / height.max(1) as f32,
            params: padded_params,
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("transition-uniform-buffer"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("transition-uniform-bind-group"),
            layout: &self.uniform_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("transition-render-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            render_pass.set_pipeline(pipeline);
            render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
            render_pass.set_bind_group(0, &from_bind_group, &[]);
            render_pass.set_bind_group(1, &to_bind_group, &[]);
            render_pass.set_bind_group(2, &uniform_bind_group, &[]);
            render_pass.draw(0..6, 0..1);
        }

        Ok(output)
    }
}
```

Replace `src/transitions.rs` with:
```rust
mod pipeline;
mod shaders;

pub use pipeline::{
    ApplyTransitionOptions, MAX_TRANSITION_PARAMS, TransitionPipeline, TransitionsError,
};
pub use shaders::{TRANSITION_SHADERS, transition_shader_source};
```

The uniform struct is 48 bytes: `vec2f` + `f32` + `f32` + 2× `vec4f`, which matches the WGSL layout and is a multiple of 16.

- [ ] **Step 5: Verify and commit**

Run: `cd /d/OpenCut/rust && cargo test -p transitions 2>&1 | grep -E "test result|warning|error"`
Expected: 2 passed, and no warnings from `crates/transitions`.

Run: `cd /d/OpenCut/rust && cargo check --target wasm32-unknown-unknown -p transitions 2>&1 | tail -2 && cargo fmt -p transitions --check`
Expected: `Finished`, and no fmt output.

```bash
cd /d/OpenCut && git add rust/Cargo.toml rust/Cargo.lock rust/crates/transitions && git commit -q -F - <<'EOF'
feat(renderer): add transitions crate with crossfade, whip pan and glitch displace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Compositor `transition` frame item

**Files:**
- Modify: `rust/crates/compositor/Cargo.toml`
- Modify: `rust/crates/compositor/src/frame.rs`
- Modify: `rust/crates/compositor/src/lib.rs` (export)
- Modify: `rust/crates/compositor/src/compositor.rs`

**Interfaces:**
- Consumes: `transitions::{TransitionPipeline, ApplyTransitionOptions, TransitionsError}` (Task 1).
- Produces: the frame JSON item `{ "type": "transition", "shader": string, "progress": number, "params": number[], "fromItems": FrameItem[], "toItems": FrameItem[] }`. The renderer composites `fromItems` and `toItems` separately over a transparent base, blends them with the shader, and draws the result over the scene with normal blending.

- [ ] **Step 1: Dependencies**

In `rust/crates/compositor/Cargo.toml`, add under `[dependencies]`:
```toml
transitions = { version = "0.1.0", path = "../transitions" }
```
and add a section:
```toml
[dev-dependencies]
serde_json = "1"
```

- [ ] **Step 2: Failing deserialization test**

In `rust/crates/compositor/src/frame.rs`, add a `Transition` variant to `FrameItemDescriptor`:
```rust
    Transition(TransitionDescriptor),
```
Add the struct after `LayerDescriptor`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionDescriptor {
    pub shader: String,
    pub progress: f32,
    #[serde(default)]
    pub params: Vec<f32>,
    pub from_items: Vec<FrameItemDescriptor>,
    pub to_items: Vec<FrameItemDescriptor>,
}
```
Append the test module at the end of `frame.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::FrameItemDescriptor;

    #[test]
    fn deserializes_transition_items_from_renderer_json() {
        let json = r#"{"type":"transition","shader":"whip-pan","progress":0.25,"params":[1,0,0.25],"fromItems":[{"type":"sceneEffect","effectPassGroups":[]}],"toItems":[]}"#;
        let item: FrameItemDescriptor = serde_json::from_str(json).expect("valid transition json");
        let FrameItemDescriptor::Transition(transition) = item else {
            panic!("expected a transition item");
        };
        assert_eq!(transition.shader, "whip-pan");
        assert_eq!(transition.progress, 0.25);
        assert_eq!(transition.params, vec![1.0, 0.0, 0.25]);
        assert_eq!(transition.from_items.len(), 1);
        assert!(transition.to_items.is_empty());
    }
}
```
In `rust/crates/compositor/src/lib.rs`, add `TransitionDescriptor` to the `pub use frame::{ ... }` list.

Run: `cd /d/OpenCut/rust && cargo test -p compositor deserializes_transition 2>&1 | grep -E "test result|error\[" | head`
Expected: compile errors, because the `match` on `FrameItemDescriptor` in `compositor.rs` is not exhaustive. This is the RED state for the next step.

- [ ] **Step 3: Composite transitions**

In `rust/crates/compositor/src/compositor.rs`:
- Add `use transitions::{ApplyTransitionOptions, TransitionPipeline};`.
- Add `TransitionDescriptor` to the `frame::{...}` import.
- Add the field `transitions: TransitionPipeline,` to `struct Compositor`.
- Initialise it in `Compositor::new` with `transitions: TransitionPipeline::new(context),` in the returned struct literal.
- Add the error variant to `CompositorError`:
```rust
    #[error("Failed to apply transition: {0}")]
    Transitions(#[from] transitions::TransitionsError),
```

Add these methods to `impl Compositor`, directly before `fn render_layer`:
```rust
    /// Composites `items` over `scene` in order and returns the resulting texture.
    fn composite_items(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        items: &[FrameItemDescriptor],
        mut scene: wgpu::Texture,
    ) -> Result<wgpu::Texture, CompositorError> {
        for item in items {
            match item {
                FrameItemDescriptor::Layer(layer) => {
                    let layer_texture = self.render_layer(context, encoder, frame, layer)?;
                    scene = self.blend_texture(
                        context,
                        encoder,
                        &scene,
                        &layer_texture,
                        layer.blend_mode,
                        frame.width,
                        frame.height,
                    )?;
                }
                FrameItemDescriptor::SceneEffect { effect_pass_groups } => {
                    scene = self.apply_effect_groups(
                        context,
                        encoder,
                        &scene,
                        frame.width,
                        frame.height,
                        effect_pass_groups,
                    )?;
                }
                FrameItemDescriptor::Transition(transition) => {
                    let blended = self.render_transition(context, encoder, frame, transition)?;
                    scene = self.blend_texture(
                        context,
                        encoder,
                        &scene,
                        &blended,
                        BlendMode::Normal,
                        frame.width,
                        frame.height,
                    )?;
                }
            }
        }
        Ok(scene)
    }

    /// Renders both sides of a transition on transparent bases and blends them.
    fn render_transition(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        transition: &TransitionDescriptor,
    ) -> Result<wgpu::Texture, CompositorError> {
        let from_base =
            self.create_cleared_texture(context, encoder, frame.width, frame.height, [0.0; 4]);
        let from = self.composite_items(context, encoder, frame, &transition.from_items, from_base)?;
        let to_base =
            self.create_cleared_texture(context, encoder, frame.width, frame.height, [0.0; 4]);
        let to = self.composite_items(context, encoder, frame, &transition.to_items, to_base)?;
        Ok(self.transitions.apply_with_encoder(
            context,
            encoder,
            ApplyTransitionOptions {
                from: &from,
                to: &to,
                width: frame.width,
                height: frame.height,
                shader: &transition.shader,
                progress: transition.progress,
                params: &transition.params,
            },
        )?)
    }
```

In both `render_frame_to_texture` and `render_frame`, replace the whole `for item in &frame.items { ... }` loop with a single call, and change `let mut scene = self.create_cleared_texture(...)` to `let scene = ...` where the compiler asks:
```rust
        let scene = self.composite_items(context, &mut encoder, frame, &frame.items, scene)?;
```
That removes the duplicated loop; both paths now share `composite_items`.

If `create_cleared_texture` or `blend_texture` borrow rules differ from these signatures, adapt minimally and report it. The signatures in this repo are:
- `create_cleared_texture(&mut self, &GpuContext, &mut CommandEncoder, u32, u32, [f32; 4]) -> wgpu::Texture`
- `blend_texture(&mut self, &GpuContext, &mut CommandEncoder, &Texture, &Texture, BlendMode, u32, u32) -> Result<Texture, _>`

- [ ] **Step 4: Verify**

Run: `cd /d/OpenCut/rust && cargo test -p compositor 2>&1 | grep -E "test result|warning:|error"`
Expected: tests pass (including `deserializes_transition_items_from_renderer_json`), with no warnings from `crates/compositor`.

Run: `cd /d/OpenCut/rust && cargo fmt -p compositor --check && cd /d/OpenCut && bun run build:wasm 2>&1 | tail -2`
Expected: no fmt output; `Your wasm pkg is ready`.

- [ ] **Step 5: Commit**

```bash
cd /d/OpenCut && git add rust && git commit -q -F - <<'EOF'
feat(renderer): composite transition frame items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Transition model, definitions and timing (TypeScript)

**Files:**
- Create: `apps/web/src/transitions/types.ts`
- Create: `apps/web/src/transitions/timing.ts`
- Create: `apps/web/src/transitions/definitions/crossfade.ts`, `whip-pan.ts`, `glitch-displace.ts`, `index.ts`
- Create: `apps/web/src/transitions/registry.ts`
- Test: `apps/web/src/transitions/__tests__/timing.test.ts`, `apps/web/src/transitions/__tests__/registry.test.ts`
- Modify: `apps/web/src/timeline/types.ts` (`VideoTrack.transitions?`)

**Interfaces:**
- Produces:
  - `TrackTransition { id; type; fromElementId; toElementId; duration: MediaTime; params: ParamValues }`
  - `TransitionDefinition { type; name; group: "basic" | "cinematic" | "gaming"; keywords; shader; defaultDurationSeconds; params: ParamDefinition[]; toShaderParams({ params }): number[] }`
  - `planTrackTransitions({ track }: { track: VideoTrack }): TrackTransitionPlan`, where `TrackTransitionPlan = { transitions: PlannedTransition[]; visibleRanges: Map<string, TimeRange> }`
  - `PlannedTransition = { transition; from: VideoElement | ImageElement; to: VideoElement | ImageElement; window: TimeRange; fromHandle: number; toHandle: number }`, with `TimeRange = { start: number; end: number }`
  - `getTransitionSideTimes({ planned, time }): { progress; fromVisualTime; toVisualTime; fromSourceClipTime; toSourceClipTime }`
  - `getTransitionDefinition({ type }): TransitionDefinition | null`, `getTransitionShaderParams({ definition, params }): number[]`, and `TRANSITION_DEFINITIONS`

- [ ] **Step 1: Types**

`apps/web/src/transitions/types.ts`:
```ts
import type { ParamDefinition, ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";

export type TransitionGroup = "basic" | "cinematic" | "gaming";

/** A transition on the cut between two adjacent clips of a video track. */
export interface TrackTransition {
	id: string;
	type: string;
	fromElementId: string;
	toElementId: string;
	duration: MediaTime;
	params: ParamValues;
}

export interface TransitionDefinition {
	type: string;
	name: string;
	group: TransitionGroup;
	keywords: string[];
	/** Shader id registered in the renderer's transitions crate. */
	shader: string;
	defaultDurationSeconds: number;
	params: ParamDefinition[];
	/** Packs param values into the shader's param array (at most 8 numbers). */
	toShaderParams: ({ params }: { params: ParamValues }) => number[];
}
```

In `apps/web/src/timeline/types.ts`, add `import type { TrackTransition } from "@/transitions/types";` and add a field to `VideoTrack` after `hidden: boolean;`:
```ts
	transitions?: TrackTransition[];
```

- [ ] **Step 2: Failing timing tests**

`apps/web/src/transitions/__tests__/timing.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import type { VideoElement, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	getTransitionSideTimes,
	planTrackTransitions,
} from "@/transitions/timing";
import type { TrackTransition } from "@/transitions/types";

const t = (value: number) => value as MediaTime;

function clip({
	id,
	start,
	duration,
	trimStart = 0,
	trimEnd = 0,
}: {
	id: string;
	start: number;
	duration: number;
	trimStart?: number;
	trimEnd?: number;
}): VideoElement {
	return {
		id,
		name: id,
		type: "video",
		mediaId: `media-${id}`,
		startTime: t(start),
		duration: t(duration),
		trimStart: t(trimStart),
		trimEnd: t(trimEnd),
		params: {},
	} as VideoElement;
}

function track({
	elements,
	transitions,
}: {
	elements: VideoElement[];
	transitions: TrackTransition[];
}): VideoTrack {
	return {
		id: "main",
		name: "Main",
		type: "video",
		elements,
		muted: false,
		hidden: false,
		transitions,
	};
}

const crossfade = ({
	duration,
	from = "a",
	to = "b",
}: {
	duration: number;
	from?: string;
	to?: string;
}): TrackTransition => ({
	id: `tr-${from}-${to}`,
	type: "crossfade",
	fromElementId: from,
	toElementId: to,
	duration: t(duration),
	params: {},
});

describe("planTrackTransitions", () => {
	test("centres the window on the cut and limits visible ranges", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100, trimEnd: 50 }),
					clip({ id: "b", start: 100, duration: 100, trimStart: 50 }),
				],
				transitions: [crossfade({ duration: 20 })],
			}),
		});

		expect(plan.transitions).toHaveLength(1);
		expect(plan.transitions[0].window).toEqual({ start: 90, end: 110 });
		expect(plan.transitions[0].fromHandle).toBe(10);
		expect(plan.transitions[0].toHandle).toBe(10);
		expect(plan.visibleRanges.get("a")).toEqual({ start: 0, end: 90 });
		expect(plan.visibleRanges.get("b")).toEqual({ start: 110, end: 200 });
	});

	test("caps handles at the footage available beyond each clip", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100, trimEnd: 4 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [crossfade({ duration: 20 })],
			}),
		});

		expect(plan.transitions[0].fromHandle).toBe(4);
		expect(plan.transitions[0].toHandle).toBe(0);
	});

	test("clamps the duration to the shorter clip", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 10 }),
					clip({ id: "b", start: 10, duration: 100 }),
				],
				transitions: [crossfade({ duration: 50 })],
			}),
		});

		expect(plan.transitions[0].window).toEqual({ start: 5, end: 15 });
	});

	test("skips transitions whose clips are missing or not adjacent", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 120, duration: 100 }),
				],
				transitions: [
					crossfade({ duration: 20 }),
					crossfade({ duration: 20, from: "a", to: "missing" }),
				],
			}),
		});

		expect(plan.transitions).toHaveLength(0);
		expect(plan.visibleRanges.size).toBe(0);
	});

	test("narrows a clip that has transitions on both ends", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
					clip({ id: "c", start: 200, duration: 100 }),
				],
				transitions: [
					crossfade({ duration: 20 }),
					crossfade({ duration: 40, from: "b", to: "c" }),
				],
			}),
		});

		expect(plan.visibleRanges.get("b")).toEqual({ start: 110, end: 180 });
	});

	test("returns an empty plan for tracks without transitions", () => {
		const plan = planTrackTransitions({
			track: { ...track({ elements: [], transitions: [] }), transitions: undefined },
		});
		expect(plan.transitions).toEqual([]);
	});
});

describe("getTransitionSideTimes", () => {
	const [planned] = planTrackTransitions({
		track: track({
			elements: [
				clip({ id: "a", start: 0, duration: 100, trimEnd: 4 }),
				clip({ id: "b", start: 100, duration: 100, trimStart: 50 }),
			],
			transitions: [crossfade({ duration: 20 })],
		}),
	}).transitions;

	test("progress runs from 0 to 1 across the window", () => {
		expect(getTransitionSideTimes({ planned, time: 90 }).progress).toBe(0);
		expect(getTransitionSideTimes({ planned, time: 100 }).progress).toBe(0.5);
		expect(getTransitionSideTimes({ planned, time: 110 }).progress).toBe(1);
	});

	test("keeps visual times inside each clip", () => {
		const times = getTransitionSideTimes({ planned, time: 95 });
		expect(times.fromVisualTime).toBe(95);
		expect(times.toVisualTime).toBe(100);

		const later = getTransitionSideTimes({ planned, time: 105 });
		expect(later.fromVisualTime).toBe(99);
		expect(later.toVisualTime).toBe(105);
	});

	test("source times extend into handles and then hold the edge frame", () => {
		const times = getTransitionSideTimes({ planned, time: 108 });
		// `a` has 4 ticks of handle: clip time 108 is held at 100 + 4 - 1.
		expect(times.fromSourceClipTime).toBe(103);
		expect(times.toSourceClipTime).toBe(8);

		const early = getTransitionSideTimes({ planned, time: 92 });
		// `b` has 10 ticks of pre-roll available (capped at half the window).
		expect(early.toSourceClipTime).toBe(-8);
		expect(early.fromSourceClipTime).toBe(92);
	});
});
```

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/timing.test.ts`
Expected: FAIL, because `@/transitions/timing` cannot be resolved.

- [ ] **Step 3: Implement `apps/web/src/transitions/timing.ts`**

```ts
import { clampRetimeRate } from "@/retime/rate";
import type { ImageElement, VideoElement, VideoTrack } from "@/timeline";
import type { TrackTransition } from "./types";

export interface TimeRange {
	start: number;
	end: number;
}

export interface PlannedTransition {
	transition: TrackTransition;
	from: VideoElement | ImageElement;
	to: VideoElement | ImageElement;
	/** Timeline window [start, end) centred on the cut. */
	window: TimeRange;
	/** Clip time available past `from`'s end, capped at half the window. */
	fromHandle: number;
	/** Clip time available before `to`'s start, capped at half the window. */
	toHandle: number;
}

export interface TrackTransitionPlan {
	transitions: PlannedTransition[];
	/** Visible range for each element whose ends are covered by a transition. */
	visibleRanges: Map<string, TimeRange>;
}

function getClipRate({ element }: { element: VideoElement | ImageElement }): number {
	return element.type === "video"
		? clampRetimeRate({ rate: element.retime?.rate ?? 1 })
		: 1;
}

function narrowRange({
	ranges,
	element,
	start,
	end,
}: {
	ranges: Map<string, TimeRange>;
	element: VideoElement | ImageElement;
	start?: number;
	end?: number;
}): void {
	const current = ranges.get(element.id) ?? {
		start: element.startTime,
		end: element.startTime + element.duration,
	};
	ranges.set(element.id, {
		start: Math.max(current.start, start ?? current.start),
		end: Math.min(current.end, end ?? current.end),
	});
}

export function planTrackTransitions({
	track,
}: {
	track: VideoTrack;
}): TrackTransitionPlan {
	const elementsById = new Map(
		track.elements.map((element) => [element.id, element]),
	);
	const transitions: PlannedTransition[] = [];
	const visibleRanges = new Map<string, TimeRange>();

	for (const transition of track.transitions ?? []) {
		const from = elementsById.get(transition.fromElementId);
		const to = elementsById.get(transition.toElementId);
		if (!from || !to) continue;

		const cut = from.startTime + from.duration;
		if (cut !== to.startTime) continue;

		const duration = Math.min(transition.duration, from.duration, to.duration);
		if (duration <= 0) continue;

		const half = duration / 2;
		const window = { start: cut - half, end: cut + half };
		transitions.push({
			transition,
			from,
			to,
			window,
			fromHandle: Math.min(half, from.trimEnd / getClipRate({ element: from })),
			toHandle: Math.min(half, to.trimStart / getClipRate({ element: to })),
		});
		narrowRange({ ranges: visibleRanges, element: from, end: window.start });
		narrowRange({ ranges: visibleRanges, element: to, start: window.end });
	}

	return { transitions, visibleRanges };
}

export interface TransitionSideTimes {
	progress: number;
	/** Timeline time for each clip's transform/animations, kept inside the clip. */
	fromVisualTime: number;
	toVisualTime: number;
	/** Clip time used to pick each source frame; extends into handles, then holds. */
	fromSourceClipTime: number;
	toSourceClipTime: number;
}

export function getTransitionSideTimes({
	planned,
	time,
}: {
	planned: PlannedTransition;
	time: number;
}): TransitionSideTimes {
	const { window, from, to, fromHandle, toHandle } = planned;
	const length = window.end - window.start;
	const progress = Math.min(Math.max((time - window.start) / length, 0), 1);
	const fromEnd = from.startTime + from.duration;

	return {
		progress,
		fromVisualTime: Math.min(time, fromEnd - 1),
		toVisualTime: Math.max(time, to.startTime),
		fromSourceClipTime: Math.min(time - from.startTime, from.duration + fromHandle - 1),
		toSourceClipTime: Math.max(time - to.startTime, -toHandle),
	};
}
```

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/timing.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 4: Failing registry tests**

`apps/web/src/transitions/__tests__/registry.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
	getTransitionDefinition,
	getTransitionShaderParams,
	TRANSITION_DEFINITIONS,
} from "@/transitions/registry";

describe("transition registry", () => {
	test("registers the phase 2 transitions with renderer shader ids", () => {
		expect(TRANSITION_DEFINITIONS.map((definition) => definition.shader)).toEqual([
			"crossfade",
			"whip-pan",
			"glitch-displace",
		]);
	});

	test("types are unique", () => {
		const types = TRANSITION_DEFINITIONS.map((definition) => definition.type);
		expect(new Set(types).size).toBe(types.length);
	});

	test("returns null for unknown types", () => {
		expect(getTransitionDefinition({ type: "nope" })).toBeNull();
	});

	test("fills defaults when packing shader params", () => {
		const definition = getTransitionDefinition({ type: "whip-pan" });
		if (!definition) throw new Error("whip-pan missing");
		expect(getTransitionShaderParams({ definition, params: {} })).toEqual([1, 0, 0.25]);
		expect(
			getTransitionShaderParams({ definition, params: { direction: "up", strength: 0.5 } }),
		).toEqual([0, 1, 0.5]);
	});

	test("every definition packs at most 8 params", () => {
		for (const definition of TRANSITION_DEFINITIONS) {
			expect(
				getTransitionShaderParams({ definition, params: {} }).length,
			).toBeLessThanOrEqual(8);
		}
	});
});
```

Run: `cd /d/OpenCut && bun test apps/web/src/transitions/__tests__/registry.test.ts`
Expected: FAIL, because `@/transitions/registry` cannot be resolved.

- [ ] **Step 5: Definitions and registry**

`apps/web/src/transitions/definitions/crossfade.ts`:
```ts
import type { TransitionDefinition } from "@/transitions/types";

export const crossfadeTransition: TransitionDefinition = {
	type: "crossfade",
	name: "Crossfade",
	group: "basic",
	keywords: ["fade", "dissolve", "mix"],
	shader: "crossfade",
	defaultDurationSeconds: 0.5,
	params: [],
	toShaderParams: () => [],
};
```

`apps/web/src/transitions/definitions/whip-pan.ts`:
```ts
import type { TransitionDefinition } from "@/transitions/types";

const DIRECTION_VECTORS: Record<string, [number, number]> = {
	left: [-1, 0],
	right: [1, 0],
	up: [0, 1],
	down: [0, -1],
};

export const whipPanTransition: TransitionDefinition = {
	type: "whip-pan",
	name: "Whip Pan",
	group: "gaming",
	keywords: ["swipe", "motion blur", "fast", "slide"],
	shader: "whip-pan",
	defaultDurationSeconds: 0.35,
	params: [
		{
			key: "direction",
			label: "Direction",
			type: "select",
			default: "right",
			options: [
				{ value: "left", label: "Left" },
				{ value: "right", label: "Right" },
				{ value: "up", label: "Up" },
				{ value: "down", label: "Down" },
			],
		},
		{
			key: "strength",
			label: "Blur",
			type: "number",
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.05,
		},
	],
	toShaderParams: ({ params }) => {
		const [x, y] =
			DIRECTION_VECTORS[String(params.direction)] ?? DIRECTION_VECTORS.right;
		const strength = typeof params.strength === "number" ? params.strength : 0.25;
		return [x, y, strength];
	},
};
```

`apps/web/src/transitions/definitions/glitch-displace.ts`:
```ts
import type { TransitionDefinition } from "@/transitions/types";

export const glitchDisplaceTransition: TransitionDefinition = {
	type: "glitch-displace",
	name: "Glitch Displace",
	group: "gaming",
	keywords: ["glitch", "digital", "distort"],
	shader: "glitch-displace",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
```

`apps/web/src/transitions/definitions/index.ts`:
```ts
import { crossfadeTransition } from "./crossfade";
import { glitchDisplaceTransition } from "./glitch-displace";
import { whipPanTransition } from "./whip-pan";

export const TRANSITION_DEFINITIONS = [
	crossfadeTransition,
	whipPanTransition,
	glitchDisplaceTransition,
];
```

`apps/web/src/transitions/registry.ts`:
```ts
import type { ParamValues } from "@/params";
import { TRANSITION_DEFINITIONS } from "./definitions";
import type { TransitionDefinition } from "./types";

export { TRANSITION_DEFINITIONS };

const definitionsByType = new Map(
	TRANSITION_DEFINITIONS.map((definition) => [definition.type, definition]),
);

export function getTransitionDefinition({
	type,
}: {
	type: string;
}): TransitionDefinition | null {
	return definitionsByType.get(type) ?? null;
}

export function getTransitionShaderParams({
	definition,
	params,
}: {
	definition: TransitionDefinition;
	params: ParamValues;
}): number[] {
	const defaults: ParamValues = Object.fromEntries(
		definition.params.map((param) => [param.key, param.default]),
	);
	return definition.toShaderParams({ params: { ...defaults, ...params } });
}
```

If `ParamDefinition` requires fields that these literals lack, add them by following an existing definition such as `effects/definitions/blur.ts`, and report it.

- [ ] **Step 6: Verify and commit**

Run: `cd /d/OpenCut && bun test apps/web/src/transitions`
Expected: 14 pass, 0 fail.

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 222 pass, 4 fail.

```bash
cd /d/OpenCut && git add apps/web/src/transitions apps/web/src/timeline/types.ts && git commit -q -F - <<'EOF'
feat: add transition model, definitions and timing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Renderer integration

**Files:**
- Create: `apps/web/src/services/renderer/nodes/transition-node.ts`
- Modify: `apps/web/src/services/renderer/nodes/visual-node.ts`, `nodes/video-node.ts`, `nodes/blur-background-node.ts`
- Modify: `apps/web/src/services/renderer/resolve.ts`
- Modify: `apps/web/src/services/renderer/compositor/types.ts`, `compositor/frame-descriptor.ts`
- Modify: `apps/web/src/services/renderer/scene-builder.ts`

**Interfaces:**
- Consumes: `planTrackTransitions` and `getTransitionSideTimes` (Task 3), `getTransitionDefinition` and `getTransitionShaderParams` (Task 3), and the Task 2 frame JSON.
- Produces: `buildScene` renders transitions for every video track with `transitions`.

This is integration code over tested pieces. It is verified by tsc, the build, and the end-to-end checks in Task 5.

- [ ] **Step 1: Node params**

In `nodes/visual-node.ts`, add to `VisualNodeParams`:
```ts
	/** When set, the node only renders inside [start, end) of timeline time. */
	visibleRange?: { start: number; end: number };
```
In `nodes/blur-background-node.ts`, add the same field to `BlurBackgroundNodeParams`:
```ts
	visibleRange?: { start: number; end: number };
```
In `nodes/video-node.ts`, add to `VideoNodeParams`:
```ts
	/** Video frame cache stream key; defaults to `mediaId`. */
	cacheKey?: string;
```

`nodes/transition-node.ts`:
```ts
import type { PlannedTransition } from "@/transitions/timing";
import { type AnyBaseNode, BaseNode } from "./base-node";

export interface TransitionNodeParams {
	planned: PlannedTransition;
	shader: string;
	shaderParams: number[];
	/** Nodes drawn for the outgoing clip (its blur backdrop, then the clip). */
	fromNodes: AnyBaseNode[];
	/** Nodes drawn for the incoming clip. */
	toNodes: AnyBaseNode[];
}

export interface ResolvedTransitionNodeState {
	progress: number;
}

export class TransitionNode extends BaseNode<
	TransitionNodeParams,
	ResolvedTransitionNodeState
> {}
```

- [ ] **Step 2: Resolution**

In `resolve.ts`:

Add imports:
```ts
import { getTransitionSideTimes } from "@/transitions/timing";
import {
	TransitionNode,
	type ResolvedTransitionNodeState,
} from "./nodes/transition-node";
```

Extend `ResolveContext`:
```ts
type ResolveContext = {
	renderer: CanvasRenderer;
	time: number;
	/** Overrides the clip time used to pick video frames (transition handles). */
	sourceClipTimeOverride?: number;
};
```

Add a helper after `ResolveContext`:
```ts
function isOutsideVisibleRange({
	range,
	time,
}: {
	range: { start: number; end: number } | undefined;
	time: number;
}): boolean {
	return range !== undefined && (time < range.start || time >= range.end);
}
```

In `resolveNode`, add a branch before the `await Promise.all(node.children...)`:
```ts
	} else if (node instanceof TransitionNode) {
		node.resolved = await resolveTransitionNode({ node, context });
	}
```
Concretely, extend the existing `if / else if` chain with this branch.

In `resolveVisualState`, directly after the existing `if (clipTime < 0 || clipTime >= params.duration) { return null; }`, add:
```ts
	if (isOutsideVisibleRange({ range: params.visibleRange, time: context.time })) {
		return null;
	}
```

In `resolveVideoNode`, directly after its `clipTime` range check, add the same visible-range check using `node.params.visibleRange`. Then change the frame lookup to:
```ts
	const sourceTimeTicks =
		node.params.trimStart +
		getSourceTimeAtClipTime({
			clipTime: context.sourceClipTimeOverride ?? clipTime,
			retime: node.params.retime,
		});
	const frame = await videoCache.getFrameAt({
		mediaId: node.params.cacheKey ?? node.params.mediaId,
		file: node.params.file,
		time: mediaTimeToSeconds({ time: roundMediaTime({ time: sourceTimeTicks }) }),
	});
```

In `resolveBlurBackgroundNode`, after its `clipTime` range check, add the visible-range check using `node.params.visibleRange`. Change the backdrop call to:
```ts
	const backdropSource = await resolveBackdropSource({
		node,
		clipTime: context.sourceClipTimeOverride ?? clipTime,
	});
```

Add the transition resolver after `resolveBlurBackgroundNode`:
```ts
async function resolveTransitionNode({
	node,
	context,
}: {
	node: TransitionNode;
	context: ResolveContext;
}): Promise<ResolvedTransitionNodeState | null> {
	const { planned, fromNodes, toNodes } = node.params;
	if (context.time < planned.window.start || context.time >= planned.window.end) {
		for (const child of [...fromNodes, ...toNodes]) {
			child.resolved = null;
		}
		return null;
	}

	const times = getTransitionSideTimes({ planned, time: context.time });
	await Promise.all([
		...fromNodes.map((child) =>
			resolveNode({
				node: child,
				context: {
					...context,
					time: times.fromVisualTime,
					sourceClipTimeOverride: times.fromSourceClipTime,
				},
			}),
		),
		...toNodes.map((child) =>
			resolveNode({
				node: child,
				context: {
					...context,
					time: times.toVisualTime,
					sourceClipTimeOverride: times.toSourceClipTime,
				},
			}),
		),
	]);

	return { progress: times.progress };
}
```

- [ ] **Step 3: Frame descriptor**

In `compositor/types.ts`, add this variant to `FrameItemDescriptor`:
```ts
	| {
			type: "transition";
			shader: string;
			progress: number;
			params: number[];
			fromItems: FrameItemDescriptor[];
			toItems: FrameItemDescriptor[];
	  }
```

In `compositor/frame-descriptor.ts`, import `TransitionNode` from `"../nodes/transition-node"`. In `collectNode`, add this branch directly after the `RootNode` branch:
```ts
	if (node instanceof TransitionNode) {
		if (!node.resolved) {
			return;
		}

		const fromItems: FrameItemDescriptor[] = [];
		const toItems: FrameItemDescriptor[] = [];
		for (const [index, child] of node.params.fromNodes.entries()) {
			await collectNode({
				node: child,
				renderer,
				path: `${path}:from:${index}`,
				items: fromItems,
				textures,
			});
		}
		for (const [index, child] of node.params.toNodes.entries()) {
			await collectNode({
				node: child,
				renderer,
				path: `${path}:to:${index}`,
				items: toItems,
				textures,
			});
		}

		items.push({
			type: "transition",
			shader: node.params.shader,
			progress: node.resolved.progress,
			params: node.params.shaderParams,
			fromItems,
			toItems,
		});
		return;
	}
```

- [ ] **Step 4: Scene builder**

In `scene-builder.ts`:

Add imports:
```ts
import type { ImageElement, VideoElement } from "@/timeline";
import { getTransitionDefinition, getTransitionShaderParams } from "@/transitions/registry";
import { planTrackTransitions, type TimeRange } from "@/transitions/timing";
import { TransitionNode } from "./nodes/transition-node";
```
Add `VideoElement` and `ImageElement` to the existing `@/timeline` type import rather than duplicating it.

Add these helpers after `getVisibleSortedElements`:
```ts
function createMediaElementNode({
	element,
	mediaAsset,
	isPreview,
	visibleRange,
	cacheKey,
}: {
	element: VideoElement | ImageElement;
	mediaAsset: MediaAsset;
	isPreview?: boolean;
	visibleRange?: TimeRange;
	cacheKey?: string;
}): VideoNode | ImageNode | null {
	if (element.type === "video" && mediaAsset.type === "video") {
		return new VideoNode({
			mediaId: mediaAsset.id,
			url: mediaAsset.url ?? "",
			file: mediaAsset.file,
			duration: element.duration,
			timeOffset: element.startTime,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			retime: element.retime,
			transform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			opacity: readOpacityFromParams({ params: element.params }),
			blendMode: readBlendModeFromParams({ params: element.params }),
			effects: element.effects ?? [],
			masks: element.masks ?? [],
			visibleRange,
			cacheKey,
		});
	}
	if (element.type === "image" && mediaAsset.type === "image") {
		return new ImageNode({
			url: mediaAsset.url ?? "",
			duration: element.duration,
			timeOffset: element.startTime,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			transform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			opacity: readOpacityFromParams({ params: element.params }),
			blendMode: readBlendModeFromParams({ params: element.params }),
			effects: element.effects ?? [],
			masks: element.masks ?? [],
			visibleRange,
			...(isPreview && { maxSourceSize: PREVIEW_MAX_IMAGE_SIZE }),
		});
	}
	return null;
}

function createBlurBackgroundNode({
	element,
	mediaAsset,
	blurIntensity,
	visibleRange,
}: {
	element: VideoElement | ImageElement;
	mediaAsset: MediaAsset;
	blurIntensity: number;
	visibleRange?: TimeRange;
}): BlurBackgroundNode | null {
	if (mediaAsset.type !== "video" && mediaAsset.type !== "image") {
		return null;
	}
	return new BlurBackgroundNode({
		mediaId: mediaAsset.id,
		url: mediaAsset.url ?? "",
		file: mediaAsset.file,
		mediaType: mediaAsset.type,
		duration: element.duration,
		timeOffset: element.startTime,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		retime: element.type === "video" ? element.retime : undefined,
		blurIntensity,
		visibleRange,
	});
}
```

Replace the existing `if (element.type === "video" || element.type === "image") { ... }` block inside `buildTrackNodes` with:
```ts
			if (element.type === "video" || element.type === "image") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset?.file || !mediaAsset?.url) {
					continue;
				}

				const node = createMediaElementNode({
					element,
					mediaAsset,
					isPreview,
					visibleRange: plan?.visibleRanges.get(element.id),
				});
				if (node) {
					nodes.push(node);
				}
			}
```

At the top of the per-track loop body (right after `const elements = getVisibleSortedElements({ track });`), add:
```ts
		const plan = track.type === "video" ? planTrackTransitions({ track }) : null;
```

At the end of the per-track loop body (after the element loop), add:
```ts
		if (plan) {
			nodes.push(
				...buildTransitionNodes({
					plan,
					mediaMap,
					isPreview,
					blurIntensity: track.id === mainTrackId ? blurIntensity : null,
				}),
			);
		}
```

Add `mainTrackId?: string` and `blurIntensity: number | null` to the `buildTrackNodes` parameters.

Add this function after `buildTrackNodes`:
```ts
function buildTransitionNodes({
	plan,
	mediaMap,
	isPreview,
	blurIntensity,
}: {
	plan: ReturnType<typeof planTrackTransitions>;
	mediaMap: Map<string, MediaAsset>;
	isPreview?: boolean;
	blurIntensity: number | null;
}): TransitionNode[] {
	const nodes: TransitionNode[] = [];

	for (const planned of plan.transitions) {
		const definition = getTransitionDefinition({ type: planned.transition.type });
		const fromAsset = mediaMap.get(planned.from.mediaId);
		const toAsset = mediaMap.get(planned.to.mediaId);
		if (!definition || !fromAsset?.file || !toAsset?.file) {
			continue;
		}

		// Clips cut from the same file need separate decode streams for the incoming side.
		const toCacheKey =
			fromAsset.id === toAsset.id ? `${toAsset.id}:transition-incoming` : undefined;
		const fromNode = createMediaElementNode({
			element: planned.from,
			mediaAsset: fromAsset,
			isPreview,
		});
		const toNode = createMediaElementNode({
			element: planned.to,
			mediaAsset: toAsset,
			isPreview,
			cacheKey: toCacheKey,
		});
		if (!fromNode || !toNode) {
			continue;
		}

		const fromBlur =
			blurIntensity === null
				? null
				: createBlurBackgroundNode({ element: planned.from, mediaAsset: fromAsset, blurIntensity });
		const toBlur =
			blurIntensity === null
				? null
				: createBlurBackgroundNode({ element: planned.to, mediaAsset: toAsset, blurIntensity });

		nodes.push(
			new TransitionNode({
				planned,
				shader: definition.shader,
				shaderParams: getTransitionShaderParams({
					definition,
					params: planned.transition.params,
				}),
				fromNodes: fromBlur ? [fromBlur, fromNode] : [fromNode],
				toNodes: toBlur ? [toBlur, toNode] : [toNode],
			}),
		);
	}

	return nodes;
}
```

Same-file blur backdrops share the video cache stream for the incoming side in this phase. This is acceptable because the blur backdrop is low-detail. If profiling in Task 5 shows stutter on same-file transitions with a blur background, pass `cacheKey` through `BlurBackgroundNode` as well (see Task 5).

In `buildBlurBackgroundNodes`:
- add a parameter `visibleRanges?: Map<string, TimeRange>`;
- replace the `nodes.push(new BlurBackgroundNode({...}))` body with:
```ts
		const node = createBlurBackgroundNode({
			element,
			mediaAsset,
			blurIntensity,
			visibleRange: visibleRanges?.get(element.id),
		});
		if (node) {
			nodes.push(node);
		}
```

In `buildScene`, compute the blur intensity and main plan once, and pass them through:
```ts
	const blurIntensity =
		background.type === "blur"
			? (background.blurIntensity ?? DEFAULT_BACKGROUND_BLUR_INTENSITY)
			: null;

	const allNodes = buildTrackNodes({
		tracks: orderedTracksBottomToTop,
		mediaMap,
		canvasSize,
		isPreview,
		mainTrackId: mainTrack?.id,
		blurIntensity,
	});

	if (blurIntensity !== null) {
		const blurNodes = buildBlurBackgroundNodes({
			track: mainTrack,
			mediaMap,
			blurIntensity,
			visibleRanges: mainTrack
				? planTrackTransitions({ track: mainTrack }).visibleRanges
				: undefined,
		});
		for (const node of blurNodes) {
			rootNode.add(node);
		}
	} else if (
```
This replaces the existing `if (background.type === "blur") { ... buildBlurBackgroundNodes({... blurIntensity: background.blurIntensity ?? ...}) ... }` opening, keeping the `else if` colour branch. Remove the old `const allNodes = buildTrackNodes({...})` call it supersedes.

- [ ] **Step 5: Verify and commit**

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 222 pass, 4 fail.

Run: `cd /d/OpenCut && bun run build:web 2>&1 | tail -3`
Expected: the wasm build and the Next build both succeed.

```bash
cd /d/OpenCut && git add apps/web/src/services/renderer && git commit -q -F - <<'EOF'
feat: render transitions between adjacent clips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 5: End-to-end verification (controller + user)

**Files:** none unless a check fails.

- [ ] **Step 1: Build**

Run `bun run build:desktop`, then build the CDP profiling exe (`tauri build --debug --no-bundle --config <remote-debugging override>`).

- [ ] **Step 2: Create a test project via CDP**

Do not modify the user's existing project. A CDP script:
1. Copies the user's project record in IndexedDB `video-editor-projects` to a new id, named "RCut transitions test". It also copies its media metadata DB `video-editor-media-<id>` to `video-editor-media-<newId>`.
2. Replaces the main track with clips cut from the 19 GB `test.mp4`: A `[0, 4s)`, B `[4s, 8s)` with `trimStart` 4 s, C `[8s, 12s)` from `2026-07-13 20-10-21.mp4` (different file), and D `[12s, 16s)` from `test.mp4` with `trimStart` 20 s.
3. Adds the transitions A→B `crossfade` 1 s, B→C `whip-pan` 0.5 s, and C→D `glitch-displace` 0.8 s.

- [ ] **Step 3: Visual check**

Open the test project. Seek to 25%, 50% and 75% of each transition window by setting the playhead through keyboard/timeline interaction or by evaluating a seek, and capture `Page.captureScreenshot` each time. Read the screenshots and check that each shows a plausible blend of the two clips (crossfade mix, horizontal motion-blurred pan, glitch). The blur background must appear on both sides.

- [ ] **Step 4: Playback check**

Play through all three transitions with GPU-submit cadence measurement, using the same method as the playback fix. Expect about 120 submits/s and no gaps over 100 ms inside transition windows, except a possible initial-decode hitch at the start of a window for a newly started stream. Report any gaps with their timestamps.

If same-file transitions with a blur background stutter, add `cacheKey?: string` to `BlurBackgroundNodeParams`, use it in `resolveBackdropSource`, and pass `toCacheKey` to `toBlur`. Then re-measure.

- [ ] **Step 5: User check**

The user opens "RCut transitions test" in the release `rcut.exe`, plays it, and exports an MP4. Expected: all three transitions are visible in preview and in the exported file.
