# RCut pro features: roadmap

**Date:** 2026-10-04
**Status:** Order approved by the user.

RCut is getting the features working editors expect. The work is split into independent sub-projects, each run as its own spec → plan → implementation → user-review cycle. Build them in this order:

| # | Sub-project | Depends on | Why this position |
|---|---|---|---|
| 1 | Export presets: resolution, fps, bitrate, presets | none | Smallest, and used on every video |
| 2 | Color correction + LUTs | none | Creates the GPU clip-effect foundation that #6 needs |
| 3 | Audio: fade handles, crossfades on cuts, loudness normalize | none | Removes hard audio pops |
| 4 | Pro editing tools: J/K/L, I/O, roll/slip/slide, trim-to-playhead, markers, transition edge-drag | none | Makes every edit faster |
| 5 | Speed ramps (keyframed speed) | existing retime + keyframes | Core technique for gaming montages |
| 6 | Clip effects + adjustment layers: shake, glow, RGB split, motion blur | #2 | Reuses the effect foundation |
| 7 | Proxy media | ffmpeg bundled with RCut (licence decision) | Biggest infrastructure piece |
| 8 | Animated caption styles | existing transcription | |
| 9 | Presets and templates | everything above | Saves settings from the other sub-projects |

Export presets (#1) also include user-saved export presets, with the user's agreement. #9 generalizes saving to the other features.
