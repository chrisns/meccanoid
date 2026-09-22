import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fakeRobot } from './fake-robot.js';
import { MEASURED_NEUTRAL } from '../src/joints.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const sampleURL = 'https://mediapipe.dev/images/mobile/pose_world_landmarks.mp4';
const sampleSHA256 = 'e06e2ec9a2c1e6e15de0de1bf68740b3dd5f216adb416a9015865d0c4cd164ca';
async function sampleVideo() {
  await mkdir('.local',{recursive:true});
  const mp4=resolve('.local/mediapipe-pose-sample.mp4'),y4m=resolve('.local/mediapipe-pose-close.y4m');
  let bytes;
  try{bytes=await readFile(mp4);}catch{}
  if(!bytes){
    const response=await fetch(sampleURL);
    if(!response.ok)throw new Error(`Official MediaPipe sample download failed: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());await writeFile(mp4,bytes);
  }
  if(createHash('sha256').update(bytes).digest('hex')!==sampleSHA256)throw new Error('Official MediaPipe sample changed; inspect it before updating the pinned hash');
  await promisify(execFile)('ffmpeg',['-y','-loglevel','error','-i',mp4,'-vf','crop=400:180:200:0,scale=640:480,fps=10','-pix_fmt','yuv420p',y4m]);
  return y4m;
}
const video = process.env.CAMERA_SAMPLE_Y4M?resolve(process.env.CAMERA_SAMPLE_Y4M):await sampleVideo();
const browser = await chromium.launch({
  ...(process.env.CI ? {} : { channel: 'chrome' }),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.poseVideoResults = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if (data?.type === 'result') window.poseVideoResults.push({
            pose: Boolean(data.world),
            visible: [11,12,13,14,15,16,23,24].map(i => Number((data.world?.[i]?.visibility ?? 0).toFixed(2))),
          });
        });
      }
    };
  });
  await page.addInitScript(fakeRobot);
  await page.goto(process.env.APP_URL || 'http://localhost:8080');
  await page.evaluate(neutral => window.setRobotPose(neutral), MEASURED_NEUTRAL);
  await page.locator('#connect').click();
  await page.locator('[data-view=copy]').click();
  await page.locator('#cameraStart').click();
  await page.waitForFunction(() => document.querySelector('#cameraStart').disabled && document.querySelector('#cameraStop').textContent === 'Camera off', null, { timeout: 45000 });
  const samples = [];
  for (let i = 0; i < 32; i++) {
    samples.push(await page.evaluate(() => ({
      state: document.querySelector('#cameraState').textContent,
      eyes: document.querySelector('#mirrorState').textContent,
      meters: [...document.querySelectorAll('#trackingBars meter')].map(m => Number(m.value)),
      poses: window.robotWrites.filter(p => p[0] === 8).length,
      preview: document.querySelector('#robotPreview').dataset.pose,
    })));
    await page.waitForTimeout(250);
  }
  const tracked = samples.filter(s => s.state.includes('Body tracked'));
  const poses = await page.evaluate(() => window.robotWrites.filter(p => p[0] === 8).map(p => p.slice(1, 9)));
  const modelResults = await page.evaluate(() => window.poseVideoResults);
  console.log(JSON.stringify({ trackedFrames: tracked.length, poseWrites: poses.length, states: [...new Set(samples.map(s => s.state))], modelFrames: modelResults.length, posesFound: modelResults.filter(r => r.pose).length, firstVisibilities: modelResults.find(r => r.pose)?.visible, meterPeaks: MEASURED_NEUTRAL.map((_, i) => Math.max(...samples.map(s => Math.abs(s.meters[i])))), firstPose: poses[0], lastPose: poses.at(-1), errors }));
  assert.deepEqual(errors, []);
  assert(tracked.length >= 4, 'recorded human video must produce repeated body tracking');
  assert(poses.some(p => p.some((value, slot) => Math.abs(value - MEASURED_NEUTRAL[slot]) >= 4)), 'tracked motion must produce a joint command');
  assert(new Set(samples.map(s=>s.preview).filter(Boolean)).size>=2,'recorded human movement must animate the 3D robot');
} finally {
  await browser.close();
}
