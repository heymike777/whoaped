const button = document.querySelector('.theme-toggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

function activeTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function updateTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111513' : '#F4F4EF');
  if (button) {
    const next = theme === 'dark' ? 'light' : 'dark';
    button.textContent = `${next[0].toUpperCase()}${next.slice(1)} mode`;
    button.setAttribute('aria-label', `Switch to ${next} mode`);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

updateTheme(activeTheme());

button?.addEventListener('click', () => {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('whoaped.theme', next); } catch {}
  updateTheme(next);
});

systemTheme.addEventListener('change', (event) => {
  try { if (localStorage.getItem('whoaped.theme')) return; } catch {}
  updateTheme(event.matches ? 'dark' : 'light');
});
