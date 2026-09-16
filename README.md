# ElaltidarAI

Storefront MVP for ElaltidarAI with a Vite React frontend and a small Express API wrapper for LiteLLM.

## Local development

```bash
pnpm install
pnpm api
pnpm dev
```

Frontend runs at `http://localhost:5173`; API runs at `http://localhost:8787`.

## Environment

Copy `.env.example` to `.env.local` locally. On Vercel, set these project environment variables:

```bash
LITELLM_BASE_URL=https://litellm.xtrip.click
LITELLM_MASTER_KEY=your-litellm-master-key
DATABASE_URL=postgres://user:password@host:5432/elaltidar
```

`DATABASE_URL` can come from Vercel Postgres, Neon, Supabase, or another managed Postgres provider. Without `DATABASE_URL`, the API falls back to local SQLite.

## Vercel deploy

Import the GitHub repo into Vercel. The repo includes `vercel.json` with:

- Framework: Vite
- Build command: `pnpm build`
- Output directory: `dist`
- Serverless API: `api/[...path].js`
- Persistent store: Postgres via `DATABASE_URL`

The API bootstraps the required Postgres tables automatically on first request. SQLite remains available for local development and tests only.

## Checks

```bash
pnpm test
pnpm build
```
