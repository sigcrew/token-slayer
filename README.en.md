# Token Slayer ⚔️

[한국어](README.md) · **English**

A desktop widget where **pixel heroes whose HP is your remaining AI usage** — Claude · Codex · Cursor — slash incoming code in the corner of your screen. Works on macOS and Windows.

> Formerly "Token Buddy". On first launch it migrates your old levels, achievements, settings and claude.ai login.

- Each agent (Claude · Codex · Cursor) gets its own **hero**, told apart by helmet color. Remaining usage is its **HP**.
- While you're spending tokens, code fragments fly in from the right and the hero slashes them. When idle, the hero plants the sword and rests by the **campfire**.
- Every time usage drops, one piece of code breaks through and hits the hero (`-5%`). The HP bar leaves a red trail that catches up.
- At 0% HP the hero falls and **GAME OVER** shows the time until revival (reset).
- When the limit refills, the hero drinks an **HP potion** (`+100%`).
- Hover over a hero to see the 5-hour / weekly remainder and time to reset.
- **⌘⌥S** (Ctrl+Alt+S on Windows) hides and shows the widget from anywhere, even if the menu bar icon is hidden behind the notch.
- **Size**: tray menu **Size → Adjust size…** (0.5–1.75×), or **⌥ (Option) + scroll** over the widget.
- Drag to move it. Transparent areas let clicks pass through to the window behind.

## What does it connect to? Where do tokens go?

To read your usage, Token Slayer **reads each tool's login token on this computer**. Tokens are only sent to the addresses below (each service's own domain). There is no server of mine, and the app collects no analytics.

