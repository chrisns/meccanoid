# Local movement tracking

The design reuses the camera/body-overlay approach from [chrisns/bsl-experiment](https://github.com/chrisns/bsl-experiment), inspected at commit `ac0aee044e24949382436d798c4cd04f4925fb9d`. That experiment uses MediaPipe Holistic 0.5. This controller independently implements a narrower Pose Landmarker pipeline for upper-body retargeting; no sign recognition is attempted and no BSL source files are copied.

The BSL project is MIT licensed, copyright 2026 Chris Nesbitt-Smith. MediaPipe Tasks Vision is Apache-2.0 licensed; its package retains the upstream license notices. Runtime dependency is pinned to `@mediapipe/tasks-vision` 1.0.1 in package-lock.json.

Sources:

- [Official Pose Landmarker web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Official model overview](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [Bundled Pose Landmarker Lite float16 model, version 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)

Bundled `assets/pose_landmarker_lite.task` SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.

All runtime JS, WASM and model requests go to the local server. Camera permission is requested only when preview starts; no video is uploaded or recorded. Inference is synchronous inside a worker, allowing browser controls to remain responsive. The runtime's generated WASM loader requires a classic worker and its IIFE bundle so that `ModuleFactory` is available.

Shoulder-relative world-space arm vectors estimate lift and swing; elbow angles estimate bend. An image-space shoulder-to-hand angle overrides depth estimates that flatten a visibly overhead arm, and reduces forward swing as the hand reaches overhead. Nose plus the widest visible ear or eye pair estimates head turn and tilt relative to the shoulders, so one hidden ear does not disable the head. Head signals use the same two-unit range as arms and elbows. The human signal's natural zero maps directly to the physically measured robot neutral. Camera preview is visually mirrored independently of the left/right retargeting option. Each visible arm and the head are handled independently: a wrist outside the frame does not discard the other arm, and the nose can provide an upper-body vertical axis when hips are not visible. Smoothing, amplitude gain, measured calibration bounds and a bounded pose sender are separate from landmark estimation. The default 50% scale maps horizontal near mid-travel, an overhead arm to the safe calibrated endpoint, and a 30-degree head tilt to the measured head limit.

This remains an approximate retargeting model rather than an anatomical calibration. All eight raw joint ranges and neutral positions were measured physically on 19 September 2026, with automatic limits inset four units. Camera occlusion, foreshortening and unusual stances can make estimates inaccurate. Confidence loss stops physical commands and reacquisition resumes them automatically.

`npm run test:camera` replays [MediaPipe's official pose demonstration video](https://mediapipe.dev/images/mobile/pose_world_landmarks.mp4) through Chrome's fake camera. The test downloads it to ignored `.local/`, verifies its SHA-256, crops it to a close Chromebook-style head-and-upper-body view with FFmpeg, then requires repeated tracked frames, joint commands and a changing 3D preview. This reproduces the previous bug in which one low-confidence wrist caused the entire visible upper body to be rejected. Install FFmpeg for this optional local integration test; set `CAMERA_SAMPLE_Y4M` to use another Y4M fixture.

For Pages, the build includes gzip camera binaries. Supporting browsers download and decompress the WASM and model concurrently in the worker; the original files remain as a compatibility fallback. Initial setup reports downloaded bytes, allows five minutes on slow connections and can be cancelled immediately. This avoids the old 30-second failure on slow first visits.
