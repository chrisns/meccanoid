import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fakeRobot } from './fake-robot.js';
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'})});
try {
 const page=await browser.newPage();await page.addInitScript(fakeRobot);await page.goto(process.env.APP_URL||'http://localhost:8080');
 await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('connected:'));
 if(process.argv[2]==='lights') {
  await page.locator('#custom').evaluate(el=>{el.value='#ff0000';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(150);
  assert(await page.evaluate(()=>window.robotWrites.some(p=>p[0]===17&&p[3]===7)),'Changing eye colour must send immediately, without Apply');
 } else {
  await page.locator('[data-view=move]').click();await page.locator('#syncPose').click();await page.waitForFunction(()=>document.querySelector('#poseState').textContent.startsWith('Current pose'));
  const slider=page.getByRole('slider',{name:'Right elbow',exact:true});
  const before=await slider.evaluate(e=>[e.min,e.max]);await page.locator('#neutralPose').click();
  if(process.argv[2]==='ranges') assert.deepEqual(await slider.evaluate(e=>[e.min,e.max]),before,'Capturing neutral must not silently narrow the configured travel');
  else {
   await page.locator('#arm').check();

   await slider.evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));el.value='140';el.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.waitForTimeout(50);
   assert.equal(await slider.inputValue(),'140','Servo progress must not pull the thumb back from the requested target during a drag');
  }
 }
 console.log(`${process.argv[2]} live-control regression passed`);
} finally {await browser.close();}
