# DigitalOcean App Platform deployment checklist

WhoAped runs as two App Platform components from the same GitHub repository:

- `api`: the public Hono HTTP service on port `8787`;
- `parsed-stream-worker`: exactly one persistent Helius Parsed Streams worker, with an internal liveness endpoint on port `8080`.

The reference App Platform spec is `.do/app.yaml`. It configures both components, health checks, alerts, autodeploy from `main`, and the primary domain `api.whoaped.com`. It deliberately does not contain real secrets or the MongoDB cluster name.

## 1. Create the app from GitHub

- [ ] In DigitalOcean, choose **Create → App Platform**.
- [ ] Select GitHub repository `heymike777/whoaped`, branch `main`, and enable Autodeploy.
- [ ] Use `apps/api` as the source directory.
- [ ] Use `apps/api/Dockerfile` as the Dockerfile path.
- [ ] Create the first resource as a Web Service named `api`.
- [ ] Set its public HTTP port to `8787`, run command to `npm start`, and route to `/`.
- [ ] Add a Worker resource from the same repo and source directory, named `parsed-stream-worker`.
- [ ] Set the worker run command to `npm run start:stream` and keep its instance count at exactly `1`.

Alternatively, create/update the app from `.do/app.yaml` using the App Spec editor or `doctl`. Before submitting the spec, replace every `SET_IN_DIGITALOCEAN` secret in the DigitalOcean UI.

## 2. Attach the existing Managed MongoDB

- [ ] In the app, choose **Add Components → Create or attach database**.
- [ ] Choose **Attach existing DigitalOcean database** and select the Managed MongoDB cluster.
- [ ] Enable **Add app as a trusted source**.
- [ ] Keep the app and database in the same VPC/region when possible.
- [ ] At app level, set encrypted runtime variable `MONGODB_URI` to the database bindable private URL shown by DigitalOcean, normally `${<database-component>.DATABASE_PRIVATE_URL}`. If private networking is unavailable, use `${<database-component>.DATABASE_URL}`.
- [ ] Set `MONGODB_DATABASE=whoaped`.

Do not expose MongoDB publicly for the app. The backend creates all collections and required unique, query, lease, session-expiry, and seven-day ingestion TTL indexes on its first successful connection.

## 3. Add app-level environment variables

Set these as **Encrypted** and **Run Time**:

- [ ] `MONGODB_URI` — the MongoDB bindable URL described above.
- [ ] `HELIUS_API_KEY` — the paid Helius project API key.
- [ ] `JUPITER_API_KEY` — optional but recommended for production Telegram `/portfolio` requests. Without it, the bot uses Jupiter's keyless API at its lower rate limit; store a server key as a runtime secret in DigitalOcean when available.
- [ ] `FIREBASE_SERVICE_ACCOUNT_BASE64` — Base64 encoding of the complete Firebase Admin service-account JSON.
- [ ] `INTERNAL_JOB_SECRET` — a new unrelated long random secret.
- [ ] `DEX_LINK_CONFIG_BASE64` — optional Base64-encoded DEX link/referral configuration described below.
- [ ] `TOKEN_ACTION_CONFIG_BASE64` — optional Base64-encoded token destination configuration; defaults to the Gated BONKbot, GMGN, FOMO, and DexScreener links.

Set these as normal **Run Time** variables:

```text
NODE_ENV=production
MONGODB_DATABASE=whoaped
HELIUS_PARSED_STREAM_URL=wss://fs-beta.helius-rpc.com
HELIUS_WALLET_REFRESH_MS=5000
HELIUS_STREAM_PING_MS=240000
HELIUS_BACKFILL_CONCURRENCY=4
HELIUS_BACKFILL_MAX_PAGES=20
FIREBASE_PROJECT_ID=whoaped
CORS_ORIGIN=*
```

Set `PORT=8080` only on the `parsed-stream-worker` component. App Platform supplies the API service port from its `http_port` setting.

Create the Firebase value on macOS without printing the private key:

```bash
base64 < /path/to/firebase-service-account.json | tr -d '\n' | pbcopy
```

Paste the clipboard into `FIREBASE_SERVICE_ACCOUNT_BASE64`. Never commit MongoDB credentials, Firebase JSON, Helius keys, APNs keys, or App Store Connect keys.

### DEX links and referral codes