| Destination | What for | Code |
|---|---|---|
| `api.anthropic.com/api/oauth/usage` | Claude usage (Claude Code login token) | `src/claude.js` |
| `platform.claude.com` · `console.anthropic.com` `/v1/oauth/token` | Refresh an expired Claude token | `src/claude.js` |
| `claude.ai` | Claude usage through the in-app claude.ai login window, when Claude Code isn't installed | `src/claude-web.js` |
| `chatgpt.com/backend-api/wham/usage` | Codex usage (`~/.codex/auth.json`, read-only) | `src/codex.js` |
| `cursor.com/api/usage-summary` | Cursor usage (token from Cursor's settings DB, read-only) | `src/cursor.js` |
| `api.github.com` (sigcrew/token-slayer-releases) | Update check | `src/updater.js` |
| `api.lemonsqueezy.com/v1/licenses` | Cosmetic pack license check (only if you bought one) | `src/license.js` |

- Usage requests are sent without the app's cookies (`src/nocookie.js`).
- To tell whether an agent is working, it looks only at file **times and sizes** and the **type of the last line** in Cursor's agent transcripts. It never reads your conversations (`src/watch.js`, `src/cursor.js`).
- The error log (`errors.log`) stays on this computer, with tokens and emails removed (`src/errlog.js`).
- You can verify all of this with a network monitor such as Little Snitch.

## Install

Website: **https://token-slayer.vercel.app/en/** (the download button for your computer comes first)

Installers and updates live in the public release repo [sigcrew/token-slayer-releases](https://github.com/sigcrew/token-slayer-releases/releases). This code repository is private.

| Computer | Direct download (always latest) |
|---|---|
| Mac (Apple silicon, M1+) | [TokenSlayer-mac-arm64.dmg](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-mac-arm64.dmg) |
| Mac (Intel) | [TokenSlayer-mac-x64.dmg](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-mac-x64.dmg) |
| Windows | [TokenSlayer-Setup-x64.exe](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-Setup-x64.exe) · [ARM](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-Setup-arm64.exe) · [Portable](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-Portable-x64.exe) |

- **Mac:** open the dmg, drag the app into **Applications**, and launch it. It's notarized by Apple, so it opens without warnings.
- **Windows:** not code-signed yet, so Windows shows a SmartScreen window. Click **More info → Run anyway**.

### Language

The app follows your system language (Korean or English). Change it any time from the tray menu: **Language · 언어 → Auto / 한국어 / English**.

### Auto-update

The installed app checks for a new version every hour. It downloads the update, verifies its SHA-256 checksum, then notifies you. Click the notification or **Restart to update** in the tray menu. Levels, achievements and settings are kept. You can check manually or turn auto-update off from the tray menu. On Mac the app must be in **Applications**; the portable build and `npm start` only notify.

## Run from source

Requires Node.js 20+.

```bash
npm install
npm start
```

To see the effects without any data, turn on **Demo mode** from the tray icon. On first launch a welcome guide explains what is read (no server involved), lets you pick heroes and log in, and sets notifications and auto-start. Re-open it from **Show the welcome guide again**.

## Where does usage come from?

| Service | Source | Refresh |
|---|---|---|
| **Codex** | ① With a Codex login, the ChatGPT usage lookup (server value, including usage from other devices, the web and cloud); ② otherwise `rate_limits` that Codex writes to `~/.codex/sessions/**/rollout-*.jsonl` (5-hour / weekly %) | 5 s (server: every 45 s) |
| **Claude** | ① your Claude Code login token, or ② a one-time login in the app's **claude.ai login window** (same data as the usage in claude.ai settings) | 1 min |
| **Cursor** | Dashboard usage via the login token in Cursor's settings DB (`state.vscdb`) (`cursor.com/api/usage-summary`) | 2 min |

Only services you **actually used in the last 30 days** get a gauge automatically. Turn them on or off under **Services to show** in the tray menu; **Reset to automatic** goes back to the 30-day rule.

- **Privacy:** Token Slayer has **no server of its own** and collects nothing. Tokens are only read (a refreshed Claude Code token is saved back to its original place), and conversations are never read. The hero's fight/rest animation only watches the *time* agents write files.
- **Claude** works without Claude Code: click **Log in** in the speech bubble to open a claude.ai login window; it closes itself when done. If Google sign-in is blocked, log in by email. With Claude Code installed its login is used first (macOS Keychain `Claude Code-credentials`, or `%USERPROFILE%\.claude\.credentials.json` on Windows). If a Keychain prompt appears on macOS, choose **Always Allow**. If the login expires and can't be refreshed, run `claude` in a terminal and use `/login` once.
- **Cursor** shows monthly usage, Auto/API usage and the billing reset day. If its token expires, open the Cursor app once.
- **Codex** records in the same folder for the CLI, IDE extension and app, but only when a conversation ends on *this* computer, so usage from the web, cloud or other devices isn't reflected. That's why the app also asks the server for usage with your login token (`~/.codex/auth.json`, read-only). If that fails it falls back to the last recorded value. Turn it off with **Look up Codex usage from the server** in the tray menu (then no network request is made).
- ⚠️ These are **not official public APIs**. If Claude or Codex change formats, the display may stop until the readers (`src/claude.js`, `src/codex.js`) are updated.

## Run-out forecast · HP warnings

- Using your last 30 minutes' pace, it computes when each limit hits 0%. If you'd run out before the reset, the panel shows **⏳ At this pace: empty in 1h 20m · reset in 2h 30m** and the hero row shows a red `OUT 1H20`.
- Forecasts need 3+ minutes of history and ≥ 0.5 points/hour.
- Notifications fire at **20% and 10%** remaining, with the forecast when available.

## Levels · BURNING TIME

- Heroes grow as you use your limits. Longer windows are worth more XP per 1%: **5-hour 100 · weekly 400 · monthly 1,500**. Cumulative XP to reach level L is `500 × L × (L−1)`.
- **BURNING TIME 🔥**: near a reset with lots left. Using it then gives **double XP**. Weekly: within 12 h of reset and ≥ 20% left. Monthly (Cursor): within 3 days and ≥ 20% left.
- **66 achievements** across Growth, Usage, Time & Streaks, GAME OVER, Use It All, Waste Badges, BURNING TIME, Bond, Style & Records, plus hidden ones. See them under **Achievements** in the tray menu.
- **Click the hero** for reactions; click five times in two seconds and it gets angry.
- **Weekly record card**: tray menu → **Make this week's record card** saves a pixel-style PNG to Downloads and copies it to the clipboard.

## Customization packs

Under **Customize** you can pick a hero class, enemies, rest scene and backdrop for each service. **Apply a series** dresses everything in one of six worlds: 🎌 Japan · 🐯 Korea · 🔥 Overtime Hell · 🏰 Dungeon · 🎃 Halloween · 🌃 Cyber.

| Kind | Free | Premium |
|---|---|---|
| Heroes | Hero (sword) · Mage (staff) · Archer (bow) · Pirate (pistol) · Chef (ladle) · Astronaut (raygun) · Cat (claw) · Viking (axe) | Samurai · Ninja · Musa · Dokkaebi · Demon · Paladin · Hacker · Witch · Vampire |
| Enemies | Code fragments · Bug swarm · Commit log · Notification bombs · Type errors | Legacy code · Meeting hell · Yokai · Hanyang spirits · Dungeon monsters · Cyber attacks · Ghosts & friends |
| Rest scenes | Campfire · Coffee break · Midnight ramen · Handheld console | Starry night lantern · Pavilion moonlit night · Lava hot spring · Torchlit camp · Late-night coding desk · Jack-o'-lantern |
| Backdrops | Night sky · Cherry blossoms · Terminal | Dungeon · Shrine at night · Gyeongbokgung at night · Autumn temple · Lava · Cyberpunk · Server room · Moonlit graveyard · Pumpkin patch |

Premium packs also open with levels (highest hero counts): Dungeon Lv.10 … Ninja Lv.40. Premium unlocks **Customize → Pixel resolution → High resolution (24×24)** too.

Premium is a one-time purchase via Lemon Squeezy: Customize → **Buy premium packs…** → copy the key → **Unlock with the copied license key**. The key is re-checked daily and re-locks on refund (30 days of grace offline). To move computers, use **Deactivate the license on this computer**. Only the key and `OS-CPU + random id` are sent — never your computer name.

**Make your own:** drop a JSON file into **Open my packs folder** and choose **Reload packs**. See the packs in `packs/` for the format (heroes are 12×12 character grids, with optional `hd` 24×24 art, `face`, `extras`, `fx`).

## Adding a service

Add one line to `PROVIDERS` in `src/usage.js` and write a reader whose `read()` returns:

```js
{ ok: true, windows: [{ key: 'monthly', label: 'Monthly', usedPercent: 33, resetsAt: 1790000000000 }] }
// failure: { ok: false, error: 'not-installed' | 'network' | ..., message: '...', needsLogin: true }
```

Gauges, panel and tray menu appear automatically.

## Internationalization (for contributors)

Korean sentences are the dictionary keys. Use `tr('한국어 문장 {n}', { n })` (main/src) or `T(...)` (renderer); `renderer/i18n-en.js` holds the English entries. `npm test` fails if a `tr()`/`T()` literal, achievement, pack or series name is missing from the dictionary. Static pages (`onboarding.html`, `scale.html`) are translated by `renderer/dom-i18n.js`, and the English website is generated from `site/index.html` with `site/en-map.js` by `scripts/build-site.js`.

## Contact

Questions and bug reports: [GitHub issues](https://github.com/sigcrew/token-slayer-releases/issues), or **Help · Contact → Copy diagnostics** in the tray menu and paste the result.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). You're free to read, modify and use the code and cosmetic packs for personal and other noncommercial purposes. Commercial use and resale are not permitted. Installers are on [sigcrew/token-slayer-releases](https://github.com/sigcrew/token-slayer-releases/releases).

Copyright (c) 2026 SIG Inc.
