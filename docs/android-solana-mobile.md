# WhoAped on Solana Mobile

WhoAped is an existing React Native Community CLI Android app. It is watch-only; Mobile Wallet Adapter, transaction signing, and Expo are not required. The Solana dApp Store requires a separately signed APK.

## Completed locally

- Android package: `com.whoaped.app`; application version: `0.1.0`.
- Separate dApp Store release keystore: `/Users/heymike/Projects/keys/WhoAped-dapp-store.jks` (not in Git).
- Keystore password: macOS Keychain item `com.whoaped.app.dappstore.signing`, account `whoaped-dapp-store`. Never paste the password into Gradle or Git.
- Release builds reject missing Firebase configuration or signing credentials, so they cannot silently use the debug key.

Back up **both** the keystore and the Keychain password in a secure vault. Losing either prevents app updates with this package/signing identity. Keep this signing key separate from any Google Play signing key.

## Firebase configuration

The existing WhoAped Firebase project now has an Android app with package name `com.whoaped.app`. Its `google-services.json` is installed at `apps/mobile/android/app/google-services.json` and ignored by Git. Keep this file available locally for subsequent builds. Firebase Cloud Messaging initializes and obtains a token in the Android emulator; actual push delivery still needs an end-to-end test.

Release signing certificate SHA-256 (useful when adding the Android app in Firebase): `D1:AB:A8:B9:6F:C6:F9:9B:16:8D:BA:35:4A:DC:B6:D3:A9:D6:C1:75:38:6E:D2:04:B6:17:98:96:F1:D8:6D:09`.

## Build and test

From `apps/mobile`, run `zsh scripts/build-android-dapp-store.sh`. The resulting APK is `android/app/build/outputs/apk/release/app-release.apk`. The script verifies its signature and prints the certificate. Install on an Android emulator or device and test wallet addition, Activity, tabs, links, realtime updates, and background/foreground push delivery before publishing.

For each subsequent release, increase `versionCode` in `android/app/build.gradle` before building. Then submit the signed APK through the [Solana dApp Store publishing flow](https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk).

The local Android SDK has an API 36 Google APIs arm64 system image and a `WhoAped_API_36` emulator. The signed release APK was installed there and its Activity, Wallets, and Settings screens launched successfully. The Settings screen showed push alerts connected to the device. This smoke test does not replace a test on a physical Solana Mobile device, including a real tracked transaction and push delivery, before publishing.
