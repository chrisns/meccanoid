# Meccanoid G15KS control studio

A JavaScript BLE library and local browser controller for the original MeccaBrain: lights, wheels, eight joints, camera mirroring, saved poses/sequences, built-in presets and a guided wiring test. The movement pad defaults to the physically verified forward/back/left/right routines for one second, with shorter durations available. Direct wheel speed control remains available separately. The BLE library has no runtime dependencies; camera tracking uses a pinned, locally served MediaPipe runtime/model. No account or cloud service is required.

## Run

```sh
npm ci
npm start
```

Open **http://localhost:8080** in desktop Chrome or Edge on the Bluetooth-equipped computer. The server binds only to the local machine. Other hosting requires HTTPS. Safari/Firefox do not provide the required Web Bluetooth API.

Use the charged robot battery, unplug USB, and wait for normal startup in Robot mode. Click **Connect robot**, select `MECCANOID …`, and press yellow if the robot asks to connect. Only one app/probe can connect at a time. Start by checking an eye colour.

## Guided system test

The **System test** panel has 38 sequential checks:

- Connection/status and red, green, blue eyes.
- Each of the four chest lights and eight servo LEDs.
- Each of the eight joint slots: read all positions, perform a visible 10-second sweep within ±24 units (or select a four-unit nudge), read feedback, and command the original pose.
- Each wheel in both directions, using 200 ms low-speed pulses, plus four verified built-in directional routines with a one-second limit.
- Each chest button, with live status-bit detection.
- Manual speaker and microphone checks. Raw microphone measurements are not available in the recovered protocol.

Press **Run this step**, observe the robot, then mark **Working**, **Wrong component**, **No response**, or **Skip**, with notes. Nothing is marked working merely because Bluetooth accepted a command. Enable motion for joint/wheel steps. Keep the wheels clear of the floor. Export the JSON report to retain observations and raw feedback. Results are also stored in local browser storage as `meccanoid.lastReport`; export before resetting a session.

The expected joint order comes from the original Android app. A wrong-component result helps identify wiring or slot-mapping differences; edit the calibration table afterwards. The test does not automatically enable joints for mirroring.

## Arms, head and mirroring

1. Read the current pose. Put the robot in a comfortable supported stance first; pose bytes are not degrees.
2. Capture that pose as neutral; this preserves existing travel limits. Manual sliders send immediately once motion is enabled, with bounded movement toward the target. The thumb keeps the requested target while the number displays the last measured/sent position.
3. Use **Measure travel by hand → Start hand capture** to request read mode (4), disarm motion and poll positions. Support the arms and first confirm that a joint moves freely; cancel if it resists. Move each joint through comfortable travel without forcing hard stops, then **Finish capture**. This saves measured min/max and the starting neutral for joints moved at least 8 units; untouched joints keep their settings. Read the pose again afterward. Read mode release still needs physical verification.
4. Check each joint using the system test or small ±4 nudges. Correct its slot, direction and limits in **Calibration**, then mark it verified for mirroring/saved poses. Changes save automatically. Manual sliders work independently of these switches. New defaults span the encoding range 24–232, not measured physical clearance. Existing saved ranges are preserved; hand capture replaces measured joints, or **Reset limits to 24–232** explicitly clears old narrow bounds. The eight mappings must use unique slots.
5. Start the camera preview. Stand where shoulders, hips, elbows and wrists are visible. Capture your neutral stance, enable robot motion, and explicitly start mirroring.

Tracking runs locally in a worker at up to 10 frames/second. Targets are smoothed, limited to calibrated ranges, and approached in steps of at most four units per update. Only enabled joints follow the camera; wheels never do. Mirror-side mode swaps left/right. Head turn/tilt are approximate estimates from face landmarks, not a precise head-pose model. Missing head landmarks leave those joints unchanged.

Loss of body tracking or a stalled camera stops mirroring and requires an explicit restart. Disarming, tab hiding, loss of window focus and disconnect cancel motion producers. **STOP & disarm** is always accessible while connected. It cancels controller movement, sends preset 8 when a robot routine has been started, and zeros wheels. This combined stop was physically verified with the directional routines; it is not a guarantee for every autonomous animation. Keep the physical power switch accessible. Browser timers and radio delivery cannot be guaranteed after a crash/disconnect.

Eye colour, servo colour and chest checkboxes send as they change; there are no Apply buttons. Experimental volume sends after a short typing pause.

Save/recall poses in local browser storage. Record up to 60 seconds of sent joint poses and export/import JSON sequences; replay applies current calibration limits. Calibration also supports JSON export/import.

## Speech and sounds

The robot reports its preset-bank and L.I.M. recording counts. **Read bank** retrieves names sequentially from the robot (INTRODUCE, JOKE, DANCE, and others). Invalid/non-printable entries are disabled. Select a built-in preset, play it, and optionally give it your own label. Generic presets may include movement, so require motion enabled and invalidate the cached pose. The verified Quiet / Medium / Loud volume controls play a preview and work without arming motion. Read pose again before using joint controls.

