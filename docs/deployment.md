# Deploying to Cloudflare

Synthora deploys as a single Worker that serves the web app and the API, with one D1 database. The free Workers plan is enough to start.

Commands run from the repository root unless noted. On Windows use PowerShell; `npx` works the same.

## 1. Sign in

```sh
npx wrangler login --cwd apps/worker
```

This opens a browser to authorise Wrangler with your Cloudflare account.

## 2. Create the database

```sh
cd apps/worker
npx wrangler d1 create synthora
```

Copy the `database_id` it prints into `apps/worker/wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.

## 3. Rate limit namespaces

`wrangler.jsonc` declares two limiters with `namespace_id` `1001` and `1002`. These must be unique within your account. If you already use those numbers for other Workers, change them.

## 4. Optional: bot protection (Turnstile)

1. In the Cloudflare dashboard, open **Turnstile → Add widget**. Add your domain (and `*.workers.dev` if you will use that URL), and choose **Invisible**.
2. Put the **site key** in `wrangler.jsonc` under `vars.TURNSTILE_SITE_KEY`. It is public.
3. Store the **secret key** as a secret:

   ```sh
   npx wrangler secret put TURNSTILE_SECRET --cwd apps/worker
   ```

Turnstile turns on only when both are set. Without them, only the rate limits protect the API.

## 5. Optional: operator settings

```sh
npx wrangler secret put NCBI_API_KEY --cwd apps/worker       # 10 instead of 3 PubMed requests/second
npx wrangler secret put CROSSREF_MAILTO --cwd apps/worker    # your email; faster Crossref responses
```

Also set `vars.NCBI_EMAIL` in `wrangler.jsonc` to your contact address. NCBI asks clients to identify themselves this way.

**Never** configure user LLM keys here. Users bring their own, per request.

## 6. Deploy

```sh
npm run deploy
```

This typechecks, runs the tests, builds the web app, applies database migrations to the remote D1 database, and deploys the Worker. Wrangler prints the URL (`https://synthora.<your-subdomain>.workers.dev`).

## 7. Check it

```sh
curl https://synthora.<your-subdomain>.workers.dev/api/health    # {"status":"ok"}
```

Then open the URL, connect a provider and run a question with 1–2 papers.

## 8. Optional: custom domain

In the dashboard: **Workers & Pages → synthora → Settings → Domains & Routes → Add → Custom domain**. If you use Turnstile, add the domain to the Turnstile widget too.

## Updating

Run `npm run deploy` again. New files in `database/migrations/` are applied automatically before the Worker is replaced.

## What is stored

| Where | What |
|---|---|
| D1 `research_sessions` | Completed research results; owner = SHA-256 of an anonymous cookie |
| Worker secrets | Your Turnstile secret, NCBI key, Crossref contact (if set) |
| Never stored | Users' LLM API keys |

Observability logs (enabled in `wrangler.jsonc`) record only error types, never request bodies or headers.
