# Streaming export audio: design

**Date:** 2026-10-04
**Status:** Approved by the user ("Looks right, build it").

## Problem (root cause confirmed)

Before rendering any frame, every export calls `createTimelineAudioBuffer` (`apps/web/src/media/audio.ts`). That function:
- decodes the **entire** audio track of every source file (`sink.buffers(0)`), however little of the file the timeline uses;
- resamples each whole file through an `OfflineAudioContext`;
- mixes the result into a single output buffer as long as the timeline.

On the user's project (two 58-minute, 20 GB recordings on a 2-hour, 120 fps timeline):
- the WebView process peaked at **7.5 GB**;
- the export sat at **5%** with the main thread busy;
- Cancel could not interrupt it, because the audio stage is unguarded.

On the 4-second test project, each export still decoded about 108 minutes of audio. The 3rd or 4th export in a session then froze in the video encoder (`encodeQueueSize` stuck at 4).

**Evidence:** with audio off, 8 back-to-back exports all succeeded, taking 2–4 s each instead of 30–60 s.

## Goal

Export audio uses bounded memory for any timeline length and is cancellable throughout. Progress reflects real work. The audio output is the same as today, except for two documented changes (see Behaviour changes).

## Design

- **The audio is mixed in windows of about 10 seconds** (`CHUNK_SECONDS = 10`) while the video frames are encoded. The exporter keeps audio one window ahead of the video.
- **Each window decodes only what it needs.** For every clip that overlaps the window, the window decodes only the source range that clip needs, via `AudioBufferSink.buffers(start, end)`. Each source file has one reader, kept open for the whole export.
- **The mix maths is unchanged:**
  - clips are placed with floor/ceil sample positions;
  - source time = `trimStart + clipTime × rate`;
  - samples are linearly interpolated at the source sample rate;
  - gain is constant, or keyframed per sample;
  - mono sources are duplicated to both channels, and sources with more than two channels use their first two.
- **Clips that change speed while keeping pitch** (`shouldMaintainPitch`) are pre-rendered once per clip through `renderRetimedBuffer`. Only the clip's used source range is decoded, never the whole file. Their memory grows with clip length; these clips are rare.
- **Mastering** uses the same −1 dB limiter chain, applied per window.
  - Each window is rendered with the previous 0.25 s of pre-master audio as pre-roll, which is then discarded, so the limiter has no reset at window joins.
  - The 0.98 peak clamp follows.
- **Transcription** (`extractTimelineAudio` → `createTimelineAudioBuffer`) uses the same stream and concatenates its windows. It no longer decodes whole files.

## Units

| Unit | Kind | Responsibility |
| --- | --- | --- |
| `media/audio-export/plan.ts` | pure, tested | `AudioMixClip` type; clip sample range; the source range a clip needs for a window; chunk windows |
| `media/audio-export/mixer.ts` | pure, tested | Mixes one clip's PCM block into a window's two output channels |
| `media/audio-export/source-reader.ts` | browser | Opens a file once (mediabunny), reads a source time range as a PCM block |
| `media/audio-export/timeline-audio-stream.ts` | browser | Builds clips from the timeline; `nextChunk()` returns mixed and mastered `AudioBuffer`s; `reset()`; `dispose()` |
| `services/renderer/scene-exporter.ts` | browser | Feeds chunks to the `AudioBufferSource` ahead of the video, under the existing stall and cancel guard |
| `core/managers/renderer-manager.ts` | browser | Creates the stream instead of the full buffer; no 5% audio stage |

## Behaviour changes (accepted)

- **The limiter chain now always runs.** Its 0.98 output gain (−0.18 dB) applies to every export. Before, it ran only when the mix peaked above 0.98.
- **Speed-changed clips that keep pitch** decode only their used range.

## Testing

- **bun:test** for `plan.ts` and `mixer.ts`:
  - clip placement;
  - window intersection;
  - rate 2;
  - constant and keyframed gain;
  - mono-to-stereo;
  - the source ending early;
  - mixing a clip across two windows equals mixing it in one window (continuity).
- **Manual, in `rcut.exe`:**
  - export the user's 2-hour project: WebView memory stays bounded, there is no 5% hang, and progress advances from the start;
  - 8 back-to-back exports of the test project with audio on: none stall;
  - `ffprobe` shows an AAC track with the right duration, and its RMS is not silent;
  - Cancel works during the export.
