use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::{EFFECT_SHADERS, EffectPass, MAX_EFFECT_PARAMS, effect_shader_source};

pub struct ApplyEffectsOptions<'a> {
    pub source: &'a wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub passes: &'a [EffectPass],
}

pub struct EffectPipeline {
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    lut_bind_group_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
    placeholder_lut: wgpu::BindGroup,
    luts: HashMap<String, wgpu::BindGroup>,
}

#[derive(Debug, Error)]
pub enum EffectsError {
    #[error("Unknown effect shader '{shader}'")]
    UnknownEffectShader { shader: String },
    #[error("Shader '{shader}' got {count} params; at most {MAX_EFFECT_PARAMS} are supported")]
    TooManyParams { shader: String, count: usize },
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct EffectUniformBuffer {
    resolution: [f32; 2],
    pad: [f32; 2],
    params: [[f32; 4]; 4],
}

impl EffectPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let uniform_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-uniform-bind-group-layout"),
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
        let lut_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-lut-bind-group-layout"),
                    entries: &[
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Texture {
                                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                                view_dimension: wgpu::TextureViewDimension::D3,
                                multisampled: false,
                            },
                            count: None,
                        },
                        wgpu::BindGroupLayoutEntry {
                            binding: 1,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                            count: None,
                        },
                    ],
                });
        let vertex_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-fullscreen-shader"),
                    source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
                });
        let pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                        Some(&lut_bind_group_layout),
                    ],
                    immediate_size: 0,
                });
        let pipelines = EFFECT_SHADERS
            .iter()
            .map(|(id, body)| {
                let shader_module =
                    context
                        .device()
                        .create_shader_module(wgpu::ShaderModuleDescriptor {
                            label: Some(id),
                            source: wgpu::ShaderSource::Wgsl(effect_shader_source(body).into()),
                        });
                let pipeline =
                    context
                        .device()
                        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                            label: Some(id),
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
                                module: &shader_module,
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
        let placeholder_lut =
            create_lut_bind_group(context, &lut_bind_group_layout, 1, &[255, 255, 255, 255]);

        Self {
            uniform_bind_group_layout,
            lut_bind_group_layout,
            pipelines,
            placeholder_lut,
            luts: HashMap::new(),
        }
    }

    /// Registers a `size`³ 3D LUT under `id`, replacing any LUT already registered there.
    /// `data` is RGB floats in 0..1 with red varying fastest.
    pub fn register_lut(&mut self, context: &GpuContext, id: &str, size: u32, data: &[f32]) {
        let rgba: Vec<u8> = data
            .chunks_exact(3)
            .flat_map(|rgb| {
                let [r, g, b] = [rgb[0], rgb[1], rgb[2]].map(unit_to_byte);
                [r, g, b, 255]
            })
            .collect();
        let bind_group = create_lut_bind_group(context, &self.lut_bind_group_layout, size, &rgba);
        self.luts.insert(id.to_string(), bind_group);
    }

    pub fn has_lut(&self, id: &str) -> bool {
        self.luts.contains_key(id)
    }

    pub fn apply(
        &self,
        context: &GpuContext,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("effects-command-encoder"),
                });
        let output = self.apply_with_encoder(
            context,
            &mut encoder,
            ApplyEffectsOptions {
                source,
                width,
                height,
                passes,
            },
        )?;
        context.queue().submit([encoder.finish()]);
        Ok(output)
    }

    pub fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut current_texture: Option<wgpu::Texture> = None;

        // A pass whose LUT is not registered (yet) is skipped rather than failing the frame.
        let runnable_passes = passes.iter().filter(|pass| {
            pass.lut
                .as_ref()
                .is_none_or(|id| self.luts.contains_key(id))
        });

        for pass in runnable_passes {
            let input_texture = current_texture.as_ref().unwrap_or(source);
            let output_texture =
                context.create_render_texture(width, height, "effects-pass-output");
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let texture_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-texture-bind-group"),
                        layout: context.texture_sampler_bind_group_layout(),
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                            },
                        ],
                    });
            let uniform_buffer =
                context
                    .device()
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("effects-uniform-buffer"),
                        contents: bytemuck::bytes_of(&pack_effect_uniforms(pass, width, height)?),
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    });
            let uniform_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-uniform-bind-group"),
                        layout: &self.uniform_bind_group_layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: uniform_buffer.as_entire_binding(),
                        }],
                    });
            let lut_bind_group = pass
                .lut
                .as_ref()
                .and_then(|id| self.luts.get(id))
                .unwrap_or(&self.placeholder_lut);
            let pipeline = self.pipelines.get(&pass.shader).ok_or_else(|| {
                EffectsError::UnknownEffectShader {
                    shader: pass.shader.clone(),
                }
            })?;

            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("effects-render-pass"),
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
                render_pass.set_bind_group(0, &texture_bind_group, &[]);
                render_pass.set_bind_group(1, &uniform_bind_group, &[]);
                render_pass.set_bind_group(2, lut_bind_group, &[]);
                render_pass.draw(0..6, 0..1);
            }

            current_texture = Some(output_texture);
        }

        if let Some(output) = current_texture {
            return Ok(output);
        }

        // Nothing to run: pass the source through unchanged.
        let output = context.create_render_texture(width, height, "effects-passthrough-output");
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());
        context.encode_texture_blit_to_view(
            encoder,
            source,
            &output_view,
            "effects-passthrough-blit",
        );
        Ok(output)
    }
}

fn create_lut_bind_group(
    context: &GpuContext,
    layout: &wgpu::BindGroupLayout,
    size: u32,
    rgba: &[u8],
) -> wgpu::BindGroup {
    let extent = wgpu::Extent3d {
        width: size,
        height: size,
        depth_or_array_layers: size,
    };
    let texture = context.device().create_texture(&wgpu::TextureDescriptor {
        label: Some("effects-lut-texture"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D3,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    context.queue().write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size * 4),
            rows_per_image: Some(size),
        },
        extent,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    context
        .device()
        .create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("effects-lut-bind-group"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                },
            ],
        })
}

fn unit_to_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn pack_effect_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let count = pass.params.len();
    if count > MAX_EFFECT_PARAMS {
        return Err(EffectsError::TooManyParams {
            shader: pass.shader.clone(),
            count,
        });
    }
    let mut params = [0.0_f32; MAX_EFFECT_PARAMS];
    params[..count].copy_from_slice(&pass.params);

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        pad: [0.0, 0.0],
        params: bytemuck::cast(params),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn uniform_buffer_is_80_bytes() {
        assert_eq!(std::mem::size_of::<super::EffectUniformBuffer>(), 80);
    }
}
