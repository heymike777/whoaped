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

test('home page links to Telegram and gives honest Seeker store instructions', async () => {
  const home = await read('index.html');
  assert.match(home, /href="https:\/\/t\.me\/whoapedbot"/);
  assert.match(home, /href="https:\/\/t\.me\/whoaped"/);
  assert.match(home, /Live on Seeker/);
  assert.match(home, /search for <strong>WhoAped<\/strong>/);
  assert.doesNotMatch(home, /href="\/download\//);
});
