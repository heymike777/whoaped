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
- [ ] `FIREBASE_SERVICE_ACCOUNT_BASE64` — Base64 encoding of the complete Firebase Admin service-account JSON.
- [ ] `INTERNAL_JOB_SECRET` — a new unrelated long random secret.

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
