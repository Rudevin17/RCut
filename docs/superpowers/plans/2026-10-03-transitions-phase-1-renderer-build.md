# Transitions Phase 1 — Renderer Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RCut builds its own `opencut-wasm` renderer from Rust source, in place of the prebuilt npm package, so later phases can add transition shaders. Behaviour stays identical.

**Architecture:**
- Restore `rust/` from commit `cf5e79e9`. That is the exact source of the `opencut-wasm` 0.2.10 package used today.
- Put the Cargo workspace in `rust/Cargo.toml`, not at the repo root, so it can never clash with `apps/desktop/src-tauri`.
- Build it with `wasm-pack --target bundler` into `rust/wasm/pkg`.
- Consume `rust/wasm/pkg` as a Bun workspace package named `opencut-wasm`.

**Tech Stack:** Rust 1.97 (`wasm32-unknown-unknown`), wasm-pack, wasm-bindgen 0.2.116 (pinned by the restored crate), wgpu, Bun workspaces, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-10-03-transitions-design.md` (section "1. Renderer build")

## Global Constraints

- Work on branch `rcut-v1` in `D:\OpenCut`. Git identity is configured.
- Every commit message ends with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Restore the renderer source exactly from commit `cf5e79e9`. Do not change crate versions or code in this phase.
- The npm package name stays `opencut-wasm`, and the import paths in `apps/web` stay unchanged.
- No Cargo workspace at the repo root. The workspace manifest is `rust/Cargo.toml`.
- `rust/wasm/pkg/` is build output and is git-ignored.
- Do NOT use `sed -i` on existing files (it strips CRLF in Git Bash), and do NOT write files containing backslashes through shell heredocs (this shell collapses `\\`). Use a file-edit tool.
- Current baseline:
  - `bun test` from the repo root: 208 pass, 4 fail. The 4 failures are pre-existing: test files that can't import the `.wasm` ESM under bun test.
  - `bunx tsc --noEmit` in `apps/web`: 0 errors.

---

## Task 1: Install the WebAssembly toolchain

**Files:** none (machine setup).

- [ ] **Step 1: Add the wasm target**

Run: `rustup target add wasm32-unknown-unknown`
Expected: `installed` or `is up to date`.

- [ ] **Step 2: Install wasm-pack**

Run: `cargo install wasm-pack --locked` (several minutes)
Expected: completes; `wasm-pack --version` prints a version.

- [ ] **Step 3: Verify**

Run: `rustup target list --installed && wasm-pack --version`
Expected: the list contains `wasm32-unknown-unknown`, and a wasm-pack version is printed.

No commit.

---

## Task 2: Restore the renderer source with a self-contained workspace

**Files:**
- Restore: `rust/` (entire directory) from `cf5e79e9`
- Create: `rust/Cargo.toml` (workspace manifest)
- Create: `rust/Cargo.lock` (from the old root lock file, then pruned by cargo)
- Modify: `.gitignore`

**Interfaces:**
- Produces: the Cargo workspace at `rust/Cargo.toml`, with the crate `opencut-wasm` at `rust/wasm`.

- [ ] **Step 1: Restore files from history**

```bash
cd /d/OpenCut && git checkout cf5e79e9 -- rust && git show cf5e79e9:Cargo.lock > rust/Cargo.lock
```
Expected: `rust/crates/{bridge,compositor,effects,gpu,masks,time}` and `rust/wasm` exist.

- [ ] **Step 2: Create `rust/Cargo.toml`**

The old root workspace also listed `apps/desktop` (the removed GPUI app). This workspace lists only the renderer crates:
```toml
[workspace]
resolver = "2"
members = [
    "crates/bridge",
    "crates/compositor",
    "crates/effects",
    "crates/gpu",
    "crates/masks",
    "crates/time",
    "wasm",
]
```

- [ ] **Step 3: Ignore build output**

Append to `.gitignore`:
```
# wasm-pack output
rust/wasm/pkg/
```
(`target/` is already ignored.)

- [ ] **Step 4: Check it compiles for wasm**

Run: `cd /d/OpenCut/rust && cargo check --target wasm32-unknown-unknown -p opencut-wasm 2>&1 | tail -5`
Expected: `Finished`. Cargo may prune the GPUI-only packages from `rust/Cargo.lock`; that is expected.

If cargo reports a resolver or edition warning about the workspace, consider `resolver = "3"`. Change it only if the build fails, and record it in the report.

- [ ] **Step 5: Confirm the Tauri crate is unaffected**

Run: `cd /d/OpenCut/apps/desktop/src-tauri && cargo check 2>&1 | tail -3`
Expected: `Finished`, with no "current package believes it's in a workspace" error.

- [ ] **Step 6: Commit**

```bash
cd /d/OpenCut && git add rust .gitignore && git commit -q -F - <<'EOF'
build: restore renderer source as a self-contained Cargo workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Build the wasm package and check API parity

**Files:** none committed (`rust/wasm/pkg` is ignored).

**Interfaces:**
- Produces: `rust/wasm/pkg/` containing `package.json` (name `opencut-wasm`, version `0.2.10`), `opencut_wasm.js`, `opencut_wasm_bg.js`, `opencut_wasm_bg.wasm`, and `opencut_wasm.d.ts`.

- [ ] **Step 1: Build**

