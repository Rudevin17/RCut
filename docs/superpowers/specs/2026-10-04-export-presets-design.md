# Export presets: design

**Date:** 2026-10-04
**Status:** Design approved, pending user review of this spec
**Roadmap:** sub-project 1 of `2026-10-04-pro-features-roadmap.md`

## Goal

Exports get professional output controls: resolution, frame rate and bitrate. They also get built-in platform presets and presets the user saves, so a video can go out at, for example, YouTube 4K60 without changing the project.

## Non-goals

- Natively re-rendering at the export size. Frames are scaled at encode time instead (see Design).
- New codecs (HEVC, AV1, ProRes). The formats stay MP4 (H.264 + AAC) and WebM (VP9 + Opus).
- Cropping, letterboxing or stretching to a different aspect ratio.
- File-size estimates, two-pass encoding, and render queues or batch export.
- Changing the save destination flow (folder / Export as… / Downloads fallback) or file naming.

## Current state (verified 2026-10-04)

- `apps/web/src/export/index.ts`: `ExportOptions = { format, quality, fps?, includeAudio? }`, with formats `mp4 | webm` and quality `low | medium | high | very_high`.
- `services/renderer/scene-exporter.ts`:
  - It renders through a `CanvasRenderer` at the **project canvas size**.
  - Video codec is `avc` for MP4 and `vp9` for WebM.
  - Video and audio bitrate both come from mediabunny's `QUALITY_*` levels. The AAC check probes at 192 kbps.
  - The frame loop steps at the export fps.
- `components/editor/export-button.tsx`: the popover has Format, Quality and Include audio. It passes `fps: activeProject.settings.fps`.
- `export/export-settings-store.ts` is a persisted zustand store (`rcut-export-settings`) that holds `exportFolder`.
- Element positions are in **project pixels**, added to the render centre (`compositor/frame-descriptor.ts`, `centerX: renderer.width / 2 + position.x`). Rendering at a size other than the project size would therefore misplace elements, so we scale at encode time instead.
- mediabunny 1.41.0 video encoding config supports:
  - `bitrate` as a number or `Quality`;
  - `bitrateMode: 'constant' | 'variable'`;
  - `hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software'`.

## Settings model

`ExportSettings`:

| Field | Values | Default |
| --- | --- | --- |
| `format` | `mp4` \| `webm` | `mp4` |
| `resolution` | `project` \| `720` \| `1080` \| `1440` \| `2160` (short side, px) | `project` |
| `frameRate` | `project` \| `23.976` \| `24` \| `25` \| `29.97` \| `30` \| `50` \| `59.94` \| `60` | `project` |
| `videoBitrate` | `{ kind: "quality", quality: ExportQuality }` \| `{ kind: "custom", mbps: number }` | quality `high` |
| `bitrateMode` | `variable` \| `constant` | `variable` |
| `includeAudio` | boolean | `true` |
| `audioBitrateKbps` | `128` \| `192` \| `320` | `192` |
| `hardwareEncoding` | boolean | `true` |

- **Fractional rates.** These map to rationals: 23.976 → 24000/1001, 29.97 → 30000/1001 and 59.94 → 60000/1001.
- **Custom Mbps** is clamped to [1, 200].

## Built-in presets

The bitrates follow YouTube's recommended SDR upload settings. Where a preset depends on frame rate, the first value applies at ≤ 30 fps and the second above 30 fps.

| Preset | Resolution | FPS | Video bitrate | Expected aspect |
| --- | --- | --- | --- | --- |
| YouTube 1080p | 1080 | project | 8 / 12 Mbps | any |
| YouTube 1440p | 1440 | project | 16 / 24 Mbps | any |
| YouTube 4K | 2160 | project | 40 / 60 Mbps | any |
| Shorts / TikTok / Reels | 1080 | project | 12 Mbps | 9:16 |
| High quality master | project | project | Quality: very_high | any |
| Small file | 720 | project | Quality: medium | any |

Every built-in preset uses `mp4`, `variable`, audio on at 192 kbps and hardware encoding on.

## Pure logic (`apps/web/src/export/`, unit-tested, no UI or encoder imports)

