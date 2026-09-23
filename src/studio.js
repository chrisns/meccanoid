import { JOINT_KEYS } from './keyboard.js';
import { JOINTS, defaultCalibration, validateCalibration, calibratedPose, clamp } from './joints.js';
import { MotionController, validateSequence } from './motion.js';
import { BodyTracker } from './tracker.js';
import { bodySignals, previewBodySignals, mirrorSignals } from './tracking-math.js';
import { DiagnosticSession, diagnosticSteps } from './diagnostics.js';
const $=id=>document.getElementById(id);
const storageKey=key=>new URLSearchParams(location.search).get('practice')==='1'?`practice.${key}`:key;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(storageKey(key)))??fallback;}catch{return fallback;}};
function download(name,value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadFile(input) {
  const file=input.files[0];if(!file)return null;
  if(file.size>1024*1024)throw new Error('JSON file must be smaller than 1 MB');
  return JSON.parse(await file.text());
}
export function setupStudio({robot,log,run,refresh,preview}) {
  const motion=new MotionController(robot),tracker=new BodyTracker($('camera'),$('landmarks')),diagnostics=new DiagnosticSession(robot);
  let calibration;
  try {
    const stored=read('meccanoid.calibration',null),version=read('meccanoid.calibrationVersion',0);
    if(stored&&version!==2)localStorage.setItem(storageKey('meccanoid.calibrationBeforeMeasured'),JSON.stringify(stored));
    calibration=version===2&&stored?validateCalibration(stored):defaultCalibration();
  } catch {calibration=defaultCalibration();}
  localStorage.setItem(storageKey('meccanoid.calibration'),JSON.stringify(calibration));
  localStorage.setItem(storageKey('meccanoid.calibrationVersion'),'2');
  let saved=read('meccanoid.poses',[]);if(!Array.isArray(saved))saved=[];
  saved=saved.filter(v=>typeof v.name==='string'&&Array.isArray(v.pose)&&v.pose.length===8&&v.pose.every(n=>Number.isInteger(n)&&n>=0&&n<=255)).slice(0,50);
  let labels=read('meccanoid.presetLabels',{});if(!labels||Array.isArray(labels)||typeof labels!=='object')labels={};
  let presetBank=new Map();
  let signals=null,smoothed=null,mirroring=false,cameraStalled=false,recoveringPose=false,lastFrame=0,manualOverrideUntil=0;
  let sequence=null,recording=false,recordStart=0,recordTimer,playTimer,playing=false,playEpoch=0;
  let cameraLoading=false,cameraEpoch=0,diagnosticMode=false;
  let capturing=false,captureStarting=false,captureEpoch=0,captureTimer,rangeSamples=null;
  const cards=[],calRows=[];
  const store=(key,value)=>localStorage.setItem(storageKey(key),JSON.stringify(value));
  function stopReplay() {playing=false;playEpoch++;clearTimeout(playTimer);}
  function pauseMirror(message='Camera control stopped') {
    mirroring=false;$('mirrorState').textContent=message;
  }
  function cancelProducers() {pauseMirror();stopReplay();motion.cancel();}
  function finishRecording() {
    recording=false;clearTimeout(recordTimer);
    $('sequenceState').textContent=sequence?.frames.length?`${sequence.frames.length} frames · ${(sequence.frames.at(-1).time/1000).toFixed(1)} seconds`:'No sequence loaded';state();
  }
  async function halt() {
    cameraEpoch++;tracker.stop();signals=null;cancelProducers();finishRecording();diagnostics.abort();diagnosticMode=false;
    if(robot.connected)await robot.arm(false);
    refresh();state();
  }
  function action(id,fn){$(id).onclick=()=>run(async()=>{await fn();state();});}
  function assertFree() {if(capturing||captureStarting)throw new Error('Finish range capture before using other controls');if(diagnosticMode)throw new Error('Stop the system test before using other controls');}
  async function ensureMotion(){if(!robot.armed)await robot.arm(true);}
  function assertPose(){if(!motion.current)throw new Error('Read the current robot pose first');}
  function renderPose() {
    if(!(tracker.running&&location.hash==='#copy')||performance.now()<manualOverrideUntil)preview?.setPose(motion.active?motion.target:motion.current,calibration);
    cards.forEach((card,i)=>{
      const value=motion.current?.[calibration[i].slot];
      card.output.textContent=value??'—';card.slider.min=calibration[i].min;card.slider.max=calibration[i].max;
      if(value!==undefined)card.slider.value=motion.active?motion.target[calibration[i].slot]:value;
    });
    $('poseState').textContent=motion.current?'Current pose available · last measured or sent':'Read pose required';
  }
  function renderCalibration() {
    calibration.forEach((c,i)=>{const row=calRows[i];for(const key of ['slot','min','centre','max'])row[key].value=c[key];row.reversed.checked=c.reversed;row.enabled.checked=c.enabled;});
    renderPose();
  }
  function readCalibration() {
    return validateCalibration(calRows.map((row,i)=>({key:JOINTS[i].key,slot:Number(row.slot.value),min:Number(row.min.value),centre:Number(row.centre.value),max:Number(row.max.value),reversed:row.reversed.checked,enabled:row.enabled.checked})));
  }
  async function applyCalibration() {
    assertFree();
    const next=readCalibration();cancelProducers();
    if(robot.connected)await robot.stop();
    calibration=next;store('meccanoid.calibration',calibration);renderPose();
    $('calibrationStatus').textContent=`Saved · ${calibration.filter(c=>c.enabled).length} verified joints enabled`;
  }
  async function nudgeJoint(index,direction) {
    assertFree();manualOverrideUntil=performance.now()+180;stopReplay();assertPose();await ensureMotion();
    const c=calibration[index],base=motion.active?motion.target:motion.current;
    motion.setJointTarget(c.slot,clamp(base[c.slot]+direction*4,c.min,c.max),calibration);
  }
  function bindJointHold(button,index,direction) {
    let active=false,timer;
    const pulse=()=>{if(!active)return;run(()=>nudgeJoint(index,direction));timer=setTimeout(pulse,100);};
    const finish=()=>{if(!active)return;active=false;clearTimeout(timer);button.classList.remove('held-key');manualOverrideUntil=performance.now()+80;motion.cancel();};
    button.addEventListener('pointerdown',event=>{if(button.disabled)return;event.preventDefault();active=true;button.classList.add('held-key');button.setPointerCapture(event.pointerId);pulse();});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,finish);
    button.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.repeat||button.disabled)return;event.preventDefault();active=true;button.classList.add('held-key');pulse();});
    button.addEventListener('keyup',event=>{if(event.key==='Enter'){event.preventDefault();finish();}});
    button.addEventListener('blur',finish);
    button.onclick=event=>event.preventDefault();
  }
  JOINTS.forEach((joint,i)=>{
    const card=document.createElement('div');card.className='joint-card';
    const heading=document.createElement('h3');heading.textContent=joint.label;
    const output=document.createElement('output');output.textContent='—';
    const label=document.createElement('label');label.append(heading,output);
    const slider=document.createElement('input');slider.type='range';slider.min=88;slider.max=168;slider.value=128;slider.setAttribute('aria-label',joint.label);
    slider.oninput=()=>run(async()=>{assertFree();manualOverrideUntil=performance.now()+220;stopReplay();assertPose();await ensureMotion();motion.setJointTarget(calibration[i].slot,Number(slider.value),calibration);});
    const toolbar=document.createElement('div');toolbar.className='toolbar';
    const buttons=[];
    for(const direction of [-1,1]){
      const button=document.createElement('button');const shortcut=direction<0?JOINT_KEYS[i].minus:JOINT_KEYS[i].plus;button.textContent=`${shortcut.toUpperCase()} ${direction<0?'−4':'＋4'}`;button.dataset.key=shortcut;button.setAttribute('aria-keyshortcuts',shortcut.toUpperCase());button.title=`Small nudge: ${joint.label}`;
      bindJointHold(button,i,direction);toolbar.append(button);buttons.push(button);
    }
    card.append(label,slider,toolbar);$('jointControls').append(card);cards.push({output,slider,buttons});
    const row=document.createElement('tr'),name=document.createElement('td');name.textContent=joint.label;row.append(name);const inputs={};
    for(const key of ['slot','min','centre','max','reversed','enabled']){
      const td=document.createElement('td'),input=document.createElement('input');input.type=['reversed','enabled'].includes(key)?'checkbox':'number';
      input.setAttribute('aria-label',`${joint.label} ${key}`);
      if(input.type==='number'){input.min=key==='slot'?0:24;input.max=key==='slot'?7:232;input.required=true;}
      input.onchange=()=>run(applyCalibration);td.append(input);row.append(td);inputs[key]=input;
    }
    calRows.push(inputs);$('calibrationRows').append(row);
  });
  renderCalibration();
  function renderSaved() {
    $('savedPoses').replaceChildren();
    saved.forEach((item,index)=>{
      const row=document.createElement('div');row.className='saved-item';const name=document.createElement('span');name.textContent=item.name;
      const play=document.createElement('button');play.textContent='Recall';play.disabled=!robot.connected||!motion.current||diagnosticMode;
      play.onclick=()=>run(async()=>{assertFree();cancelProducers();await ensureMotion();motion.setTarget(item.pose,calibration);});
      const remove=document.createElement('button');remove.textContent='Delete';remove.onclick=()=>run(()=>{saved.splice(index,1);store('meccanoid.poses',saved);renderSaved();});
      row.append(name,play,remove);$('savedPoses').append(row);
    });
  }
  function renderBank() {
    const selected=$('presetSelect').value;$('presetSelect').replaceChildren();
    const count=robot.status?.presetCount??0;
    if(!count){const option=new Option('Read bank first','');$('presetSelect').append(option);}
    for(let id=1;id<=count;id++) {
      const option=new Option(labels[id]?`${id} · ${String(labels[id]).slice(0,60)}`:(presetBank.has(id)?`${id} · ${presetBank.get(id)??'unavailable metadata'}`:`Preset ${id} · not labelled`),String(id));
      option.disabled=presetBank.has(id)&&!presetBank.get(id);$('presetSelect').append(option);
    }
    if([...$('presetSelect').options].some(o=>o.value===selected))$('presetSelect').value=selected;
    $('bankState').textContent=robot.status?`${count} built-in presets · ${robot.status.limCount} L.I.M. recordings`:'Awaiting robot status';
    $('presetLabel').value=labels[$('presetSelect').value]??'';
  }
  let lastBankCount=-1,lastLimCount=-1;
  robot.addEventListener('status',({detail})=>{
    if(detail.presetCount!==lastBankCount||detail.limCount!==lastLimCount){lastBankCount=detail.presetCount;lastLimCount=detail.limCount;renderBank();}
    for(const colour of ['blue','red','green','yellow'])$(`input-${colour}`).classList.toggle('pressed',detail.buttons[colour]);
  });
  for(const colour of ['blue','red','green','yellow']){const badge=document.createElement('span');badge.id=`input-${colour}`;badge.textContent=colour;$('buttonInputs').append(badge);}
  motion.addEventListener('pose',({detail})=>{
    renderPose();
    if(recording&&sequence.frames.length<600){const time=Math.round(performance.now()-recordStart);if(time<=60000&&(!sequence.frames.length||time>sequence.frames.at(-1).time))sequence.frames.push({time,pose:[...detail]});}
    state();
  });
  motion.addEventListener('error',e=>{if(!tracker.running)pauseMirror(e.detail);stopReplay();log(e.detail);state();});
  robot.addEventListener('stop',()=>{if(!tracker.running)pauseMirror();stopReplay();if(capturing)endCapture('Range capture stopped; previous limits retained.');});
  robot.addEventListener('armed',e=>{if(!e.detail){cancelProducers();diagnostics.abort();diagnosticMode=false;}state();});
  robot.addEventListener('state',()=>{if(!robot.connected){endCapture('Disconnected; previous limits retained.');presetBank=new Map();cancelProducers();finishRecording();diagnosticMode=false;renderBank();renderPose();}state();});
  function endCapture(message) {
    if(capturing||captureStarting){motion.cancel();motion.current=null;renderPose();}
    capturing=false;captureEpoch++;clearTimeout(captureTimer);robot.endRangeCapture();
    $('rangeCaptureState').textContent=message;state();
  }
  action('startRangeCapture',async()=>{
    assertFree();cancelProducers();finishRecording();captureStarting=true;state();
    const epoch=++captureEpoch;
    try {
      await robot.beginRangeCapture();
      if(epoch!==captureEpoch||!robot.connected)throw new Error('Range capture cancelled');
      capturing=true;rangeSamples=calibration.map(()=>null);
      async function sample() {
        try {
          const pose=await robot.readPose();if(!capturing||epoch!==captureEpoch)return;
          motion.current=[...pose];motion.target=[...pose];renderPose();
          calibration.forEach((c,i)=>{
            const value=pose[c.slot];if(value<24||value>232)return;
            const seen=rangeSamples[i];rangeSamples[i]=seen?{min:Math.min(seen.min,value),max:Math.max(seen.max,value)}:{min:value,max:value};
          });
          $('rangeCaptureState').textContent='Reading by hand · '+rangeSamples.map((r,i)=>`${JOINTS[i].label}: ${r?`${r.min}–${r.max}`:'no valid reading'}`).join(' · ');
          captureTimer=setTimeout(sample,200);
        }catch(error){if(epoch===captureEpoch){endCapture(`Capture failed: ${error.message}. Previous limits retained.`);log(error.message);}}
      }
      await sample();
    }finally{captureStarting=false;if(!capturing)robot.endRangeCapture();state();}
  });
  action('finishRangeCapture',()=>{
    if(!capturing)throw new Error('Start range capture first');
    const usable=(r,c)=>r&&r.max-r.min>=10&&r.min+4<=c.centre&&r.max-4>=c.centre;
    const next=calibration.map((c,i)=>usable(rangeSamples[i],c)?{...c,min:rangeSamples[i].min+4,max:rangeSamples[i].max-4}:c);
    const count=rangeSamples.filter((r,i)=>usable(r,calibration[i])).length;
    calibration=validateCalibration(next);store('meccanoid.calibration',calibration);
    endCapture(`Saved measured limits for ${count} joints with a four-unit safety margin. The measured neutral stayed unchanged; incomplete sweeps kept their previous limits. Motion remains disabled.`);renderCalibration();
  });
  action('cancelRangeCapture',()=>endCapture('Capture discarded; previous limits retained.'));
  action('halt',halt);
  action('syncPose',async()=>{assertFree();cancelProducers();await motion.sync();renderPose();});
  action('resetLimits',async()=>{assertFree();cancelProducers();if(robot.connected)await robot.stop();calibration=defaultCalibration();store('meccanoid.calibration',calibration);renderCalibration();$('calibrationStatus').textContent='Measured G15KS centres and safe limits restored.';});
  action('exportCalibration',()=>download('meccanoid-calibration.json',{version:1,joints:calibration}));
  $('importCalibration').onchange=()=>run(async()=>{assertFree();const data=await loadFile($('importCalibration'));if(!data)return;if(data.version!==1)throw new Error('Unsupported calibration version');const next=validateCalibration(data.joints);cancelProducers();if(robot.connected)await robot.stop();calibration=next;store('meccanoid.calibration',calibration);renderCalibration();state();});
  action('savePose',()=>{assertPose();if(saved.length>=50)throw new Error('Maximum 50 saved poses');saved.push({name:$('poseName').value.trim()||`Pose ${saved.length+1}`,pose:[...motion.current]});store('meccanoid.poses',saved);renderSaved();});
  action('recordSequence',()=>{assertFree();assertPose();stopReplay();recording=true;recordStart=performance.now();sequence={version:1,name:'Recorded movement',frames:[{time:0,pose:[...motion.current]}]};recordTimer=setTimeout(finishRecording,60000);$('sequenceState').textContent='Recording sent joint poses…';});
  action('finishSequence',finishRecording);
  action('playSequence',async()=>{
    assertFree();assertPose();if(!sequence?.frames.length)throw new Error('Record or import a sequence first');
    await ensureMotion();cancelProducers();finishRecording();
    const data=validateSequence(sequence);playing=true;const epoch=++playEpoch,start=performance.now();let index=0;
    const tick=()=>{
      if(!playing||epoch!==playEpoch)return;
      try{
        let frame;while(index<data.frames.length&&data.frames[index].time<=performance.now()-start)frame=data.frames[index++];
        if(frame)motion.setTarget(frame.pose,calibration);
        if(index<data.frames.length)playTimer=setTimeout(tick,30);
        else{playing=false;$('sequenceState').textContent='Final pose sent to the rate limiter';state();}
      }catch(error){stopReplay();motion.cancel();log(error.message);$('sequenceState').textContent=error.message;state();}
    };$('sequenceState').textContent='Replaying within current joint limits…';tick();
  });
  action('stopSequence',async()=>{stopReplay();motion.cancel();if(robot.connected)await robot.stop();$('sequenceState').textContent='Replay stopped';});
  action('exportSequence',()=>{if(!sequence?.frames.length)throw new Error('No recorded sequence');download('meccanoid-sequence.json',validateSequence(sequence));});
  $('importSequence').onchange=()=>run(async()=>{const data=await loadFile($('importSequence'));if(!data)return;const next=validateSequence(data);cancelProducers();finishRecording();sequence=next;$('sequenceState').textContent=`Loaded ${sequence.frames.length} frames. Replay applies current joint limits.`;state();});
  action('cameraStart',async()=>{
    assertFree();const epoch=++cameraEpoch;cameraLoading=true;state();
    try {
      await tracker.start();if(epoch!==cameraEpoch||!tracker.running)return;
      if(!document.hasFocus()){tracker.stop();return;}
      if(robot.connected){await motion.sync();if(epoch!==cameraEpoch||!tracker.running)return;await robot.arm(true);if(epoch!==cameraEpoch||!tracker.running){await robot.arm(false);return;}mirroring=true;smoothed=null;$('mirrorState').textContent='Camera is controlling the robot';}
      else $('mirrorState').textContent='Camera is controlling the on-screen robot';
    } catch(error) {
      if(epoch===cameraEpoch){tracker.stop();if(robot.connected)await robot.arm(false);throw error;}
    } finally {cameraLoading=false;refresh();state();}
  });
  action('cameraStop',async()=>{cameraEpoch++;tracker.stop();signals=null;pauseMirror();motion.cancel();if(robot.connected)await robot.arm(false);});
  tracker.addEventListener('state',e=>{$('cameraState').textContent=e.detail;if(!tracker.running){pauseMirror();signals=null;smoothed=null;}state();});
  tracker.addEventListener('error',e=>{pauseMirror(e.detail);signals=null;log(`Camera: ${e.detail}`);if(robot.connected)run(()=>robot.arm(false));state();});
  for(const joint of JOINTS){const row=document.createElement('div');row.className='tracking-row';const name=document.createElement('span');name.textContent=joint.label;const meter=document.createElement('meter');meter.id=`signal-${joint.key}`;meter.min=-1;meter.max=1;meter.value=0;row.append(name,meter);$('trackingBars').append(row);}
  tracker.addEventListener('frame',({detail})=>{
    lastFrame=performance.now();const mirrored=$('mirrorSides').checked;const raw=bodySignals(detail.world,detail.landmarks);signals=mirrorSignals(raw,mirrored);
    if(!signals){preview?.trackingLost();$('cameraState').textContent='Step into view — robot stopped';smoothed=null;if(mirroring&&!cameraStalled){cameraStalled=true;motion.cancel();if(robot.connected)run(()=>robot.stop());}state();return;}
    cameraStalled=false;$('cameraState').textContent=mirroring?'Body tracked · controlling robot':'Body tracked · on-screen preview';
    const relative=signals,previewSignals=mirrorSignals(previewBodySignals(detail.world,detail.landmarks),mirrored);
    if(location.hash==='#copy'&&performance.now()>=manualOverrideUntil)preview?.setSignals(previewSignals,calibration,Number($('mirrorGain').value)/100);
    for(const joint of JOINTS)$(`signal-${joint.key}`).value=relative[joint.key]??0;
    if(mirroring&&performance.now()>=manualOverrideUntil){
      try {
        if(!motion.current){
          if(!recoveringPose){recoveringPose=true;run(async()=>{try{await motion.sync();}catch(error){pauseMirror('Camera control paused — pose read failed');throw error;}finally{recoveringPose=false;}});}
          return;
        }
        if(!smoothed)smoothed={};
        for(const key of Object.keys(smoothed))if(!Number.isFinite(relative[key]))delete smoothed[key];
        for(const [key,value] of Object.entries(relative))smoothed[key]=smoothed[key]===undefined?value:smoothed[key]*0.7+value*0.3;
        motion.setTarget(calibratedPose(smoothed,calibration,motion.current,Number($('mirrorGain').value)/100),calibration);
      }catch(error){pauseMirror(error.message);motion.cancel();log(error.message);}
    }
    state();
  });
  setInterval(()=>{if(mirroring&&!cameraStalled&&performance.now()-lastFrame>1000){cameraStalled=true;$('mirrorState').textContent='Waiting for camera — robot stopped';motion.cancel();if(robot.connected)run(()=>robot.stop());state();}},250);
  $('mirrorSides').onchange=()=>{smoothed=null;};
  $('mirrorGain').oninput=()=>$('gainValue').textContent=`${$('mirrorGain').value}%`;
  action('syncClock',async()=>{const now=new Date();await robot.syncClock(now);$('clockState').textContent=`Clock sent: ${now.toLocaleString()}. Verify with TELL TIME.`;});
  action('refreshBank',async()=>{$('bankState').textContent='Reading names from the robot…';const entries=await robot.readPresetBank();presetBank=new Map(entries.map(e=>[e.id,e.name]));renderBank();});
  $('presetSelect').onchange=()=>$('presetLabel').value=labels[$('presetSelect').value]??'';
  $('presetLabel').onchange=()=>run(()=>{const id=$('presetSelect').value;if(!id)throw new Error('Select a preset');labels[id]=$('presetLabel').value.trim();store('meccanoid.presetLabels',labels);renderBank();});
  async function playRobot(fn){assertFree();cancelProducers();finishRecording();motion.current=null;renderPose();if(robot.connected){await robot.stop();await ensureMotion();}await fn();}
  for(const [id,level] of [['volumeQuiet',1],['volumeMedium',2],['volumeLoud',3]])action(id,async()=>{await playRobot(()=>robot.setVolume(level));$('audioState').textContent=`Volume ${level} sent · listen for its preview`;});
  let volumeTimer;
  $('volumeCustom').oninput=()=>{clearTimeout(volumeTimer);volumeTimer=setTimeout(()=>run(async()=>{if(!robot.connected||$('volumeCustom').disabled||!$('volumeCustom').value||!$('volumeCustom').checkValidity())return;const value=Number($('volumeCustom').value);await playRobot(()=>robot.setExperimentalVolume(value));$('audioState').textContent=`Experimental volume ${value} sent · effect needs listening confirmation`; }),200);};
  const quickActions=[
    ['quickJoke',3,'Joke requested on the robot'],
    ['quickIntro',1,'Introduction requested on the robot'],
    ['quickHighFive',2,'High five requested on the robot'],
    ['quickSystemCheck',10,'System check requested on the robot'],
    ['quickUserName',11,'User-name action requested on the robot'],
    ['quickRobotName',12,'Robot-name action requested on the robot'],
    ['quickHandshake',19,'Handshake requested on the robot'],
  ];
  for(const [id,preset,message] of quickActions)action(id,async()=>{await playRobot(()=>robot.playPreset(preset));$('audioState').textContent=message;});
  action('quickTime',async()=>{await playRobot(async()=>{await robot.syncClock(new Date());await robot.playPreset(18);});$('audioState').textContent='Clock synced and time requested on the robot';});
  action('playPreset',()=>playRobot(()=>{const id=Number($('presetSelect').value);if(presetBank.has(id)&&!presetBank.get(id))throw new Error('This preset returned invalid metadata');return robot.playPreset(id,Number($('presetVariant').value));}));
  action('playLim',()=>playRobot(()=>{const slot=Number($('limSlot').value);if(!robot.status||slot>robot.status.limCount)throw new Error('Choose a slot reported by the robot');return robot.playLIM(slot);}));
  function renderTest() {
    const step=diagnostics.step;$('testTitle').textContent=step?.title??'Check complete';$('testDescription').textContent=step?.description??'Export your report. Skipped or manual checks remain unverified.';
    $('testProgress').max=diagnosticSteps.length;$('testProgress').value=diagnostics.index;$('testCount').textContent=`${diagnostics.index} / ${diagnosticSteps.length}`;
    $('testResults').replaceChildren();for(const result of diagnostics.results){const li=document.createElement('li');li.textContent=`${result.title}: ${result.outcome}${result.notes?` — ${result.notes}`:''}`;$('testResults').append(li);}
  }
  diagnostics.addEventListener('progress',e=>{$('testEvidence').textContent=e.detail;renderTest();state();});
  action('runTest',async()=>{
    cancelProducers();finishRecording();diagnosticMode=true;motion.current=null;renderPose();state();
    try{if(robot.connected){await robot.stop();if(diagnostics.step?.motion)await ensureMotion();}await diagnostics.run(calibration,{visible:$('visibleTests').checked});}finally{state();}
  });
  action('abortTest',async()=>{diagnostics.abort();diagnosticMode=false;if(robot.connected)await robot.arm(false);state();});
  action('resetTests',()=>{diagnostics.reset();diagnosticMode=false;$('testEvidence').textContent='Ready';renderTest();});
  document.querySelectorAll('[data-result]').forEach(button=>button.onclick=()=>run(()=>{diagnostics.mark(button.dataset.result,$('testNotes').value);$('testNotes').value='';if(!diagnostics.step)diagnosticMode=false;store('meccanoid.lastReport',diagnostics.report());renderTest();state();}));
  action('exportReport',()=>download('meccanoid-system-test.json',diagnostics.report()));
  window.addEventListener('blur',()=>{if(capturing||captureStarting)endCapture('Capture stopped when window lost focus; previous limits retained.');if(cameraLoading)return;cameraEpoch++;tracker.stop();signals=null;cancelProducers();finishRecording();diagnostics.abort();diagnosticMode=false;state();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cameraEpoch++;tracker.stop();signals=null;cancelProducers();}});
  window.addEventListener('pagehide',()=>{cameraEpoch++;tracker.stop();});
  function state() {
    const teaching=capturing||captureStarting;
    const available=robot.connected&&!diagnosticMode&&!teaching;
    $('startRangeCapture').disabled=!robot.connected||diagnosticMode||teaching;$('finishRangeCapture').disabled=!capturing;$('cancelRangeCapture').disabled=!teaching;
    $('copyDrive').disabled=!available;
    $('servoColour').disabled=teaching;document.querySelectorAll('#chest input').forEach(input=>input.disabled=teaching);
    calRows.forEach(row=>Object.values(row).forEach(input=>input.disabled=teaching));
    for(const id of ['resetLimits','importCalibration'])$(id).disabled=teaching;
    cards.forEach((card,i)=>{card.slider.disabled=!available||!motion.current;card.buttons.forEach(b=>b.disabled=!available||!motion.current);});
    $('syncPose').disabled=!robot.connected||diagnosticMode||teaching;
    $('savePose').disabled=!motion.current;
    $('cameraStart').disabled=cameraLoading||tracker.running;$('cameraStop').disabled=!tracker.running;
    $('cameraStop').textContent=cameraLoading?'Cancel camera setup':'Camera off';
    $('recordSequence').disabled=!available||!motion.current||recording;$('finishSequence').disabled=!recording;
    $('playSequence').disabled=!available||!motion.current||!sequence?.frames.length||recording||playing;
    $('stopSequence').disabled=!playing;
    for(const id of ['volumeQuiet','volumeMedium','volumeLoud','volumeCustom'])$(id).disabled=!robot.connected||diagnosticMode||teaching;
    $('syncClock').disabled=!robot.connected;$('refreshBank').disabled=!robot.connected;$('playPreset').disabled=!available||!$('presetSelect').value;
    for(const [id] of quickActions)$(id).disabled=!available;$('quickTime').disabled=!available;
    $('visibleTests').disabled=diagnostics.running;
    $('playLim').disabled=!available||!robot.status?.limCount;
    $('runTest').disabled=teaching||diagnostics.running||!diagnostics.step||(!robot.connected&&diagnostics.step.kind!=='manual');
    $('resetTests').disabled=diagnostics.running;
    document.querySelectorAll('[data-result]').forEach(b=>b.disabled=diagnostics.running||!diagnostics.step);
    if(diagnosticMode)$('motion').disabled=true;
    renderSaved();
  }
  renderSaved();renderTest();renderBank();state();
  return {state,halt,
    async keyboardDrive(direction,valid){assertFree();manualOverrideUntil=performance.now()+500;motion.cancel();await ensureMotion();if(valid())await robot.holdDirection(direction,700);},
    async holdDrive(direction){assertFree();manualOverrideUntil=performance.now()+500;motion.cancel();await ensureMotion();await robot.holdDirection(direction,700);},
    async keyboardNudge(deltas,valid){
      assertFree();manualOverrideUntil=performance.now()+180;stopReplay();if(!motion.current)await motion.sync();await ensureMotion();if(!valid())return;
      const base=motion.active?motion.target:motion.current,pose=[...base];
      const config=calibration.map((c,i)=>{if(deltas[i])pose[c.slot]=clamp(base[c.slot]+deltas[i],c.min,c.max);return {...c,enabled:Boolean(deltas[i])};});
      motion.setTarget(pose,config);
    },
    releaseJoint(){manualOverrideUntil=performance.now()+80;motion.cancel();},
    async syncPose(){await motion.sync();renderPose();state();},async navigate(){cameraEpoch++;tracker.stop();signals=null;cancelProducers();diagnostics.abort();diagnosticMode=false;if(robot.connected)await robot.stop();state();},async beforeManual(){assertFree();cameraEpoch++;tracker.stop();signals=null;cancelProducers();motion.current=null;renderPose();await robot.stop();},get diagnostics(){return diagnostics;}};
}
