import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fakeRobot} from './fake-robot.js';
import {JOINT_KEYS} from '../src/keyboard.js';
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(fakeRobot);
 await page.goto(process.env.APP_URL||'http://localhost:8080');await page.waitForFunction(()=>document.querySelector('#robotPreview').dataset.ready==='true');
 await page.locator('#connect').click();await page.waitForFunction(()=>!document.querySelector('#arm').disabled);
 await page.locator('[data-view=move]').click();await page.locator('#syncPose').click();await page.locator('#arm').check();await page.locator('#content').focus();
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
 await page.locator('#content').focus();await page.keyboard.down('ArrowUp');await page.waitForTimeout(600);await page.keyboard.up('ArrowUp');await page.waitForTimeout(200);
 assert(await page.evaluate(()=>window.robotWrites.some(p=>p[0]===25&&p[1]===13)));const drives=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===13).length);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===25&&p[1]===13).length),drives);
 await page.locator('[data-view=create]').click();const before=await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length);await page.locator('#poseName').fill('');await page.locator('#poseName').pressSequentially('qwertyuiop');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.robotWrites.filter(p=>p[0]===8).length),before,'typing does not move joints');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#arm').isChecked(),false);
 // Exercise the same virtual camera-to-model mapping with no connected hardware.
 await page.locator('#disconnect').click();await page.evaluate(async()=>{const {RobotPreview}=await import('./src/robot-preview.js');const {defaultCalibration}=await import('./src/joints.js');const host=document.createElement('div');host.style='width:300px;height:400px';document.body.append(host);const preview=new RobotPreview(host,document.createElement('p'));preview.setSignals({rightElbow:1,headTurn:.7,headTilt:-.5},defaultCalibration(),.8);window.virtualTestPose=JSON.parse(host.dataset.pose);preview.dispose();host.remove();});
 const virtual=await page.evaluate(()=>window.virtualTestPose);assert(virtual[0]>128&&virtual[6]>128&&virtual[7]<128);assert.deepEqual(errors,[]);
 console.log('All 16 joint keys, key release, drive stop, typing, Escape, rendered pose changes and disconnected camera mapping passed.');
}finally{await browser.close();}
