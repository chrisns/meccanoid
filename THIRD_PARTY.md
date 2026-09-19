# Third-party components

- [CNS design system](https://github.com/chrisns/design), MIT. Pinned to commit `0c5d2ff75a448e092d2e53539d9f65591e3b79ea`. Consumed as a dependency; the build preserves its tokens and replaces the Google Fonts import with local font files. Brand identity remains owned by Chris Nesbitt-Smith.
- Fraunces, Hanken Grotesk and JetBrains Mono, SIL Open Font License. Distributed through pinned Fontsource packages; their licence files are included beside the deployed fonts.
- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe), Apache-2.0. The browser runtime and [Pose Landmarker Lite model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) are served locally from the site. See [MediaPipe's licence](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).
- [Three.js](https://github.com/mrdoob/three.js), MIT. Locally served with OrbitControls and its licence. The articulated robot model is original procedural geometry; no third-party robot mesh or artwork is used.
- Playwright, Apache-2.0, and axe-core/Playwright, MPL-2.0, are development-only test dependencies.

No original Meccanoid APK, decompiled assembly, proprietary artwork, voice recording or firmware is included. The Bluetooth protocol is documented from observed behaviour and analysis. This is an independent project; Meccano/Meccanoid names belong to their respective owners.
