import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.env.APP_URL||'http://localhost:8080';
const browser=await chromium.launch({...process.env.CI?{}:{channel:'chrome'}});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1100}});const page=await context.newPage();
 const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith(new URL(base).origin)&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto(base);const realCalibration=await page.evaluate(()=>localStorage.getItem('meccanoid.calibration'));await page.getByRole('button',{name:'Try it without a robot'}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Practice robot'));
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()),'#F4EFE7','CNS tokens must load from the published artifact');
 assert(await page.evaluate(()=>document.fonts.check('900 64px Fraunces')),'Local display font must be available');
 assert.deepEqual(await page.locator('.masthead .brand').evaluate(el=>({ink:getComputedStyle(el.querySelector('.brand-me')).color,dot:getComputedStyle(el.querySelector('.brand-dot')).backgroundColor,italic:getComputedStyle(el.querySelector('.brand-me')).fontStyle,flamingos:document.querySelectorAll('.brand-flamingo').length})),{ink:'rgb(20, 17, 15)',dot:'rgb(229, 25, 127)',italic:'italic',flamingos:0});
 assert(await page.locator('#practiceBanner').isVisible());
 await page.getByRole('button',{name:'Red eyes',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Red eyes',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Green eyes',exact:true}).click();
 await page.locator('#quickJoke').click();
 assert.match(await page.locator('#practiceAction').textContent(),/Practice joke/);
 assert.equal(await page.locator('#speechText,#voiceSelect,#audioFile,#audioPlayer').count(),0);
 const issues=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 assert.deepEqual(issues.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 await mkdir('docs/screenshots',{recursive:true});
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/screenshots/play-desktop.png',fullPage:true});
 for(const width of [1366,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  for(const view of ['play','move','copy','create','workshop']){
   await page.locator(`[data-view=${view}]`).click();await page.locator(`[data-page=${view}]`).waitFor({state:'visible'});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.equal(overflow,false,`Overflow at ${width}px on ${view}`);
  }
 }
 await page.setViewportSize({width:390,height:844});await page.locator('[data-view=play]').click();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/screenshots/play-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1050});await page.locator('[data-view=copy]').click();
 const copyIssues=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 assert.deepEqual(copyIssues.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 await page.screenshot({path:'docs/screenshots/copy-me.png',fullPage:true});
 await page.locator('[data-view=move]').click();await page.locator('#syncPose').click();
 await page.screenshot({path:'docs/screenshots/arms-and-head.png',fullPage:true});
 assert.equal(await page.evaluate(()=>localStorage.getItem('meccanoid.calibration')),realCalibration,'Practice must not change real robot calibration');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[],'Fonts, camera and app assets must stay on this origin');
 console.log('UI passed: practice, instant lights, jokes, accessibility, all five views at five widths, screenshots, no external requests.');
}finally{await browser.close();}