Run: `cd /d/OpenCut && wasm-pack build rust/wasm --target bundler --out-dir pkg 2>&1 | tail -5`
Expected: `Your wasm pkg is ready to publish at …rust/wasm/pkg`.

- [ ] **Step 2: Compare against the npm package**

Run:
```bash
cd /d/OpenCut && cat rust/wasm/pkg/package.json | grep -E '"(name|version)"'
diff <(grep -oE "export (function|class|const|type|interface|enum) [A-Za-z0-9_]+" node_modules/opencut-wasm/opencut_wasm.d.ts | sort) <(grep -oE "export (function|class|const|type|interface|enum) [A-Za-z0-9_]+" rust/wasm/pkg/opencut_wasm.d.ts | sort) && echo "EXPORTS IDENTICAL"
diff node_modules/opencut-wasm/opencut_wasm.d.ts rust/wasm/pkg/opencut_wasm.d.ts > /dev/null && echo "D.TS IDENTICAL" || echo "D.TS DIFFERS (inspect)"
ls -la node_modules/opencut-wasm/opencut_wasm_bg.wasm rust/wasm/pkg/opencut_wasm_bg.wasm
```
Expected: name `opencut-wasm` and version `0.2.10`, then `EXPORTS IDENTICAL`. Ideally `D.TS IDENTICAL`; formatting-only differences are acceptable. The `.wasm` sizes should be similar.

If the exported names differ, STOP and report the difference. The npm package may not have been built from `cf5e79e9`, and a human decides how to proceed.

No commit.

---

## Task 4: Use the local renderer build in the app

**Files:**
- Modify: `package.json` (workspaces, dependency, scripts)
- Modify: `apps/web/package.json` (dependency)
- Modify: `bun.lock` (via `bun install`)
- Modify: `AGENTS.md`, `README.md`

**Interfaces:**
- Consumes: `rust/wasm/pkg` from Task 3. It must exist before `bun install`.
- Produces:
  - root script `build:wasm`;
  - `build:web` rebuilds the wasm first;
  - `opencut-wasm` resolves to `rust/wasm/pkg`.

- [ ] **Step 1: Root `package.json`**

Change `"workspaces": ["apps/*"]` to:
```json
	"workspaces": ["apps/*", "rust/wasm/pkg"],
```
In `"dependencies"`, change `"opencut-wasm": "^0.2.10"` to:
```json
		"opencut-wasm": "workspace:*"
```
In `"scripts"`, add:
```json
		"build:wasm": "wasm-pack build rust/wasm --target bundler --out-dir pkg",
```
and change the `build:web` script to:
```json
		"build:web": "bun run build:wasm && turbo run build --filter=@rcut/web",
```

- [ ] **Step 2: `apps/web/package.json`**

Change `"opencut-wasm": "^0.2.10",` to:
```json
    "opencut-wasm": "workspace:*",
```

- [ ] **Step 3: Install and verify resolution**

Run: `cd /d/OpenCut && bun install 2>&1 | tail -3 && ls -la node_modules/opencut-wasm apps/web/node_modules/opencut-wasm`
Expected: both symlinks point into `rust/wasm/pkg`, not `.bun/opencut-wasm@0.2.10`.

- [ ] **Step 4: Verify tests, types, and builds**

Run: `cd /d/OpenCut && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: 208 pass, 4 fail (unchanged).

Run: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

Run: `cd /d/OpenCut && bun run build:web 2>&1 | tail -4`
Expected: the wasm build finishes, then the Next build succeeds.

- [ ] **Step 5: Update docs**

In `AGENTS.md`, replace:
```
- Core media logic comes from the prebuilt npm package `opencut-wasm`.
```
with:
```
- `rust/` — the renderer (wgpu compositor, effects, masks) compiled to WebAssembly with `wasm-pack` into `rust/wasm/pkg`, consumed by the web app as the workspace package `opencut-wasm`. Cargo workspace: `rust/Cargo.toml`.
```

In `README.md`, under `## Requirements`, add after the Rust line:
```
- `rustup target add wasm32-unknown-unknown` and `cargo install wasm-pack` (builds the renderer)
```
and under `## Develop`, change the first line of the code block from `bun install` to:
```
bun run build:wasm    # build the renderer (needed before the first bun install)
bun install
```

- [ ] **Step 6: Commit**

```bash
cd /d/OpenCut && git add package.json apps/web/package.json bun.lock AGENTS.md README.md && git commit -q -F - <<'EOF'
build: use locally built opencut-wasm renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Runtime parity check in the desktop app

**Files:** none unless a check fails.

- [ ] **Step 1: Release build**

Run: `cd /d/OpenCut && bun run build:desktop` (in background; several minutes).
Expected: success.

- [ ] **Step 2: Automated preview check (controller)**

Use the CDP profiling approach from the playback fix:
1. Build a debug exe with `--remote-debugging-port=9222` through `tauri build --debug --no-bundle --config <override>`.
2. Open the user's project and play for 10 s.

Expected: about 120 GPU submits per second, no stalls over 50 ms, and no console errors. The blur background (gaussian-blur effect pass) must render, which exercises the effects pipeline.

- [ ] **Step 3: User check**

In the new `rcut.exe`, the user plays the project and exports a short MP4.
Expected: the result looks the same as before (blur background, GIF overlay, text), and the export plays.
