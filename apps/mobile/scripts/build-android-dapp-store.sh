#!/bin/zsh
set -euo pipefail

mobile_dir="${0:A:h:h}"
firebase_file="$mobile_dir/android/app/google-services.json"
keystore_file="/Users/heymike/Projects/keys/WhoAped-dapp-store.jks"

if [[ ! -f "$firebase_file" ]]; then
  print -u2 "Missing $firebase_file. Download the Android Firebase config for com.whoaped.app first."
  exit 1
fi
if ! node -e 'const fs=require("fs"); const config=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!config.client?.some(client=>client.client_info?.android_client_info?.package_name==="com.whoaped.app")) process.exit(1)' "$firebase_file"; then
  print -u2 "Firebase config does not contain the Android app com.whoaped.app."
  exit 1
fi
if [[ ! -f "$keystore_file" ]]; then
  print -u2 "Missing release keystore at $keystore_file. Do not substitute the debug keystore."
  exit 1
fi

export WHOAPED_ANDROID_KEYSTORE_FILE="$keystore_file"
export WHOAPED_ANDROID_KEY_ALIAS="whoaped-dapp-store"
export WHOAPED_ANDROID_KEYSTORE_PASSWORD="$(security find-generic-password -a whoaped-dapp-store -s com.whoaped.app.dappstore.signing -w)"
export WHOAPED_ANDROID_KEY_PASSWORD="$WHOAPED_ANDROID_KEYSTORE_PASSWORD"

cd "$mobile_dir/android"
./gradlew assembleRelease --console=plain

apk="$mobile_dir/android/app/build/outputs/apk/release/app-release.apk"
"${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools/36.0.0/apksigner" verify --print-certs "$apk"
print "Signed dApp Store APK: $apk"
