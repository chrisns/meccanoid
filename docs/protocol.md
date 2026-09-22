# Protocol evidence and remaining work

## Sources

- [iamsrp/pymecca](https://github.com/iamsrp/pymecca/blob/master/meccanoid.py): existing Apache-2.0 Python implementation documents command byte values, payload layout, and additive checksum. This project independently implements those wire facts in JavaScript.
- Original Spin Master Android apps, statically inspected from [Neil Fraser’s preservation archive](https://neil.fraser.name/software/meccanoid/Android/): versions 1.49 and 4.02.48. Inspected `BluetoothLE` in `Assembly-CSharp.dll` and Java Bluetooth bridge. No APK or decompiled code is redistributed.
- Version 1.49 APK SHA-256: `c4413c7c1e1fadf7742bc970780ec0aeca11240722b12962ce3d3a046363b5e5`.
- [Chrome Web Bluetooth documentation](https://developer.chrome.com/docs/capabilities/bluetooth).
- [Official Robot/Drone mode guidance](https://spinmaster.helpshift.com/hc/en/6-meccanoid/section/37-drone-mode/).
- [Original G15KS manual](https://neil.fraser.name/software/meccanoid/Instructions/Meccanoid%20G15KS.pdf): battery installation/charging, normal startup, USB firmware update instructions.

## Transport

UUIDs below expand to the Bluetooth base UUID `0000xxxx-0000-1000-8000-00805f9b34fb`.

| Role | UUID | Observed properties |
| --- | --- | --- |
| Main service | FFF0 | Primary |
| Command | FFF2 | Write, write without response |
| Notifications | FFF1 | Notify |

Confirmed on the user's `MECCANOID 8A8647` on 2026-09-16. Native characteristic descriptions map FFF2 to ATT value handle 0x001f, matching pymecca. Other services include FFE0, FFE5 and TI custom services; none are used for controls or firmware writes.

## Framing

Every command is 20 bytes: command at offset 0, 17 payload bytes at offsets 1–17, big-endian sum of bytes 0–17 at offsets 18–19. Zero-fill unused payload slots except where a command specifies otherwise. This matches both pymecca and the original app's `calculateChecksum` method.

## Connection sequence

1. Connect GATT, discover FFF0/FFF2/FFF1.
2. Subscribe to FFF1.
3. Send the original `SendPIN` packet: `1a 01 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1c`.
4. Wait for notification command 0x1a. The app rejects response payload starting `00 01 ff`; otherwise it proceeds. The browser additionally validates the response's 20-byte checksum.
5. Zero wheels, then poll status command 0x01 every 500 ms. The original app polls status at roughly this interval while connected.

The original app also sets the date and requests name/config/servo state. This controller does not alter the robot's date or persistent configuration. It does not automatically send servo poses.

## Implemented commands

| Command | Meaning | Payload |
| --- | --- | --- |
| 01 | Status | Zero-filled |
| 08 | Servo pose | Eight raw positions, nine bytes of 01 (also confirmed in original app) |
| 09 | Read servo pose | Zero-filled; reply positions at wire bytes 1–8 |
| 0b | Servo control mode | Sixteen bytes of 02 for direct control, or 04 for read mode; last payload byte zero |
| 0c | Servo lights | Eight colour codes, eight bytes of 04, one 00 |
| 0d | Wheels | Left direction, right direction, left magnitude, right magnitude, ff ff, zeros |
| 11 | Eye colour | 00 00, `(green << 3) \| red`, blue, zeros |
| 15 | Play L.I.M. recording | Slot at byte 1, zeros |
| 18 | Read preset information | ID at byte 1; reply ID, duration code, up to 15 ASCII name bytes |
| 19 | Built-in preset | ID at byte 1, variant at byte 2, zeros; may include motion |
| 1a | PIN handshake | 01 00 01, zeros |
| 1c | Chest LEDs | Four booleans as 00/01, zeros |

Wheel direction is 01 forward, 02 reverse; zero-speed stop uses 02 with magnitude zero. The original app's general preset encoder uses preset ID at byte 1 and an argument at byte 2, with the rest zero. General presets use this two-byte encoding. The separate original `SendAwake` method instead calls a `SendCommand` overload that fills all 17 payload bytes with 1d; `wake()` and the native probe preserve that distinct encoding. Its effect is still unverified.

## Observations

- GATT connects and acknowledged writes succeed.
- Red/green eyes, chest lights, and wake commands produced no user-observed effect under USB-only power.
- PIN tests in both GATT write modes produced no notification or connection prompt under USB-only power.
- The user confirmed physical buttons and voice were also inactive. USB-only/update operation is the leading explanation; repeat with the charged battery pack and normal startup before changing the protocol further.
- No servo calibration, wheel movement, wake preset, heartbeat requirement, or firmware-specific acknowledgement has yet been physically validated.

## Next hardware check

With USB disconnected and charged battery installed, confirm normal startup in Robot mode. Run the handshake and accept the robot's yellow-button prompt. Verify one light change before testing a short wheel pulse or explicit servo pose. Record observed effects separately from successful Bluetooth writes.

## Battery-powered retest (2026-09-18)

The user confirmed normal startup speech with USB disconnected. GATT discovery still succeeds. Device Information reports firmware string `A0008` (this is the BLE characteristic value, not a verified main-brain firmware version). A diagnostic sweep returned FFF4=01 and FFF3=02, then stalled on FFF5; macOS displayed a pairing-code prompt. That protected read is a suspected cause, not yet proven. Removed the vendor-characteristic read sweep from the probe; optional `--read-info` now reads only standard Device Information characteristics. Retesting the normal FFF1 subscription / FFF2 PIN flow without those reads.

The clean retry succeeded: the user heard the robot request connection, and FFF1 returned PIN response `1a 01 00 01 00 ff ff ff ff ff ff ff ff ff ff ff ff ff 0d 0f`. Status commands now return valid 20-byte checksummed packets, e.g. `01 04 00 01 0a 07 00 00 00 00 07 72 04 00 14 00 00 00 00 a8`. Red/green eye commands were sent after this handshake and subsequently confirmed by the user. The browser transport already follows the clean flow and never reads FFF5.

The user confirmed alternating red/green eyes during the longer repeat test on 2026-09-18. This establishes physical BLE eye control with the recovered handshake and write-without-response mode. Other actuators remain unverified.


## Expanded controller evidence (2026-09-18)

Version 4.02.48 APK SHA-256: `6d460908d2808fe92a94cde13809bc2e9cf95ff2658a54cfd99dbacec34311ab`. Static inspection of `Assembly-CSharp.dll` recovered these facts; no APK, decompiled implementation or audio assets are redistributed.

The large-robot UI maps slots as follows. These are expected wiring identities, not physically verified calibration:

| Slot | Joint |
| --- | --- |
| 0 | Right elbow / forearm |
| 1 | Right arm side lift |
| 2 | Right shoulder forward swing |
| 3 | Left shoulder forward swing |
| 4 | Left arm side lift |
| 5 | Left elbow / forearm |
| 6 | Head turn — corrected by physical test |
| 7 | Sideways head tilt — corrected by physical test |

`getServoPos` sends 09; `setServoPos` sends 08 with eight positions and nine 01 bytes. The original float-to-servo conversion maps its nominal normalized angle range to raw 24–232. Physical hand capture on 2026-09-19 measured 24–232 for slots 0–3, 5 and 6; 24–229 for slot 4; and 67–183 for slot 7. Automatic defaults sit four units inside those observations and use neutral `[134,215,28,226,36,121,127,125]`.

Status wire offsets (including command at offset 0): byte 8 is the button bitfield (blue 1, red 2, green 4, yellow 8); byte 12 is a battery code; byte 13 is L.I.M. count; byte 14 is preset count; byte 16 is an error code. No battery percentage/voltage conversion is claimed. `FileManager.PopulatePresets` uses the reported count. Bank items are presented numerically until the user identifies them.

The original timeline's `PlayAudio` uses Unity `AudioSource.Play` with 44.1 kHz sample buffers on the phone. No arbitrary audio-upload or robot text-to-speech command was found. The known preset command can invoke firmware content. Microphone checks remain manual; no raw level stream is implemented.

The guided test reads feedback separately from asking the operator whether the intended component moved. It never equates a position reply or acknowledged write with correct wiring. Each servo test preserves the other seven read positions, uses a four-unit nudge and restores the baseline unless interrupted. Stop/disconnect cancels delayed restoration. Re-read pose after built-in routines before manual or camera control.


The 2026-09-18 sustained CLI tests found that explicit servo mode 2 enables direct joint and light control. A status query returning mode 2 by itself was not sufficient evidence. See [hardware observations and preset catalogue](hardware-2026-09-18.md). Read preset names sequentially; do not assume every entry up to the reported count contains a valid name.

### Hand-position range capture

The recovered Android `setWriteState(false)` selects servo mode 4 and reads positions, while `setWriteState(true)` selects mode 2. `beginRangeCapture()` stops/disarms, selects mode 4 and blocks pose, servo/chest light and preset writes that could change servo mode. `endRangeCapture()` removes that lock without enabling motion or sending a target; the next direct command restores mode 2. Browser capture reads command 09 sequentially every 200 ms after each reply and records observed bounds. Servo release and live hand-position feedback in mode 4 were physically confirmed during the eight-joint capture on 2026-09-19.
