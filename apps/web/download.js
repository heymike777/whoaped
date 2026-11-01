// Keep APK distribution public and separate from the private application source.
const repository = 'Danger-Valley/whoaped-downloads';
const perPage = 100;
const latestNode = document.getElementById('latest-release');
const listNode = document.getElementById('release-list');
const countNode = document.getElementById('build-count');
const moreButton = document.getElementById('load-more');

let page = 1;
let builds = [];
let loading = false;
let hasMore = false;

function validAsset(asset) {
  if (!asset || typeof asset.name !== 'string' || !/\.apk$/i.test(asset.name)) return false;
  try {
    const url = new URL(asset.browser_download_url);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${repository}/releases/download/`);
  } catch {
    return false;
  }
}

function parseBuilds(releases) {
  return releases.flatMap(release => {
    if (release.draft || release.prerelease || !Array.isArray(release.assets)) return [];
    return release.assets.filter(validAsset).map(asset => ({
      name: release.name || release.tag_name || asset.name,
      tag: release.tag_name || '',
      publishedAt: release.published_at || asset.created_at,
      size: asset.size,
      digest: typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.slice(7) : null,
      url: asset.browser_download_url,
    }));
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' :
    new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatSize(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : 'APK';
}

function link(build, text, className) {
  const anchor = element('a', className, text);
  anchor.href = build.url;
  anchor.rel = 'noopener noreferrer';
  anchor.setAttribute('aria-label', `${text}: ${build.name}`);
  return anchor;
}

function showEmpty() {
  latestNode.replaceChildren();
  latestNode.className = 'release-card empty';
  latestNode.append(element('h3', '', 'No public Android build yet.'));
  latestNode.append(element('p', '', 'The first signed APK will appear here as soon as it is published. There is nothing to download right now.'));
  listNode.replaceChildren(element('p', 'archive-empty', 'The build archive is empty for now.'));
  countNode.textContent = '0 BUILDS';
}

function showError() {
  latestNode.replaceChildren();
  latestNode.className = 'release-card error';
  latestNode.append(element('h3', '', 'Could not load Android builds.'));
  latestNode.append(element('p', '', 'GitHub release data is temporarily unavailable. Please try again.'));
  const retry = element('button', 'button button-outline', 'Try again ↻');
  retry.type = 'button';
  retry.addEventListener('click', () => loadBuilds(true));
  latestNode.append(retry);
  listNode.replaceChildren();
  countNode.textContent = '';
}

function render() {
  latestNode.setAttribute('aria-busy', 'false');
  if (builds.length === 0) {
    showEmpty();
    moreButton.hidden = !hasMore;
    return;
  }
  const latest = builds[0];
  latestNode.replaceChildren();
  latestNode.className = 'release-card';
  latestNode.append(element('div', 'topline', '●  LATEST PUBLISHED BUILD'));
  latestNode.append(element('h3', '', latest.name));
  latestNode.append(element('p', 'release-meta', `${formatDate(latest.publishedAt)}  ·  ${formatSize(latest.size)}  ·  Android APK`));
  const actions = element('div', 'release-actions');
  actions.append(link(latest, 'Download APK  ↓', 'button button-primary'));
  if (latest.digest) actions.append(element('span', 'checksum', `SHA-256 ${latest.digest}`));
  latestNode.append(actions);

  listNode.replaceChildren();
  builds.forEach(build => {
    const row = element('div', 'archive-row');
    const info = element('div');
    info.append(element('strong', '', build.name));
    info.append(element('small', '', `${build.tag || 'Release'} · ${formatSize(build.size)}`));
    row.append(info);
    row.append(element('span', 'archive-date', formatDate(build.publishedAt)));
    row.append(link(build, 'Download ↗', ''));
    listNode.append(row);
  });
  countNode.textContent = `${builds.length} ${builds.length === 1 ? 'BUILD' : 'BUILDS'}${hasMore ? ' · MORE AVAILABLE' : ''}`;
  moreButton.hidden = !hasMore;
}

async function loadBuilds(reset = false) {
  if (loading) return;
  loading = true;
  if (reset) { page = 1; builds = []; latestNode.setAttribute('aria-busy', 'true'); }
  moreButton.disabled = true;
  moreButton.textContent = 'Loading builds…';
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=${perPage}&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok && response.status !== 404) throw new Error(`GitHub returned ${response.status}`);
    // The public downloads repository may not exist before the first APK is published.
    const releases = response.status === 404 ? [] : await response.json();
    if (!Array.isArray(releases)) throw new Error('Unexpected release response');
    builds = builds.concat(parseBuilds(releases));
    hasMore = releases.length === perPage;
    page += 1;
    render();
  } catch {
    if (builds.length === 0) showError();
    else {
      moreButton.hidden = false;
      moreButton.textContent = 'Could not load more — retry';
    }
  } finally {
    latestNode.setAttribute('aria-busy', 'false');
    moreButton.disabled = false;
    if (moreButton.textContent !== 'Could not load more — retry') moreButton.textContent = 'Load older builds ↓';
    loading = false;
  }
}

moreButton.addEventListener('click', () => loadBuilds());
loadBuilds();
