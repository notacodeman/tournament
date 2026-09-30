// Cloudflare Turnstile in the browser: gets a one-time token to send with "go live" and "submit a time". Loads
// Cloudflare's script only when the site has a Turnstile key (/api/config); otherwise returns an empty token, which
// the server accepts while Turnstile is off. Usually invisible; it only shows a box if Cloudflare wants a click.

import { api } from './util.js';

let config = null;
let scriptLoading = null;

function loadScript() {
  scriptLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Couldn’t load the “are you a person” check. Check your connection or ad blocker.'));
    document.head.append(s);
  });
  return scriptLoading;
}

export async function turnstileToken() {
  config ??= await api('/api/config').catch(() => ({}));
  if (!config.turnstile_site_key) return '';
  await loadScript();
  return new Promise((resolve, reject) => {
    const box = document.createElement('div');
    box.className = 'turnstile-box';
    document.body.append(box);
    const done = () => setTimeout(() => { try { window.turnstile.remove(id); } catch (_) { /* gone */ } box.remove(); }, 0);
    const id = window.turnstile.render(box, {
      sitekey: config.turnstile_site_key,
      appearance: 'interaction-only',
      callback: token => { done(); resolve(token); },
      'error-callback': () => { done(); reject(new Error('The “are you a person” check failed. Reload the page and try again.')); },
    });
  });
}
