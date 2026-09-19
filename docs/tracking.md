# Local movement tracking

The design reuses the camera/body-overlay approach from [chrisns/bsl-experiment](https://github.com/chrisns/bsl-experiment), inspected at commit `ac0aee044e24949382436d798c4cd04f4925fb9d`. That experiment uses MediaPipe Holistic 0.5. This controller independently implements a narrower Pose Landmarker pipeline for upper-body retargeting; no sign recognition is attempted and no BSL source files are copied.

The BSL project is MIT licensed, copyright 2026 Chris Nesbitt-Smith. MediaPipe Tasks Vision is Apache-2.0 licensed; its package retains the upstream license notices. Runtime dependency is pinned to `@mediapipe/tasks-vision` 1.0.1 in package-lock.json.

Sources:

- [Official Pose Landmarker web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Official model overview](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [Bundled Pose Landmarker Lite float16 model, version 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)

Bundled `assets/pose_landmarker_lite.task` SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.

All runtime JS, WASM and model requests go to the local server. Camera permission is requested only when preview starts; no video is uploaded or recorded. Inference is synchronous inside a worker, allowing browser controls to remain responsive. The runtime's generated WASM loader requires a classic worker and its IIFE bundle so that `ModuleFactory` is available.

Shoulder-relative world-space arm vectors estimate lift and swing; elbow angles estimate bend. Nose/ear landmarks approximate head turn and tilt. Capture human neutral to subtract the starting stance. Camera preview is visually mirrored independently of the left/right retargeting option. Smoothing, amplitude gain, explicit enabled joints, calibration bounds and a bounded pose sender are separate from landmark estimation.

This is a starting retargeting model, not an anatomical calibration. Hardware direction and range must be checked before enabling a joint. Confidence loss pauses body mirroring; missing head signals preserve those joints. Camera occlusion, foreshortening and unusual stances can make estimates inaccurate. The guided wiring test and conservative calibration are the next physical validation steps.
