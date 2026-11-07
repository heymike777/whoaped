import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const output = new URL('./dist/', root);
const measurementId = process.env.GA_MEASUREMENT_ID?.trim() ?? '';
if (measurementId && !/^G-[A-Z0-9]+$/.test(measurementId)) {
  throw new Error('GA_MEASUREMENT_ID must be a GA4 web measurement ID (G-...).');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['styles.css', 'download.js', 'theme.js', 'analytics.js']) {
  await cp(new URL(name, root), new URL(name, output));
}
for (const name of ['index.html', 'download/index.html', 'privacy/index.html', 'terms/index.html']) {
  const html = await readFile(new URL(name, root), 'utf8');
  await mkdir(new URL(name.substring(0, name.lastIndexOf('/') + 1), output), { recursive: true });
  await writeFile(new URL(name, output), html.replaceAll('__GA_MEASUREMENT_ID__', measurementId));
}
await cp(new URL('assets/', root), new URL('assets/', output), { recursive: true });
