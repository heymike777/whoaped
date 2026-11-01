# WhoAped

Watch-only wallet activity for humans. Add a Solana public address and get a plain-language push alert after its next confirmed transaction.

This repository contains a React Native Community CLI mobile client with checked-in iOS and Android projects, plus a Hono/MongoDB API and a persistent Solana ingestion worker. Without `API_URL`, wallets are stored locally and no live tracking occurs.

The static landing page and Android build archive live in `apps/web`; deployment and APK release steps are in [docs/web-and-android-downloads.md](docs/web-and-android-downloads.md).

## Stack

- Mobile: React Native 0.86, Community CLI, TypeScript, Hermes
- Native UI: React Native Blur, Linear Gradient, native haptics, Keychain/Keystore
- Push: Firebase Cloud Messaging through React Native Firebase
- API: Hono on Node 22
- Ingestion: Helius Parsed Streams (confirmed WebSocket) with Parsed Events REST backfill
- Live feed: authenticated app WebSocket backed by MongoDB change streams; FCM remains the background fallback
- Database: MongoDB with automatic indexes and seven-day raw-ingestion retention

## Run the mobile app

Prerequisites follow React Native's native environment setup: Xcode/CocoaPods for iOS and Android Studio/JDK for Android.

```bash
cd apps/mobile
npm install
cp .env.example .env
npm run assets
```

Install iOS pods:

```bash
cd ios
bundle install
bundle exec pod install
cd ..
```

Start Metro, then run a native target in another terminal:

```bash
npm start
npm run ios
# or
npm run android
```

Use your computer's LAN IP in `.env` when running on a physical device:

```text
API_URL=http://192.168.1.10:8787
```

Without an API URL, wallet additions persist locally and the activity feed stays empty. A release build must include the production API URL to track anything.

## Configure native push

Create Firebase iOS and Android apps with bundle/package ID `com.whoaped.app`.

- Android: place `google-services.json` at `apps/mobile/android/app/google-services.json`.
- iOS: add `GoogleService-Info.plist` to the `WhoAped` target in Xcode, enable Push Notifications, and enable Background Modes → Remote notifications.
- Upload the APNs authentication key in Firebase Console for iOS delivery.

The native projects deliberately still build without these files so UI development is not blocked. Enabling notifications in the app explains when Firebase configuration is missing.

## Run the API

1. Create a MongoDB deployment and database named `whoaped`.
2. Copy `apps/api/.env.example` to `apps/api/.env` and fill in `MONGODB_URI` and the remaining values.
3. Provide Application Default Credentials or `FIREBASE_SERVICE_ACCOUNT_JSON` for FCM delivery.
4. Start the API and the continuously running Parsed Streams worker as separate processes:

```bash
cd apps/api
npm install
npm run dev
# another terminal/process
npm run dev:stream
```

The first API or worker connection creates the required MongoDB indexes automatically. The worker reads active wallet addresses from MongoDB every five seconds, opens `parsedTransactionSubscribe` subscriptions at confirmed commitment, and persists the last completely processed slot. Helius Parsed Streams is at-most-once, so reconnects use the Parsed Events transaction-history endpoint to backfill the missed slot window before live processing resumes.

While Activity is open, the mobile app keeps one authenticated WebSocket to the API. New transaction inserts are delivered through a MongoDB change stream and merged into the feed without polling or showing a refresh spinner. Reconnects and foreground resumes perform a silent reconciliation fetch; pull-to-refresh remains available only as a manual action.

Run exactly one worker replica initially. It needs an always-on runtime. The repository includes a DigitalOcean App Platform spec at `.do/app.yaml`; deployment and Managed MongoDB setup are covered in [docs/deployment-digitalocean.md](docs/deployment-digitalocean.md).

## Verify

```bash
cd apps/mobile && npm run typecheck && npm test
cd apps/mobile/android && ./gradlew assembleDebug
cd apps/api && npm test && npm run typecheck
```

The infrastructure and scaling decisions are documented in [docs/architecture.md](docs/architecture.md).

## Production gates

- Replace anonymous install sessions with Sign in with Apple/Google if cross-device sync is required.
- Add App Attest / Play Integrity and rate limiting before opening session creation publicly.
- Move push delivery to a dedicated durable queue when MongoDB job polling becomes a bottleneck.
- Test FCM permissions and delivery on physical iOS and Android devices.
- Add ingestion-lag alerting based on `pipeline_checkpoints.updated_at`.
