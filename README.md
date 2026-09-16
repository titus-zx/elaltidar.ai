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
```

## Vercel deploy

Import the GitHub repo into Vercel. The repo includes `vercel.json` with:

- Framework: Vite
- Build command: `pnpm build`
- Output directory: `dist`
- Serverless API: `api/[...path].js`

SQLite on Vercel uses `/tmp/elaltidar.sqlite`, which is suitable only for MVP/demo runtime state because serverless storage is ephemeral. Use Postgres before production payments or permanent customer history.

## Checks

```bash
pnpm test
pnpm build
```
