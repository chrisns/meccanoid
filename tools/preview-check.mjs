import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fakeRobot} from './fake-robot.js';
import {JOINT_KEYS} from '../src/keyboard.js';
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(fakeRobot);
 await page.goto(process.env.APP_URL||'http://localhost:8080');await page.waitForFunction(()=>document.querySelector('#robotPreview').dataset.ready==='true');
 await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('connected:'));
 await page.locator('[data-view=move]').click();await page.locator('#syncPose').click();await page.locator('#content').focus();
 const pose=()=>page.evaluate(()=>JSON.parse(document.querySelector('#robotPreview').dataset.pose));
 for(let slot=0;slot<8;slot++)for(const [key,sign] of [[JOINT_KEYS[slot].plus,1],[JOINT_KEYS[slot].minus,-1]]){
  const before=await pose();await page.keyboard.down(key);await page.waitForTimeout(320);await page.keyboard.up(key);await page.waitForTimeout(120);
  const after=await pose();assert((after[slot]-before[slot])*sign>0,`key ${key} moves slot ${slot}`);assert(after.every((n,i)=>i===slot||n===before[i]),`key ${key} preserves other joints`);
  const writes=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length),writes,'release stops joint writes');
 }
 const shot=await page.locator('#robotPreview').screenshot();const slider=page.getByRole('slider',{name:'Right side lift',exact:true});
 // Use the second joint regardless of its child-friendly display label.
 await page.locator('#jointControls input[type=range]').nth(1).evaluate(el=>{el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForTimeout(700);
 assert(!shot.equals(await page.locator('#robotPreview').screenshot()),'rendered robot changes with joint target');
 const jointBefore=(await pose())[0],jointButton=page.locator('#jointControls .joint-card').first().locator('button').nth(1);await jointButton.hover();await page.mouse.down();await page.waitForTimeout(360);await page.mouse.up();await page.waitForTimeout(150);assert((await pose())[0]-jointBefore>=8,'holding a joint button repeatedly moves it until release');
 await page.locator('#content').focus();
 for(let attempt=0;attempt<2;attempt++){
  const beforeDrive=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===13).length);
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(1100);
  assert(await page.evaluate(count=>window.robotWrites.filter(p=>p[0]===25&&p[1]===13).length>=count+2,beforeDrive),'held arrow resends movement while held');
  const beforeStop=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===8).length);await page.keyboard.up('ArrowUp');await page.waitForFunction(count=>window.robotWrites.filter(p=>p[0]===25&&p[1]===8).length>count,beforeStop);
 }
 const drives=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===13).length);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===13).length),drives);
 await page.locator('[data-view=play]').click();const forward=page.getByRole('button',{name:'Forward',exact:true});await forward.hover();await page.waitForTimeout(150);const stopsBefore=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===8).length);await page.mouse.down();await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===8).length),stopsBefore,'held direction button stays active beyond the watchdog');await page.mouse.up();await page.waitForFunction(count=>window.robotWrites.filter(p=>p[0]===25&&p[1]===8).length>count,stopsBefore);
 await page.locator('[data-view=create]').click();const before=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length);await page.locator('#poseName').fill('');await page.locator('#poseName').pressSequentially('qwertyuiop');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length),before,'typing does not move joints');
 const writesBeforeEscape=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#motion').isEnabled(),true,'Escape stops without requiring a readiness checkbox');
 await page.locator('#content').focus();await page.keyboard.down('q');await page.waitForTimeout(320);await page.keyboard.up('q');
 assert(await page.evaluate(count=>window.robotWrites.filter(p=>p[0]===8).length>count,writesBeforeEscape),'the next deliberate movement works immediately after Stop');
 // Exercise the same virtual camera-to-model mapping with no connected hardware.
 await page.locator('#disconnect').click();await page.evaluate(async()=>{const {RobotPreview}=await import('./src/robot-preview.js');const {defaultCalibration,MEASURED_NEUTRAL}=await import('./src/joints.js');const {Vector3}=await import('./vendor/three/three.module.js');const host=document.createElement('div');host.style='width:300px;height:400px';document.body.append(host);const preview=new RobotPreview(host,document.createElement('p'));const config=defaultCalibration(),pose=[...MEASURED_NEUTRAL];pose[1]=config[1].max;preview.setPose(pose,config);window.previewShortSide=preview.targets[1];pose[1]=config[1].min;preview.setPose(pose,config);window.previewLongSide=preview.targets[1];const reversed=config.map(c=>({...c,reversed:!c.reversed}));preview.setPose(pose,reversed);window.previewReversed=preview.targets[1];preview.setSignals({leftLift:1,leftElbow:1.4},config,.4);for(const i of [4,5])preview.joints[i].group.rotation[preview.joints[i].axis]=preview.targets[i];const elbow=preview.joints[5].group.localToWorld(new Vector3());const wrist=preview.joints[5].group.localToWorld(new Vector3(0,-.67,0));window.cameraBentHandRise=wrist.y-elbow.y;preview.setSignals({rightElbow:1,headTurn:.7,headTilt:-.5},config,.8);window.virtualTestPose=JSON.parse(host.dataset.pose);preview.dispose();host.remove();});
 const virtual=await page.evaluate(()=>window.virtualTestPose);assert(virtual[0]>128&&virtual[6]>128&&virtual[7]<128);assert.deepEqual(errors,[]);
 const previewAngles=await page.evaluate(()=>[window.previewShortSide,window.previewLongSide,window.previewReversed]);assert(Math.abs(previewAngles[0])<Math.abs(previewAngles[1])/5,'small raw travel renders a small physical change');assert.equal(previewAngles[1],previewAngles[2],'reversing camera mapping does not reverse a raw pose preview');
 assert((await page.evaluate(()=>window.cameraBentHandRise))>.25,'a visible bent elbow raises the preview hand above the joint');
 console.log('All 16 joint keys, key release, drive stop, typing, Escape, rendered pose changes and disconnected camera mapping passed.');
}finally{await browser.close();}
