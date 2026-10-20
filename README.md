# IMG · Imagination

A personal AI studio that runs on your own machine. Generate and edit **images**, turn images into **videos**, and keep **characters consistent** across everything — switching freely between Google Gemini, xAI Grok Imagine and Alibaba Wan (more providers can be plugged in). Finished files are stored in **Cloudflare R2** (or on local disk until R2 is set up).

## Quick start

Requirements: **Node.js 22.12+** and **ffmpeg** on PATH (both already installed on this PC).

**Easiest:** double-click **`IMG.bat`**. It installs dependencies on first run, builds the UI, starts the server and opens <http://127.0.0.1:8787>.

From a terminal:

```bash
npm install          # first time only
copy .env.example .env   # first time only, then fill in keys
npm start            # build UI + run at http://127.0.0.1:8787
npm run dev          # development: hot reload at http://127.0.0.1:5173
```

No keys yet? The **Mock** provider is on by default, so every screen and flow can be tried for free.

## Configuration (`.env`)

| What | Variables | Where to get it |
|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | [AI Studio → API keys](https://aistudio.google.com/apikey). Video (Gemini Omni Flash) needs a **paid-tier** project. |
| xAI Grok | `XAI_API_KEY` | [console.x.ai](https://console.x.ai) → API Keys (prepaid credits). |
| Wan (Alibaba) | `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL` | Alibaba Cloud **Model Studio** → API Key. The key only works in the region it was created in; the default URL is Singapore. |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (optional `R2_PREFIX`) | Cloudflare dashboard → R2 → create a **private** bucket → *Manage R2 API Tokens* → token with **Object Read & Write** on that bucket. |

Restart IMG after editing `.env`. **Settings → Test connection** checks each key, and **Test storage** checks R2.

The server only listens on `127.0.0.1`, so nothing is reachable from other devices. Keys are only ever sent to their own provider.

## What you can do

- **Studio**
  - **Image mode**: text → image, or add 1–14 input images (depends on the model) to edit or combine them, e.g. "put the person from image 1 into the scene of image 2".
  - **Video mode**: text → video, start frame → video, start and end frames → video, and subject/character reference images → video.
  - **Compare**: send one prompt to up to 4 models side by side.
  - **Enhance**: rewrites a rough idea into a detailed prompt with an LLM.
  - **Style presets**, aspect ratio / resolution / duration / count / seed / sound controls. Each control adapts to what the selected model supports.
  - **Custom model ID** (Advanced): try a provider's brand-new model before it's in the catalog.
  - Paste or drag images straight into the composer. **Ctrl+Enter** generates.
- **Characters**
  - A name, a description and a few reference photos.
  - Select one or more characters in the Studio. IMG attaches their photos as references and adds a character sheet to the prompt, for images and videos alike.
  - **Auto-describe** writes the description from the photos.
- **Gallery**
  - Filter by type, source, provider or favorites, and search prompts.
  - Open any item to download, favorite, remix, edit, animate or add it to a character.
  - **Continue** a video: saves its last frame and opens it as the next clip's start frame.
  - Multi-select clips and **Stitch** them into one video (ffmpeg).
- **Queue**: live status of every job, with cancel, run again, remix, and cost per job (exact for xAI).
- **Settings**
  - Provider and storage checks.
  - **Move local files to R2** once R2 is configured.
  - **Back up database** to R2.

## Project layout

```
shared/   types + helpers used by both sides (model capabilities, params)
server/   Fastify API, SQLite (Drizzle), job worker, provider adapters, storage
  src/providers/catalog.ts   ← the model list: edit here when providers ship new models
  src/providers/*.ts         ← one adapter per provider (gemini, xai, wan, mock)
  src/jobs/worker.ts         ← queue, polling, downloading results, crash recovery
  src/storage/index.ts       ← local disk + Cloudflare R2
web/      React + Vite + Tailwind UI
data/     (git-ignored) imagination.db, local files, thumbnail cache
docs/PLAN.md   architecture, decisions and roadmap
```

### Adding a model

Add an entry to `server/src/providers/catalog.ts` (copy a similar one) and restart. Its capabilities drive the UI automatically.

### Adding a provider

Create `server/src/providers/<name>.ts` implementing `ProviderAdapter` (`submit`, optional `poll`, `test`, `imageLabel`), add its models to the catalog and register it in `registry.ts`. Async APIs return `{ status: 'pending', taskId }` from `submit` and the worker polls until done; outputs can be URLs or raw bytes. The worker handles downloading, storage, thumbnails, retries and live updates.

## Troubleshooting

- **A provider says "not configured"**: the key is missing in `.env`, or IMG wasn't restarted after you added it.
- **Wan rejects input images while using local storage**: Wan downloads inputs from a URL, so configure R2, and IMG will hand it short-lived signed links.
- **Gemini video fails with a billing/permission error**: Gemini Omni Flash requires a paid-tier API project.
- **No video thumbnails**: ffmpeg isn't on PATH. Set `FFMPEG_PATH` / `FFPROBE_PATH` in `.env`.
- Generated files are copied to your storage right away. Provider-hosted URLs expire within 1–2 days, so nothing depends on them.
