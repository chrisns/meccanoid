import { stepPose, validateCalibration, clamp } from './joints.js';

/** One in-flight pose at a time. New targets replace old ones; no frame backlog. */
export class MotionController extends EventTarget {
  current = null;
  target = null;
  active = false;
  #epoch = 0;
  #sending = false;
  #timer;
  constructor(robot) {
    super(); this.robot = robot;
    robot.addEventListener('stop', () => this.cancel());
    robot.addEventListener('armed', e => { if (!e.detail) this.cancel(); });
    robot.addEventListener('state', () => { if (!robot.connected) { this.cancel(); this.current = null; } });
  }
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type,{detail})); }
  async sync() {
    this.cancel();
    const epoch = this.#epoch;
    const pose = await this.robot.readPose();
    if (epoch !== this.#epoch || !this.robot.connected) throw new Error('Pose read cancelled');
    this.current = [...pose]; this.target = [...pose];
    this.#emit('pose', [...pose]);
    return [...pose];
  }
  setTarget(positions, calibration) {
    if (!this.robot.connected || !this.robot.armed) throw new Error('Connect and enable motion first');
    if (!this.current) throw new Error('Read the robot’s current pose first');
    if (!Array.isArray(positions) || positions.length !== 8 || !positions.every(v=>Number.isInteger(v) && v>=0 && v<=255)) throw new Error('Invalid pose');
    const config = validateCalibration(calibration);
    if (!config.some(c => c.enabled)) throw new Error('Verify and enable at least one joint');
    const target = [...this.current];
    for (const c of config) {
      if (c.enabled) {
        if (this.current[c.slot] < c.min || this.current[c.slot] > c.max) throw new Error(`${c.key}: current position is outside its calibrated limits`);
        target[c.slot] = clamp(positions[c.slot],c.min,c.max);
      }
    }
    this.target = target;
    this.active = true;
    this.#tick();
  }
  setJointTarget(slot, value, calibration) {
    const config = validateCalibration(calibration);
    // Retain other manual targets while a second slider is being dragged.
    const pose = [...(this.active ? this.target : this.current ?? [])];
    pose[slot] = value;
    this.setTarget(pose, config.map(c => ({...c, enabled:c.slot===slot || (this.active && this.target[c.slot]!==this.current[c.slot])})));
  }
  async #tick() {
    if (this.#sending || this.#timer || !this.active) return;
    const epoch = this.#epoch;
    if (this.current.every((v,i)=>v===this.target[i])) { this.active = false; return; }
    this.#sending = true;
    const next = stepPose(this.current,this.target,4);
    try {
      await this.robot.setPose(next);
      if (epoch === this.#epoch) { this.current = next; this.#emit('pose', [...next]); }
      // A cancelled in-flight write leaves physical position uncertain; require a fresh read.
      else this.current = null;
    } catch(error) {
      this.cancel(); this.current = null; this.#emit('error',error.message);
    } finally {
      this.#sending = false;
      if (this.active) this.#timer = setTimeout(()=>{this.#timer=undefined;this.#tick();},100);
    }
  }
  cancel() {
    this.#epoch++; this.active = false; this.target = this.current && [...this.current];
    clearTimeout(this.#timer); this.#timer = undefined;
    this.#emit('cancel', null);
  }
}

export function validateSequence(value) {
  if (value?.version !== 1 || !Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > 600) throw new Error('Expected a version 1 sequence of 1–600 frames');
  let previous = -1;
  const frames = value.frames.map(frame => {
    if (!Number.isFinite(frame.time) || frame.time < 0 || frame.time > 60000 || frame.time <= previous) throw new Error('Frame times must increase within 60 seconds');
    previous = frame.time;
    if (!Array.isArray(frame.pose) || frame.pose.length!==8 || !frame.pose.every(v=>Number.isInteger(v)&&v>=0&&v<=255)) throw new Error('Invalid sequence pose');
    return {time:frame.time,pose:[...frame.pose]};
  });
  return {version:1,name:String(value.name || 'Untitled').slice(0,80),frames};
}
