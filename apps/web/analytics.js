// Basic consent mode: do not load Google's script or send measurements until opted in.
(() => {
const measurementId = document.currentScript?.dataset.measurementId ?? '';
if (/^G-[A-Z0-9]+$/.test(measurementId)) {
  const consentKey = 'whoaped.analytics.consent.v1';
  const footer = document.querySelector('.site-footer');
  let enabled = false;
  let banner;

  function choice() {
    try { return localStorage.getItem(consentKey); } catch { return null; }
  }

  function remember(value) {
    try { localStorage.setItem(consentKey, value); } catch { /* The next visit will ask again. */ }
  }

  function enableAnalytics() {
    if (enabled) return;
    enabled = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(tag);
  }

  function clearAnalyticsCookies() {
    const names = document.cookie.split(';').map((cookie) => cookie.trim().split('=')[0])
      .filter((name) => name === '_ga' || name.startsWith('_ga_'));
    const domains = [undefined, location.hostname, `.${location.hostname}`];
    if (location.hostname === 'whoaped.com' || location.hostname.endsWith('.whoaped.com')) domains.push('.whoaped.com');
    for (const name of names) for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
    }
  }

  function setChoice(allowed) {
    remember(allowed ? 'yes' : 'no');
    banner?.remove();
    banner = undefined;
    if (allowed) enableAnalytics();
    else if (enabled) {
      window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      clearAnalyticsCookies();
      location.reload(); // Unload the tag completely after consent is withdrawn.
    }
  }

  function button(label, className, onClick) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.addEventListener('click', onClick);
    return element;
  }

  function showChoices() {
    if (banner) return;
    banner = document.createElement('aside');
    banner.className = 'analytics-consent';
    banner.setAttribute('aria-label', 'Optional analytics');
    const title = document.createElement('strong');
    title.textContent = 'Help us improve WhoAped';
    const explanation = document.createElement('p');
    explanation.textContent = 'Allow Google Analytics to measure visits and APK downloads? Nothing is sent to Google unless you agree.';
    const actions = document.createElement('div');
    actions.className = 'analytics-consent-actions';
    actions.append(
      button('No thanks', 'analytics-decline', () => setChoice(false)),
      button('Allow analytics', 'analytics-allow', () => setChoice(true)),
    );
    banner.append(title, explanation, actions);
    document.body.append(banner);
  }

  footer?.append(button('Privacy choices', 'analytics-privacy', showChoices));
  if (choice() === 'yes') enableAnalytics();
  else if (choice() !== 'no') showChoices();

  document.addEventListener('click', (event) => {
    if (!enabled || !(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.hostname === 'github.com' && url.pathname.endsWith('.apk')) {
      window.gtag('event', 'download_apk', {
        file_name: url.pathname.split('/').at(-1),
        link_url: url.href,
        transport_type: 'beacon',
      });
    }
  });
}
})();
