# Messenger for Mac

A small native macOS app (Swift + WebKit, no Electron) that runs Facebook Messenger in its own window, without the rest of Facebook.
This is a personal project and is not affiliated with or endorsed by Meta.

## Build

```bash
./build.sh            # builds build/Messenger.app
./build.sh install    # also copies it to /Applications and opens it
```

Needs only the Xcode Command Line Tools and macOS 14 or later.

**Notifications:** macOS only allows notifications for apps signed with a real certificate. The default build is "ad-hoc" signed, so notification banners won't appear until the app is signed with one.

## What it does

- Shows only Messenger. Facebook's top bar (feed, Marketplace, notifications) is hidden, and links to the rest of Facebook open in your browser.
- Uses Safari's engine, so it is light on memory and battery and doesn't trigger Facebook's "unsupported browser" page.
- Closing the window (⌘W) only hides it. The app stays connected, so it reopens instantly and new messages still arrive.
- The page is never throttled in the background, so notifications show up right away.
- Native macOS notifications show the sender's photo. Clicking one opens that chat.
- The Dock icon shows how many chats are unread. The app draws this badge itself, so it works even without notification permission.
- You stay logged in between launches.
- Links open in your default browser. Calls, file uploads and downloads (saved to ~/Downloads) work in the app.
- If you're offline, it shows a retry page and reconnects automatically when the network comes back.
- Reopens the chat you had open last.

## Settings (⌘,)

All of these are on by default and apply instantly:

- **Seamless title bar:** no gray title bar. The window buttons sit on the app, and you drag the window by the strip at the top.
- **Frosted-glass sidebar:** the chat list uses the macOS blur effect.
- **Custom accent color:** one color for your message bubbles, buttons and highlights, replacing every chat's theme. It defaults to your Mac's accent color.
- **Compact chat list:** smaller rows so more chats fit.
- **Hide filter row:** removes the All / Unread / Groups buttons.
- **Hide "Reply?" nudges:** removes Meta's "Reply?" / "Follow up?" prompts in the chat list.
- **Keep info panel closed:** closes the right-hand panel when you switch chats. The ⓘ button still opens it.
- Notifications, sound, message previews and Open at Login.

## Messages

- **Right-click a message** for a native menu laid out like Messages: your quick reactions across the top, then Reply, Edit, Forward, Copy, Pin and Unsend. Facebook's hover buttons and the time tooltip on hover are hidden.
- **Quick reactions:** 5 by default and up to 10, shown 5 per line. **+** opens Customize Reactions, where you can search and pick from all of Facebook's emoji. The list is kept by the app (Facebook itself only allows 6). Reactions outside Facebook's own six are sent through Facebook's full emoji picker behind the scenes.
- **Unsend / remove** asks with a native macOS alert instead of Facebook's popup.
- **Esc** leaves reply mode.
- **Apple emoji** instead of Facebook's in messages, the message box, the chat list, reactions and the emoji picker.

## Trackpad gestures (in a chat)

| Two-finger swipe | Action |
| --- | --- |
| Left | Slide the messages over to show when each was sent |
| Right on a message | Reply to it. Swipe until the arrow turns blue (the trackpad clicks), then let go |

Swiping no longer goes back or forward between pages.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌘N | New message |
| ⌘K | Search chats |
| ⌘1 – ⌘9 | Jump to chat 1–9 in the sidebar |
| ⌃Tab / ⌃⇧Tab (or ⌥⌘↓ / ⌥⌘↑) | Next / previous chat |
| ⌘R / ⌘⇧R | Reload / force reload |
| ⌘+ / ⌘- / ⌘0 | Zoom in / out / reset |
| ⌘W | Hide window (app keeps running) |
| ⌘Q | Quit |

## Files

- `Sources/main.swift`: the app itself (window, menus, notifications, downloads)
- `Sources/SettingsView.swift`: the Settings window
- `Sources/Appearance.swift`: turns the settings into page options, plus the title bar drag strip
- `Sources/SwipeGestures.swift`: reads two-finger swipes from the trackpad and passes them to the page
- `Sources/DockBadge.swift`: draws the unread count on the Dock icon
- `Sources/MessageMenu.swift`: the right-click menu for messages
- `Sources/ReactionCustomizer.swift`: the Customize Reactions sheet
- `Sources/bridge.js`: injected into the page. It hides the rest of Facebook, holds the CSS for each look option, routes web notifications to macOS and powers the chat shortcuts
- `Tools/make-icon.swift`: draws the app icon
- `Info.plist`: bundle settings and camera/microphone permission text