- `settings.ts`: the `ExportSettings` type, defaults and value lists.
- `presets.ts`: `BUILT_IN_EXPORT_PRESETS`, with stable ids, names, settings, an optional `expectedAspect` and the fps-dependent bitrate rule.
- `resolve.ts`:
  - `resolveExportSize({ projectSize, resolution })`.
    - `project` returns the project size.
    - Otherwise the short side equals the chosen value, the project aspect ratio is kept, and both dimensions are rounded to even numbers.
  - `resolveExportFps({ projectFps, frameRate })` returns a rational `FrameRate`.
  - `resolveVideoBitrate({ settings, presetRule?, fps })` returns either bits per second or a `Quality` level.
  - `getPresetWarnings({ preset, projectSize })`. For example: "Project is 16:9. Shorts / TikTok / Reels expects 9:16. Change the canvas in project settings."
- Applying a preset produces plain `ExportSettings`. Fps-dependent bitrates are resolved at export time, so a preset stays correct when the project's fps changes.

## Encoder (`services/renderer/scene-exporter.ts`)

- **Inputs** gain:
  - `outputWidth` and `outputHeight`;
  - `videoBitrate` (a number or a `Quality` level);
  - `bitrateMode`;
  - `audioBitrate` (bits per second);
  - `hardwareAcceleration`.
- **Rendering** stays at the project size.
  - If the output size equals the project size, the renderer's canvas feeds the encoder directly, as today.
  - Otherwise each frame is drawn onto an output-sized canvas with `imageSmoothingQuality = "high"`, and that canvas feeds `CanvasSource`. The aspect ratio always matches, so the frame is never stretched or cropped.
- **Hardware fallback.** Before the output starts, RCut checks whether the video config is encodable with `prefer-hardware`.
  - If it is not, RCut uses `no-preference`.
  - If neither works, export fails before rendering with an error that names the resolution, fps and codec.
  - The exact API (WebCodecs `VideoEncoder.isConfigSupported` or mediabunny's encodability check) is decided in the plan after checking the mediabunny 1.41 API.
- **Audio** uses `audioBitrateKbps × 1000` instead of the Quality level. The existing AAC support probe uses the same bitrate rather than the hard-coded 192 kbps.

## Persistence (`export/export-settings-store.ts`)

- The store adds `lastSettings: ExportSettings` and `customPresets: Array<{ id, name, settings }>`.
- It bumps the persist `version` and adds a `migrate` step. Older stored data, which holds only `exportFolder`, gets the defaults and an empty preset list.
- The UI starts from `lastSettings`. A successful export updates them.

## UI (`components/editor/export-button.tsx`)

- **Preset dropdown** at the top, in two groups: *Built-in* and *My presets*.
  - After the user edits any field, the dropdown reads `Custom (from <preset>)`.
  - Custom presets can be deleted with a trash icon.
- **Visible fields:** Format, Resolution, Frame rate, and Bitrate (Quality select or Custom Mbps).
- **"Advanced"** section, collapsed by default: VBR/CBR, Include audio with audio bitrate, Hardware encoding.
- **Summary line**, e.g. `3840×2160 · 59.94 fps · 60 Mbps · H.264`. A Quality bitrate shows its level name instead of a number.
- **Warnings** from `getPresetWarnings` appear inline in amber.
- **"Save as preset…"** takes a name. An empty or duplicate name is rejected inline.

## Error handling

- An unsupported encoder config fails before rendering, with a clear toast, and no file is written.
- Every other failure path (save errors, the Downloads fallback, cancellation) is unchanged.

## Testing

- **bun:test:**
  - `resolveExportSize` for 16:9, 9:16 and 4:3 at every tier, including odd-to-even rounding and `project`;
  - fractional fps rationals;
  - the YouTube bitrate split at exactly 30 fps and above;
  - Custom Mbps clamping;
  - preset warnings;
  - the built-in table has unique ids and valid settings;
  - store migration from the old shape.
- **Manual in `rcut.exe`, checked with `ffprobe`:**
  - a 1080p project → YouTube 4K at 60 fps (3840×2160, about 60 Mbps, 60 fps);
  - the same project → Small file (1280×720);
  - a 9:16 project → Shorts (1080×1920);
  - a 16:9 project → Shorts shows the warning;
  - an export with hardware encoding off;
  - saving, re-selecting and deleting a custom preset.
