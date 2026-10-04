# RCut

A local-only video editor for Windows, forked from [opencut-classic](https://github.com/OpenCut-app/opencut-classic) (MIT). It runs as a standalone `.exe`. There are no accounts, no server and no uploads, so your projects and media stay on your machine.

- **Linked media.** RCut references your videos where they sit on disk instead of copying them into browser storage, so large files work. If a file moves, use "Locate file" to relink it.
- **31 GPU transitions** in three groups:
  - **Basic**
  - **Cinematic:** Cross Zoom, Film Burn, Page Curl, Cube and more
  - **Gaming:** glitch, datamosh, TV static, zoom punch, shake hit and more

  Most are ported from [gl-transitions](https://github.com/gl-transitions/gl-transitions). The rest are RCut originals.
- **Export where you want.** Export to a remembered folder or use "Export as…", then jump to the result with "Show in folder".
- **Built with** Tauri v2 (WebView2), Next.js, and a Rust/wgpu renderer compiled to WebAssembly.

Third-party credits are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Requirements

- [Bun](https://bun.sh) 1.3+
- [Rust](https://rustup.rs) (stable, MSVC toolchain) + Visual Studio Build Tools ("Desktop development with C++")
- `rustup target add wasm32-unknown-unknown` and `cargo install wasm-pack` (builds the renderer)
- WebView2 runtime (included with Windows 11)

## Develop

```bash
bun run build:wasm    # build the renderer (needed before the first bun install)
bun install
bun run dev:web       # editor in the browser at http://localhost:3000
bun run dev:desktop   # editor in the RCut window
bun test
```

## Build

```bash
bun run build:desktop
```

Outputs:
- `apps/desktop/src-tauri/target/release/rcut.exe` — portable executable
- `apps/desktop/src-tauri/target/release/bundle/nsis/` — installer

## Upstream

- `upstream` remote: opencut-classic (archived)
- `opencut` remote: the OpenCut rewrite — source for porting new features