Copy `apps/api/dex-links.example.json`, then add an entry keyed by the normalized DEX id used by WhoAped, for example `jupiter`, `pancakeswap`, `orca`, or `raydium`:

```json
{
  "pancakeswap": {
    "providerName": "PancakeSwap",
    "urlTemplate": "https://pancakeswap.finance/swap?chain=solana&inputCurrency={inputMint}&outputCurrency={outputMint}",
    "referralCode": "YOUR_CODE",
    "referralQueryParam": "ref"
  }
}
```

Supported URL placeholders are `{inputMint}`, `{outputMint}`, `{tokenMint}`, `{dex}`, and `{referralCode}`. Use `referralQueryParam` when a DEX expects a query parameter. Use `{referralCode}` directly in `urlTemplate` when it expects the code in the path or another custom position. When `referralCode` is empty or absent, no referral query parameter is added.

Only HTTPS URLs are accepted. A missing, malformed, or unsafe DEX entry falls back to the Jupiter pair URL. Confirm each DEX's current official referral parameter before enabling its code; the parameter names are not assumed to be identical.

Encode the finished file without printing its contents:

```bash
base64 < apps/api/dex-links.production.json | tr -d '\n' | pbcopy
```

Paste it into the encrypted runtime variable `DEX_LINK_CONFIG_BASE64`. Raw `DEX_LINK_CONFIG_JSON` is also supported locally, but Base64 avoids App Platform JSON parsing issues.

### Token buy and chart links

Every non-SOL, non-stable fungible token in a tracked activity gets external actions. The built-in defaults are copied from Gated and include its referral-enabled BONKbot, GMGN, and FOMO URLs plus DexScreener. Override the full destination set using `TOKEN_ACTION_CONFIG_BASE64`; use [apps/api/token-actions.example.json](../apps/api/token-actions.example.json) as the template and keep the `{mint}` placeholder. `TOKEN_ACTION_CONFIG_JSON` is available for local development. Only HTTPS URLs are accepted.

## 4. Health checks and scaling

- [ ] API readiness and liveness: HTTP `GET /health` on port `8787`.
- [ ] Worker liveness: HTTP `GET /health` on port `8080`.
- [ ] Keep the worker instance count at `1`; multiple copies waste Helius connections even though database writes are idempotent.
- [ ] Start with one API instance. Scale it independently only after traffic requires it.
- [ ] Enable deployment, domain, CPU, memory, and restart alerts included in `.do/app.yaml`.

The public health endpoint is ready only when MongoDB responds:

```json
{"ok":true,"database":"connected"}
```

## 5. Firebase push prerequisites

- [ ] In Firebase Console, create a server service account with Firebase Cloud Messaging access.
- [ ] Upload the APNs authentication key for iOS bundle ID `com.whoaped.app`.
- [ ] Confirm `apps/mobile/ios/WhoAped/GoogleService-Info.plist` belongs to Firebase project `whoaped`.
- [ ] Before Android testing, add `google-services.json` at `apps/mobile/android/app/google-services.json`.

## 6. Configure `api.whoaped.com`

- [ ] In the App Platform app, open **Networking → Domains → Add Domain**.
- [ ] Add `api.whoaped.com` as the primary domain.
- [ ] If DNS is not hosted by DigitalOcean, copy the exact `ondigitalocean.app` CNAME target shown in the UI.
- [ ] At the DNS provider for `whoaped.com`, create `CNAME api → <target shown by DigitalOcean>`.
- [ ] Wait until App Platform reports the domain and managed TLS certificate as active.
- [ ] Verify `https://api.whoaped.com/health` returns HTTP 200 with the connected response above.

Do not point the subdomain at an old Droplet IP. App Platform provides the required CNAME/A targets in the Networking screen.

## 7. Connect and release the mobile app

- [ ] Create local `apps/mobile/.env` with `API_URL=https://api.whoaped.com`.
- [ ] Build a release only after the production health endpoint is green.
- [ ] Increment the iOS build number and upload the connected build to TestFlight.
- [ ] On a physical iPhone, install the TestFlight build, allow notifications, and add a real Solana public address.

## 8. Required end-to-end acceptance test

