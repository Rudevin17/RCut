# Agents.md

## Architecture

RCut is a local-only fork of opencut-classic.

- `apps/web/` — Next.js editor, built as a static export (`apps/web/out`). All state lives in the browser storage (IndexedDB/OPFS). No server code: no API routes, server actions or middleware.
- `apps/desktop/` — Tauri v2 shell that serves `apps/web/out` in WebView2 and produces `rcut.exe`.
- Core media logic comes from the prebuilt npm package `opencut-wasm`.

## Web

### React

- Read components before using them. They may already apply classes, which affects what you need to pass and how to override them.
