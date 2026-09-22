import { RobotPreview } from './src/robot-preview.js';
import { KeyboardControls, JOINT_KEYS } from './src/keyboard.js';
import { JOINTS } from './src/joints.js';
import { PracticeTransport } from './src/practice.js';
import { setupShell } from './src/shell.js';
import { setupStudio } from './src/studio.js';
import { Meccanoid, protocol } from './src/meccanoid.js';
const $ = id => document.getElementById(id);
const practice=new URLSearchParams(location.search).get('practice')==='1';
const robot = practice?new Meccanoid(new PracticeTransport()):new Meccanoid();
const entries = [];
let studio;
const preview=new RobotPreview($('robotPreview'),$('previewState'));
$('resetView').onclick=()=>preview.resetView();
robot.addEventListener('stop',()=>preview.stop());
robot.addEventListener('state',()=>{if(!robot.connected)preview.stop();});
function log(message) {
  entries.push(`${new Date().toISOString()}  ${message}`);
  if (entries.length > 1000) entries.shift();
  $('log').textContent = entries.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}
function state() {
  const connected = robot.connected;
  document.body.dataset.connected=connected;
  $('practice').disabled=connected;
  $('connect').disabled = connected||(!practice&&!navigator.bluetooth);
  $('disconnect').disabled = !connected;
  $('lights').disabled = !connected;
  $('motion').disabled = !connected;
  $('globalStop').disabled=!connected;
  $('stop').disabled=!connected;
  studio?.state();
  document.querySelectorAll('#colours button').forEach(b => b.disabled = !connected);
}
async function run(action) {
  try { await action(); }
  catch (error) { log(`ERROR ${error.message}`); $('notice').textContent = error.message; }
  finally { state(); }
}
robot.addEventListener('state', e => { $('status').textContent = e.detail; log(e.detail); state(); });
robot.addEventListener('tx', e => {log(`TX submitted · ${protocol.hex(e.detail)}`);preview.command(e.detail);});
robot.addEventListener('notification', e => log(`RX ${protocol.hex(e.detail)}`));
for (const event of ['notice', 'error']) robot.addEventListener(event, e => { log(e.detail); $('notice').textContent = e.detail; });
$('connect').onclick = () => { $('connect').disabled = true; run(async () => {
  await robot.connect(); $('notice').textContent = 'Bluetooth connected. If the robot asks, press its yellow button. Try an eye colour and check for a physical response.';
}); };
$('disconnect').onclick = () => run(() => robot.disconnect());
const colours = {Red:[7,0,0],Green:[0,7,0],Blue:[0,0,7],Amber:[7,4,0],Cyan:[0,7,7],White:[7,7,7],Off:[0,0,0]};
for (const [name, rgb] of Object.entries(colours)) {
  const button = document.createElement('button');
  button.textContent=name;button.setAttribute('aria-pressed','false');
  button.title = name; button.setAttribute('aria-label', `${name} eyes`);
  const colour = `rgb(${rgb.map(c => Math.round(c*255/7)).join(',')})`;
  button.style.setProperty('--swatch',colour);
  button.onclick = () => run(async () => { await robot.setEyes(...rgb); document.documentElement.style.setProperty('--eye',colour);document.querySelectorAll('#colours button').forEach(b=>b.setAttribute('aria-pressed',String(b===button))); });
  $('colours').append(button);
}
$('custom').oninput = () => run(async () => {
  const colour = $('custom').value;
  const rgb = colour.slice(1).match(/../g).map(v => Math.round(parseInt(v,16)*7/255));
  await robot.setEyes(...rgb); document.documentElement.style.setProperty('--eye',colour);
});
$('servoColour').onchange = () => run(() => robot.setServoLights(Array(8).fill(Number($('servoColour').value))));
document.querySelectorAll('#chest input').forEach(input=>input.onchange = () => run(() => robot.setChest([...document.querySelectorAll('#chest input')].map(c => c.checked))));
let heldDriveButton=null;
function bindDriveHold(button) {
  let active=false,timer;
  const pulse=()=>{if(!active)return;run(()=>studio.holdDrive(button.dataset.drive));timer=setTimeout(pulse,250);};
  const finish=()=>{
    if(!active)return;active=false;heldDriveButton=null;clearTimeout(timer);button.classList.remove('held-key');
    run(()=>robot.stop());
  };
  button.addEventListener('pointerdown',event=>{if(!robot.connected||heldDriveButton)return;event.preventDefault();active=true;heldDriveButton=button;button.classList.add('held-key');button.setPointerCapture(event.pointerId);pulse();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,finish);
  button.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.repeat||!robot.connected||heldDriveButton)return;event.preventDefault();active=true;heldDriveButton=button;button.classList.add('held-key');pulse();});
  button.addEventListener('keyup',event=>{if(event.key==='Enter'){event.preventDefault();finish();}});
  button.addEventListener('blur',finish);
  button.onclick=event=>event.preventDefault();
}
document.querySelectorAll('[data-drive]').forEach(bindDriveHold);
const stop = () => { if (robot.connected) run(() => studio ? studio.halt() : robot.stop()); };
$('stop').onclick = stop;
$('globalStop').onclick = stop;
window.addEventListener('blur', () => { if (robot.connected) run(() => robot.arm(false)); });
document.addEventListener('visibilitychange', () => { if (document.hidden && robot.connected) run(() => robot.arm(false)); });
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([entries.join('\n')],{type:'text/plain'}));
  const link = document.createElement('a'); link.href = url; link.download = 'meccanoid-session.log'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};
studio = setupStudio({robot,log,run,refresh:state,preview});
setupShell({robot,studio,run,practice});
const keyboard=new KeyboardControls({
  enabled:()=>robot.connected,
  drive:(direction,valid)=>studio.keyboardDrive(direction,valid),
  nudge:(deltas,valid)=>studio.keyboardNudge(deltas,valid),
  release:()=>studio.releaseJoint(),
  stop:()=>robot.connected?robot.stop():Promise.resolve(),halt:()=>studio.halt(),
  report:error=>{log(`Keyboard: ${error.message}`);$('notice').textContent=error.message;},
  onchange:held=>document.querySelectorAll('[data-key]').forEach(el=>el.classList.toggle('held-key',held.has(el.dataset.key))),
});
robot.addEventListener('armed',e=>{if(!e.detail)keyboard.clear();});
robot.addEventListener('state',()=>{if(!robot.connected)keyboard.clear();});
$('keyboardToggle').onclick=()=>{const open=$('keyboardHelp').hidden;$('keyboardHelp').hidden=!open;$('keyboardToggle').setAttribute('aria-expanded',String(open));};
JOINTS.forEach((joint,i)=>{const row=document.createElement('div');const label=document.createElement('span');label.textContent=joint.label;
 const keys=document.createElement('span');for(const [key,meaning] of [[JOINT_KEYS[i].minus,'−'],[JOINT_KEYS[i].plus,'+']]){const k=document.createElement('kbd');k.textContent=`${key.toUpperCase()} ${meaning}`;keys.append(k);}row.append(label,keys);$('keyboardJoints').append(row);});
if (!navigator.bluetooth&&!practice) {$('connect').disabled=true;$('notice').textContent='To connect a real robot, open this page in Chrome on a Chromebook, Mac, Android, or Windows PC. You can still try practice mode and the camera.';}
if(practice)run(async()=>{await robot.connect();await studio.syncPose();$('notice').textContent='You’re practising! Try the lights, moves, and jokes. Nothing here moves a real robot.';});
log('Ready. No commands are sent until you connect.'); state();