- [ ] Add a wallet in the physical TestFlight app.
- [ ] Confirm the wallet document and enabled device token exist in MongoDB.
- [ ] Confirm the worker rebuilds its Parsed Streams subscriptions within five seconds.
- [ ] Send a small real Solana transaction involving that wallet.
- [ ] Confirm the worker receives and stores the normalized transaction.
- [ ] Confirm the Activity feed displays it.
- [ ] Confirm the device receives the push notification.

Deployment is complete only after the full transaction-to-push path succeeds. A green `/health` response alone is not sufficient.

## 9. Before wider beta

- [ ] Add Crashlytics or Sentry and structured backend error reporting.
- [ ] Add API rate limiting and Apple App Attest/Google Play Integrity before opening session creation publicly.
- [ ] Add push-tap routing and a Solscan transaction link.
- [ ] Add cursor pagination to the Activity endpoint.
- [ ] Document MongoDB backup restore and secret rotation procedures.

## Telegram bot

Set `TELEGRAM_BOT_TOKEN` as an encrypted app-level runtime variable, shared by the API and the existing worker. No extra worker or polling process is needed. After deployment, run `npm run setup:telegram` from `apps/api` with the same token; it verifies the deployed authenticated route before registering `https://api.whoaped.com/telegram/webhook`, bot commands, and description. Override `TELEGRAM_PUBLIC_URL` for another deployment. Do not put the bot token in a URL, logs, or Git.

For StakeFast, deploy the web build and verify `https://whoaped.com/staking/`. Set `TELEGRAM_STAKING_ENABLED=true` for the API and worker to enable the bot's **Staking & PRO** menu. Use the same setting when registering the `/staking` command. The bot links to the regular WhoAped website. Users confirm their Telegram account there and approve each staking action in their Solana wallet.

