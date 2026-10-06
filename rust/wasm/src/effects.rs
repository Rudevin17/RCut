#![cfg(target_arch = "wasm32")]

use effects::{ApplyEffectsOptions, EffectPass};
use gpu::wgpu;
use js_sys::{Float32Array, Object};
use serde::Deserialize;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

use crate::compositor::with_compositor;
use crate::gpu::{
    import_canvas_texture, read_offscreen_canvas_property, read_property, read_serde_property,
    read_u32_property, render_texture_to_canvas, with_gpu_runtime, with_gpu_runtime_mut,
};

struct ApplyEffectPassesOptions {
    source: wgpu::web_sys::OffscreenCanvas,
    width: u32,
    height: u32,
    passes: Vec<EffectPassInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffectPassInput {
    shader: String,
    params: Vec<f32>,
    #[serde(default)]
    lut: Option<String>,
}

struct RegisterLutOptions {
    id: String,
    size: u32,
    data: Vec<f32>,
}

#[wasm_bindgen(js_name = applyEffectPasses)]
pub fn apply_effect_passes(options: JsValue) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    let ApplyEffectPassesOptions {
        source,
        width,
        height,
        passes,
    } = parse_apply_effect_passes_options(options)?;

    with_gpu_runtime(|runtime| {
        let source_texture = import_canvas_texture(
            &runtime.context,
            &source,
            width,
            height,
            "effects-input-texture",
        );
        let effect_passes = map_effect_passes(passes);
        let result_texture = runtime
            .effects
            .apply(
                &runtime.context,
                ApplyEffectsOptions {
                    source: &source_texture,
                    width,
                    height,
                    passes: &effect_passes,
                },
            )
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        render_texture_to_canvas(&runtime.context, &result_texture, width, height)
    })
}

/// Registers a 3D LUT with every effect pipeline: the GPU runtime's and, if initialized,
/// the compositor's. `data` is `size`³ RGB floats with red varying fastest.
#[wasm_bindgen(js_name = registerLut)]
pub fn register_lut(options: JsValue) -> Result<(), JsValue> {
    let RegisterLutOptions { id, size, data } = parse_register_lut_options(options)?;

    with_gpu_runtime_mut(|runtime| {
        runtime
            .effects
            .register_lut(&runtime.context, &id, size, &data);
        with_compositor(|compositor| compositor.register_lut(&runtime.context, &id, size, &data));
        Ok(())
    })
}

/// True only when every initialized effect pipeline has the LUT `id`.
#[wasm_bindgen(js_name = hasLut)]
pub fn has_lut(id: String) -> bool {
    let runtime_has_lut =
        with_gpu_runtime(|runtime| Ok(runtime.effects.has_lut(&id))).unwrap_or(false);
    let compositor_has_lut = with_compositor(|compositor| compositor.has_lut(&id)).unwrap_or(true);
    runtime_has_lut && compositor_has_lut
}

fn map_effect_passes(effect_passes: Vec<EffectPassInput>) -> Vec<EffectPass> {
    effect_passes
        .into_iter()
        .map(|pass| EffectPass {
            shader: pass.shader,
            params: pass.params,
            lut: pass.lut,
        })
        .collect()
}

fn parse_apply_effect_passes_options(value: JsValue) -> Result<ApplyEffectPassesOptions, JsValue> {
    let object: Object = value
        .dyn_into()
        .map_err(|_| JsValue::from_str("applyEffectPasses expects an options object"))?;

    Ok(ApplyEffectPassesOptions {
        source: read_offscreen_canvas_property(&object, "source")?,
        width: read_u32_property(&object, "width")?,
        height: read_u32_property(&object, "height")?,
        passes: read_serde_property(&object, "passes")?,
    })
}

fn parse_register_lut_options(value: JsValue) -> Result<RegisterLutOptions, JsValue> {
    let object: Object = value
        .dyn_into()
        .map_err(|_| JsValue::from_str("registerLut expects an options object"))?;

    let id: String = read_serde_property(&object, "id")?;
    let size = read_u32_property(&object, "size")?;
    let data = read_property(&object, "data")?
        .dyn_into::<Float32Array>()
        .map_err(|_| JsValue::from_str("Property 'data' must be a Float32Array"))?
        .to_vec();

    let expected_len = u64::from(size).pow(3) * 3;
    if size == 0 || data.len() as u64 != expected_len {
        return Err(JsValue::from_str(&format!(
            "LUT '{id}' of size {size} needs {expected_len} floats, got {}",
            data.len()
        )));
    }

    Ok(RegisterLutOptions { id, size, data })
}
