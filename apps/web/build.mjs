import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const output = new URL('./dist/', root);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'download.js']) {
  await cp(new URL(name, root), new URL(name, output));
}
await cp(new URL('download/', root), new URL('download/', output), { recursive: true });
await cp(new URL('assets/', root), new URL('assets/', output), { recursive: true });
