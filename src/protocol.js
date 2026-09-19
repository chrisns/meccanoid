/** BLE command framing documented by iamsrp/pymecca. No serial Smart Module framing. */
export function integer(value, min, max, name = 'value') {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function packet(command, payload = []) {
  integer(command, 0, 255, 'command');
  if (payload.length > 17) throw new RangeError('Payload exceeds 17 bytes');
  const result = new Uint8Array(20);
  result[0] = command;
  Array.from(payload).forEach((v, i) => { result[i + 1] = integer(v, 0, 255, `byte ${i}`); });
  const sum = result.reduce((a, b) => a + b, 0);
  result[18] = sum >> 8;
  result[19] = sum & 255;
  return result;
}
export function eyes(red, green, blue) {
  [red, green, blue].forEach(v => integer(v, 0, 7, 'colour channel'));
  return packet(0x11, [0, 0, (green << 3) | red, blue]);
}
/** Positive = forward; order on the wire is left then right. */
export function wheels(left, right) {
  [left, right].forEach(v => integer(v, -255, 255, 'wheel speed'));
  return packet(0x0d, [left > 0 ? 1 : 2, right > 0 ? 1 : 2,
    Math.abs(left), Math.abs(right), 255, 255]);
}
export function chest(states) {
  if (states.length !== 4 || states.some(v => typeof v !== 'boolean'))
    throw new TypeError('Expected four boolean chest light states');
  return packet(0x1c, states.map(Number));
}
export function servoLights(colours) {
  if (colours.length !== 8) throw new RangeError('Expected eight servo colours');
  Array.from(colours).forEach(v => integer(v, 0, 7, 'servo colour'));
  return packet(0x0c, [...colours, ...Array(8).fill(4), 0]);
}
/** Full raw pose required: avoids silently moving unselected joints to a guessed pose. */
export function pose(positions) {
  if (positions.length !== 8) throw new RangeError('Expected eight raw servo positions');
  Array.from(positions).forEach(v => integer(v, 0, 255, 'servo position'));
  return packet(0x08, [...positions, ...Array(9).fill(1)]);
}
/** Original SendAwake uses repeated 0x1d payload; may include arm movement. */
export function wake() { return packet(0x19, Array(17).fill(29)); }
export function hex(bytes) { return Array.from(bytes, v => v.toString(16).padStart(2, '0')).join(' '); }

/** Original Android 1.49 BluetoothLE.SendPIN, sent after FFF1 subscription. */
export function pin() { return packet(0x1a, [1, 0, 1]); }
export function validPacket(bytes) {
  return bytes.length === 20 && bytes.slice(0,18).reduce((a,b) => a+b,0) === ((bytes[18]<<8)|bytes[19]);
}

export function presetInfo(id) { return packet(0x18, [integer(id, 1, 255, 'preset ID')]); }
export function servoMode(mode) {
  if (![2,4].includes(mode)) throw new RangeError('Servo mode must be 2 (control) or 4 (read)');
  return packet(0x0b, Array(16).fill(mode));
}
export function readPose() { return packet(0x09); }
export function preset(id, variant = 0) {
  return packet(0x19, [integer(id, 1, 255, 'preset ID'), integer(variant, 0, 255, 'variant')]);
}
export function playLIM(slot) { return packet(0x15, [integer(slot, 1, 255, 'LIM slot')]); }
export function decode(bytes) {
  if (!validPacket(bytes)) return null;
  if (bytes[0] === 0x18) {
    const nameBytes = Array.from(bytes.slice(3,18));
    const end = nameBytes.indexOf(0);
    const text = end < 0 ? nameBytes : nameBytes.slice(0,end);
    const validName = text.length > 0 && text.every(v => v >= 32 && v <= 126);
    return {type:'presetInfo',id:bytes[1],durationCode:bytes[2],name:validName ? String.fromCharCode(...text).trim() : null,raw:Array.from(bytes)};
  }
  if (bytes[0] === 9) return { type: 'pose', positions: Array.from(bytes.slice(1, 9)) };
  if (bytes[0] === 1) return { type: 'status', buttons: { blue: !!(bytes[8]&1), red: !!(bytes[8]&2), green: !!(bytes[8]&4), yellow: !!(bytes[8]&8) }, chestLEDs: bytes[9], motorCurrentCode: bytes[10], servoCurrentCode: bytes[11], batteryCode: bytes[12], limCount: bytes[13], presetCount: bytes[14], errorCode: bytes[16], raw: Array.from(bytes) };
  return { type: 'reply', command: bytes[0], raw: Array.from(bytes) };
}

/** Original Android setTimeDate encoding: local 12-hour clock, decimal digit bytes. */
export function clock(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || date.getFullYear()<1 || date.getFullYear()>9999) throw new RangeError('Invalid clock date');
  const hour=date.getHours()%12 || 12, minute=date.getMinutes(), year=date.getFullYear();
  return packet(0x1b,[Math.floor(hour/10),hour%10,Math.floor(minute/10),minute%10,date.getHours()>=12?1:0,0,date.getMonth()+1,date.getDate(),Math.floor(year/1000),Math.floor(year/100)%10,Math.floor(year/10)%10,year%10]);
}
