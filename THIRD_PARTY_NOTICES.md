# Third-party notices

## gl-transitions

Some RCut transitions are WGSL ports of shaders from
[gl-transitions](https://github.com/gl-transitions/gl-transitions).
Each ported shader keeps its original author and license header in
`rust/crates/transitions/src/shaders/`.

| RCut transition | Original shader | Author | License |
| --- | --- | --- | --- |
| Crossfade | `fade.glsl` | gre | MIT |
| Glitch Displace | `GlitchDisplace.glsl` | Matt DesLauriers | MIT |
| Glitch Memories | `GlitchMemories.glsl` | Gunnar Roth (based on work from natewave) | MIT |
| Datamosh Strip | `StripDatamoshGlitch.glsl` | bread | MIT |
| Parametric Glitch | `parametric_glitch.glsl` | Yoni Maltsman | MIT |
| Doom Melt | `DoomScreenTransition.glsl` | Zeh Fernando | MIT |
| Lost Signal | `old_tv_lost_signal.glsl` | mernking (Godswork) | MIT |
| TV Static | `TVStatic.glsl` | Brandon Anzaldi | MIT |
| Pixelize | `pixelize.glsl` | gre (forked from benraziel) | MIT |
| Block Dissolve | `BlockDissolve.glsl` | nwoeanhinnogaehr | MIT |
| Dip to Black / Dip to White | `fadecolor.glsl` | gre | MIT |
| Zoom In/Out | `zoomInOut.glsl` | OllyOllyOlly | MIT |
| Circle | `circleopen.glsl` | gre | MIT |
| Cross Zoom | `CrossZoom.glsl` | rectalogic (ported by gre) | MIT |
| Dreamy Zoom | `DreamyZoom.glsl` | Zeh Fernando | MIT |
| Linear Blur | `LinearBlur.glsl` | gre | MIT |
| Film Burn | `FilmBurn.glsl` | Anastasia Dunbar | MIT |
| Overexposure | `Overexposure.glsl` | Ben Zhang | MIT |
| Swirl | `Swirl.glsl` | Sergey Kosarevsky (ported by gre) | MIT |
| Cube | `cube.glsl` | gre | MIT |
| Crosswarp | `crosswarp.glsl` | Eke Péter | MIT |
| Page Curl | `InvertedPageCurl.glsl` | Hewlett-Packard (adapted by Sergey Kosarevsky) | BSD 3-Clause (below) |

The gl-transitions repository is distributed under the MIT License:

```
MIT License

Copyright (c) 2017-present gl-transitions contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Note: Individual transitions in the transitions/ directory may have their own
license specified in their file header comments. When no license is specified,
the transition is covered by this MIT license.
```

## Page Curl (BSD 3-Clause)

Page Curl is a WGSL port of `InvertedPageCurl.glsl`, distributed under this license:

```
Copyright (c) 2010 Hewlett-Packard Development Company, L.P. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
     copyright notice, this list of conditions and the following disclaimer
     in the documentation and/or other materials provided with the
     distribution.
   * Neither the name of Hewlett-Packard nor the names of its
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
