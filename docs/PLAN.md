# IMG — plan, architecture & roadmap

## Goal

A private, local-first studio for AI images and videos that can switch between providers per task, keep characters consistent, and keep every result safely in Cloudflare R2.

## Tech stack and why

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript end-to-end | One language for UI, API and provider code; shared types catch mismatches. |
| API server | Node 22 + Fastify 5 | Fast, small, good file-upload and streaming support. Long-running process means a built-in job worker (no Redis/queues needed for one user). |
| Database | SQLite + Drizzle ORM | Zero setup, single file (`data/imagination.db`), typed queries, versioned migrations. |
| Storage | Cloudflare R2 (S3 API) with local-disk fallback | Durable, no egress fees, private bucket + signed links. Local mode lets the app work before R2 exists; one click moves files over later. |
| Media | sharp (images), ffmpeg (video) | Thumbnails, format normalization for providers, frame extraction, stitching. |
| UI | React 19 + Vite + Tailwind 4 + TanStack Query + Zustand | Fast dev loop, live updates via Server-Sent Events, persistent Studio state. |

## Architecture

```
Browser (React)
  │  REST + SSE (/api/events)
  ▼
Fastify API ──► SQLite (assets, generations, characters)
  │
  ├─► Job worker ── submit ──► Provider adapter ──► Gemini / xAI / OpenAI / fal.ai / Mock
  │        ▲        poll ◄──────────┘ (async tasks)
  │        └── download result → storage → thumbnail → DB → SSE event
  │
  └─► Storage driver: R2 (signed URLs) | local disk
```

**Key decisions**

- **Capability-driven models.** Each model declares what it supports: input images, start/end frames, reference images, aspect ratios, resolutions, durations, audio, seed. The UI renders only valid controls, and the server validates every request and fits params per model (important in compare mode).
- **One catalog file** (`server/src/providers/catalog.ts`). Provider model IDs change every few months (Veo 3.1 preview shuts down 2026-10-22), so updating models is a one-file edit. The Studio also accepts a *custom model ID* for instant tests.
- **Durable jobs.** Jobs live in SQLite. If IMG restarts while a provider is rendering, polling resumes. Jobs interrupted mid-submit are marked failed (never silently re-sent, which could double-bill).
- **Results are copied immediately.** Provider URLs expire in 1–2 days, so outputs are downloaded into storage the moment they finish.
- **Inputs via signed links.** Providers that fetch images by URL (fal.ai) get short-lived signed R2 links to a normalized JPEG copy. Others get inline base64.
- **Characters = photos + description.** At run time IMG spreads each character's photos across the model's reference slots (round-robin, so every character gets at least one), and appends a character sheet that points at the right images ("Aria (shown in Image 2, Image 3): …").

## Provider support (checked 2026-10-20)

| Provider | Image | Video | Notes |
|---|---|---|---|
| Google Gemini | Nano Banana 2.1, Pro, 2, 2 Lite: generate & edit with up to 14 images | Gemini Omni Flash: text/start/end/reference → video with audio | Uses the Interactions API. Veo 3.1 preview IDs retire 2026-10-22; GA Veo is only on Vertex AI. |
| xAI | Grok Imagine Image 2.0 / Quality: generate, edit with up to 5 images | Grok Imagine Video 1.5 / 1.5 Lite / classic: up to 15 s, 1080p, start/end frame, references | Reports exact cost per request. |
| OpenAI | GPT Image 2.5 Sunburst / Flare, GPT Image 1 Mini: generate, edit (multipart), transparent backgrounds | — (Sora API shut down 2026-09-24) | Exact cost computed from token usage. |
| fal.ai (Wan) | Wan 2.7 Image: generate, edit with up to 4 images; Wan 2.2 Image | Wan 3.0 / Prime: 3–30 s, start/end frame, up to 10 references; Wan 2.6 Flash; Wan 2.2 A14B / Turbo | Queue API; inputs by URL. Alibaba's own DashScope API was removed in favor of fal. |
| Mock | placeholder images | ffmpeg test clips | Offline testing. |

## Roadmap

### Phase 1 — done (this version)

- Studio with image and video modes, compare mode, styles, prompt enhancer, custom model IDs
- Characters with reference photos and AI auto-description
- Gallery with search, filters, favorites, viewer, remix, edit/animate shortcuts
- Video continuation (last frame → next clip) and stitching
- Live queue with cancel/retry and per-job cost
- R2 storage, local → R2 migration, database backup to R2
- Mock provider plus integration tests of all adapters against the documented API response shapes

### Phase 2 — next

1. **Storyboard mode**: plan a multi-shot sequence (shot list + characters), generate each shot, auto-chain the last frame of each into the next, and stitch at the end.
2. **Video edit & extend**: Gemini Omni conversational edits, xAI `/videos/edits` + `/videos/extensions`, Wan 2.7 video edit.
3. **Cost guardrails**: list prices for every model, a "this will cost ~$X" confirmation above a threshold, and a monthly budget.
4. **Image tools**: upscale, background removal, inpainting with a mask brush, outpainting (Wan bbox editing).
5. **Organization**: projects/collections, tags, saved prompt templates, prompt history search.
6. **Audio**: voice-over / dialogue / music (e.g. ElevenLabs), lip-sync, and Wan 3.0 reference audio.

### Phase 3 — more providers & polish

- More providers: fal.ai (one key → Kling, Seedance, Flux, Hailuo…), Replicate, Runway, Luma, BytePlus Seedance/Seedream, Vertex AI Veo (GA).
- **Local GPU provider** via ComfyUI running open-weight Wan models: free generation if this PC has a capable NVIDIA GPU.
- Desktop packaging (system-tray app), optional LAN access protected by a passcode, scheduled automatic R2 backups.

## What's needed from you

1. **Gemini API key**. Video needs billing enabled on the project.
2. **xAI API key** with credits.
3. **fal.ai API key** with balance (Wan video and images).
4. **Cloudflare R2**: Account ID, Access Key ID, Secret Access Key, bucket name (private bucket, token with Object Read & Write).
5. Recommended: set a spending limit or alert in each provider's billing console. Video generation is billed per second.
