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
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_BOT_USERNAME=your_bot_username
ADMIN_TOKEN=long-random-admin-token
```

`DATABASE_URL` can come from Vercel Postgres, Neon, Supabase, or another managed Postgres provider. Without `DATABASE_URL`, the API falls back to local SQLite.
Email dev login is disabled on Vercel unless `ALLOW_DEV_LOGIN=true` is explicitly set. Production customer login should use Telegram Login.

## Vercel deploy

Import the GitHub repo into Vercel. The repo includes `vercel.json` with:

- Framework: Vite
- Build command: `pnpm build`
- Output directory: `dist`
- Serverless API: `api/[...path].js`
- Persistent store: Postgres via `DATABASE_URL`
- Customer auth: Telegram Login via `TELEGRAM_BOT_TOKEN`
- Admin approval: protected by `ADMIN_TOKEN`

The API bootstraps the required Postgres tables automatically on first request. SQLite remains available for local development and tests only.

## Admin approval

Customer-created orders stay `pending`. Approve them from an admin tool by calling:

Open the admin UI at `/admin`, enter `ADMIN_TOKEN`, then load and approve pending orders.

```bash
curl -X POST https://your-domain.vercel.app/api/admin/orders/ORDER_ID/approve \
	-H "x-admin-token: $ADMIN_TOKEN"
```

List pending orders:

```bash
curl https://your-domain.vercel.app/api/admin/orders?status=pending \
	-H "x-admin-token: $ADMIN_TOKEN"
```

Paid orders create model entitlements with an expiry based on the package duration. Customer API keys can call:

```bash
curl https://your-domain.vercel.app/v1/models \
	-H "Authorization: Bearer $ELALTIDAR_API_KEY"
```

The response only includes models from active, non-expired paid orders for that customer.

Each customer has one LiteLLM virtual key. When a customer already has a key, new approved model orders update that existing LiteLLM key through `/key/update` instead of creating another key. The key's `models` allowlist is recomputed from active, non-expired paid orders.

## Checks

```bash
pnpm test
pnpm build
```
