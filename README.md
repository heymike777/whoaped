# WhoAped

Watch-only wallet activity for humans. Add a Solana public address and get a plain-language push alert after its next confirmed transaction.

This repository contains a React Native Community CLI mobile client with checked-in iOS and Android projects, plus a Hono/Postgres API. The app opens in preview mode with realistic data until `API_URL` is configured.

## Stack

- Mobile: React Native 0.86, Community CLI, TypeScript, Hermes
- Native UI: React Native Blur, Linear Gradient, native haptics, Keychain/Keystore
- Push: Firebase Cloud Messaging through React Native Firebase
- API: Hono on Node 22
- Ingestion: Helius Enhanced Webhooks
- Database: Neon Postgres through the serverless driver

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

Without an API URL, wallet additions persist locally and the activity feed uses preview transactions.

## Configure native push

Create Firebase iOS and Android apps with bundle/package ID `com.whoaped.app`.

- Android: place `google-services.json` at `apps/mobile/android/app/google-services.json`.
- iOS: add `GoogleService-Info.plist` to the `WhoAped` target in Xcode, enable Push Notifications, and enable Background Modes → Remote notifications.
- Upload the APNs authentication key in Firebase Console for iOS delivery.

The native projects deliberately still build without these files so UI development is not blocked. Enabling notifications in the app explains when Firebase configuration is missing.

## Run the API

1. Create a Neon database.
2. Run `apps/api/migrations/001_initial.sql` in the Neon SQL editor.
3. Copy `apps/api/.env.example` to `apps/api/.env` and fill in the values.
4. Provide Application Default Credentials or `FIREBASE_SERVICE_ACCOUNT_JSON` for FCM delivery.
5. Start the API:

```bash
cd apps/api
npm install
npm run dev
```

Create one Helius Enhanced webhook, then set its URL to:

```text
https://YOUR_API/webhooks/helius/YOUR_HELIUS_WEBHOOK_SECRET
```

Put that webhook ID in `HELIUS_WEBHOOK_ID`. Every new wallet triggers a reconciliation of the desired address set with Helius.

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
- Run push delivery in a scheduled worker or durable queue rather than inline with webhook handling.
- Test FCM permissions and delivery on physical iOS and Android devices.
- Shard Helius webhooks when the provider address limit or update latency makes a single webhook impractical.
