// Injected into the page at document start (main frame only).
// - Logged-in users end up on facebook.com/messages: hide the rest of Facebook there.
// - Applies the look options from the Settings window.
// - WKWebView has no Web Notifications, so `Notification` forwards to the native app.
// - Helpers for the keyboard shortcuts.
(() => {
  const native = (msg) => {
    try { window.webkit.messageHandlers.native.postMessage(msg); } catch (_) {}
  };

  const root = document.documentElement;
  const isFacebookHost = (host) => /(^|\.)facebook\.com$/.test(host);
  const isMessengerPath = (path) => /^\/(messages|groupcall|videocall)(\/|$)/.test(path);
  const onFacebook = isFacebookHost(location.hostname);

  // ---- Styles ---------------------------------------------------------------
  // Scoped to html[data-mdesk-messenger], which is only set on Messenger pages (so the
  // login screen keeps its own layout), plus one html attribute per Settings option.

  const M = 'html[data-mdesk-messenger]';
  const THEMES = ':is(.__fb-light-mode, .__fb-dark-mode)'; // Facebook redefines its colors on these
  const LIST = '[aria-label="Thread list"]';

  const STYLES = `
    /* Facebook's top bar (feed, Marketplace, notifications…) */
    ${M} [role="banner"] { display: none !important; }
    ${M}, ${M} ${THEMES} { --header-height: 0px !important; }

    /* Seamless title bar: leave a strip for the window buttons */
    ${M}[data-mdesk-seamless], ${M}[data-mdesk-seamless] ${THEMES} { --header-height: 28px !important; }

    /* Frosted glass: the window's blur shows through the chat list and title strip */
    ${M}[data-mdesk-glass], ${M}[data-mdesk-glass] body { background: transparent !important; }
    ${M}[data-mdesk-glass] ${LIST}, ${M}[data-mdesk-glass] ${LIST} ${THEMES} {
      --messenger-card-background: transparent !important;
      --surface-background: transparent !important;
    }
    /* Keep the conversation area solid, including Facebook's 16px gutter to its right */
    ${M}[data-mdesk-glass] [role="main"] { background-color: var(--web-wash); box-shadow: 16px 0 0 var(--web-wash); }

    /* Accent color: Facebook's blue, and every chat theme (set inline on the conversation) */
    ${M}[data-mdesk-accent], ${M}[data-mdesk-accent] ${THEMES},
    ${M}[data-mdesk-accent] [role="main"] [style*="--chat-outgoing-message-background-gradient"] {
      --accent: var(--mdesk-accent) !important;
      --primary-button-background: var(--mdesk-accent) !important;
      --primary-deemphasized-button-text: var(--mdesk-accent-light) !important;
      --primary-deemphasized-button-background: color-mix(in srgb, var(--mdesk-accent) 22%, transparent) !important;
      --chat-outgoing-message-background-gradient: linear-gradient(var(--mdesk-accent-light), var(--mdesk-accent)) !important;
      --chat-composer-button-color: var(--mdesk-accent) !important;
      --chat-composer-caret-color: var(--mdesk-accent) !important;
      --mwp-header-button-color: var(--mdesk-accent) !important;
      --mwp-primary-theme-color: var(--mdesk-accent) !important;
      --reaction-pill-multireact-selected-color: var(--mdesk-accent-light) !important;
    }
    /* The bubble gradient is also written inline as fixed colors on the message list */
    ${M}[data-mdesk-accent] [role="main"] [style*="--chat-outgoing-message-background-gradient"][style*="background-image"] {
      background-image: linear-gradient(var(--mdesk-accent-light), var(--mdesk-accent)) !important;
    }

    /* Compact chat list */
    ${M}[data-mdesk-compact] ${LIST} [role="grid"] { zoom: 0.85; }

    /* Parts tagged by markParts() */
    ${M}[data-mdesk-hide-filters] [data-mdesk-part="filters"],
    ${M}[data-mdesk-hide-nudges] [data-mdesk-part="nudge"] { display: none !important; }
  `;

  // ---- Tagging parts of the page ------------------------------------------------
  // Facebook's class names are random and change often, so parts are found by structure.

  let settings = {};
  let markingScheduled = false;
  let linkColor = null;
  let infoPanelHandledFor = null;

  const scheduleMarking = () => {
    if (markingScheduled || !onFacebook) return;
    markingScheduled = true;
    setTimeout(() => { markingScheduled = false; markParts(); }, 150);
  };

  const markParts = () => {
    if (!document.body || !isMessengerPath(location.pathname)) return;
    const list = document.querySelector(`[role="navigation"]${LIST}`);
    const grid = list?.querySelector('[role="grid"]');
    const tabs = list?.querySelector('[role="tablist"]');

    // Filter row (All / Unread / Groups): the tab bar's largest ancestor without the chat list in it.
    if (tabs && grid) {
      let el = tabs;
      while (el.parentElement && !el.parentElement.contains(grid)) el = el.parentElement;
      el.dataset.mdeskPart = 'filters';
    }

    // "Reply?" / "Follow up?" nudges: link-colored text ending in "?" at the end of a chat's subtitle.
    if (settings.hideNudges && grid) {
      if (!linkColor) {
        const sample = document.body.appendChild(document.createElement('span'));
        sample.style.color = 'var(--blue-link)';
        linkColor = getComputedStyle(sample).color;
        sample.remove();
      }
      for (const span of grid.querySelectorAll('span')) {
        if (span.childElementCount || span.closest('[data-mdesk-part]')) continue;
        const text = span.textContent.trim();
        if (!text.endsWith('?') || text.length > 24 || getComputedStyle(span).color !== linkColor) continue;
        let chunk = span;
        while (chunk.parentElement?.tagName === 'SPAN') chunk = chunk.parentElement;
        chunk.dataset.mdeskPart = 'nudge';
        const separator = chunk.previousElementSibling; // the " · " before it
        if (separator?.querySelector('[aria-hidden="true"]')) separator.dataset.mdeskPart = 'nudge';
      }
    }

    // Info panel: close it once per chat, so the ⓘ button can still open it on purpose.
    if (settings.closeInfoPanel && infoPanelHandledFor !== location.pathname) {
      const button = document.querySelector('[role="main"] [aria-label="Conversation information"]');
      if (button) {
        infoPanelHandledFor = location.pathname;
        if (button.getAttribute('aria-expanded') === 'true') button.click();
      }
    }
  };

  // ---- Settings (from the Settings window) ------------------------------------------

  const OPTION_ATTRIBUTES = {
    seamless: 'seamless', glass: 'glass', compact: 'compact', hideFilters: 'hide-filters', hideNudges: 'hide-nudges',
  };
  const accentStyle = document.createElement('style');

  const applySettings = (next) => {
    settings = next || {};
    for (const [key, name] of Object.entries(OPTION_ATTRIBUTES)) {
      root.toggleAttribute(`data-mdesk-${name}`, !!settings[key]);
    }
    root.toggleAttribute('data-mdesk-accent', !!settings.accent);
    accentStyle.textContent = settings.accent
      ? `html { --mdesk-accent: ${settings.accent}; --mdesk-accent-light: ${settings.accentLight}; }`
      : '';
    infoPanelHandledFor = null;
    scheduleMarking();
  };

  applySettings(window.__mdeskSettings);

  // ---- Messenger only -------------------------------------------------------------

  if (onFacebook) {
    const style = document.createElement('style');
    style.textContent = STYLES;
    root.append(style, accentStyle);

    const syncPage = () => {
      root.toggleAttribute('data-mdesk-messenger', isMessengerPath(location.pathname));
      scheduleMarking();
    };
    syncPage();
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        syncPage();
        return result;
      };
    }
    window.addEventListener('popstate', syncPage);
    new MutationObserver(scheduleMarking).observe(root, { childList: true, subtree: true });

    // Tell the app whether Facebook is in dark mode, so the window and its glass match.
    let dark = null;
    const reportTheme = () => {
      const isDark = root.classList.contains('__fb-dark-mode');
      if (isDark === dark) return;
      dark = isDark;
      linkColor = null;
      native({ type: 'theme', dark });
    };
    new MutationObserver(reportTheme).observe(root, { attributes: true, attributeFilter: ['class'] });
    reportTheme();

    // Links to the rest of Facebook open in the browser.
    window.addEventListener('click', (event) => {
      if (!isMessengerPath(location.pathname)) return;
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const url = new URL(link.href, location.href);
      if (!/^https?:$/.test(url.protocol) || !isFacebookHost(url.hostname) || isMessengerPath(url.pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      native({ type: 'openExternal', url: url.href });
    }, true);
  }

  // ---- Notifications ------------------------------------------------------

  const prefix = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  const live = new Map();

  class DesktopNotification extends EventTarget {
    constructor(title, options = {}) {
      super();
      this.title = String(title ?? '');
      this.body = String(options.body ?? '');
      this.tag = String(options.tag ?? '');
      this.icon = String(options.icon ?? options.image ?? '');
      this.data = options.data ?? null;
      this.silent = !!options.silent;
      this.onclick = this.onshow = this.onclose = this.onerror = null;
      this._id = `${prefix}-${++counter}`;

      live.set(this._id, this);
      if (live.size > 200) live.delete(live.keys().next().value);

      native({
        type: 'notify', id: this._id, title: this.title, body: this.body,
        tag: this.tag, icon: this.icon, silent: this.silent,
      });
      queueMicrotask(() => this._fire('show'));
    }

    _fire(type) {
      const ev = new Event(type, { cancelable: true });
      const handler = this['on' + type];
      if (typeof handler === 'function') handler.call(this, ev);
      this.dispatchEvent(ev);
    }

    close() {
      if (live.delete(this._id)) this._fire('close');
    }

    static get permission() { return 'granted'; }
    static get maxActions() { return 0; }
    static requestPermission(callback) {
      if (typeof callback === 'function') callback('granted');
      return Promise.resolve('granted');
    }
  }

  Object.defineProperty(window, 'Notification', {
    value: DesktopNotification, writable: true, configurable: true,
  });

  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      new DesktopNotification(title, options);
      return Promise.resolve();
    };
  }

  const perms = navigator.permissions;
  if (perms && perms.query) {
    const query = perms.query.bind(perms);
    perms.query = (desc) => (desc && desc.name === 'notifications')
      ? Promise.resolve(Object.assign(new EventTarget(), { name: 'notifications', state: 'granted', onchange: null }))
      : query(desc);
  }

  window.__mdeskNotificationClicked = (id) => {
    const n = live.get(id);
    if (n) n._fire('click');
  };

  // ---- Keyboard shortcut helpers -------------------------------------------

  const norm = (href) => new URL(href, location.href).pathname.replace(/\/+$/, '');

  window.__mdesk = {
    // Conversation rows in the sidebar, in on-screen order.
    chats() {
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll('a[href*="/t/"]')) {
        if (a.closest('[role="main"], [role="banner"]')) continue; // thread contents, hidden top bar
        const r = a.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const path = norm(a.href);
        if (seen.has(path)) continue;
        seen.add(path);
        out.push(a);
      }
      return out;
    },

    go(index) {
      const link = this.chats()[index];
      if (link) link.click();
    },

    step(delta) {
      const list = this.chats();
      if (!list.length) return;
      const current = norm(location.href);
      let i = list.findIndex((a) => norm(a.href) === current);
      i = i < 0 ? 0 : (i + delta + list.length) % list.length;
      list[i].click();
    },

    search() {
      // The hidden Facebook top bar has its own search box, so pick the visible one.
      const el = [...document.querySelectorAll(
        'input[type="search"], input[aria-label*="Search" i], input[placeholder*="Search" i]'
      )].find((input) => !input.closest('[role="banner"]') && input.getBoundingClientRect().width > 0);
      if (!el) return false;
      el.focus();
      el.select?.();
      return true;
    },

    compose() {
      const el = document.querySelector('a[href$="/new"], a[href$="/new/"], [aria-label*="New message" i]');
      if (!el) return false;
      el.click();
      return true;
    },

    retry() { native({ type: 'retry' }); },

    applySettings,
  };
})();
