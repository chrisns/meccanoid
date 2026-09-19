// Arm mapping recovered from the app; head order corrected by physical CLI tests.
export const JOINTS = [
  { key: 'rightElbow', label: 'Right elbow', signal: 'rightElbow' },
  { key: 'rightLift', label: 'Right arm · side lift', signal: 'rightLift' },
  { key: 'rightSwing', label: 'Right shoulder · forward', signal: 'rightSwing' },
  { key: 'leftSwing', label: 'Left shoulder · forward', signal: 'leftSwing' },
  { key: 'leftLift', label: 'Left arm · side lift', signal: 'leftLift' },
  { key: 'leftElbow', label: 'Left elbow', signal: 'leftElbow' },
  { key: 'headTurn', label: 'Head · turn', signal: 'headTurn' },
  { key: 'headTilt', label: 'Head · sideways tilt', signal: 'headTilt' },
];
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export function defaultCalibration() {
  return JOINTS.map((joint, slot) => ({ key: joint.key, slot, min: 24, max: 232, centre: 128, reversed: false, enabled: false }));
}
export function validateCalibration(value) {
  if (!Array.isArray(value) || value.length !== 8) throw new Error('Calibration needs eight joints');
  const used = new Set();
  return value.map((v, i) => {
    if (v.key !== JOINTS[i].key || !Number.isInteger(v.slot) || v.slot < 0 || v.slot > 7 || used.has(v.slot)) throw new Error('Each joint must use a unique slot from 0–7');
    used.add(v.slot);
    if (![v.min,v.max,v.centre].every(Number.isInteger) || v.min < 24 || v.max > 232 || v.min >= v.max || v.centre < v.min || v.centre > v.max) throw new Error('Joint limits must contain the centre and lie within 24–232');
    if (typeof v.reversed !== 'boolean' || typeof v.enabled !== 'boolean') throw new Error('Invalid joint switches');
    return {key:v.key,slot:v.slot,min:v.min,max:v.max,centre:v.centre,reversed:v.reversed,enabled:v.enabled};
  });
}
export function calibratedPose(signals, calibration, base, gain = 0.5) {
  if (!Array.isArray(base) || base.length !== 8 || !base.every(v => Number.isInteger(v) && v>=0 && v<=255)) throw new Error('Read the current robot pose first');
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error('Gain must be 0–1');
  const next = [...base];
  for (const c of validateCalibration(calibration)) {
    if (!c.enabled || !Number.isFinite(signals[c.key])) continue;
    const signal = clamp(signals[c.key] * (c.reversed ? -1 : 1) * gain, -1, 1);
    next[c.slot] = Math.round(c.centre + signal * (signal >= 0 ? c.max-c.centre : c.centre-c.min));
  }
  return next;
}
export function stepPose(current, target, maximumStep = 4) {
  return current.map((v,i) => Math.round(v + clamp(target[i]-v,-maximumStep,maximumStep)));
}
