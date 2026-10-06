use serde::{Deserialize, Serialize};

use crate::BlendMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub width: u32,
    pub height: u32,
    pub clear: CanvasClearDescriptor,
    pub items: Vec<FrameItemDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasClearDescriptor {
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrameItemDescriptor {
    Layer(LayerDescriptor),
    SceneEffect {
        #[serde(rename = "effectPassGroups")]
        effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    },
    Transition(TransitionDescriptor),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDescriptor {
    pub texture_id: String,
    pub transform: QuadTransformDescriptor,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    pub mask: Option<LayerMaskDescriptor>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadTransformDescriptor {
    pub center_x: f32,
    pub center_y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation_degrees: f32,
    pub flip_x: bool,
    pub flip_y: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerMaskDescriptor {
    pub texture_id: String,
    pub feather: f32,
    pub inverted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectPassDescriptor {
    pub shader: String,
    pub params: Vec<f32>,
    #[serde(default)]
    pub lut: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTextureDescriptor {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

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
