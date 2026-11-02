import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');

function runAnalytics(id, storedChoice) {
  const tags = [];
  const storage = new Map(storedChoice ? [['whoaped.analytics.consent.v1', storedChoice]] : []);
  class Element {
    constructor(tagName = 'div') { this.tagName = tagName; this.children = []; this.listeners = {}; this.dataset = {}; }
    append(...children) { this.children.push(...children); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute() {}
    remove() { this.removed = true; }
  }
  const footer = new Element('footer');
  const document = {
    currentScript: { dataset: { measurementId: id } },
    head: { append(tag) { tags.push(tag); } },
    body: new Element('body'),
    cookie: '',
    querySelector(selector) { return selector === '.site-footer' ? footer : null; },
    createElement(name) { return new Element(name); },
    addEventListener() {},
  };
  const window = {};
  const location = { hostname: 'whoaped.com', href: 'https://whoaped.com/', reload() {} };
  runInNewContext(script, { document, window, location, Element, URL,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  return { document, footer, storage, tags, window };
}

test('no GA4 ID means no consent UI and no Google tag', () => {
  const result = runAnalytics('');
  assert.equal(result.footer.children.length, 0);
  assert.equal(result.tags.length, 0);
});

test('Google tag stays unloaded until the visitor opts in', () => {
  const result = runAnalytics('G-TEST123');
  assert.equal(result.tags.length, 0);
  const banner = result.document.body.children[0];
  const allow = banner.children[2].children[1];
  allow.listeners.click();
  assert.equal(result.storage.get('whoaped.analytics.consent.v1'), 'yes');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST123');
  assert.equal(result.window.dataLayer.some(([command]) => command === 'config'), true);
});

test('declining analytics never loads the tag', () => {
  const result = runAnalytics('G-TEST123');
  result.document.body.children[0].children[2].children[0].listeners.click();
  assert.equal(result.storage.get('whoaped.analytics.consent.v1'), 'no');
  assert.equal(result.tags.length, 0);
  assert.equal(runAnalytics('G-TEST123', 'no').tags.length, 0);
});

test('consent UI still initializes when another script defines a global button binding', () => {
  const source = `const button = 'site theme control';\n${script}`;
  const footer = { children: [], append(child) { this.children.push(child); } };
  const body = { children: [], append(child) { this.children.push(child); } };
  class Element {
    constructor() { this.children = []; this.listeners = {}; }
    append(...children) { this.children.push(...children); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute() {}
  }
  runInNewContext(source, {
    document: { currentScript: { dataset: { measurementId: 'G-TEST123' } }, body, head: {},
      querySelector: () => footer, createElement: () => new Element(), addEventListener() {} },
    localStorage: { getItem: () => null }, window: {}, location: { hostname: 'whoaped.com' }, Element, URL,
  });
  assert.equal(footer.children.length, 1);
  assert.equal(body.children.length, 1);
});
