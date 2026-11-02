# WhoAped website and Android builds

The static website lives in `apps/web`. Its `/download/` page reads public APK assets from GitHub Releases in `Danger-Valley/whoaped-downloads`, newest first. Every release with an `.apk` asset appears in the archive; draft and prerelease assets do not. It never links to an unsigned or debug APK.

## Website deployment on Vercel

1. Import the GitHub repository `heymike777/whoaped` as a **new Vercel project**. Grant Vercel access to the private repository if prompted.
2. Set **Root Directory** to `apps/web` and **Framework Preset** to `Other`. Keep the project on the `main` branch. The root directory must be set in Vercel; it cannot be inferred from the `vercel.json` inside `apps/web`.
3. The checked-in `apps/web/vercel.json` sets the build command to `npm run build`, the output directory to `dist`, and canonical trailing slashes. No environment variables or framework installation are required.
4. Deploy, then check both `/` and `/download/` on the Vercel URL. The download page shows an honest empty state until the separate public APK releases repository has a published build.
5. Add `whoaped.com` (and optionally `www.whoaped.com`) in the Vercel project's Domains settings. Add the exact DNS records Vercel requests at your DNS provider. Leave `api.whoaped.com` on the existing DigitalOcean API app; do not change its routes or secrets.

The site has no runtime secrets and does not need a web server, database, or API integration. `npm run check && npm run build` validates and stages its static files locally.

## Landing-page analytics

Use the GA4 **whoaped.com web data stream** in the Firebase-linked property. Set its public measurement ID `G-N6ZMCJLS6S` as the Vercel **build-time** environment variable `GA_MEASUREMENT_ID` for the production environment, then redeploy the website. Do not use the separate Telegram bot stream ID, a Firebase app ID (`1:...:web:...`), or a secret API key here. The site builds without this variable, but analytics and the consent prompt remain disabled.

The lightweight Google tag loads only after a visitor chooses **Allow analytics**. Declining leaves the tag unloaded. The choice is stored locally, can be revisited through **Privacy choices** in the footer, and applies to `/` and `/download/`. GA4 records page views and a `download_apk` event when a visitor clicks a GitHub APK link. No mobile-app analytics are enabled by this setting. Validate in GA4 Realtime/DebugView after consenting; no events should appear from a browser that declined.

## Publish Android builds

1. Keep application source and signing keys in the private source repository; only signed APK release artifacts belong in the public `Danger-Valley/whoaped-downloads` repository.
2. For each app release, increase `versionCode` in `apps/mobile/android/app/build.gradle`, build with `zsh scripts/build-android-dapp-store.sh` from `apps/mobile` using the existing dApp Store keystore and production `API_URL`, and verify the APK signature and package ID. Keep the same signing certificate for updates.
3. Run `node scripts/publish-android-release.mjs` from `apps/mobile`. It uses the locally saved GitHub credential, uploads the signed APK to a draft release, checks its size and SHA-256, then publishes it. Do not replace a previous release: the archive keeps every build accessible.
4. Refresh `/download/`. It reads the GitHub Releases API, so new builds appear without a website redeploy. Verify that the latest button downloads the APK and that its SHA-256 (when GitHub reports one) matches the local file. Test installation on a real Android device before sharing the link.

The first public release is `0.1.0 (2)` (`android-v0.1.0-2`). Build `0.1.0 (1)` was never published.
