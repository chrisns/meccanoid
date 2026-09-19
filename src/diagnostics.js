import { JOINTS } from './joints.js';
export const diagnosticSteps = [
  {id:'status',title:'Connection & status',kind:'status',description:'Read robot status. A reply confirms communication; an error code is reported without guessing its meaning.'},
  ...['Red','Green','Blue'].map((colour,index)=>({id:`eyes-${index}`,title:`Eyes · ${colour}`,kind:'eyes',index,description:`Both eyes should turn ${colour.toLowerCase()}.`})),
  ...['Blue','Red','Green','Yellow'].map((colour,index)=>({id:`chest-${index}`,title:`Chest LED · ${colour}`,kind:'chest',index,description:'Only the indicated chest LED should light. Record a different colour if the order differs on this firmware.'})),
  ...JOINTS.map((joint,index)=>({id:`led-${index}`,title:`Servo LED · ${joint.label}`,kind:'servoLED',index,description:`Only the LED on ${joint.label.toLowerCase()} should turn red. Other servo LEDs are off during this step.`})),
  ...JOINTS.map((joint,index)=>({id:`joint-${index}`,title:`Joint · ${joint.label}`,kind:'joint',index,motion:true,description:'Reads all positions, tests this joint, reads feedback, then returns to the initial pose. Larger mode sweeps within ±24 raw units for 10 seconds; small mode nudges by four. Confirm the physical joint and direction.'})),
  ...['Left','Right'].flatMap((side,index)=>[1,-1].map(direction=>({id:`wheel-${index}-${direction}`,title:`${side} wheel · ${direction===1?'forward':'reverse'}`,kind:'wheel',index,direction,motion:true,description:'A single wheel gets a low-speed 200 ms pulse, followed by zero speed. Keep the robot stable with the wheels clear of the floor.'}))),
  ...['forward','backward','left','right'].map(direction=>({id:`travel-${direction}`,title:`Robot movement · ${direction}`,kind:'travel',direction,motion:true,description:'Verified built-in movement for one second, followed by STOP and zero wheel speed. Clear space around the robot.'})),
  ...['blue','red','green','yellow'].map(colour=>({id:`button-${colour}`,title:`Button input · ${colour}`,kind:'button',colour,description:`Press and hold the ${colour} chest button for at least one second. Incoming status reports will show whether its input was detected.`})),
  {id:'speaker',title:'Speaker · manual check',kind:'manual',description:'Confirm you heard clear startup speech. No sound upload or automatic speech test is claimed here.'},
  {id:'microphone',title:'Microphone · manual check',kind:'manual',description:'Outside Bluetooth control, say the robot’s wake name and check that it acknowledges you. No raw microphone-level sensor is exposed by the recovered protocol; leave this pending until checked.'},
];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class DiagnosticSession extends EventTarget {
  index=0;results=[];running=false;#epoch=0;#record=null;
  constructor(robot) {
    super();this.robot=robot;
    robot.addEventListener('status',({detail})=>{
      const step=diagnosticSteps[this.index];
      if(this.#record && step?.kind==='button' && detail.buttons[step.colour]) {
        this.#record.evidence.detected=true;this.#emit('Button input detected');
      }
    });
    robot.addEventListener('state',()=>{if(!robot.connected)this.abort();});
  }
  get step(){return diagnosticSteps[this.index]??null;}
  #emit(message){this.dispatchEvent(new CustomEvent('progress',{detail:message}));}
  reset(){if(this.running)throw new Error('Stop the current test first');this.#epoch++;this.index=0;this.results=[];this.#record=null;}
  async run(calibration, {visible=false}={}) {
    if(this.running)throw new Error('Test already running');
    const step=this.step;if(!step)throw new Error('Test complete');
    if(step.kind!=='manual'&&!this.robot.connected)throw new Error('Connect the robot first');
    if(step.motion&&!this.robot.armed)throw new Error('Enable motion controls first');
    this.running=true;const epoch=++this.#epoch;
    const record=this.#record={id:step.id,title:step.title,started:new Date().toISOString(),evidence:{},outcome:'pending',notes:''};
    const check=()=>{if(epoch!==this.#epoch)throw new Error('Test cancelled');};
    try {
      if(step.kind==='status')record.evidence.status=await this.robot.readStatus();
      if(step.kind==='eyes') {const rgb=[0,0,0];rgb[step.index]=7;await this.robot.setEyes(...rgb);}
      if(step.kind==='chest')await this.robot.setChest([0,1,2,3].map(i=>i===step.index));
      if(step.kind==='servoLED') {const colours=Array(8).fill(0);const slot=calibration[step.index].slot;colours[slot]=1;record.evidence.slot=slot;await this.robot.setServoLights(colours);}
      if(step.kind==='joint') {
        const slot=calibration[step.index].slot;
        const before=await this.robot.readPose();check();
        const value=before[slot];
        if(value<24||value>232)throw new Error(`Slot ${slot} returned ${value}; no movement sent because this is outside the app's position range`);
        const target=[...before];target[slot]=value>228?value-4:value+4;
        record.evidence={slot,before:value,target:target[slot]};
        if (visible) {
          record.evidence.sweep={amplitude:24,durationMs:10000};
          for(let n=0;n<100;n++) {
            check();const frame=[...before];frame[slot]=Math.max(24,Math.min(232,value+Math.round(Math.sin(n*Math.PI/20)*24)));
            await this.robot.setPose(frame);await sleep(100);
          }
        } else {await this.robot.setPose(target);await sleep(500);}
        check();
        try {record.evidence.after=(await this.robot.readPose())[slot];}
        finally {if(epoch===this.#epoch&&this.robot.connected&&this.robot.armed)await this.robot.setPose(before);}
      }
      if(step.kind==='wheel') {
        await this.robot.drive(step.index===0?step.direction*40:0,step.index===1?step.direction*40:0,200);
        await sleep(300);check();await this.robot.stop();record.evidence.pulseMs=200;
      }
      if(step.kind==='travel') {await this.robot.moveDirection(step.direction,1000);await sleep(1100);check();await this.robot.stop();record.evidence.durationMs=1000;}
      if(step.kind==='button')record.evidence.detected=false;
      check();
      const detail=step.kind==='joint'?`Slot ${record.evidence.slot}: ${record.evidence.before} → ${record.evidence.sweep?'bounded sweep':`target ${record.evidence.target}`} → feedback ${record.evidence.after}; original pose commanded again. `:step.kind==='status'?`Status received: battery code ${record.evidence.status.batteryCode}, error code ${record.evidence.status.errorCode}. `:'';
      this.#emit(step.kind==='button'?'Waiting for the physical button; then record your result.':`${detail}Command finished. Record what you observed.`);
    } catch(error){record.evidence.error=error.message;this.#emit(error.message);throw error;}
    finally{this.running=false;}
  }
  mark(outcome,notes='') {
    if(this.running)throw new Error('Wait for the test to finish');
    if(!['working','wrong-component','no-response','skipped'].includes(outcome))throw new Error('Invalid outcome');
    if(!this.step)throw new Error('Test complete');
    if(outcome!=='skipped'&&!this.#record)throw new Error('Run this step before recording a result');
    this.results.push({...this.#record,id:this.step.id,title:this.step.title,outcome,notes:String(notes).slice(0,1000),finished:new Date().toISOString()});
    this.#record=null;this.index++;this.#emit(this.step?'Next component — press Run when ready.':'Wiring check complete. Export the report.');
  }
  abort(){this.#epoch++;this.#record=null;this.#emit('Test stopped. Re-run the current step when ready.');}
  report(){return {version:1,date:new Date().toISOString(),completed:this.index===diagnosticSteps.length,results:this.results,pending:diagnosticSteps.slice(this.index).map(s=>s.id)};}
}
