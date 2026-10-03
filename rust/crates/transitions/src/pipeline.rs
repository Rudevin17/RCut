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
        let pipeline = self.pipelines.get(shader).ok_or_else(|| {
            TransitionsError::UnknownTransitionShader {
                shader: shader.to_string(),
            }
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
