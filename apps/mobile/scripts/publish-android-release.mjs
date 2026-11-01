#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const repository = 'Danger-Valley/whoaped-downloads';
const mobileDirectory = fileURLToPath(new URL('..', import.meta.url));
const apkPath = join(mobileDirectory, 'android/app/build/outputs/apk/release/app-release.apk');
const metadataPath = join(mobileDirectory, 'android/app/build/outputs/apk/release/output-metadata.json');

function githubToken() {
  const credential = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const token = credential.match(/^password=(.+)$/m)?.[1];
  if (!token) throw new Error('No GitHub credential is available. Sign in before publishing.');
  return token;
}

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'WhoAped-Android-release',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}: ${result?.message || 'unknown error'}`);
  }
  return result;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const build = metadata.elements?.[0];
  if (metadata.applicationId !== 'com.whoaped.app' || !Number.isInteger(build?.versionCode) || !build.versionName) {
    throw new Error('Release metadata does not describe a valid WhoAped Android build.');
  }
  const size = (await stat(apkPath)).size;
  if (size < 1_000_000) throw new Error('Release APK is unexpectedly small.');
  const digest = await sha256(apkPath);
  const tag = `android-v${build.versionName}-${build.versionCode}`;
  const assetName = `WhoAped-Android-${build.versionName}-${build.versionCode}.apk`;
  const token = githubToken();
  const base = `https://api.github.com/repos/${repository}`;

  const releases = await request(`${base}/releases?per_page=100`, token);
  let release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft && !release.assets?.some(asset => asset.name === assetName)) {
    throw new Error(`Published release ${tag} exists without ${assetName}; inspect it before retrying.`);
  }
  if (!release) {
    release = await request(`${base}/releases`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: 'master',
        name: `WhoAped Android ${build.versionName} (${build.versionCode})`,
        body: `Signed Android release for WhoAped. Package: com.whoaped.app.\n\nSHA-256: ${digest}`,
        draft: true,
        prerelease: false,
      }),
    });
  }

  let asset = release.assets?.find(item => item.name === assetName);
  if (asset && asset.digest && asset.digest !== `sha256:${digest}`) {
    throw new Error(`Existing ${assetName} has a different SHA-256; refusing to replace it.`);
  }
  if (!asset) {
    const uploadUrl = `${release.upload_url.split('{')[0]}?name=${encodeURIComponent(assetName)}`;
    asset = await request(uploadUrl, token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': String(size),
      },
      body: Readable.toWeb(createReadStream(apkPath)),
      duplex: 'half',
    });
  }
  if (asset.size !== size || (asset.digest && asset.digest !== `sha256:${digest}`)) {
    throw new Error(`Uploaded ${assetName} does not match the local APK.`);
  }
  if (release.draft) {
    release = await request(`${base}/releases/${release.id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: false }),
    });
  }
  asset = release.assets?.find(item => item.name === assetName);
  if (!asset || asset.size !== size || (asset.digest && asset.digest !== `sha256:${digest}`)) {
    throw new Error(`Published release ${tag} does not contain the expected APK.`);
  }
  console.log(JSON.stringify({ tag, releaseUrl: release.html_url, apkUrl: asset.browser_download_url, sha256: digest }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