Use **Sync robot clock to computer** before trying TELL TIME. It sends the original app’s local-time/date format; this addition is software-tested but still awaits hardware verification. Experimental volume is available separately: 99 was sent during exploration, but its effect was not confirmed and higher values are not known to mean louder. The **Variation** field sends the original preset subcommand byte; its meaning varies by routine, and repeated JOKE variation 1 produced different jokes.

The original Android app plays custom recorded audio through the **phone's speaker**. We found no custom sound-upload, audio-streaming or text-to-speech command to the robot in the inspected app. This controller offers local computer speech synthesis and audio-file playback, clearly separate from robot presets. Computer speech requires an installed local voice. Preset 1 (INTRODUCE) physically produced “konnichiwa”; other effects are being catalogued in the hardware notes.

## Library

```js
import { Meccanoid } from './src/meccanoid.js';
const robot = new Meccanoid();
connectButton.onclick = async () => {
  await robot.connect(); // picker, FFF1 subscription, PIN reply, wheels zero
  await robot.setEyes(7, 0, 0);
};
// After deliberately enabling motion:
await robot.arm(true);
const positions = await robot.readPose();
await robot.drive(40, 40, 250);
await robot.stop();
await robot.disconnect();
```

Other methods: `moveDirection("forward" | "backward" | "left" | "right", milliseconds)`, `setExperimentalVolume(0..255)`, `setVolume(1..3)`, `syncClock(date)`, `readPresetInfo(id)`, `readPresetBank()`, `readStatus()`, `setChest(fourBooleans)`, `setServoLights(eightColourCodes)`, `setPose(eightRawBytes)`, `playPreset(id, variant = 0)`, `playLIM(slot)`, and `wake()` (original repeated-29 wake packet, firmware-dependent). Raw pose APIs do not apply studio calibration: use `MotionController` for limited movement. Motion commands require arming. Eye/servo colour codes are 0–7; wheel speeds are −255 to 255. `pose`, `status`, `armed`, `stop`, `notification`, `tx`, `notice` and `state` events expose controller activity.

`WebBluetoothTransport({withResponse:true})` enables acknowledged GATT writes; default is the original app's write-without-response path. Supply a compatible EventTarget transport to test or use another BLE backend.

## Verification

```sh
npm test
# With npm start running, and Google Chrome installed:
npm run test:browser
```

Unit tests cover wire fixtures, handshake, decoding, motion gating/cancellation, calibration, retargeting, sequence validation and diagnostic restoration/abort behavior. Browser checks use simulated Bluetooth, a fake camera and the real local MediaPipe model, exercising controls and desktop/mobile layout without touching hardware.

**Physically verified:** battery-powered handshake, status notifications, alternating red/green eyes (user confirmation, 2026-09-18, native probe). The subsequent CLI session confirmed blue eyes, chest lights, all eight joint identities, all servo/chest LEDs, directional robot routines and their combined stop, INTRODUCE/JOKE speech, and quiet/medium/loud volume previews. See [ongoing hardware observations](hardware-2026-09-18.md) for the latest component-by-component results. Browser-to-hardware mirroring still requires verification. A successful command write is not physical evidence.

Avoid reading vendor FFF5: a diagnostic read coincided with a macOS pairing-code prompt and stalled commands. The browser does not read it.

## Native diagnostic probe (macOS)

```sh
swiftc -module-cache-path /tmp/meccanoid-swift-cache tools/probe.swift -o /tmp/meccanoid-probe
/tmp/meccanoid-probe
/tmp/meccanoid-probe --lights --without-response
```

The probe connects to names containing `mecc`, subscribes and sends the app PIN handshake. `--lights` alternates red/green after acceptance. It exits after three minutes. Stop it before connecting the browser. The legacy `--wake` probe is experimental and can move arms.

See [protocol evidence](protocol.md) and [tracking sources and attribution](tracking.md).


### Persistent CLI controller

```sh
swiftc -module-cache-path /tmp/meccanoid-swift-cache tools/control.swift -o /tmp/meccanoid-control
/tmp/meccanoid-control
```

This interactive session stays connected until `quit`. Commands: `status`, `pose`, `eyes R G B`, `chest MASK`, `led SLOT CODE`, `mode 2`, `jog SLOT DELTA`, `sweep SLOT` (30-second bounded ±24-unit movement), `wheel SIDE SIGN [SPEED] [MS]` (defaults 40 / 200 ms, bounded at 100 / 500 ms), `preset ID [VARIANT]`, `stop`. `read COMMAND [ARG]` permits only known read commands. `clock` syncs local computer time; `read 29` reads it back. These clock and adjustable-wheel CLI additions are compiled for the next session; they were not loaded into the uninterrupted hardware-test connection. Read a fresh pose before joint tests, and send `mode 2` before individual jog/LED tests. `stop` cancels a continuous sweep and zeros wheels; it does not claim to cancel an autonomous preset. Keep this CLI open throughout a test session to avoid repeated pairing prompts.

The persistent CLI connection is deliberately not changed by web-app development. Release that connection before selecting the robot in the browser; only one controller should own it at a time.

Browser regressions: `npm run test:controls` checks slider snap-back, neutral bounds, instant colour and hand-capture stop/timeout/disconnect behaviour using simulated BLE. `npm run test:browser` covers the broader UI and local camera inference. These do not verify physical motor clearance or servo release.
