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
/** Landmarks use anatomical left/right. Mirroring the video CSS does not change their IDs. */
export function bodySignals(world, image) {
  const signals={};
  if(tracked(world,image,11)&&tracked(world,image,12)) {
    const shoulders=midpoint(world[11],world[12]);
    const right=unit(subtract(world[12],world[11]));
    const hips=tracked(world,image,23)&&tracked(world,image,24)?midpoint(world[23],world[24]):null;
    const down=unit(hips?subtract(hips,shoulders):tracked(world,image,0)?subtract(shoulders,world[0]):{x:0,y:1,z:0});
    const forward=right&&down?unit(cross(right,down)):null;
    if(right&&down&&forward)for(const [side,s,e,w,sign] of [['left',11,13,15,-1],['right',12,14,16,1]]) {
      if(!tracked(world,image,e))continue;
      const upper=unit(subtract(world[e],world[s]));
      if(!upper)continue;
      signals[`${side}Lift`]=Math.atan2(dot(upper,right)*sign,dot(upper,down))/(Math.PI/2);
      signals[`${side}Swing`]=Math.atan2(dot(upper,forward),Math.max(0.05,dot(upper,down)))/(Math.PI/2);
      if(tracked(world,image,w)){
        const lower=unit(subtract(world[w],world[e]));
        if(lower){
          let bend=Math.acos(clamp(dot(upper,lower),-1,1))/(Math.PI/2);
          if(image?.[s]&&image?.[e]&&image?.[w]){
            const upperImage=flatDelta(image[e],image[s]),lowerImage=flatDelta(image[w],image[e]);
            if(length(upperImage)>.04&&length(lowerImage)>.04){
              bend=Math.max(bend,Math.acos(clamp(dot(unit(upperImage),unit(lowerImage)),-1,1))/(Math.PI/2));
            }
          }
          signals[`${side}Elbow`]=bend;
        }
      }
    }
  }
  if ([0,7,8].every(i=>inFrame(image?.[i]))) {
    const ears=midpoint(image[7],image[8]);
    const width=Math.abs(image[8].x-image[7].x);
    if(width>0.015) {
      signals.headTurn=clamp((image[0].x-ears.x)/width*2,-1,1);
      const a=image[7].x < image[8].x ? image[7] : image[8];
      const b=a===image[7]?image[8]:image[7];
      signals.headTilt=clamp(Math.atan2(b.y-a.y,b.x-a.x)/(Math.PI/4),-1,1);
    }
  }
  return Object.keys(signals).length?signals:null;
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
