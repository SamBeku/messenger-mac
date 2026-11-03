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

    /* Facebook's hover buttons on messages (react, reply, more): right-click a message instead.
       Invisible rather than removed, so the app can still press them and anchor their menus. */
    ${M} [role="main"] [role="article"] [role="toolbar"] { opacity: 0 !important; pointer-events: none !important; }
    /* Facebook focuses a message after some actions; its focus ring spans the whole row as a blue bar */
    ${M} [role="main"] [data-message-id]:focus-visible { outline: none !important; }
    /* The time tooltip when hovering a message (swipe left for times) */
    [data-mdesk-part="time-tooltip"] { display: none !important; }
    /* Emoji typed in the message box: Facebook paints its own picture behind an invisible real
       emoji. Drop the picture and show the real (Apple) one. */
    [data-testid="emoji"][data-lexical-text]:has(> span) {
      background-image: none !important; width: auto !important; height: auto !important;
    }
    [data-testid="emoji"][data-lexical-text] > span { color: var(--primary-text) !important; }
    /* Facebook menus the app opens behind the scenes for the right-click menu */
    html[data-mdesk-quiet] [role="menu"] { opacity: 0 !important; }

    /* Two-finger swipes: time labels, reply arrow, and the cover for the space messages slide out of */
    .mdesk-layer { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }
    .mdesk-cover { position: absolute; background: var(--messenger-card-background); }
    .mdesk-fading { position: absolute; inset: 0; opacity: 0; }
    .mdesk-time {
      position: absolute; transform: translateY(-50%); white-space: nowrap;
      font: 12px/1 -apple-system, system-ui, sans-serif; color: var(--secondary-text);
    }
    .mdesk-reply {
      position: absolute; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
      background: var(--secondary-button-background); color: var(--primary-text); transform: translateY(-50%);
    }
    .mdesk-reply svg { width: 18px; height: 18px; fill: currentColor; }
    .mdesk-reply.mdesk-armed { background: var(--accent); color: #fff; }
  `;
  const messageList = () => document.querySelector('[role="main"] [role="log"]');

  // ---- Tagging parts of the page ------------------------------------------------
  // Facebook's class names are random and change often, so parts are found by structure.

  let settings = {};
  let markingScheduled = false;
  let linkColor = null;
  let infoPanelHandledFor = null;
  let lastUnread = -1;

  const reportUnread = (count) => {
    if (count === lastUnread) return;
    lastUnread = count;
    native({ type: 'unread', count });
  };

  // The app only treats two-finger swipes as gestures inside the message list.
  let lastRegion = null;
  const reportRegion = (rect) => {
    const key = JSON.stringify(rect);
    if (key === lastRegion) return;
    lastRegion = key;
    native({ type: 'swipeRegion', rect });
  };

  const scheduleMarking = () => {
    if (markingScheduled || !onFacebook) return;
    markingScheduled = true;
    setTimeout(() => { markingScheduled = false; markParts(); }, 150);
  };

  const markParts = () => {
    if (!document.body) return;
    if (!isMessengerPath(location.pathname)) {
      reportRegion(null);
      return reportUnread(0);
    }
    const box = messageList()?.getBoundingClientRect();
    reportRegion(box?.width ? [box.left, box.top, box.width, box.height].map(Math.round) : null);

    const list = document.querySelector(`[role="navigation"]${LIST}`);
    const grid = list?.querySelector('[role="grid"]');
    const tabs = list?.querySelector('[role="tablist"]');

    // Unread chats, for the Dock badge: Messenger shows their name in bold (600; read ones are 500).
    if (grid) {
      let unread = 0;
      for (const row of grid.querySelectorAll('[role="row"]')) {
        const name = [...row.querySelectorAll('span')].find((s) => !s.childElementCount && s.textContent.trim());
        if (name && Number(getComputedStyle(name).fontWeight) >= 600) unread++;
      }
      reportUnread(unread);
    }

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

  // ---- Message actions (right-click menu) ---------------------------------------------
  // Facebook's hover buttons (react, reply, more) are hidden. Right-clicking a message opens a
  // native menu instead (see showMessageMenu in main.swift), and its choices press those buttons.

  const REPLY_BUTTON = /^(vasta|reply)/i; // "Vasta sellele sõnumile" / "Reply"
  const REACT_BUTTON = /^(reageeri|react)/i; // "Reageeri emotikoniga" / "React"
  const MORE_BUTTON = /^(rohkem|more)/i; // "Rohkem toiminguid" / "More"
  const DEFAULT_REACTIONS = ['❤️', '😆', '😮', '😢', '😡', '👍'];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (find, timeout = 800) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = find();
      if (found) return found;
      await sleep(16);
    }
    return null;
  };

  // The action buttons only exist while a message is hovered, so hover it.
  const hover = (message) => {
    const target = message.querySelector('[data-message-id]') || message;
    for (const type of ['mouseover', 'mouseenter', 'mousemove']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, view: window }));
    for (const type of ['pointerover', 'pointerenter', 'pointermove']) target.dispatchEvent(new PointerEvent(type, { bubbles: true, view: window }));
  };
  const actionButtons = (message) => [...message.querySelectorAll('[role="toolbar"] [role="button"][aria-label]')];
  const actionButton = (message, pattern) => {
    hover(message);
    return waitFor(() => actionButtons(message).find((b) => pattern.test(b.getAttribute('aria-label'))), 500);
  };

  const openMenu = async (button) => {
    const before = new Set(document.querySelectorAll('[role="menu"]'));
    button.click();
    return waitFor(() => [...document.querySelectorAll('[role="menu"]')].find((menu) => !before.has(menu)));
  };
  const closeMenus = () => (document.activeElement || document.body)
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

  // Runs `work` with Facebook's popup menus invisible (html[data-mdesk-quiet]).
  const quietly = async (work) => {
    root.setAttribute('data-mdesk-quiet', '');
    try {
      return await work();
    } finally {
      root.removeAttribute('data-mdesk-quiet');
    }
  };

  // Facebook's "More" menu for a message (remove, forward, pin, report…), read without showing it.
  const readMoreItems = (message) => quietly(async () => {
    const button = await actionButton(message, MORE_BUTTON);
    const menu = button && await openMenu(button);
    if (!menu) return [];
    await waitFor(() => menu.querySelector('[role="menuitem"]'), 400);
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()).filter(Boolean);
    closeMenus();
    await waitFor(() => !menu.isConnected, 300);
    return labels;
  });

  // "More" items the menu leaves out, and the ones that ask for confirmation (answered natively).
  const HIDDEN_MORE = /^(report|teata)/i;
  const REMOVE_ITEM = /^(unsend|remove|delete|eemalda|kustuta)/i;

  const clickMoreItem = (message, label) => quietly(async () => {
    const button = await actionButton(message, MORE_BUTTON);
    const menu = button && await openMenu(button);
    const item = menu && await waitFor(() => [...menu.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === label), 400);
    if (item) item.click();
    else if (menu) closeMenus();
  });

  const chooseMore = (message, label) => (REMOVE_ITEM.test(label) ? confirmRemoval(message, label) : clickMoreItem(message, label));

  // Unsend / remove: Facebook's confirmation dialog is kept hidden (see hideDialogIn) and the app
  // shows a native alert with the same choices, then answers Facebook's dialog.
  let hideNextDialog = false;
  let hiddenDialog = null;
  let pendingConfirm = null;

  const hideDialogIn = (node) => {
    const dialog = node.matches('[role="dialog"]') ? node : node.querySelector('[role="dialog"]');
    if (!dialog || dialog.closest('[role="banner"]')) return;
    // Its layer: the outermost ancestor not shared with the page, which also holds the dimmed backdrop.
    const page = document.querySelector('[role="main"]');
    let layer = dialog;
    while (layer.parentElement && layer.parentElement !== document.body && !layer.parentElement.contains(page)) layer = layer.parentElement;
    const previousStyle = layer.style.cssText;
    layer.style.setProperty('opacity', '0', 'important');
    layer.style.setProperty('pointer-events', 'none', 'important');
    hiddenDialog = { layer, restore: () => { layer.style.cssText = previousStyle; } };
    hideNextDialog = false;
  };

  const confirmRemoval = async (message, label) => {
    hiddenDialog = null;
    hideNextDialog = true;
    await clickMoreItem(message, label);
    const hidden = await waitFor(() => hiddenDialog, 1500);
    hideNextDialog = false;
    if (!hidden) return;

    // Facebook first shows a "Loading…" dialog; wait for the real one (its choices or its button).
    const textOf = (b) => (b.getAttribute('aria-label') || b.textContent).trim();
    const isReady = (d) => d.querySelector('input[type="radio"]')
      || [...d.querySelectorAll('[role="button"], button')].some((b) => REMOVE_ITEM.test(textOf(b)));
    const dialog = await waitFor(() => [...hidden.layer.querySelectorAll('[role="dialog"]')].find(isReady), 4000);
    if (!dialog) return hidden.restore(); // fall back to Facebook's own dialog

    const leafTexts = (el) => [...el.querySelectorAll('span')]
      .filter((s) => !s.childElementCount && s.textContent.trim()).map((s) => s.textContent.trim());
    const buttons = [...dialog.querySelectorAll('[role="button"], button')];
    const cancel = buttons.find((b) => /^(cancel|tühista)$/i.test(textOf(b)));
    const close = buttons.find((b) => /^(close|sulge)$/i.test(textOf(b)));
    const confirm = buttons.find((b) => b !== cancel && b !== close && REMOVE_ITEM.test(textOf(b)));
    const radios = [...dialog.querySelectorAll('input[type="radio"]')];
    // Each choice's row: the radio's largest ancestor without the other choices in it.
    // Its texts are a title, then an explanation.
    const options = radios.map((radio) => {
      let row = radio;
      while (row.parentElement && row.parentElement !== dialog
        && row.parentElement.querySelectorAll('input[type="radio"]').length === 1) row = row.parentElement;
      const [title = '', ...rest] = leafTexts(row);
      return { title, detail: rest.join(' ') };
    });
    const title = dialog.getAttribute('aria-label') || leafTexts(dialog)[0] || label;
    const buttonTexts = [cancel, close, confirm].filter(Boolean).map(textOf);
    const detail = options.length ? '' : leafTexts(dialog).filter((t) => t !== title && !buttonTexts.includes(t)).join('\n');

    pendingConfirm = { ...hidden, dialog, radios, confirm, dismiss: cancel || close };
    native({
      type: 'confirm', title, detail, options,
      confirm: confirm ? textOf(confirm) : label, cancel: cancel ? textOf(cancel) : 'Cancel',
    });
  };

  // The native alert's answer: which choice (0, 1…), or -1 for Cancel.
  const answerConfirm = async (choice) => {
    const pending = pendingConfirm;
    pendingConfirm = null;
    if (!pending) return;
    if (choice >= 0 && pending.confirm) {
      pending.radios[choice]?.click();
      await sleep(80);
      pending.confirm.click();
    } else {
      pending.dismiss?.click();
    }
    await waitFor(() => !pending.dialog.isConnected, 1500);
    pending.restore();
  };

  const replyTo = async (message) => (await actionButton(message, REPLY_BUTTON))?.click();

  // Quick reactions: the user's own set from Facebook's reaction bar, remembered between menus.
  const withEmojiStyle = (emoji) => (/^[\u{2000}-\u{2BFF}]$/u.test(emoji) ? `${emoji}\u{FE0F}` : emoji); // ❤ → ❤️
  const sameEmoji = (a, b) => a.replace(/\u{FE0F}/gu, '') === b.replace(/\u{FE0F}/gu, '');
  let reactionsStale = (() => {
    try { return !localStorage.getItem('mdesk-reactions'); } catch { return true; }
  })();

  const quickReactions = () => {
    try {
      return JSON.parse(localStorage.getItem('mdesk-reactions')) || DEFAULT_REACTIONS;
    } catch {
      return DEFAULT_REACTIONS;
    }
  };

  const rememberReactions = (menu) => {
    const current = [...menu.querySelectorAll('[role="menuitemradio"] img[alt]')].map((img) => withEmojiStyle(img.alt));
    if (!current.length) return;
    reactionsStale = false;
    try { localStorage.setItem('mdesk-reactions', JSON.stringify(current)); } catch {}
  };

  // Opens Facebook's reaction bar for a message behind the scenes, then hands it to `work`.
  const withReactionBar = (message, work) => quietly(async () => {
    const button = await actionButton(message, REACT_BUTTON);
    const menu = button && await openMenu(button);
    if (!menu) return;
    await waitFor(() => menu.querySelector('[role="menuitemradio"]'), 400);
    rememberReactions(menu);
    if (await work(menu)) return;
    closeMenus();
    await waitFor(() => !menu.isConnected, 300);
  });

  // Facebook's full emoji picker ("Show more emojis" in the reaction bar), kept hidden (see hideDialogIn).
  const openPicker = async (bar) => {
    hiddenDialog = null;
    hideNextDialog = true;
    [...bar.querySelectorAll('[role="button"]')].pop()?.click();
    const hidden = await waitFor(() => hiddenDialog, 1500);
    hideNextDialog = false;
    if (!hidden) return null;
    const close = async () => {
      if (hidden.layer.querySelector('[role="dialog"]')) closeMenus();
      await waitFor(() => !hidden.layer.querySelector('[role="dialog"] img[alt]'), 1000);
      hidden.restore();
    };
    // The grid's scrolling box.
    const scroller = await waitFor(() => {
      let el = hidden.layer.querySelector('[role="dialog"] img[alt]');
      while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      return el;
    }, 2000);
    if (!scroller) {
      await close();
      return null;
    }
    return { scroller, close };
  };

  // The picker only draws the emoji in view, so walk it a screen at a time between two scroll positions.
  // `visit` returns true to stop early.
  const scanPicker = async (scroller, visit, from = 0, to = Infinity) => {
    for (let y = Math.max(0, from); y <= Math.min(to, scroller.scrollHeight); y += scroller.clientHeight * 0.9) {
      scroller.scrollTop = y;
      await sleep(40);
      if (visit()) return true;
    }
    return false;
  };

  // Where each emoji sits in the picker, saved by readEmojiCatalog so reacting can jump straight to it.
  const pickerPositions = () => {
    try {
      return JSON.parse(localStorage.getItem('mdesk-emoji-positions')) || {};
    } catch {
      return {};
    }
  };

  // Reacts with any emoji: from Facebook's six in the reaction bar, or else from the hidden full picker.
  const react = (message, emoji) => withReactionBar(message, async (bar) => {
    const quick = [...bar.querySelectorAll('[role="menuitemradio"]')]
      .find((item) => sameEmoji(item.querySelector('img')?.alt || '', emoji));
    if (quick) {
      quick.click();
      return true;
    }
    const picker = await openPicker(bar);
    if (!picker) return true;
    const { scroller } = picker;
    let found = null;
    const look = () => (found = [...scroller.querySelectorAll('img[alt]')].find((img) => sameEmoji(img.alt, emoji)));
    const near = pickerPositions()[emoji];
    if (near !== undefined) await scanPicker(scroller, look, near - scroller.clientHeight, near + scroller.clientHeight);
    if (!found) await scanPicker(scroller, look);
    found?.closest('[role="button"], button')?.click();
    await picker.close();
    return true;
  });

  // Facebook's emoji catalog for the app's reaction customizer: every emoji in the full picker, by
  // category (Smileys & People, Animals & Nature…). Read once; the app keeps it.
  const readEmojiCatalog = async (message) => {
    let categories = null;
    await withReactionBar(message, async (bar) => {
      const picker = await openPicker(bar);
      if (!picker) return true;
      const { scroller } = picker;
      const headings = new Map(); // position → category name
      const spots = [];
      await scanPicker(scroller, () => {
        const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
        for (const h of scroller.querySelectorAll('[role="heading"]')) {
          headings.set(Math.round(h.getBoundingClientRect().top - base), h.textContent.trim());
        }
        for (const img of scroller.querySelectorAll('img[alt]')) {
          const b = img.getBoundingClientRect();
          spots.push({ emoji: img.alt, top: Math.round(b.top - base), left: Math.round(b.left) });
        }
      });
      await picker.close();

      // Each emoji belongs to the heading above it; the first heading is "Your reactions", which is skipped.
      const sortedHeadings = [...headings].sort((a, b) => a[0] - b[0]);
      const byCategory = new Map();
      const positions = {};
      spots.sort((a, b) => a.top - b.top || a.left - b.left);
      for (const spot of spots) {
        const index = sortedHeadings.findLastIndex(([top]) => top <= spot.top);
        if (index <= 0 || spot.emoji in positions) continue;
        positions[spot.emoji] = spot.top;
        const name = sortedHeadings[index][1];
        if (!byCategory.has(name)) byCategory.set(name, []);
        byCategory.get(name).push(spot.emoji);
      }
      try { localStorage.setItem('mdesk-emoji-positions', JSON.stringify(positions)); } catch {}
      categories = [...byCategory].map(([name, emoji]) => ({ name, emoji }));
      return true;
    });
    native({ type: 'emojiCatalog', categories: categories || [] });
  };

  // The message's label is "At 23:43, Alex: text" ("Kell 23:43, …"); unlike the bubble, it has real emoji.
  const messageText = (message) => {
    const label = message.querySelector('[data-message-id][aria-label]')?.getAttribute('aria-label') || '';
    return label.match(/^[^,]*\d{1,2}[:.]\d{2}[^,]*,[^:]*:\s*([\s\S]*)$/)?.[1].trim() || '';
  };

  let menuMessage = null;
  let menuId = 0;

  const openMessageMenu = async (message) => {
    const id = ++menuId;
    menuMessage = message;
    hover(message);
    const buttons = (await waitFor(() => actionButtons(message).length && actionButtons(message), 400)) || [];
    const has = (pattern) => buttons.some((b) => pattern.test(b.getAttribute('aria-label')));
    if (has(REACT_BUTTON) && reactionsStale) await withReactionBar(message, () => false);
    const more = has(MORE_BUTTON) ? (await readMoreItems(message)).filter((label) => !HIDDEN_MORE.test(label)) : [];
    if (id !== menuId) return; // right-clicked something else meanwhile
    native({
      type: 'messageMenu', id, reply: has(REPLY_BUTTON),
      reactions: has(REACT_BUTTON) ? quickReactions() : [], text: messageText(message), more,
    });
  };

  const messageAction = (id, action, value) => {
    const message = id === menuId ? menuMessage : null;
    if (!message?.isConnected) return;
    if (action === 'reply') replyTo(message);
    else if (action === 'react') react(message, value);
    else if (action === 'emoji-catalog') readEmojiCatalog(message);
    else if (action === 'more') chooseMore(message, value);
  };

  // ---- Apple emoji, and no time tooltip ---------------------------------------------------
  // Facebook draws emoji as images of its own set, with the emoji itself as the alt text.
  // Each one is swapped for an image drawn with Apple's emoji font as soon as it appears.

  const FB_EMOJI = 'img[src*="/images/emoji.php/"]';
  const IS_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u;
  const appleEmojiImages = new Map();
  const appleEmoji = (emoji) => {
    if (!appleEmojiImages.has(emoji)) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" font-size="88"'
        + ` text-anchor="middle" dominant-baseline="central" font-family="Apple Color Emoji">${emoji}</text></svg>`;
      appleEmojiImages.set(emoji, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    return appleEmojiImages.get(emoji);
  };
  // Typed emoticons keep what was typed as their alt text.
  const EMOTICONS = {
    '(Y)': '👍', '(y)': '👍', '<3': '❤️', ':)': '🙂', ':-)': '🙂', ':(': '🙁', ':-(': '🙁', ':D': '😃', ':-D': '😃',
    ';)': '😉', ';-)': '😉', ':P': '😛', ':-P': '😛', ':p': '😛', ':O': '😮', ':-O': '😮', ':o': '😮', ":'(": '😢',
  };
  const swapEmoji = (img) => {
    const emoji = EMOTICONS[img.alt] || img.alt;
    if (!IS_EMOJI.test(emoji) || /[<&]/.test(emoji)) return;
    img.removeAttribute('srcset');
    img.src = appleEmoji(emoji);
  };

  // Hovering a message shows its time in a tooltip; swiping left shows times instead.
  const TIME = /\d{1,2}[:.]\d{2}/;
  const checkTooltip = (tooltip) => {
    const text = tooltip.textContent;
    if (text.length <= 40 && TIME.test(text)) tooltip.dataset.mdeskPart = 'time-tooltip';
    else if (tooltip.dataset.mdeskPart === 'time-tooltip') delete tooltip.dataset.mdeskPart;
  };

  // Runs right after every DOM change, before the page is drawn, so nothing flashes.
  const onDomChange = (records) => {
    for (const record of records) {
      const target = record.target;
      if (record.type === 'attributes') {
        if (target.matches(FB_EMOJI)) swapEmoji(target);
        continue;
      }
      const tooltip = (target.nodeType === 1 ? target : target.parentElement)?.closest('[role="tooltip"]');
      if (tooltip) checkTooltip(tooltip);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (hideNextDialog) hideDialogIn(node);
        for (const el of [node, ...node.querySelectorAll(`${FB_EMOJI}, [role="tooltip"]`)]) {
          if (el.matches(FB_EMOJI)) swapEmoji(el);
          else if (el.matches('[role="tooltip"]')) checkTooltip(el);
        }
      }
    }
  };

  // ---- Two-finger swipes in a chat ---------------------------------------------------
  // The app reads the trackpad (MessengerWebView) and calls swipe() with how far the fingers
  // moved: left slides the messages over to show their times, right on a message replies to it.

  const TIME_WIDTH = 72; // how far messages slide to show their times
  const REPLY_AT = 60; // how far to swipe before letting go replies
  const rubberBand = (distance, limit) => (distance <= limit ? distance : limit + (distance - limit) * 0.15);
  let gesture = null;

  // A message's label starts with its time: "Kell 23:29, Alex: …" ("At 23:29, …").
  const messageTime = (message) => {
    const label = message.querySelector('[data-message-id][aria-label]')?.getAttribute('aria-label') || '';
    const match = label.match(/^(.*?\d{1,2}[:.]\d{2})/);
    return match ? match[1].replace(/^(kell|at)\s+/i, '') : null;
  };

  const add = (parent, className) => parent.appendChild(Object.assign(document.createElement('div'), { className }));

  // Facebook paints the bubble gradient behind the whole list and lets each row mask it, so the
  // strip a row slides out of needs covering. The cover stays fully opaque (only what sits on it
  // fades) and moves with the same timing as the messages, or the blue would show through.
  const gestureLayer = (box, list) => {
    const layer = add(document.body, 'mdesk-layer');
    const cover = add(layer, 'mdesk-cover');
    const rowColor = getComputedStyle(list).getPropertyValue('--mwp-message-row-background').trim();
    if (rowColor) cover.style.background = rowColor;
    Object.assign(cover.style, { top: `${box.top}px`, height: `${box.height}px` });
    const fading = add(layer, 'mdesk-fading');
    return { cover, fading, remove: () => layer.remove() };
  };

  // Messages only ever sit at whole pixels: at fractional positions the edges between a row's
  // pieces blur and let the blue backdrop through as thin vertical lines.
  const slideMessages = (messages, offset) => {
    for (const message of messages) message.style.transform = offset ? `translateX(${offset}px)` : '';
  };

  // Eases from `from` back to 0 over 250ms, a whole pixel at a time (CSS transitions would pass
  // through fractional positions).
  const settle = (from, apply, done) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / 250);
      apply(Math.round(from * (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  };

  const showTimes = (list) => {
    const box = list.getBoundingClientRect();
    const { cover, fading, remove } = gestureLayer(box, list);
    const messages = [...list.querySelectorAll('[role="article"]')].filter((message) => {
      const r = message.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom;
    });
    for (const message of messages) {
      const r = message.getBoundingClientRect();
      const middle = r.top + r.height / 2;
      const time = messageTime(message);
      if (!time || middle < box.top || middle > box.bottom) continue;
      const label = add(fading, 'mdesk-time');
      label.textContent = time;
      Object.assign(label.style, { top: `${middle}px`, right: `${innerWidth - box.right + 12}px` });
    }
    let current = 0;
    const slide = (offset) => {
      current = offset;
      slideMessages(messages, -offset);
      // 2px of overlap, so no sliver of gradient shows at the cover's edge.
      Object.assign(cover.style, { left: `${box.right - offset - 2}px`, width: `${offset + 2}px` });
      fading.style.opacity = Math.min(1, offset / TIME_WIDTH);
    };
    return {
      move: (distance) => slide(Math.round(rubberBand(Math.max(0, -distance), TIME_WIDTH))),
      end: () => settle(current, slide, () => { remove(); slideMessages(messages, 0); }),
    };
  };

  const swipeToReply = (message, list) => {
    const box = list.getBoundingClientRect();
    const r = message.getBoundingClientRect();
    const { cover, fading, remove } = gestureLayer(box, list);
    // Only this message moves, so only its row needs covering.
    const top = Math.max(r.top, box.top);
    Object.assign(cover.style, { left: `${box.left}px`, top: `${top}px`, height: `${Math.min(r.bottom, box.bottom) - top}px` });
    const icon = add(fading, 'mdesk-reply');
    // Line up with what the message shows (text, photo, sticker, video, big emoji), not the row,
    // which also holds reactions and reply quotes. The lowest one on screen is the message itself
    // ("X replied to Y" and the quote sit above it, in any page order). Skipped: empty elements,
    // avatars (28px) and reaction emoji (16px).
    const bubble = [...message.querySelectorAll('[data-message-id] :is([dir="auto"], img, video, [role="img"])')]
      .map((el) => [el, el.getBoundingClientRect()])
      .filter(([el, b]) => b.width > 0 && b.height > 0 && (el.matches('[dir="auto"]') || (b.width >= 32 && b.height >= 32)))
      .map(([, b]) => b)
      .reduce((lowest, b) => (!lowest || b.bottom > lowest.bottom ? b : lowest), null) || r;
    const svg = icon.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.appendChild(document.createElementNS(svg.namespaceURI, 'path'))
      .setAttribute('d', 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z');
    Object.assign(icon.style, {
      left: `${box.left + 14}px`,
      top: `${Math.min(Math.max(bubble.top + bubble.height / 2, box.top + 20), box.bottom - 20)}px`,
    });

    let armed = false;
    let current = 0;
    const slide = (offset) => {
      current = offset;
      slideMessages([message], offset);
      cover.style.width = `${offset + 2}px`;
      const progress = Math.min(1, offset / REPLY_AT);
      fading.style.opacity = progress;
      icon.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * progress})`;
      if ((offset >= REPLY_AT) !== armed) {
        armed = !armed;
        icon.classList.toggle('mdesk-armed', armed);
        if (armed) native({ type: 'haptic' }); // a click on the trackpad
      }
    };
    return {
      move: (distance) => slide(Math.round(rubberBand(Math.max(0, distance), REPLY_AT))),
      end: (completed) => {
        const reply = completed && armed;
        settle(current, slide, () => { remove(); slideMessages([message], 0); });
        if (reply) replyTo(message);
      },
    };
  };

  const swipe = (phase, distance, x, y) => {
    if (phase === 'began') {
      gesture?.end(false);
      gesture = null;
      const list = messageList();
      if (!list) return;
      if (distance < 0) {
        gesture = showTimes(list);
      } else {
        const message = document.elementFromPoint(x, y)?.closest('[role="article"]');
        if (message && list.contains(message)) gesture = swipeToReply(message, list);
      }
    }
    if (!gesture) return;
    if (phase === 'ended' || phase === 'cancelled') {
      gesture.end(phase === 'ended');
      gesture = null;
    } else {
      gesture.move(distance);
    }
  };

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
    window.addEventListener('resize', scheduleMarking); // keeps the swipe area current
    new MutationObserver(scheduleMarking).observe(root, { childList: true, subtree: true });
    new MutationObserver(onDomChange).observe(root, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'],
    });

    // Right-clicking a message opens the app's message menu. A right-click on text selects the
    // word under the pointer before `contextmenu` fires, so note any real selection on mouse-down.
    let selectedBeforeRightClick = false;
    window.addEventListener('mousedown', (event) => {
      if (event.button === 2) selectedBeforeRightClick = String(getSelection()).trim() !== '';
    }, true);
    window.addEventListener('contextmenu', (event) => {
      const message = event.target.closest?.('[role="main"] [role="log"] [role="article"]');
      if (!message?.querySelector('[data-message-id]')) return;
      // Selected text, links and photos keep the normal menu (Copy, Open Link, Copy Image…).
      const photo = event.target.tagName === 'IMG' && !event.target.src.startsWith('data:');
      if (selectedBeforeRightClick || event.target.closest('a[href]') || photo) return;
      event.preventDefault();
      event.stopPropagation();
      getSelection().removeAllRanges(); // the word the right-click selected
      openMessageMenu(message);
    }, true);

    // Esc leaves reply mode. Only real key presses (the app sends its own Escapes to close
    // Facebook's hidden menus), and not while one of Facebook's popups is open (Esc closes that).
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !event.isTrusted) return;
      const popupOpen = [...document.querySelectorAll('[role="menu"], [role="dialog"]')]
        .some((popup) => !popup.closest('[role="banner"]') && popup.getBoundingClientRect().width > 0);
      if (popupOpen) return;
      const cancelReply = [...document.querySelectorAll('[role="main"] [role="button"][aria-label]')]
        .find((b) => /^(cancel repl|tühista vastamine)/i.test(b.getAttribute('aria-label')));
      if (!cancelReply) return;
      event.preventDefault();
      const textbox = () => document.querySelector('[role="main"] [role="textbox"][contenteditable="true"]');
      const selection = getSelection();
      const caret = selection.rangeCount && textbox()?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange() : null;
      cancelReply.click();
      // Facebook then focuses the message that was being replied to (a blue ring around its whole
      // row); put the cursor back in the message box instead, where it was (focus() alone would put
      // it at the start of whatever is typed).
      waitFor(() => document.activeElement?.matches?.('[data-message-id]'), 300).then(() => {
        const box = textbox();
        if (!box) return;
        box.focus();
        let range = caret;
        if (!range || !box.contains(range.startContainer)) {
          range = document.createRange();
          range.selectNodeContents(box);
          range.collapse(false); // the end, if the old spot is gone
        }
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
    }, true);

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
    swipe,
    messageAction,
    answerConfirm,
  };
})();
