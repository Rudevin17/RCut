pub const MAX_EFFECT_PARAMS: usize = 16;

#[derive(Clone, Debug)]
pub struct EffectPass {
    pub shader: String,
    pub params: Vec<f32>,
    pub lut: Option<String>,
}
