# RCut v1 — Design

**Date:** 2026-10-03
**Status:** Approved (pending spec review)

## Goal

RCut is a personal, local-only fork of [opencut-classic](https://github.com/OpenCut-app/opencut-classic) (MIT, archived 2026-05-17), shipped as a standalone Windows `.exe`. No accounts, servers, databases, or Docker. Features from the newer [OpenCut rewrite](https://github.com/OpenCut-app/OpenCut) may be ported later, case by case.

## Non-goals (v1)

- Sound library (Freesound) — removed; users import their own audio.
- Any cloud/online account features, analytics, marketing site.
- macOS/Linux builds.
- Porting features from the OpenCut rewrite.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Base | Fork opencut-classic | Stable, frozen, working Next.js editor |
| Desktop shell | Tauri v2 | Small binary, uses built-in WebView2, Rust aligns with OpenCut's direction |
| Frontend delivery | Next.js static export (`output: "export"`) | Tauri serves static files; editor has no server dependency |
| Sounds | Removed | Requires server-side Freesound API key |

## Findings from the classic codebase (verified 2026-10-03)

- Projects and media are stored client-side (`apps/web/src/services/storage/` — IndexedDB + OPFS adapters).
- WASM core comes prebuilt from npm (`opencut-wasm@^0.2.10`); no Rust/WASM build required.
- Auth/DB/Redis are used only by `app/api/*` routes and `feedback/`; the editor does not import them (except `FeedbackPopover` in `components/editor/editor-header.tsx`).
- No middleware and no server actions.
- Only dynamic route needed by the editor: `app/editor/[project_id]` — incompatible with static export for runtime IDs.
- Internet-dependent features kept: Whisper transcription (downloads model from Hugging Face on first use, then cached), Google Fonts picker (`fonts.googleapis.com`), Brandfetch logos in platform guides.
- Branding: 244 occurrences of "opencut" across 77 files, plus logos in `apps/web/public/logos/opencut/`.

## Design

### 1. Repository

- `D:\OpenCut` is a full-history clone of opencut-classic, working branch `rcut-v1`.
- Remotes: `upstream` → opencut-classic, `opencut` → OpenCut rewrite (for future porting).
- Keep `LICENSE` with the original copyright notice (MIT requirement); add an RCut copyright line.
- Remove `apps/desktop/` (unfinished GPUI app), `rust/`, root `Cargo.toml` and `Cargo.lock`. A root Cargo workspace would conflict with the Tauri crate. History preserves them.

### 2. Strip `apps/web` to editor-only

Delete:

- `src/auth/`, `src/db/`, `src/feedback/`, and the `FeedbackPopover` usage in the editor header.
- `src/app/api/` (auth, feedback, health, sounds/search).
- Pages: `blog`, `changelog`, `roadmap`, `sponsors`, `brand`, `contributors`, `privacy`, `terms`, `rss.xml`, `sitemap.ts`, `robots.ts`, and the landing page content of `app/page.tsx`.
- `src/sounds/` and the Sounds tab in the assets panel.
- Anything left orphaned by the above (e.g. blog/changelog content, `content-collections.ts`, `ChangelogNotification` if it depends on removed content).
- Config/infra: `drizzle.config.ts`, `migrations/`, `open-next.config.ts`, `wrangler.jsonc` (web and root), `Dockerfile`, `docker-compose.yml`, `.env.example`, env vars referring to removed services.
- Dependencies: `better-auth`, `drizzle-orm`, `drizzle-kit`, `pg`, `postgres`, `@types/pg`, `@upstash/*`, `botid`, `@content-collections/*`, `@opennextjs/cloudflare`, `wrangler`, `feed`, and any others left unused.

Resulting routes:

- `/` — client-side redirect to `/projects` (projects list, unchanged).
- `/editor/?id=<projectId>` — editor; reads the ID via `useSearchParams` (inside `Suspense`) instead of `useParams`. All navigation to the editor goes through a `getEditorUrl({ projectId })` helper.
- `trailingSlash: true` so routes export as `<route>/index.html`.

### 3. Static export

`apps/web/next.config.ts`:

- `output: "export"` (replaces `"standalone"`), `images: { unoptimized: true }`.
- Remove `withBotId` and `withContentCollections` wrappers and unused `remotePatterns`.
- Build output: `apps/web/out/`.

### 4. Tauri shell — `apps/desktop/`

- Tauri v2 project at `apps/desktop/src-tauri/`.
- `devUrl: http://localhost:3000`, `beforeDevCommand: bun run dev:web` (from repo root).
- `frontendDist: ../../web/out`, `beforeBuildCommand: bun run build:web`.
- `productName: RCut`, `identifier: com.rcut.app`. **The identifier must never change** — WebView2 storage (projects/media) is keyed to it.
- Window: 1600×900 default, resizable, min size suitable for the editor layout.
- Outputs: portable `rcut.exe` (frontend assets embedded) and an NSIS installer. Both require the WebView2 runtime (bundled with Windows 11).
- Root scripts: `dev:desktop`, `build:desktop`.

### 5. Rebrand

- Replace "OpenCut" with "RCut" across app name, `<title>`/metadata, UI copy, README, `AGENTS.md`, package names (`opencut` → `rcut`, `@opencut/*` → `@rcut/*`).
- Replace logos with simple text-based RCut SVGs and generate the Tauri icon set from them (`tauri icon`).
- Keep the `opencut-wasm` dependency name (third-party published package).
- Upstream links (GitHub, Discord, opencut.app) are removed rather than renamed.

### 6. Risks to verify during implementation

| Risk | Check | Fallback |
| --- | --- | --- |
| WebGPU unavailable in WebView2 | Look for the "degraded renderer" banner in the Tauri window | Accept degraded path, or enable WebView2 flags via `additionalBrowserArgs` |
| Exported video doesn't save | Export an MP4 in the Tauri app | Add `tauri-plugin-dialog` + `tauri-plugin-fs` for a native save |
| Storage not persisted | Create project, restart app, confirm it's still listed | Investigate WebView2 data dir / `navigator.storage.persist()` |
| Static export build errors from leftover server-only code | `bun run build:web` | Remove/replace the offending code |

### 7. Definition of done

1. `bun test` passes.
2. `bun run build:web` produces `apps/web/out/`.
3. `bun run build:desktop` produces `rcut.exe` (and installer).
4. Manual smoke test in the `.exe`: create project → import video → cut clip → add text → export MP4 → close → reopen → project still present.
5. No remaining "OpenCut" branding in the UI.
