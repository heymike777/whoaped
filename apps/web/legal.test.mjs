import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('.', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('privacy and terms pages have public canonical URLs and cross-links', async () => {
  const [privacy, terms, home, download, build] = await Promise.all([
    read('privacy/index.html'), read('terms/index.html'), read('index.html'),
    read('download/index.html'), read('build.mjs'),
  ]);
  assert.match(privacy, /<link rel="canonical" href="https:\/\/whoaped\.com\/privacy\/"/);
  assert.match(terms, /<link rel="canonical" href="https:\/\/whoaped\.com\/terms\/"/);
  for (const html of [home, download, privacy, terms]) {
    assert.match(html, /href="\/privacy\/"/);
    assert.match(html, /href="\/terms\/"/);
  }
  assert.match(build, /'privacy\/index\.html'/);
  assert.match(build, /'terms\/index\.html'/);
  assert.match(privacy, /How long we keep data/);
  assert.match(terms, /financial, investment, tax, or legal advice/);
});
