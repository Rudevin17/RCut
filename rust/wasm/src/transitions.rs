#![cfg(target_arch = "wasm32")]

use gpu::wgpu;
use js_sys::Object;
use transitions::ApplyTransitionOptions;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

use crate::gpu::{
    import_canvas_texture, read_f32_property, read_offscreen_canvas_property, read_property,
    read_serde_property, read_u32_property, render_texture_to_canvas, with_gpu_runtime,
};

/// Blends `from` into `to` with a transition shader. Used for transition thumbnails.
#[wasm_bindgen(js_name = applyTransition)]
pub fn apply_transition(options: JsValue) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    let object: Object = options
        .dyn_into()
        .map_err(|_| JsValue::from_str("applyTransition expects an options object"))?;
    let from = read_offscreen_canvas_property(&object, "from")?;
    let to = read_offscreen_canvas_property(&object, "to")?;
    let width = read_u32_property(&object, "width")?;
    let height = read_u32_property(&object, "height")?;
    let shader = read_property(&object, "shader")?
        .as_string()
        .ok_or_else(|| JsValue::from_str("Property 'shader' must be a string"))?;
    let progress = read_f32_property(&object, "progress")?;
    let params: Vec<f32> = read_serde_property(&object, "params")?;

    with_gpu_runtime(|runtime| {
        let from_texture = import_canvas_texture(
            &runtime.context,
            &from,
            width,
            height,
            "transition-preview-from",
        );
        let to_texture = import_canvas_texture(
            &runtime.context,
            &to,
            width,
            height,
            "transition-preview-to",
        );
        let mut encoder =
            runtime
                .context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("transition-preview-encoder"),
                });
        let output = runtime
            .transitions
            .apply_with_encoder(
                &runtime.context,
                &mut encoder,
                ApplyTransitionOptions {
                    from: &from_texture,
                    to: &to_texture,
                    width,
                    height,
                    shader: &shader,
                    progress,
                    params: &params,
                },
            )
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        runtime.context.queue().submit([encoder.finish()]);
        render_texture_to_canvas(&runtime.context, &output, width, height)
    })
}
