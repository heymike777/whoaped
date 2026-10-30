# WhoAped on Solana Mobile

WhoAped is an existing React Native Community CLI Android app. It is watch-only; Mobile Wallet Adapter, transaction signing, and Expo are not required. The Solana dApp Store requires a separately signed APK.

## Completed locally

- Android package: `com.whoaped.app`; application version: `0.1.0`.
- Separate dApp Store release keystore: `/Users/heymike/Projects/keys/WhoAped-dapp-store.jks` (not in Git).
- Keystore password: macOS Keychain item `com.whoaped.app.dappstore.signing`, account `whoaped-dapp-store`. Never paste the password into Gradle or Git.
- Release builds reject missing Firebase configuration or signing credentials, so they cannot silently use the debug key.

Back up **both** the keystore and the Keychain password in a secure vault. Losing either prevents app updates with this package/signing identity. Keep this signing key separate from any Google Play signing key.

## Firebase file (user action)

In the existing WhoAped Firebase project, register an Android app with package name `com.whoaped.app`. Download its `google-services.json` and put it at `apps/mobile/android/app/google-services.json`. It is ignored by Git. Ensure Firebase Cloud Messaging is enabled for the project.

## Build and test

From `apps/mobile`, run `zsh scripts/build-android-dapp-store.sh`. The resulting APK is `android/app/build/outputs/apk/release/app-release.apk`. The script verifies its signature and prints the certificate. Install on an Android emulator or device and test wallet addition, Activity, tabs, links, realtime updates, and background/foreground push delivery before publishing.

For each subsequent release, increase `versionCode` in `android/app/build.gradle` before building. Then submit the signed APK through the [Solana dApp Store publishing flow](https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk).
