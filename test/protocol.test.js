import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/protocol.js';
import { Meccanoid } from '../src/meccanoid.js';
const bytes = s => Uint8Array.from(s.split(' ').map(v => parseInt(v,16)));
test('wire fixtures: original PIN, red eyes, stationary wheels', () => {
  assert.deepEqual(p.pin(), bytes('1a 01 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1c'));
  assert.deepEqual(p.eyes(7,0,0), bytes('11 00 00 07 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 18'));
  assert.deepEqual(p.wheels(0,0), bytes('0d 02 02 00 00 ff ff 00 00 00 00 00 00 00 00 00 00 00 02 0f'));
});
test('wheel direction and independent magnitudes', () => {
  assert.deepEqual([...p.wheels(-40,60).slice(0,7)], [13,2,1,40,60,255,255]);
  assert.equal(p.validPacket(p.wheels(-255,255)),true);
});
test('invalid commands cannot become truncated bytes', () => {
  for (const v of [NaN,Infinity,1.5,-1,8,'7']) assert.throws(() => p.eyes(v,0,0));
  assert.throws(() => p.wheels(256,0));
  assert.throws(() => p.pose([1,2]));
  assert.throws(() => p.chest([true, true, true, 1]));
  assert.throws(() => p.packet(1,Array(18).fill(0)));
  const corrupt=p.pin();corrupt[1]=3;assert.equal(p.validPacket(corrupt),false);
});
class FakeTransport extends EventTarget {
  writes=[];
  async connect(){return 'test robot';}
  async write(bytes){this.writes.push(bytes);}
  disconnect(){this.dispatchEvent(new Event('disconnect'));}
}
test('connect only stops wheels; motion requires explicit arming',async () => {
  const transport=new FakeTransport();const robot=new Meccanoid(transport);
  await robot.connect();
  assert.deepEqual(transport.writes,[p.wheels(0,0)]);
  await assert.rejects(robot.drive(20,20),/Enable motion/);
  assert.throws(() => robot.wake(),/Enable motion/);
  await robot.setEyes(0,7,0);
  await robot.disconnect();assert.equal(robot.armed,false);
});
test('wheel pulse automatically stops and rejects overlapping pulses',async () => {
  const transport=new FakeTransport();const robot=new Meccanoid(transport);
  await robot.connect();await robot.arm(true);await robot.drive(30,-30,50);
  await assert.rejects(robot.drive(30,30,50),/current wheel pulse/);
  await new Promise(resolve=>setTimeout(resolve,90));
  assert.deepEqual(transport.writes.at(-1),p.wheels(0,0));
  await robot.disconnect();
});
test('stop cancels queued commands and follows the in-flight write',async () => {
  const transport=new FakeTransport();const robot=new Meccanoid(transport);
  await robot.connect();
  let release;
  transport.write=async bytes=>{transport.writes.push(bytes);if(bytes[0]===0x11) await new Promise(r=>{release=r;});};
  const first=robot.setEyes(7,0,0);await new Promise(r=>setImmediate(r));
  const queued=robot.setEyes(0,7,0);
  const rejected=assert.rejects(queued,/cancelled/);
  const stopped=robot.stop();release();await Promise.all([first,rejected,stopped]);
  assert.deepEqual(transport.writes.map(p=>p[0]),[13,17,13]);
  await robot.disconnect();
});

test('accepts real battery-powered robot PIN and status replies', () => {
  assert.equal(p.validPacket(bytes('1a 01 00 01 00 ff ff ff ff ff ff ff ff ff ff ff ff ff 0d 0f')), true);
  assert.equal(p.validPacket(bytes('01 04 00 01 0a 07 00 00 00 00 07 72 04 00 14 00 00 00 00 a8')), true);
});

test('direct servo and LED controls enable mode once; preset invalidates it', async()=>{
  const transport=new FakeTransport(), robot=new Meccanoid(transport);
  await robot.connect();await robot.arm(true);
  await robot.setPose(Array(8).fill(128));await robot.setServoLights(Array(8).fill(1));
  assert.deepEqual(transport.writes.map(v=>v[0]),[13,11,8,12]);
  assert.deepEqual(transport.writes[1],p.servoMode(2));
  await robot.playPreset(1);await robot.setChest([true,true,true,true]);
  assert.deepEqual(transport.writes.slice(-3).map(v=>v[0]),[25,11,28]);
  await robot.disconnect();
});
test('stop during mode enable prevents the delayed pose write',async()=>{
  const transport=new FakeTransport(),robot=new Meccanoid(transport);
  await robot.connect();await robot.arm(true);let release;
  transport.write=async b=>{transport.writes.push(b);if(b[0]===11)await new Promise(r=>release=r);};
  const pose=robot.setPose(Array(8).fill(128));const rejected=assert.rejects(pose,/cancelled/);
  await new Promise(r=>setImmediate(r));const stop=robot.stop();release();await Promise.all([rejected,stop]);
  assert.equal(transport.writes.some(b=>b[0]===8),false);await robot.disconnect();
});
test('preset metadata decodes actual robot name and rejects non-printable entry',()=>{
  const info=p.decode(bytes('18 01 00 49 4e 54 52 4f 44 55 43 45 00 00 00 00 00 00 02 c6'));
  assert.equal(info.name,'INTRODUCE');assert.equal(info.id,1);
  assert.equal(p.decode(bytes('18 14 00 01 00 00 00 14 00 00 00 15 00 00 00 1f 00 00 00 75')).name,null);
});

