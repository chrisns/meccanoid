import * as protocol from './protocol.js';
export { protocol };
export const SERVICE = 0xfff0;
export const COMMAND = 0xfff2;
export const NOTIFY = 0xfff1;

export class WebBluetoothTransport extends EventTarget {
  device = null;
  characteristic = null;
  constructor({ withResponse = false } = {}) { super(); this.withResponse = withResponse; }
  async connect() {
    if (!globalThis.navigator?.bluetooth) throw new Error('Open this app in Chrome or Edge with Web Bluetooth support.');
    if (this.device) throw new Error('Already connected or connecting');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'MECCANOID' }], optionalServices: [SERVICE],
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      if (this.device !== device) return;
      this.characteristic = null;
      this.device = null;
      this.dispatchEvent(new Event('disconnect'));
    }, { once: true });
    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      this.characteristic = await service.getCharacteristic(COMMAND);
      const notify = await service.getCharacteristic(NOTIFY);
      notify.addEventListener('characteristicvaluechanged', event => {
        const v = event.target.value;
        this.dispatchEvent(new CustomEvent('notification', { detail: new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice() }));
      });
      await notify.startNotifications();
      this.dispatchEvent(new CustomEvent('notice', { detail: 'Requesting connection. Press the robot’s yellow button if it asks.' }));
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.removeEventListener('notification', receive);
          this.removeEventListener('disconnect', disconnected);
        };
        const fail = error => { cleanup(); reject(error); };
        const disconnected = () => fail(new Error('Disconnected during handshake'));
        const receive = event => {
          const bytes = event.detail;
          if (!protocol.validPacket(bytes) || bytes[0] !== 0x1a) return;
          cleanup();
          if (bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 255) reject(new Error('Robot rejected the connection'));
          else resolve();
        };
        const timer = setTimeout(() => fail(new Error('Robot did not accept the PIN handshake within 30 seconds')), 30000);
        this.addEventListener('notification', receive);
        this.addEventListener('disconnect', disconnected);
        this.write(protocol.pin()).catch(fail);
      });
      return device.name;
    } catch (error) { this.disconnect(); throw error; }
  }
  async write(bytes) {
    if (!this.device?.gatt.connected || !this.characteristic) throw new Error('Robot is disconnected');
    if (this.withResponse) await this.characteristic.writeValueWithResponse(bytes);
    else await this.characteristic.writeValueWithoutResponse(bytes);
  }
  disconnect() {
    const device = this.device;
    this.characteristic = null;
    this.device = null;
    if (device?.gatt.connected) device.gatt.disconnect();
    if (device) this.dispatchEvent(new Event('disconnect'));
  }
}

