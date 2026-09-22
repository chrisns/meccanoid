import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCalibration, isLegacyDefaultCalibration, validateCalibration, calibratedPose, MEASURED_NEUTRAL } from '../src/joints.js';
import { bodySignals, previewBodySignals, mirrorSignals, relativeSignals } from '../src/tracking-math.js';
import { MotionController, validateSequence } from '../src/motion.js';
import { DiagnosticSession, diagnosticSteps } from '../src/diagnostics.js';
import { decode, packet, preset, readPose } from '../src/protocol.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Robot extends EventTarget {
 connected=true;armed=true;writes=[];pose=Array(8).fill(128);
 async readPose(){return [...this.pose];}
 async setPose(pose){this.writes.push([...pose]);this.pose=[...pose];}
 async readStatus(){return {type:'status',presetCount:20,buttons:{blue:true},errorCode:0};}
 async setEyes(...rgb){this.writes.push(rgb);}
 async stop(){this.dispatchEvent(new Event('stop'));}
}
test('calibration rejects duplicated slots and limits outside original app range',()=>{
 const c=defaultCalibration();c[1].slot=0;assert.throws(()=>validateCalibration(c),/unique/);
 const d=defaultCalibration();d[0].min=0;assert.throws(()=>validateCalibration(d),/24/);
});
test('measured G15KS calibration has safe physical bounds and recognises only the old untouched defaults',()=>{
 const c=defaultCalibration();assert.deepEqual(c.map(v=>v.centre),MEASURED_NEUTRAL);assert(c.every(v=>v.enabled&&v.min>24&&v.max<232));
 const legacy=c.map((v,slot)=>({...v,min:24,max:232,centre:128,reversed:false,enabled:false,slot}));
 assert.equal(isLegacyDefaultCalibration(legacy),true);legacy[0].centre=129;assert.equal(isLegacyDefaultCalibration(legacy),false);
});
test('mirroring changes only explicitly verified joints and respects asymmetrical limits',()=>{
 const c=defaultCalibration().map(v=>({...v,enabled:false}));c[0]={...c[0],enabled:true,min:100,max:150,centre:120,reversed:true};
 const pose=calibratedPose({rightElbow:1,leftElbow:1},c,Array(8).fill(128),1);
 assert.deepEqual(pose,[100,128,128,128,128,128,128,128]);
 assert.deepEqual(calibratedPose({rightElbow:100},c,Array(8).fill(128),1),pose);
});
test('body landmarks preserve visible joints through occlusion; anatomical sides swap only when requested',()=>{
 const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
 world[11]={x:-1,y:0,z:0,visibility:1};world[12]={x:1,y:0,z:0,visibility:1};
 world[13]={x:-1,y:1,z:0,visibility:1};world[14]={x:1,y:1,z:0,visibility:1};
 world[15]={x:-1,y:2,z:0,visibility:1};world[16]={x:2,y:1,z:0,visibility:1};
 world[23]={x:-1,y:2,z:0,visibility:1};world[24]={x:1,y:2,z:0,visibility:1};
 const s=bodySignals(world,[]);assert.equal(s.leftElbow,0);assert.equal(s.rightElbow,1);
 assert.equal(mirrorSignals(s).leftElbow,1);assert.equal(mirrorSignals(s,false).leftElbow,0);
 assert.deepEqual(relativeSignals(s,s),Object.fromEntries(Object.keys(s).map(k=>[k,0])));
 world[15].visibility=.2;assert.equal(bodySignals(world,[]).leftElbow,undefined);assert.equal(bodySignals(world,[]).rightElbow,1);
 world[23].visibility=.2;world[24].visibility=.2;world[0]={x:0,y:-1,z:0,visibility:1};
 assert.equal(bodySignals(world,[]).rightElbow,1,'visible arm still works when other wrist and hips are out of frame');
 const image=[];image[0]={x:.55,y:.18,z:0,visibility:1};image[7]={x:.42,y:.2,z:0,visibility:1};image[8]={x:.62,y:.2,z:0,visibility:1};
 world[11].visibility=.2;world[12].visibility=.2;
 assert(Number.isFinite(bodySignals(world,image).headTurn),'head keeps tracking without shoulders');
});
test('camera ignores confident arm landmarks guessed beyond the frame',()=>{
 const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
 const image=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
 world[11]={x:-1,y:0,z:0,visibility:1};world[12]={x:1,y:0,z:0,visibility:1};
 world[13]={x:-1,y:1,z:0,visibility:1};world[14]={x:1,y:1,z:0,visibility:1};
 world[15]={x:-1,y:2,z:0,visibility:1};world[16]={x:1,y:2,z:0,visibility:1};
 world[23]={x:-1,y:2,z:0,visibility:1};world[24]={x:1,y:2,z:0,visibility:1};
 image[13].y=1.12;
 const robotSignals=bodySignals(world,image),signals=previewBodySignals(world,image);
 assert.equal(robotSignals.leftElbow,0,'robot mapping remains based on the physically tested world landmarks');
 assert.equal(signals.leftLift,undefined);
 assert.equal(signals.leftSwing,undefined);
 assert.equal(signals.leftElbow,undefined);
 assert.equal(signals.rightElbow,0);
});
test('camera preserves a clear on-screen elbow bend when depth estimation understates it',()=>{
 const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
 const image=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
 world[11]={x:-1,y:0,z:0,visibility:1};world[12]={x:1,y:0,z:0,visibility:1};
 world[13]={x:-1,y:1,z:0,visibility:1};world[14]={x:1,y:1,z:0,visibility:1};
 world[15]={x:-1,y:2,z:0,visibility:1};world[16]={x:1,y:2,z:0,visibility:1};
 world[23]={x:-1,y:2,z:0,visibility:1};world[24]={x:1,y:2,z:0,visibility:1};
 image[12]={x:.333,y:.806,z:0,visibility:1};
 image[14]={x:.046,y:.962,z:0,visibility:1};
 image[16]={x:.095,y:.566,z:0,visibility:1};
 assert.equal(bodySignals(world,image).rightElbow,0);
 assert(previewBodySignals(world,image).rightElbow>1.3);
});
test('camera expands compressed overhead lift while keeping horizontal at one',()=>{
 const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
 world[11]={x:-1,y:0,z:0,visibility:1};world[12]={x:1,y:0,z:0,visibility:1};
 world[23]={x:-1,y:2,z:0,visibility:1};world[24]={x:1,y:2,z:0,visibility:1};
 world[13]={x:-2,y:0,z:0,visibility:1};world[14]={x:2,y:0,z:0,visibility:1};
 assert.equal(bodySignals(world,[]).rightLift,1);
 const angle=1.57*Math.PI/2;
 world[14]={x:1+Math.sin(angle),y:Math.cos(angle),z:0,visibility:1};
 assert(bodySignals(world,[]).rightLift>1.99,'a camera-compressed overhead arm must reach full travel at 50% scale');
});
test('motion advances in small steps, preserves other joints and stops queued targets',async()=>{
 const r=new Robot(),m=new MotionController(r);await m.sync();const c=defaultCalibration().map(v=>({...v,enabled:false}));c[0].enabled=true;
 m.setTarget([150,...Array(7).fill(0)],c);await sleep(10);
 assert.deepEqual(r.writes[0],[132,...Array(7).fill(128)]);
 await r.stop();await sleep(120);assert.equal(r.writes.length,1);
});
test('motion refuses stale/unread pose and an invalid encoded baseline',async()=>{
 const r=new Robot(),m=new MotionController(r),c=defaultCalibration().map(v=>({...v,enabled:false}));c[0].enabled=true;
 assert.throws(()=>m.setTarget(Array(8).fill(140),c),/Read/);
 c[0].max=168;r.pose[0]=0;await m.sync();assert.throws(()=>m.setTarget(Array(8).fill(140),c),/encoding/);
});
test('sequence import validates times and never accepts a wheel command',()=>{
 assert.throws(()=>validateSequence({version:1,frames:[{time:0,pose:Array(8).fill(128)},{time:0,pose:Array(8).fill(128)}]}),/increase/);
 assert.throws(()=>validateSequence({version:1,frames:[{time:0,wheels:[1,1]}]}),/pose/);
});
test('status decodes robot bank size and physical button bitfield',()=>{
 const payload=Array(17).fill(0);payload[7]=5;payload[13]=20;
 const status=decode(packet(1,payload));assert.equal(status.presetCount,20);
 assert.deepEqual(status.buttons,{blue:true,red:false,green:true,yellow:false});
 assert.equal(readPose()[0],9);assert.deepEqual([...preset(20,2).slice(0,4)],[25,20,2,0]);
});
test('diagnostic does not pass without an observation; joint jog preserves and restores others',async()=>{
 const r=new Robot(),d=new DiagnosticSession(r);assert.throws(()=>d.mark('working'),/Run/);
 d.index=diagnosticSteps.findIndex(s=>s.kind==='joint');await d.run(defaultCalibration());
 assert.deepEqual(r.writes,[[132,...Array(7).fill(128)],Array(8).fill(128)]);
 assert.equal(d.results.length,0);d.mark('wrong-component','left elbow moved');
 const result=d.report().results[0];assert.equal(result.outcome,'wrong-component');assert.equal(result.evidence.after,132);assert.equal(d.report().completed,false);
});
test('aborting a joint test never sends a delayed restore after stop',async()=>{
 const r=new Robot(),d=new DiagnosticSession(r);d.index=diagnosticSteps.findIndex(s=>s.kind==='joint');
 const running=d.run(defaultCalibration());await sleep(20);d.abort();await assert.rejects(running,/cancelled/);assert.equal(r.writes.length,1);assert.throws(()=>d.mark('working'),/Run/);
});

