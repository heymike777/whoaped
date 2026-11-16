import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../public/', import.meta.url);
// Resolve against this script; never depend on the caller's working directory.
const repo = new URL('../../../', import.meta.url);
await mkdir(new URL('fonts/', publicDir), { recursive: true });
for (const [source, target] of [
  ['files/whoaped-app-icon.svg', 'mark.svg'],
  ['files/store-screenshots/captures/ios/01-activity.png', 'activity.png'],
  ['files/store-screenshots/captures/ios/06-add-wallet.png', 'add-wallet.png'],
  ['apps/mobile/assets/fonts/SpaceGrotesk-Bold.ttf', 'fonts/SpaceGrotesk-Bold.ttf'],
  ['apps/mobile/assets/fonts/SpaceGrotesk-Regular.ttf', 'fonts/SpaceGrotesk-Regular.ttf'],
]) {
  await copyFile(new URL(source, repo), new URL(target, publicDir));
  console.log(`${source} → ${fileURLToPath(new URL(target, publicDir))}`);
}
