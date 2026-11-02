# Messenger for Mac

A small native macOS app (Swift + WebKit, no Electron) that runs Facebook Messenger in its own window, without the rest of Facebook.
This is a personal project and is not affiliated with or endorsed by Meta.

## Build

```bash
./build.sh            # builds build/Messenger.app
./build.sh install    # also copies it to /Applications and opens it
```

Needs only the Xcode Command Line Tools and macOS 14 or later.

## What it does

- Shows only Messenger. Facebook's top bar (feed, Marketplace, notifications) is hidden, and links to the rest of Facebook open in your browser.
- Uses Safari's engine, so it is light on memory and battery and doesn't trigger Facebook's "unsupported browser" page.
- Closing the window (⌘W) only hides it. The app stays connected, so it reopens instantly and new messages still arrive.
- The page is never throttled in the background, so notifications show up right away.
- Native macOS notifications show the sender's photo. Clicking one opens that chat.
- The Dock icon shows the unread count.
- You stay logged in between launches.
- Links open in your default browser. Calls, file uploads and downloads (saved to ~/Downloads) work in the app.
- If you're offline, it shows a retry page and reconnects automatically when the network comes back.
- The Messenger menu has settings for notifications, sound, message previews and Open at Login.

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
- `Sources/bridge.js`: injected into the page to route web notifications to macOS and power the chat shortcuts
- `Tools/make-icon.swift`: draws the app icon
- `Info.plist`: bundle settings and camera/microphone permission text
