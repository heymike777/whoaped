# WhoAped website and Android builds

The static website lives in `apps/web`. Its `/download/` page reads public APK assets from GitHub Releases in `Danger-Valley/whoaped-downloads`, newest first. Every release with an `.apk` asset appears in the archive; draft and prerelease assets do not. The page intentionally shows an empty state until the public downloads repository and first signed release exist. It never links to an unsigned or debug APK.

## Website deployment

Create a separate **DigitalOcean App Platform Static Site** from `heymike777/whoaped`, branch `main`, source directory `apps/web`. Use `npm run build` as the build command and `dist` as the output directory. Attach `whoaped.com` and, if desired, `www.whoaped.com` to this website app. Keep `api.whoaped.com` on the existing API app; do not change its routes or secrets. Copy the DNS targets DigitalOcean shows for the website domains into your DNS provider, then verify both `/` and `/download/` over HTTPS.

The site has no runtime secrets and does not need a web server, database, or API integration. `npm run check && npm run build` validates and stages its static files locally.

## Publish Android builds

1. Create a **public** GitHub repository named `Danger-Valley/whoaped-downloads`. Keep application source and signing keys in the existing private repository; only signed APK release artifacts belong in the public downloads repository.
2. For each app release, increase `versionCode` in `apps/mobile/android/app/build.gradle`, build the signed release using the existing dApp Store keystore and production `API_URL`, and verify the APK signature and package ID. Keep the same signing certificate for updates.
3. Create a new GitHub Release in `Danger-Valley/whoaped-downloads` with a unique tag such as `android-v0.1.0-2`, name it `WhoAped Android 0.1.0 (2)`, and attach the signed APK. Do not replace a previous release: the archive is meant to keep every build accessible. Publish the release (not a draft/prerelease).
4. Refresh `/download/`. It reads the GitHub Releases API, so new builds appear without a website redeploy. Verify that the latest button downloads the APK and that its SHA-256 (when GitHub reports one) matches the local file. Test installation on a real Android device before sharing the link.

The current local release APK is version `0.1.0 (1)`, but it is **not** presented as a public download until it has been uploaded and verified. The in-app browser is not signed in to GitHub, so creation of the public downloads repository and upload remain pending.
