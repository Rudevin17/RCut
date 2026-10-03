# Agents.md

## Architecture

RCut is a local-only fork of opencut-classic.

- `apps/web/` — Next.js editor, built as a static export (`apps/web/out`). All state lives in the browser storage (IndexedDB/OPFS). No server code: no API routes, server actions or middleware.
- `apps/desktop/` — Tauri v2 shell that serves `apps/web/out` in WebView2 and produces `rcut.exe`.
- `rust/` — the renderer (wgpu compositor, effects, masks) compiled to WebAssembly with `wasm-pack` into `rust/wasm/pkg`, consumed by the web app as the workspace package `opencut-wasm`. Cargo workspace: `rust/Cargo.toml`.

## Web

### React

- Read components before using them. They may already apply classes, which affects what you need to pass and how to override them.
