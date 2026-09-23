import { clamp } from './joints.js';
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const length=a=>Math.sqrt(dot(a,a));
const unit=a=>{const n=length(a);return n>1e-5?{x:a.x/n,y:a.y/n,z:a.z/n}:null;};
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2});
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const flatDelta=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:0});
const visible=p=>p && [p.x,p.y,p.z].every(Number.isFinite) && (p.visibility ?? 0)>=0.65;
const inFrame=p=>visible(p)&&p.x>=-.015&&p.x<=1.015&&p.y>=-.015&&p.y<=1.015;
const tracked=(world,image,i)=>visible(world?.[i])&&(!image?.length||inFrame(image[i]));
// Laptop-camera perspective compresses the upper part of a side-lift arc. Keep
// down-to-horizontal linear, then expand overhead travel to the robot's range.
const expandOverheadLift=value=>value>1?1+(value-1)*1.75:value;
const imageArmLift=(image,s,e,w)=>{
  if(!inFrame(image?.[s])||!inFrame(image?.[e]))return null;
  const tip=inFrame(image?.[w])?image[w]:image[e],arm=flatDelta(tip,image[s]);
  return length(arm)>.04?Math.atan2(Math.abs(arm.x),arm.y)/(Math.PI/2):null;
};
const ordered=(a,b)=>a.x<=b.x?[a,b]:[b,a];
const roll=(a,b)=>{const [left,right]=ordered(a,b);return Math.atan2(right.y-left.y,right.x-left.x);};
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
/** Landmarks use anatomical left/right. Mirroring the video CSS does not change their IDs. */
export function bodySignals(world, image) {
  const signals={};
  if(visible(world?.[11])&&visible(world?.[12])) {
    const shoulders=midpoint(world[11],world[12]);
    const right=unit(subtract(world[12],world[11]));
    const hips=visible(world?.[23])&&visible(world?.[24])?midpoint(world[23],world[24]):null;
    const down=unit(hips?subtract(hips,shoulders):visible(world?.[0])?subtract(shoulders,world[0]):{x:0,y:1,z:0});
    const forward=right&&down?unit(cross(right,down)):null;
    if(right&&down&&forward)for(const [side,s,e,w,sign] of [['left',11,13,15,-1],['right',12,14,16,1]]) {
      if(!visible(world?.[e]))continue;
      const upper=unit(subtract(world[e],world[s]));
      if(!upper)continue;
      let lift=expandOverheadLift(Math.atan2(dot(upper,right)*sign,dot(upper,down))/(Math.PI/2));
      let swing=Math.atan2(dot(upper,forward),Math.max(0.05,dot(upper,down)))/(Math.PI/2);
      const screenLift=imageArmLift(image,s,e,w);
      if(Number.isFinite(screenLift)){
        lift=Math.max(lift,screenLift);
        if(screenLift>1)swing*=clamp(2-screenLift,0,1);
      }
      signals[`${side}Lift`]=lift;signals[`${side}Swing`]=swing;
      if(visible(world?.[w])){
        const lower=unit(subtract(world[w],world[e]));
        if(lower)signals[`${side}Elbow`]=Math.acos(clamp(dot(upper,lower),-1,1))/(Math.PI/2);
      }
    }
  }
  const facePair=[[7,8],[3,6],[2,5]].map(([a,b])=>visible(image?.[a])&&visible(image?.[b])?[image[a],image[b]]:null).filter(Boolean).sort((a,b)=>Math.abs(b[1].x-b[0].x)-Math.abs(a[1].x-a[0].x))[0];
  if(facePair){
    const width=Math.abs(facePair[1].x-facePair[0].x);
    if(width>.015){
      if(visible(image?.[0]))signals.headTurn=clamp((image[0].x-midpoint(...facePair).x)/width*4,-2,2);
      const shoulderRoll=visible(image?.[11])&&visible(image?.[12])?roll(image[11],image[12]):0;
      signals.headTilt=clamp(angleDifference(roll(...facePair),shoulderRoll)/(Math.PI/12),-2,2);
    }
  }
  return Object.keys(signals).length?signals:null;
}
/** Make the on-screen model match only limbs that are actually visible, without changing robot commands. */
export function previewBodySignals(world,image) {
  const signals=bodySignals(world,image);
  if(!signals)return null;
  const result={...signals};
  for(const [side,s,e,w] of [['left',11,13,15],['right',12,14,16]]) {
    if(!tracked(world,image,s)||!tracked(world,image,e)){
      for(const joint of ['Lift','Swing','Elbow'])delete result[`${side}${joint}`];
      continue;
    }
    if(tracked(world,image,w)){
      const upper=flatDelta(image[e],image[s]),lower=flatDelta(image[w],image[e]);
      if(length(upper)>.04&&length(lower)>.04){
        const bend=Math.acos(clamp(dot(unit(upper),unit(lower)),-1,1))/(Math.PI/2);
        result[`${side}Elbow`]=Math.max(result[`${side}Elbow`]??0,bend);
      }
    } else delete result[`${side}Elbow`];
  }
  return result;
}
export function mirrorSignals(signals, mirrored=true) {
  if(!signals) return null;
  if(!mirrored) return {...signals};
  const result={...signals};
  for(const joint of ['Elbow','Lift','Swing']) {
    result[`left${joint}`]=signals[`right${joint}`];result[`right${joint}`]=signals[`left${joint}`];
  }
  if(Number.isFinite(signals.headTurn)) result.headTurn=-signals.headTurn;
  if(Number.isFinite(signals.headTilt)) result.headTilt=-signals.headTilt;
  return result;
}
export function relativeSignals(signals, neutral) {
  return Object.fromEntries(Object.entries(signals).filter(([key,v])=>Number.isFinite(v)&&Number.isFinite(neutral?.[key])).map(([key,v])=>[key,clamp(v-neutral[key],-1,1)]));
}