test('clock encoding handles midnight, noon and decimal date digits',()=>{
 assert.deepEqual([...p.clock(new Date(2026,8,18,0,5)).slice(0,13)],[27,1,2,0,5,0,0,9,18,2,0,2,6]);
 assert.deepEqual([...p.clock(new Date(2026,8,18,12,59)).slice(1,6)],[1,2,5,9,1]);
 assert.throws(()=>p.clock(new Date(NaN)),/Invalid/);
});

test('verified volume levels work without arming motion and reject unknown levels',async()=>{
 const transport=new FakeTransport(),robot=new Meccanoid(transport);await robot.connect();
 await robot.setVolume(2);assert.deepEqual(transport.writes.at(-1),p.preset(9,2));assert.equal(robot.armed,false);
 assert.throws(()=>robot.setVolume(0),/volume/);assert.throws(()=>robot.setVolume(4),/volume/);await robot.disconnect();
});

test('bounded firmware movement ends with STOP preset then zero wheels',async()=>{
 const transport=new FakeTransport(),robot=new Meccanoid(transport);await robot.connect();await robot.arm(true);
 await robot.moveDirection('forward',100);
 await assert.rejects(robot.moveDirection('left',100),/finish/);
 await new Promise(r=>setTimeout(r,140));
 assert.deepEqual(transport.writes.slice(-3),[p.preset(13),p.preset(8),p.wheels(0,0)]);
 await robot.disconnect();
});
test('held firmware movement refreshes its watchdog and stops on release',async()=>{
 const transport=new FakeTransport(),robot=new Meccanoid(transport);await robot.connect();await robot.arm(true);
 await robot.holdDirection('forward',250);await new Promise(r=>setTimeout(r,150));await robot.holdDirection('forward',250);
 assert.equal(transport.writes.filter(v=>v[0]===25&&v[1]===13).length,1,'refresh does not restart the routine');
 await new Promise(r=>setTimeout(r,150));assert.equal(transport.writes.some(v=>v[0]===25&&v[1]===8),false);
 await robot.stop();assert.deepEqual(transport.writes.slice(-2),[p.preset(8),p.wheels(0,0)]);await robot.disconnect();
});
test('zero wheels is attempted even if the preset STOP write fails',async()=>{
 const transport=new FakeTransport(),robot=new Meccanoid(transport);await robot.connect();await robot.arm(true);await robot.playPreset(13);
 transport.write=async b=>{transport.writes.push(b);if(b[0]===25&&b[1]===8)throw new Error('STOP failed');};
 await assert.rejects(robot.stop(),/STOP failed/);assert.deepEqual(transport.writes.at(-1),p.wheels(0,0));
 transport.write=async b=>transport.writes.push(b);await robot.stop();assert.deepEqual(transport.writes.slice(-2),[p.preset(8),p.wheels(0,0)]);await robot.disconnect();
});
test('experimental volume preserves 99 as a raw value without widening tested volume API',async()=>{
 const transport=new FakeTransport(),robot=new Meccanoid(transport);await robot.connect();await robot.setExperimentalVolume(99);
 assert.deepEqual(transport.writes.at(-1),p.preset(9,99));assert.throws(()=>robot.setVolume(99));assert.throws(()=>robot.setExperimentalVolume(256));await robot.disconnect();
});

test('hand capture selects read mode and blocks commands that would re-energize servos',async()=>{
 const transport=new FakeTransport(),robot=new Meccanoid(transport);await robot.connect();await robot.arm(true);
 try {
  await robot.beginRangeCapture();assert.equal(robot.armed,false);assert.deepEqual(transport.writes.at(-1),p.servoMode(4));
  assert.throws(()=>robot.arm(true),/Finish range/);
  await assert.rejects(robot.setServoLights(Array(8).fill(1)),/Finish range/);
  await assert.rejects(robot.setChest([true,true,true,true]),/Finish range/);
  await assert.rejects(robot.setVolume(2),/Finish range/);
  await robot.stop();assert.deepEqual(transport.writes.at(-1),p.wheels(0,0));
  robot.endRangeCapture();assert.equal(robot.armed,false);
  await robot.arm(true);await robot.setPose(Array(8).fill(128));assert.deepEqual(transport.writes.at(-2),p.servoMode(2));
 }finally{await robot.disconnect();}
});