test('physically verified head mapping sends turn to slot 6 and sideways tilt to slot 7',()=>{
 const c=defaultCalibration().map(v=>({...v,enabled:true}));
 const pose=calibratedPose({headTurn:1,headTilt:-1},c,Array(8).fill(128),1);
 assert.deepEqual(pose,[128,128,128,128,128,128,228,71]);
});

test('visible diagnostic sweep cancels promptly without a late restore',async()=>{
 const r=new Robot(),d=new DiagnosticSession(r);d.index=diagnosticSteps.findIndex(s=>s.kind==='joint');
 const running=d.run(defaultCalibration(),{visible:true});await sleep(150);d.abort();await assert.rejects(running,/cancelled/);
 const count=r.writes.length;await sleep(150);assert.equal(r.writes.length,count);assert(count>=1&&count<100);
 assert(r.writes.every(p=>p.slice(1).every(v=>v===128)&&Math.abs(p[0]-128)<=24));
});

test('concurrent manual targets preserve each other without mutating calibration switches',async()=>{
 const r=new Robot(),m=new MotionController(r),c=defaultCalibration();await m.sync();
 m.setJointTarget(0,148,c);m.setJointTarget(1,144,c);
 assert.deepEqual(m.target,[148,144,128,128,128,128,128,128]);
 await sleep(650);assert.deepEqual(r.pose,m.target);assert(c.every(j=>j.enabled));m.cancel();
});