/** Injectable transport permits testing without Bluetooth; connect never moves servos. */
export class Meccanoid extends EventTarget {
  #tail = Promise.resolve();
  #epoch = 0;
  #timer;
  #connecting = false;
  #heartbeat;
  #polling = false;
  #requests = new Map();
  #servoControl = false;
  #routineActive = false;
  #heldDirection = null;
  #heldSentAt = 0;
  #teaching = false;
  positions = null;
  status = null;
  connected = false;
  armed = false;
  constructor(transport = new WebBluetoothTransport()) {
    super();
    this.transport = transport;
    transport.addEventListener('disconnect', () => this.#reset());
    transport.addEventListener('notification', event => {
      const decoded = protocol.decode(event.detail);
      if (!decoded) return;
      if (decoded.type === 'pose') { this.positions = decoded.positions; this.#emit('pose', [...this.positions]); }
      if (decoded.type === 'status') { this.status = decoded; this.#emit('status', decoded); }
      this.#requests.get(event.detail[0])?.resolve(decoded);
    });
    for (const type of ['notification', 'notice']) transport.addEventListener(type, e => this.#emit(type, e.detail));
  }
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #reset() {
    this.connected = false;
    this.armed = false;
    this.#servoControl = false;
    this.#routineActive = false;
    this.#heldDirection = null;
    this.#heldSentAt = 0;
    this.#teaching = false;
    this.positions = null;
    this.status = null;
    for (const request of this.#requests.values()) request.reject(new Error('Robot disconnected'));
    this.#requests.clear();
    this.#epoch++;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    clearInterval(this.#heartbeat);
    this.#emit('state', 'disconnected');
  }
  async connect() {
    if (this.connected || this.#connecting) throw new Error('Already connected or connecting');
    this.#connecting = true;
    try {
      const name = await this.transport.connect();
      this.connected = true;
      await this.stop(); // Explicit zero speed after authentication; no automatic servo pose.
      this.#heartbeat = setInterval(() => {
        if (this.#polling) return;
        this.#polling = true;
        this.#send(protocol.packet(1)).catch(error => this.#emit('error', error.message)).finally(() => { this.#polling = false; });
      }, 500);
      this.#emit('state', `connected: ${name}`);
      return name;
    } catch (error) { this.transport.disconnect(); this.#reset(); throw error; }
    finally { this.#connecting = false; }
  }
  #send(bytes) {
    if (!this.connected) return Promise.reject(new Error('Connect to the robot first'));
    const epoch = this.#epoch;
    const operation = this.#tail.catch(() => {}).then(async () => {
      if (epoch !== this.#epoch) throw new Error('Command cancelled');
      if (!this.connected) throw new Error('Robot is disconnected');
      if (this.#teaching && ([8,12,28,21].includes(bytes[0]) || (bytes[0]===25 && bytes[1]!==8) || (bytes[0]===13 && bytes.slice(3,5).some(v=>v!==0)))) throw new Error('Finish range capture before controlling the robot');
      if ([0x08,0x0c,0x1c].includes(bytes[0]) && !this.#servoControl) {
        const mode = protocol.servoMode(2);
        await this.transport.write(mode);
        this.#emit('tx', mode);
        if (epoch !== this.#epoch || !this.connected) throw new Error('Command cancelled');
        this.#servoControl = true;
      }
      if ([0x19,0x15].includes(bytes[0])) this.#servoControl = false;
      if (bytes[0]===0x15 || (bytes[0]===0x19 && ![8,9].includes(bytes[1]))) this.#routineActive=true;
      await this.transport.write(bytes);
      if (bytes[0]===0x19 && bytes[1]===8) this.#routineActive=false;
      this.#emit('tx', bytes);
    });
    this.#tail = operation;
    return operation;
  }
  arm(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Expected boolean');
    if (enabled && this.#teaching) throw new Error('Finish range capture before enabling motion');
    if (enabled && !this.connected) throw new Error('Connect first');
    this.armed = enabled;
    this.#emit('armed', enabled);
    return !enabled && this.connected ? this.stop() : Promise.resolve();
  }
  #requireMotion() { if (!this.armed) throw new Error('Enable motion controls first'); }
  setEyes(r, g, b) { return this.#send(protocol.eyes(r, g, b)); }
  setChest(states) { return this.#send(protocol.chest(states)); }
  setServoLights(colours) { return this.#send(protocol.servoLights(colours)); }
  setPose(positions) { this.#requireMotion(); return this.#send(protocol.pose(positions)); }
  async beginRangeCapture() {
    await this.arm(false);
    this.#teaching = true;
    this.#servoControl = false;
    try { await this.#send(protocol.servoMode(4)); }
    catch(error) { this.#teaching = false; throw error; }
  }
  endRangeCapture() { this.#teaching = false; this.#servoControl = false; }
  async readPose() { return (await this.#request(protocol.readPose())).positions; }
  setVolume(level) { protocol.integer(level,1,3,'volume level'); return this.#send(protocol.preset(9,level)); }
  setExperimentalVolume(value) { protocol.integer(value,0,255,'experimental volume value'); return this.#send(protocol.preset(9,value)); }
  syncClock(date = new Date()) { return this.#send(protocol.clock(date)); }
  async readPresetInfo(id) {
    const info = await this.#request(protocol.presetInfo(id));
    if (info.id !== id) throw new Error('Preset reply ID did not match request');
    return info;
  }
  async readPresetBank() {
    const status = await this.readStatus(), entries = [];
    for (let id=1; id<=status.presetCount; id++) entries.push(await this.readPresetInfo(id));
    return entries;
  }
  async readStatus() { return this.#request(protocol.packet(1)); }
  #request(bytes) {
    if (!this.connected) return Promise.reject(new Error('Connect first'));
    const command = bytes[0];
    if (this.#requests.has(command)) return Promise.reject(new Error('A request of this type is already pending'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); this.#requests.delete(command); fn(value); };
      const timer = setTimeout(() => finish(reject, new Error('Robot response timed out')), 3000);
      this.#requests.set(command, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      this.#send(bytes).catch(error => finish(reject, error));
    });
  }
  playPreset(id, variant = 0) { this.#requireMotion(); return this.#send(protocol.preset(id, variant)); }
  playLIM(slot) { this.#requireMotion(); return this.#send(protocol.playLIM(slot)); }
  wake() { this.#requireMotion(); return this.#send(protocol.wake()); }
  /** One bounded wheel pulse. Call again only after the previous pulse has stopped. */
  async drive(left, right, milliseconds = 250) {
    this.#requireMotion();
    protocol.integer(milliseconds, 50, 1000, 'duration');
    const bytes = protocol.wheels(left, right);
    if (this.#timer) throw new Error('Wait for the current wheel pulse to finish');
    // Reserve immediately so rapid clicks cannot queue motion behind an in-flight write.
    this.#timer = setTimeout(() => {
      this.stop().catch(error => this.#emit('error', error.message));
    }, milliseconds);
    try { await this.#send(bytes); }
    catch (error) { await this.stop().catch(() => {}); throw error; }
  }
  /** Firmware directions verified on G15KS; speed is chosen by the robot. */
  async moveDirection(direction, milliseconds = 1000) {
    this.#requireMotion();
    const id={forward:13,backward:14,left:15,right:16}[direction];
    if (!id) throw new Error('Unknown direction');
    protocol.integer(milliseconds,100,1000,'duration');
    if (this.#timer) throw new Error('Wait for the current movement to finish');
    this.#timer=setTimeout(()=>{this.stop().catch(e=>this.#emit('error',e.message));},milliseconds);
    try { await this.#send(protocol.preset(id)); }
    catch(error) { await this.stop().catch(()=>{}); throw error; }
  }
  /** Refreshable firmware movement for press-and-hold controls. */
  async holdDirection(direction, watchdogMilliseconds = 700) {
    this.#requireMotion();
    const id={forward:13,backward:14,left:15,right:16}[direction];
    if(!id)throw new Error('Unknown direction');
    protocol.integer(watchdogMilliseconds,250,1000,'watchdog');
    clearTimeout(this.#timer);
    this.#timer=setTimeout(()=>{this.stop().catch(e=>this.#emit('error',e.message));},watchdogMilliseconds);
    const now=Date.now();
    if(this.#heldDirection===direction&&now-this.#heldSentAt<400)return;
    this.#heldDirection=direction;
    this.#heldSentAt=now;
    try {await this.#send(protocol.preset(id));}
    catch(error){await this.stop().catch(()=>{});throw error;}
  }
  stop() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#heldDirection = null;
    this.#heldSentAt = 0;
    this.#emit('stop', null);
    this.#epoch++; // Drop queued commands; zero speed follows the current GATT write.
    // Queue both synchronously so another producer cannot slip between them.
    const tasks=[];
    if (this.#routineActive) tasks.push(this.#send(protocol.preset(8)));
    tasks.push(this.#send(protocol.wheels(0,0)));
    return Promise.allSettled(tasks).then(results=>{const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;});
  }
  async disconnect() {
    clearInterval(this.#heartbeat);
    try { if (this.connected) await this.stop(); }
    finally { this.transport.disconnect(); this.#reset(); }
  }
}