Mainnet withdrawals require the vendored StakeFast SDK 0.6.0 (10-byte instruction with a 50 bps limit and the mint's canonical fee token account). The API simulates the unsigned transaction and adds an integer-exact quote for the position used to prepare it. The staking page reviews that same transaction before handing it to the wallet. The 0.5% token fee applies only to withdrawal, not to requesting unstake. The StakeFast action fee is 0.002 SOL, separate from network fees and possible token account rent.

The `/portfolio` command and inline Portfolio button need `HELIUS_API_KEY` on the backend. Helius supplies current SOL/SPL/Token-2022 balances and USD prices where available; Jupiter filters tokens to its catalogue and supplies prices when available. With `JUPITER_API_KEY`, the bot also queries Jupiter Price V3; without it, Jupiter token-search requests are paced for the slower keyless tier and Helius prices fill gaps. The bot keeps a two-minute portfolio snapshot so pagination does not reread every wallet. Missing prices are shown as unavailable and are excluded from the estimated USD total; partial wallet reads are explicitly marked.

The webhook authenticates Telegram's secret header, validates updates, and durably queues commands in MongoDB before acknowledging them. The stream worker processes commands and notification jobs. Use `/add`, `/wallets`, and `/remove` in a private bot chat. Bare `/add` prompts for a multiline list of `ADDRESS Name` entries; bare `/remove` prompts for a multiline list of addresses (optional names are accepted). Lists can also follow the command directly. Conversation mode persists in MongoDB across worker restarts; `/cancel` exits it. Invalid rows are reported individually. Wallet lists include remove buttons. Each detected transaction is delivered automatically as a chat message; there is no history command. Telegram wallets use a separate `telegram:<chatId>` owner and do not expose mobile wallets. Maximum: 200 wallets per chat, added in batches of up to 100 per message.

Each observed signature produces one durable notification job per tracked wallet, including failed and unclassified transactions (mobile filtering stays independent). Token buttons use the existing `TOKEN_ACTION_CONFIG_BASE64` / `TOKEN_ACTION_CONFIG_JSON` referral destinations. Removed wallets and blocked chats stop receiving pending alerts. Delivery is at least once: a crash after Telegram accepts a message but before MongoDB acknowledges it can cause a duplicate. Temporary errors and HTTP 429 are retried; terminal 400/403 errors are recorded. Delivery records remain stored after wallet removal. Existing Parsed Events backfill covers stream disconnects, within its configured page limit and upstream parser coverage; this is not a complete historical blockchain archive.

Acceptance: open the bot, add a wallet, verify wallet listing and removal, and confirm an actual on-chain transaction arrives with working token links. A healthy API and successful webhook registration alone do not verify Telegram delivery.

### Shared mobile and Telegram accounts

In mobile Settings, **Connect Telegram** creates a one-time 10-minute deep link and a six-digit comparison code. The private bot chat shows the same code and asks for explicit confirmation. Opening a link claims it for that Telegram user; confirmation consumes it atomically. Expired, cancelled and other-chat links cannot merge accounts. Cancel is available in both clients. Existing secure mobile sessions survive linking, and the connection persists across launches. A fresh installation can connect to the same Telegram identity to recover the shared account after confirmation.

The existing Telegram account remains the canonical owner. MongoDB transactions combine the mobile wallet list, activity history, sessions, push devices, notification jobs and account entitlements. Duplicate wallets retain the Telegram wallet's name and ID; duplicate activity IDs remain aliases so old push links still resolve. Account aliases are resolved by HTTP authentication, live activity sockets and ingestion. Wallet/device/ingestion writes and merges use the same per-account transaction lock to prevent orphaned writes during linking. This requires the existing MongoDB replica-set deployment; there is no non-atomic fallback.

`GET /v1/account` returns the canonical account ID, verified Telegram connection and active entitlements. `POST /v1/account/telegram-link` issues a link for the authenticated session; `DELETE` cancels outstanding links. No public endpoint accepts a caller-supplied target account or Telegram identity. The bot derives identity only from the authenticated Telegram webhook and a private user's own chat.

Future payment integrations should grant/revoke `account_entitlements` rows against the canonical user ID using unique `(provider, externalId)` event/receipt identifiers. Entitlements move together on account merge, preserving both providers' grants without downgrading access. Payment processing, subscription purchases, receipt verification and premium gating are not implemented by this account-linking change. Never grant entitlements from mobile or Telegram client parameters.

Run `npm test` in `apps/api` for transaction/rollback/concurrency tests on an ephemeral local MongoDB replica set. The test-only MongoDB binary downloads on first use; it is disabled during Docker installation and is not included in the production runtime.

### Free account transaction limits and tracking pauses

Every canonical account has rolling limits of **20 unique transactions per 60 seconds**, **100 per 60 minutes**, and **300 per 24 hours**, summed across all its wallets and delivery channels. Failed and unclassified transactions count because they still consume upstream traffic. Retries, stream/backfill overlap and a signature touching several wallets count once. The first transaction beyond any limit is rejected before normalization or token metadata requests, and starts cooldown until all exhausted windows have room for another transaction. No premium exceptions, purchase flow or client-supplied policy overrides are enabled.

Counters, signature receipts and cooldown state live in MongoDB. Admission uses the existing per-account transaction lock, so multiple stream connections, process restarts and account linking cannot reset or exceed the budget. Account merges combine usage, deduplicate shared signatures and retain the stronger pause; combining two budgets can itself start cooldown. A durable account notification is created atomically with cooldown and delivered through Telegram and all enabled mobile push devices. Telegram account notices have priority over queued transaction alerts. Already accepted transactions may still finish delivery after the notice.

The worker excludes paused/cooling accounts when building its Helius Parsed Streams address set. A live limit violation triggers an immediate subscription refresh; administrative changes are picked up by the regular refresh (normally five seconds). Old sockets close and their queued frames are discarded. Shared addresses remain subscribed only while another non-paused account still needs them; the cooled account is excluded from admission. An already in-flight provider response cannot be refunded, but no further history pages are requested for an address without eligible owners.

On expiry, subscriptions reopen automatically. The first provider ping establishes a new slot floor for the resumed account; transactions at or below that slot are ignored, including shared-address traffic and backfill. **The cooldown interval is intentionally not collected or backfilled.** Checkpoints are now per address, avoiding incorrect recovery after subscription groups change; existing connection checkpoints are migrated once at startup. Before each paid history request and each result, the backend rechecks account eligibility. New wallets added during a pause stay paused as part of their account.

`GET /v1/account` includes tracking limits, cooldown deadline, manual pause and resumption state. Mobile Settings shows this status; foreground and background cooldown pushes explain when tracking resumes. Use `POST /internal/accounts/<canonical-or-previous-user-id>/tracking` with `Authorization: Bearer <INTERNAL_JOB_SECRET>` and JSON `{"paused":true}` to pause an account indefinitely, or `{"paused":false}` to release that manual pause. Releasing a manual pause does not reset usage or override an active quota cooldown. This administrative credential must never be shipped to clients.
