# Robot club · Meccanoid G15KS

[![Test and publish](https://github.com/chrisns/meccanoid/actions/workflows/pages.yml/badge.svg)](https://github.com/chrisns/meccanoid/actions/workflows/pages.yml)

**A little control room for a very big robot.** Made for curious kids, Chromebook browsers, and a Meccanoid G15KS.

[Open Robot club](https://chrisns.github.io/meccanoid/) · [Try practice mode](https://chrisns.github.io/meccanoid/?practice=1) · [Protocol notes](docs/protocol.md)

![Robot club in practice mode: CNS cream, ink and pink interface with lights, movement and joke controls](docs/screenshots/play-desktop.png)

## Have a play

1. Open the app in **Chrome on your Chromebook**. Practice mode needs no robot.
2. For the real thing, charge its battery, unplug USB, and turn it on. Only one browser can control it at a time.
3. Tap **Connect robot**, choose **MECCANOID**, and press its yellow button if it asks.
4. Pick an eye colour. Tick **Ready to move** for short wheel moves or jokes with gestures. **Stop robot** stays at the top of every activity.

School-managed Chromebooks may need Bluetooth/camera permission from an administrator. Web Bluetooth requires HTTPS (provided by Pages), or localhost for development. [Chrome's supported platforms and permissions](https://developer.chrome.com/docs/capabilities/bluetooth).

## See your robot move

An interactive **3D G15KS-style robot** sits beside the controls. Drag to orbit or use Reset view. Its eight joints follow slider and keyboard targets; eye and chest colours follow light commands. Wheel commands spin the preview wheels. This is an approximate illustration, not measured mechanics or physical feedback.

In **Copy me**, turn the camera on and stand back: the 3D robot follows your tracked arms and head even without Bluetooth or arming. Capture a neutral stance after the three-second countdown to centre your movements. The real robot still needs connection, arming and verified calibration before copying.

**Keyboard:** tick Ready to move, then hold arrow keys to drive. Release to stop. Joint +/− pairs, in order: right elbow **Q/A**, right lift **W/S**, right shoulder **E/D**, left shoulder **R/F**, left lift **U/J**, left elbow **I/K**, head turn **O/L**, head tilt **P/;**. The on-page Keyboard keys guide shows every shortcut. **Esc** stops and disarms anywhere; **Space** does so outside text fields. Shortcuts pause while typing or adjusting a focused slider. Losing window focus disarms the robot.

## Five places to explore

| Activity | What it does |
| --- | --- |
| **Play** | Live eye/joint/chest lights, short directional moves, introductions, jokes, and volume controls. |
| **Arms & head** | Eight live sliders and small nudges. Targets stay put while motors catch up. |
| **Copy me** | Local camera tracking with a three-second get-ready timer. Camera preview works without a robot. |
| **Make a routine** | Named poses and up to a minute of recorded joint movements; JSON import/export. |
| **Grown-ups** | Calibration, hand capture, sound bank, clock, component checks, and connection log. |

**Movement ranges: TBC.** Joint identities and small/sustained test movements were verified, but comfortable full travel is not yet measured. Physical range capture and camera-to-robot copying await a charged robot and adult calibration. New 24–232 bounds are protocol encoding limits, not a claim of safe mechanical travel. Don't use unmeasured full-range movements as a child's starting activity.

Practice mode is explicitly labelled, uses an in-memory robot, and never requests Bluetooth. Its saved poses and calibration are separate from the real robot's. It illustrates commands; it does not simulate the robot's mechanics or verify wiring.

<table><tr><td width="30%"><img src="docs/screenshots/play-mobile.png" alt="Robot club on a narrow touch screen"></td><td><img src="docs/screenshots/copy-me.png" alt="Copy me: local camera preview and simple get-ready controls"><br><img src="docs/screenshots/arms-and-head.png" alt="Eight joint sliders and the movement ranges TBC notice"></td></tr></table>

Screenshots show the app's **practice mode**, not a connected physical robot.

## Privacy and design

No accounts, adverts, analytics, or camera uploads. Video inference runs in a browser worker; fonts, model, and runtime load from this site. Hosting still involves normal web requests to GitHub Pages. Poses/calibration stay in local browser storage unless you export them. Custom speech and audio play from the **computer**, not the robot's speaker.

Uses the actual [CNS design system](https://github.com/chrisns/design) behind [blog.cns.me](https://blog.cns.me), [talks.cns.me](https://talks.cns.me), and [govbuy.run.cns.me](https://govbuy.run.cns.me): Fraunces, Hanken Grotesk, JetBrains Mono, cream paper, warm ink, and hot pink. Large labelled controls, keyboard focus, reduced-motion support, and responsive layouts make it easier to use with fingers or a trackpad.

## Run locally

```sh
npm ci
npm start
```

Open http://localhost:8080. Requires Node.js 22+. `npm start` builds the same static artifact used on Pages. Rebuild after source edits.

```sh
npm test                 # protocol, motion, transport and diagnostic tests
npm run build            # explicit public-file allowlist → dist/
npx playwright install chromium
CI=true npm run test:controls
CI=true npm run test:browser
CI=true npm run test:preview # keyboard, stop behaviour and 3D rendering
CI=true npm run test:ui   # accessibility, responsive layouts, practice, screenshots
```

Keep the local server running during browser tests. Without `CI=true`, tests use installed Google Chrome. `APP_URL` can target a different local URL; CI serves `/meccanoid/` to catch project-path errors, including camera worker/model loading.

## CI and publishing

[GitHub Actions](.github/workflows/pages.yml) scans for secrets, installs locked dependencies, runs the unit and browser suites, checks accessibility and five screen widths, and uploads screenshots. Only a successful `main` build deploys its tested `dist/` artifact to GitHub Pages. Pull requests run checks without publishing. Actions are pinned to commit hashes; deployment uses GitHub's short-lived token, with no personal deployment secrets.

The public repo contains source, tests, documentation, screenshots, and the camera model. It excludes local session logs, environment files, dependency directories, and reverse-engineered app binaries. See [third-party notices](THIRD_PARTY.md) and [MIT licence](LICENSE).

## For tinkerers

- [JavaScript library and local CLI guide](docs/development.md)
- [Bluetooth packets and handshake](docs/protocol.md)
- [Hardware observations and verified joint map](docs/hardware-2026-09-18.md)
- [Tracking approach](docs/tracking.md)

A successful Bluetooth write is not proof of a physical response. If the browser or radio connection disappears, it cannot guarantee another stop packet will arrive. Keep the robot's power switch within reach during physical testing.
