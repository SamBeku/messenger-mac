// Injected into messenger.com at document start.
// WKWebView has no Web Notifications, so we provide our own `Notification`
// that forwards to the native app, plus a few helpers for keyboard shortcuts.
(() => {
  const native = (msg) => {
    try { window.webkit.messageHandlers.native.postMessage(msg); } catch (_) {}
  };

  // ---- Messenger only -----------------------------------------------------
  // Logged-in users end up on facebook.com/messages. Hide Facebook's top bar
  // there and send links to the rest of Facebook to the browser.

  const isFacebookHost = (host) => /(^|\.)facebook\.com$/.test(host);
  const isMessengerPath = (path) => /^\/(messages|groupcall|videocall)(\/|$)/.test(path);

  if (isFacebookHost(location.hostname)) {
    const style = document.createElement('style');
    style.textContent = `
      html[data-mdesk-messenger] [role="banner"] { display: none !important; }
      html[data-mdesk-messenger],
      html[data-mdesk-messenger] .__fb-light-mode,
      html[data-mdesk-messenger] .__fb-dark-mode { --header-height: 0px !important; }
    `;
    document.documentElement.appendChild(style);

    // Only on Messenger pages, so the login screen keeps its own layout.
    const sync = () => document.documentElement.toggleAttribute('data-mdesk-messenger', isMessengerPath(location.pathname));
    sync();
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        sync();
        return result;
      };
    }
    window.addEventListener('popstate', sync);

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
  };
})();
