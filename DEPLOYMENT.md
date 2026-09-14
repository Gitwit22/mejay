# MEJay deployment

MEJay is split into two deployable services:

- The repository root is the React/Vite frontend deployed to Cloudflare Pages.
- `api/` is the Express API deployed to Render as `mejay-api`.
- Neon PostgreSQL stores accounts, sessions, and entitlements.
- Cloudflare R2 stores the Full Program download.

## Cloudflare Pages

Configure the Pages project with:

- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_API_URL=https://api-staging.mejayapp.com`
- Optional same-origin proxy flag: `VITE_USE_SAME_ORIGIN_API=1` only when the Pages project is explicitly serving `/api/*`

`public/_routes.json` and `public/_redirects` together control Pages routing. Keep non-static app paths such as `/app/provider` flowing through the SPA fallback, and only enable `VITE_USE_SAME_ORIGIN_API=1` when the deployed Pages origin really serves `/api/*` through a proxy or Pages Function.

## Render

Create the service from `render.yaml`, or use these settings:

- Name: `mejay-api`
- Root directory: `api`
- Build command: `npm install && npm run build`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Health check: `/api/health`

Set `DATABASE_URL` to the Neon pooled PostgreSQL connection string. Configure the remaining secrets listed in `api/.env.example` in Render.

For cookie authentication, `FRONTEND_URL` must exactly match the Pages origin. Multiple allowed origins can be comma-separated.

## Local development

Start the API and frontend in separate terminals:

```powershell
Set-Location api
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

```powershell
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:4000` by default. Override it with `VITE_API_PROXY_TARGET` when needed.