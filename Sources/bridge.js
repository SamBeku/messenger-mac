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
  const ML = `${M}[data-mdesk-messages-list]`;

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
    /* Facebook paints the bubble color behind the whole message list and leaves holes in each row
       for bubbles; scrolling fast, rows not drawn yet show that backdrop as a blue flash. Fill the
       bubbles themselves instead (solid accent) and drop the backdrop. */
    ${M}[data-mdesk-accent] [role="main"] [style*="--chat-outgoing-message-background-gradient"] {
      --chat-outgoing-message-bubble-background-color: var(--mdesk-accent) !important;
    }
    ${M}[data-mdesk-accent] [role="main"] [style*="--chat-outgoing-message-background-gradient"][style*="background-image"] {
      background-image: none !important;
    }

    /* Compact chat list */
    ${M}[data-mdesk-compact] ${LIST} [role="grid"] { zoom: 0.85; }

    /* Messages-style chat list: time at the top right, two lines of preview, hairlines between
       chats, the open chat in the accent color. The parts are tagged by markChats(). */
    ${ML} [data-mdesk-chat="text"] { position: relative !important; }
    ${ML} [data-mdesk-chat="name"] { padding-right: 52px !important; box-sizing: border-box; }
    ${ML} [data-mdesk-chat="age"] { position: absolute !important; top: 3px; right: 0; }
    ${ML} [data-mdesk-chat="age-sep"] { display: none !important; }
    ${ML} [data-mdesk-chat="subtitle"] { height: auto !important; align-items: flex-start !important; }
    ${ML} [data-mdesk-chat="preview"], ${ML} [data-mdesk-chat="preview"] * { white-space: normal !important; }
    ${ML} [data-mdesk-chat="preview"] {
      display: -webkit-box !important; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden !important;
    }
    /* Facebook trims each line's spacing with negative-margin pseudo-elements; clipped to two lines,
       that cuts off the bottom of the letters */
    ${ML} [data-mdesk-chat="preview"]::before, ${ML} [data-mdesk-chat="preview"]::after,
    ${ML} [data-mdesk-chat="preview"] *::before, ${ML} [data-mdesk-chat="preview"] *::after { display: none !important; }
    ${ML} ${LIST} [role="row"] a[href*="/t/"]::after {
      content: ''; position: absolute; left: 76px; right: 8px; bottom: 0; pointer-events: none;
      border-bottom: 1px solid color-mix(in srgb, var(--primary-text) 10%, transparent);
    }
    ${ML} ${LIST} [role="row"] a[aria-current="page"]::after { display: none; }
    ${ML} ${LIST} a[aria-current="page"] { background-color: var(--accent) !important; border-radius: 10px !important; }
    ${ML} ${LIST} a[aria-current="page"] :is(span, abbr) { color: #fff !important; }

    /* Facebook's "…" button on chats: right-click a chat instead. Invisible, so the app can still press it. */
    ${M} [data-mdesk-chat="more"] { opacity: 0 !important; pointer-events: none !important; }

    /* Pinned chats: a grid of big avatars above the list, like Messages */
    ${M} [data-mdesk-pinned] { display: none !important; }
    .mdesk-pins { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 6px; padding: 2px 12px 10px; }
    .mdesk-pin {
      position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
      min-width: 0; padding: 8px 4px 7px; border-radius: 12px;
    }
    .mdesk-pin:hover { background: var(--hover-overlay); }
    .mdesk-pins { position: relative; }
    .mdesk-pins.mdesk-sorting .mdesk-pin:not(.mdesk-current) { background: none; }
    .mdesk-pin.mdesk-dragging { z-index: 1; scale: 1.06; transition: scale 0.15s; }
    .mdesk-pin.mdesk-current { background: var(--accent); }
    .mdesk-pin-avatar {
      position: relative; width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center;
      background: var(--secondary-button-background); color: var(--primary-text);
      font: 600 26px -apple-system, system-ui, sans-serif;
    }
    .mdesk-pin-avatar:has(img) { background: none; }
    .mdesk-pin-avatar img { position: absolute; border-radius: 50%; aspect-ratio: 1; object-fit: cover; }
    .mdesk-pin-name {
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font: 12px/1.25 -apple-system, system-ui, sans-serif; color: var(--secondary-text);
    }
    .mdesk-current .mdesk-pin-name { color: #fff; }
    .mdesk-pin-unread {
      position: absolute; top: 10px; left: 8px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent);
    }

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
  // Facebook's icons in the chat header and next to the message box, swapped for SF Symbols drawn
  // by the app (PageSymbols.swift): gray like Messages' toolbar, the accent color for send and like.
  const ICONS = [
    ['Start a voice call', 'phone.fill'],
    ['Start a video call', 'video.fill'],
    ['Conversation information', 'info.circle'],
    ['Open more actions', 'plus.circle.fill', 22],
    ['Send a voice clip', 'mic.fill'],
    ['Attach a file', 'photo.on.rectangle'],
    ['Choose a sticker', 'face.smiling.inverse'],
    ['Choose a GIF', 'play.square.stack'],
    ['Choose an emoji', 'face.smiling'],
    ['Send a like', 'hand.thumbsup.fill', 20, true],
    ['Press enter to send', 'arrow.up.circle.fill', 26, true],
  ];
  const iconStyles = () => ICONS.map(([label, symbol, size = 20, accent = false]) => {
    const url = window.__mdeskSymbols?.[symbol];
    if (!url) return '';
    const button = `${M} [role="main"] [role="button"][aria-label^="${label}"]`;
    return `
      ${button} { position: relative; }
      ${button} svg { visibility: hidden !important; }
      ${button}::after {
        content: ''; position: absolute; inset: 0; margin: auto; width: ${size}px; height: ${size}px; pointer-events: none;
        background-color: ${accent ? 'var(--accent)' : 'var(--secondary-icon)'};
        -webkit-mask: url("${url}") center / contain no-repeat;
      }`;
  }).join('');

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

    if (grid) markChats(grid);

    // Info panel: close it once per chat, so the ⓘ button can still open it on purpose.
    if (settings.closeInfoPanel && infoPanelHandledFor !== location.pathname) {
      const button = document.querySelector('[role="main"] [aria-label="Conversation information"]');
      if (button) {
        infoPanelHandledFor = location.pathname;
        if (button.getAttribute('aria-expanded') === 'true') button.click();
      }
    }
  };

  // ---- Chat list: Messages-style rows and pinned chats -----------------------------------
  // Facebook has no pinned chats, so the app keeps its own list (window.__mdeskPins, saved by
  // savePins in main.swift): each pin remembers the chat's name and avatar, refreshed whenever its
  // row is in the list. The pinned rows stay in the list, hidden, so a pin opens its chat by
  // clicking the real row.

  const MAX_PINS = 9;
  let pins = Array.isArray(window.__mdeskPins) ? window.__mdeskPins : [];
  const savePins = () => native({ type: 'pins', pins });
  const isPinned = (path) => pins.some((pin) => pin.path === path);

  // A row's chat: where it leads, its name, avatar (one photo, or two overlapping for a group
  // without one, as fractions of the avatar's size) and whether it's unread (bold name).
  const readChat = (row) => {
    const link = row.querySelector('a[href*="/t/"]');
    const name = link?.querySelector('span[dir="auto"]');
    if (!name) return null;
    const box = link.getBoundingClientRect();
    const photos = [...link.querySelectorAll('img')]
      .map((img) => [img, img.getBoundingClientRect()])
      .filter(([, r]) => r.width >= 24 && r.left - box.left < 80); // not the "seen" heads or badges
    const left = Math.min(...photos.map(([, r]) => r.left));
    const top = Math.min(...photos.map(([, r]) => r.top));
    const size = Math.max(...photos.map(([, r]) => Math.max(r.right - left, r.bottom - top)));
    const label = name.querySelector('span') || name;
    return {
      row, link, name,
      path: norm(link.href),
      title: name.textContent.trim(),
      avatar: photos.map(([img, r]) => ({
        src: img.currentSrc || img.src, x: (r.left - left) / size, y: (r.top - top) / size, size: r.width / size,
      })),
      unread: Number(getComputedStyle(label).fontWeight) >= 600,
    };
  };

  // Tags a row's parts for the Messages-style CSS: name, then a subtitle of preview · time (· nudge).
  const tagRow = (chat) => {
    // Facebook's "…" button: invisible, still there for the right-click menu to use.
    const more = chat.row.querySelectorAll('[role="gridcell"]')[1];
    if (more) more.dataset.mdeskChat = 'more';
    const text = chat.name.parentElement;
    const subtitle = text.lastElementChild;
    if (subtitle === chat.name) return;
    text.dataset.mdeskChat = 'text';
    chat.name.dataset.mdeskChat = 'name';
    subtitle.dataset.mdeskChat = 'subtitle';
    const [preview, separator, age] = subtitle.children;
    if (preview) preview.dataset.mdeskChat = 'preview';
    if (age && separator.textContent.trim() === '·') {
      separator.dataset.mdeskChat = 'age-sep';
      age.dataset.mdeskChat = 'age';
    }
  };

  let pinsBox = null;
  let pinsDrawn = '';

  const drawPins = (grid, chats) => {
    const panel = grid.closest('[role="tabpanel"]') || grid;
    if (!pins.length) {
      pinsBox?.remove();
      pinsDrawn = '';
      return;
    }
    if (!pinsBox) {
      pinsBox = Object.assign(document.createElement('div'), { className: 'mdesk-pins' });
      pinsBox.addEventListener('mousedown', startPinDrag);
      pinsBox.addEventListener('click', (event) => {
        const tile = event.target.closest('.mdesk-pin');
        if (tile) openChat(tile.dataset.path);
      });
    }
    if (pinsBox.nextElementSibling !== panel) panel.before(pinsBox);

    const current = norm(location.href);
    const state = JSON.stringify([pins, current, pins.map((pin) => chats.get(pin.path)?.unread)]);
    if (state === pinsDrawn || pinDrag) return; // not mid-drag: that would drop the tile being dragged
    pinsDrawn = state;
    pinsBox.replaceChildren(...pins.map((pin) => {
      const tile = Object.assign(document.createElement('div'), { className: 'mdesk-pin' });
      tile.dataset.path = pin.path;
      tile.classList.toggle('mdesk-current', pin.path === current);
      const avatar = add(tile, 'mdesk-pin-avatar');
      avatar.textContent = [...pin.title][0] || '';
      for (const part of pin.avatar) {
        const img = avatar.appendChild(document.createElement('img'));
        img.src = part.src;
        img.draggable = false;
        img.onerror = () => img.remove(); // an old photo link; the row brings a fresh one
        Object.assign(img.style, { left: `${part.x * 100}%`, top: `${part.y * 100}%`, width: `${part.size * 100}%` });
      }
      if (chats.get(pin.path)?.unread) add(tile, 'mdesk-pin-unread');
      add(tile, 'mdesk-pin-name').textContent = pin.title;
      return tile;
    }));
  };

  // Dragging a pin reorders the pins: the dragged one follows the pointer, the others slide out of its
  // way, and the new order is saved on drop. A press without moving stays a click.
  let pinDrag = null;
  const SLIDE = { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };

  // Where a tile's grid slot is on screen (offsetLeft/Top ignore the drag's transform).
  const slotOf = (tile) => {
    const box = pinsBox.getBoundingClientRect();
    return { left: box.left + tile.offsetLeft, top: box.top + tile.offsetTop };
  };

  const startPinDrag = (event) => {
    const tile = event.button === 0 && event.target.closest('.mdesk-pin');
    if (!tile) return;
    event.preventDefault(); // no text selection or image drag
    const slot = slotOf(tile);
    const press = { tile, x: event.clientX, y: event.clientY, grabX: event.clientX - slot.left, grabY: event.clientY - slot.top };
    let frame = 0;
    let pointer = null;

    const follow = () => {
      frame = 0;
      const now = slotOf(tile);
      tile.style.transform = `translate(${snap(pointer.x - press.grabX - now.left)}px, ${snap(pointer.y - press.grabY - now.top)}px)`;
      // The slot under the pointer's tile center takes the dragged pin; the others slide over (FLIP).
      const centerX = pointer.x - press.grabX + tile.offsetWidth / 2;
      const centerY = pointer.y - press.grabY + tile.offsetHeight / 2;
      const tiles = [...pinsBox.children];
      const target = tiles.reduce((best, other) => {
        const r = slotOf(other);
        const distance = Math.hypot(r.left + other.offsetWidth / 2 - centerX, r.top + other.offsetHeight / 2 - centerY);
        return distance < best.distance ? { other, distance } : best;
      }, { other: tile, distance: Infinity }).other;
      if (target === tile) return;
      const before = new Map(tiles.map((other) => [other, slotOf(other)]));
      const from = tiles.indexOf(tile);
      const to = tiles.indexOf(target);
      pinsBox.insertBefore(tile, to > from ? target.nextSibling : target);
      for (const other of tiles) {
        if (other === tile) continue;
        const was = before.get(other);
        const now = slotOf(other);
        if (was.left === now.left && was.top === now.top) continue;
        other.animate([{ transform: `translate(${was.left - now.left}px, ${was.top - now.top}px)` }, { transform: 'none' }], SLIDE);
      }
      follow(); // re-place the dragged tile from its new slot
    };

    const move = (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!pinDrag) {
        if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < 4) return;
        pinDrag = press;
        tile.classList.add('mdesk-dragging');
        pinsBox.classList.add('mdesk-sorting');
      }
      if (!frame) frame = requestAnimationFrame(follow);
    };

    const drop = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', drop, true);
      if (!pinDrag) return;
      cancelAnimationFrame(frame);
      // The click that ends a drag (fired right after this mouse-up, if at all) doesn't open the chat.
      const swallow = (e) => e.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true));
      const order = [...pinsBox.children].map((t) => t.dataset.path);
      pins = order.map((path) => pins.find((pin) => pin.path === path)).filter(Boolean);
      savePins();
      const landing = tile.animate([{ transform: tile.style.transform || 'none' }, { transform: 'none' }], SLIDE);
      tile.style.transform = '';
      tile.classList.remove('mdesk-dragging');
      landing.finished.catch(() => {}).then(() => {
        pinsBox.classList.remove('mdesk-sorting');
        pinDrag = null;
        markParts();
      });
    };

    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', drop, true);
  };

  const markChats = (grid) => {
    const chats = new Map();
    for (const row of grid.querySelectorAll('[role="row"]')) {
      const chat = readChat(row);
      if (!chat) continue;
      chats.set(chat.path, chat);
      tagRow(chat);
      row.toggleAttribute('data-mdesk-pinned', isPinned(chat.path));
    }
    let changed = false;
    for (const pin of pins) {
      const chat = chats.get(pin.path);
      if (!chat?.avatar.length) continue;
      if (chat.title !== pin.title || JSON.stringify(chat.avatar) !== JSON.stringify(pin.avatar)) {
        Object.assign(pin, { title: chat.title, avatar: chat.avatar });
        changed = true;
      }
    }
    if (changed) savePins();
    drawPins(grid, chats);
  };

  const chatRows = () => [...document.querySelectorAll(`${LIST} [role="row"]`)].map(readChat).filter(Boolean);

  const openChat = (path) => {
    const chat = chatRows().find((c) => c.path === path);
    if (chat) chat.link.click();
    else location.assign(path); // not loaded in the list: open it with a page load
  };

  // Right-click on a row or a pin: the app's chat menu (showChatMenu in main.swift), with Pin /
  // Unpin and the items of Facebook's "…" menu for that chat.
  const chatMenuButton = (path) => () => {
    const row = chatRows().find((chat) => chat.path === path)?.row;
    return row?.querySelector('[data-mdesk-chat="more"] [role="button"]') || null;
  };
  let chatMenuId = 0;

  const openChatMenu = async (target) => {
    const path = target.closest('.mdesk-pin')?.dataset.path || readChat(target.closest('[role="row"]'))?.path;
    if (!path) return;
    const id = ++chatMenuId;
    const items = (await readMenuItems(chatMenuButton(path))).filter((label) => !HIDDEN_CHAT_ITEMS.test(label));
    if (id !== chatMenuId) return; // right-clicked something else meanwhile
    native({ type: 'chatMenu', path, items, pinned: isPinned(path), full: pins.length >= MAX_PINS });
  };

  const chatAction = (path, action, label) => {
    if (action === 'item') return chooseMenuItem(chatMenuButton(path), label);
    if (action === 'unpin') {
      pins = pins.filter((pin) => pin.path !== path);
    } else if (action === 'pin' && !isPinned(path) && pins.length < MAX_PINS) {
      const chat = chatRows().find((c) => c.path === path);
      if (!chat) return;
      pins.push({ path, title: chat.title, avatar: chat.avatar });
    }
    savePins();
    markParts();
  };

  // ---- Settings (from the Settings window) ------------------------------------------

  const OPTION_ATTRIBUTES = {
    seamless: 'seamless', glass: 'glass', compact: 'compact', hideFilters: 'hide-filters', hideNudges: 'hide-nudges',
    messagesList: 'messages-list',
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

  // A menu item's title: its first text ("Unmute notifications" also says "Off until 4:35 AM").
  const itemLabel = (item) => (item.querySelector('span[dir="auto"]') || item).textContent.trim();

  // Facebook's popup menus (a message's "More", a chat's "…"), read and used without showing them.
  // `findButton` returns the button that opens the menu (or a promise of it).
  const readMenuItems = (findButton) => quietly(async () => {
    const button = await findButton();
    const menu = button && await openMenu(button);
    if (!menu) return [];
    await waitFor(() => menu.querySelector('[role="menuitem"]'), 400);
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map(itemLabel).filter(Boolean);
    closeMenus();
    await waitFor(() => !menu.isConnected, 300);
    return labels;
  });

  // Items the menus leave out, and the ones that open a popup (asked natively, see askDialog).
  const HIDDEN_MORE = /^(report|teata)/i;
  const HIDDEN_CHAT_ITEMS = /^(report|teata|view profile|vaata profiili)/i;
  const DIALOG_ITEM = /^(unsend|remove|delete|leave|mute|block|eemalda|kustuta|lahku|vaigista|blokeeri)/i;

  // `beforeClick` runs just before the item is pressed (with the menu already open).
  const clickMenuItem = (findButton, label, beforeClick) => quietly(async () => {
    const button = await findButton();
    const menu = button && await openMenu(button);
    const item = menu && await waitFor(() => [...menu.querySelectorAll('[role="menuitem"]')].find((i) => itemLabel(i) === label), 400);
    if (item) {
      beforeClick?.();
      item.click();
    } else if (menu) {
      closeMenus();
    }
  });

  // `titled`: whether the native alert shows the popup's title (unsend asks with its buttons alone).
  const chooseMenuItem = (findButton, label, titled = true) => (DIALOG_ITEM.test(label)
    ? askDialog(findButton, label, titled) : clickMenuItem(findButton, label));
  const moreButton = (message) => () => actionButton(message, MORE_BUTTON);

  // ---- Facebook's popups as native alerts ----------------------------------------------
  // Menu items that open a Facebook popup (unsend, delete, leave, mute, block…): the popup is kept
  // hidden (see hideDialogIn) and the app asks the same thing with a native alert (showConfirmation
  // in main.swift), then answers the popup. A popup with a second step (block, then confirm) is
  // asked again for that step. Anything the app can't read falls back to Facebook's own popup.

  let hideNextDialog = false;
  let hiddenDialog = null;

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

  // Runs `open` and returns the popup layer it opened, hidden; null if none appeared. `open` calls
  // the function it gets right before the step that opens the popup: Facebook's menus sit in a
  // popup layer too, and one opened on the way must not be taken for it.
  const openHidden = async (open, timeout) => {
    hiddenDialog = null;
    await open(() => { hideNextDialog = true; });
    const hidden = await waitFor(() => hiddenDialog, timeout);
    hideNextDialog = false;
    return hidden;
  };

  const DISMISS = /^(cancel|close|tühista|sulge)$/i;
  const DESTRUCTIVE = /^(unsend|remove|delete|leave|block|eemalda|kustuta|lahku|blokeeri)/i;
  const leafTexts = (el) => [...el.querySelectorAll('span')]
    .filter((s) => !s.childElementCount && s.textContent.trim()).map((s) => s.textContent.trim());
  const buttonLabel = (b) => (b.getAttribute('aria-label') || leafTexts(b)[0] || b.textContent).trim();

  // What a popup asks: a title, its choices (a list to pick from and a confirm button, or buttons),
  // and how to dismiss it. Null while it isn't ready (Facebook first shows "Loading…").
  const readDialog = (dialog) => {
    // Facebook also keeps hidden, disabled copies of some buttons (for another layout).
    const buttons = [...dialog.querySelectorAll('[role="button"], button')]
      .filter((b) => b.getAttribute('aria-disabled') !== 'true' && getComputedStyle(b).visibility !== 'hidden');
    const dismiss = buttons.find((b) => /^(cancel|tühista)$/i.test(buttonLabel(b)))
      || buttons.find((b) => /^(close|sulge)$/i.test(buttonLabel(b)));
    const radios = [...dialog.querySelectorAll('input[type="radio"]')];
    // One choice per label.
    const seen = new Set();
    const actions = buttons.filter((b) => {
      const label = buttonLabel(b);
      if (!label || DISMISS.test(label) || /^learn more/i.test(label) || seen.has(label)) return false;
      if (radios.some((radio) => b.contains(radio))) return false;
      seen.add(label);
      return true;
    });
    let choices;
    if (radios.length) {
      const confirm = actions[0];
      if (!confirm) return null;
      choices = radios.map((radio) => {
        // Its row: the radio's largest ancestor without the other choices in it; the first text is its title.
        let row = radio;
        while (row.parentElement && row.parentElement !== dialog
          && row.parentElement.querySelectorAll('input[type="radio"]').length === 1) row = row.parentElement;
        return {
          title: leafTexts(row)[0] || '',
          pick: async () => { radio.click(); await sleep(80); confirm.click(); },
        };
      });
    } else {
      choices = actions.map((b) => ({ title: buttonLabel(b), pick: () => b.click() }));
    }
    if (!choices.length) return null;
    return { dialog, title: dialog.getAttribute('aria-label') || leafTexts(dialog)[0] || '', choices, dismiss };
  };

  // The native alert's answer arrives through answerConfirm: the choice (0, 1…), or -1 for Cancel.
  let answerAlert = null;
  const askNatively = (step, titled) => new Promise((resolve) => {
    answerAlert = resolve;
    native({
      type: 'confirm',
      title: titled ? step.title : '',
      options: step.choices.map((choice) => ({ title: choice.title, destructive: DESTRUCTIVE.test(choice.title) })),
      cancel: step.dismiss && /^(cancel|tühista)$/i.test(buttonLabel(step.dismiss)) ? buttonLabel(step.dismiss) : 'Cancel',
    });
  });
  const answerConfirm = (choice) => {
    const resolve = answerAlert;
    answerAlert = null;
    resolve?.(choice);
  };

  const askDialog = async (findButton, label, titled) => {
    const first = await openHidden((watch) => clickMenuItem(findButton, label, watch), 1500);
    if (!first) return;
    const layers = [first];
    const signature = (step) => [step.title, ...step.choices.map((choice) => choice.title)].join('\n');
    let previous = '';
    try {
      for (let steps = 0; steps < 4; steps++) {
        const step = await waitFor(() => {
          for (const { layer } of layers) {
            const dialog = [...layer.querySelectorAll('[role="dialog"]')].pop();
            const read = dialog && readDialog(dialog);
            if (read && signature(read) !== previous) return read;
          }
          return null;
        }, steps ? 1500 : 4000);
        if (!step) return; // done (closed), or nothing the app can read
        previous = signature(step);
        const choice = await askNatively(step, titled);
        if (!(choice >= 0 && step.choices[choice])) {
          step.dismiss?.click();
          return;
        }
        const next = await openHidden((watch) => { watch(); return step.choices[choice].pick(); }, 600); // a next step in a new popup
        if (next) layers.push(next);
      }
    } finally {
      await waitFor(() => layers.every(({ layer }) => !layer.querySelector('[role="dialog"]')), 1500);
      for (const { restore } of layers) restore();
    }
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
    const hidden = await openHidden((watch) => {
      watch();
      [...bar.querySelectorAll('[role="button"]')].pop()?.click();
    }, 1500);
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
    const more = has(MORE_BUTTON) ? (await readMenuItems(moreButton(message))).filter((label) => !HIDDEN_MORE.test(label)) : [];
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
    else if (action === 'more') chooseMenuItem(moreButton(message), value, false);
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
  // Past the limit the messages resist more and more, without a sudden change in speed.
  const rubberBand = (distance, limit) => {
    if (distance <= limit) return distance;
    const over = distance - limit;
    return limit + over / (1 + over / (limit * 0.3));
  };
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

  // Messages only ever sit at whole screen pixels: in between, the edges between a row's
  // pieces blur and let the blue backdrop through as thin vertical lines.
  const snap = (value) => Math.round(value * devicePixelRatio) / devicePixelRatio;

  const slideMessages = (messages, offset) => {
    for (const message of messages) {
      message.style.transform = offset ? `translateX(${offset}px)` : '';
      message.style.willChange = offset ? 'transform' : ''; // moved by the GPU, no repaint per frame
    }
  };

  // Trackpad events arrive out of step with the screen, so drawing each one directly skips some
  // frames and doubles up others. Instead `to` only sets where the fingers are, and drawing happens
  // once per screen frame, easing quickly toward that spot. `release` eases back to 0, then calls done.
  const follower = (apply) => {
    let target = 0;
    let shown = 0;
    let last = 0;
    let frame = 0;
    let finish = null;
    const tick = (now) => {
      const elapsed = last ? Math.min(now - last, 50) : 16;
      last = now;
      shown += (target - shown) * (1 - Math.exp(-elapsed / (finish ? 60 : 25)));
      if (Math.abs(target - shown) < 0.25) shown = target;
      apply(snap(shown));
      if (shown !== target) {
        frame = requestAnimationFrame(tick);
        return;
      }
      frame = 0;
      finish?.();
    };
    const run = () => {
      if (frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    return {
      to: (value) => { target = value; run(); },
      release: (done) => { target = 0; finish = done; run(); },
    };
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
    const slide = (offset) => {
      slideMessages(messages, -offset);
      // 2px of overlap, so no sliver of gradient shows at the cover's edge.
      Object.assign(cover.style, { left: `${box.right - offset - 2}px`, width: `${offset + 2}px` });
      fading.style.opacity = Math.min(1, offset / TIME_WIDTH);
    };
    const motion = follower(slide);
    return {
      move: (distance) => motion.to(rubberBand(Math.max(0, -distance), TIME_WIDTH)),
      end: () => motion.release(() => { remove(); slideMessages(messages, 0); }),
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
    const slide = (offset) => {
      slideMessages([message], offset);
      cover.style.width = `${offset + 2}px`;
      const progress = Math.min(1, offset / REPLY_AT);
      fading.style.opacity = progress;
      icon.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * progress})`;
      icon.classList.toggle('mdesk-armed', offset >= REPLY_AT - 0.5);
    };
    const motion = follower(slide);
    return {
      move: (distance) => {
        const offset = rubberBand(Math.max(0, distance), REPLY_AT);
        // Armed by where the fingers are, so the trackpad clicks right away.
        if ((offset >= REPLY_AT) !== armed) {
          armed = !armed;
          if (armed) native({ type: 'haptic' }); // a click on the trackpad
        }
        motion.to(offset);
      },
      end: (completed) => {
        const reply = completed && armed;
        motion.release(() => { remove(); slideMessages([message], 0); });
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
    style.textContent = STYLES + iconStyles();
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
      const chat = event.target.closest?.(`.mdesk-pin, ${LIST} [role="row"]`);
      if (chat) {
        event.preventDefault();
        event.stopPropagation();
        return openChatMenu(chat);
      }
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
    // Pinned chats, then the conversation rows in the sidebar, in on-screen order.
    chats() {
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll('.mdesk-pin, a[href*="/t/"]')) {
        if (a.closest('[role="main"], [role="banner"]')) continue; // thread contents, hidden top bar
        const r = a.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const path = a.dataset.path || norm(a.href);
        if (!/\/t\/[^/]+$/.test(path) || seen.has(path)) continue; // a chat, not the "Chats" link (/messages/t)
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
      let i = list.findIndex((a) => (a.dataset.path || norm(a.href)) === current);
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
    chatAction,
  };
})();
