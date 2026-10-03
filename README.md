# RCut

A local-only video editor for Windows, forked from [opencut-classic](https://github.com/OpenCut-app/opencut-classic) (MIT).

No accounts, no server. Projects are stored on this machine.

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
