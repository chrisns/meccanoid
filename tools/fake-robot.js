export function fakeRobot() {
  window.robotWrites=[];
  const pack=(command,payload=[])=>{const a=new Uint8Array(20);a[0]=command;a.set(payload,1);const sum=a.reduce((s,v)=>s+v,0);a[18]=sum>>8;a[19]=sum&255;return a;};
  const notify=new EventTarget();notify.startNotifications=async()=>{};
  let pose=Array(8).fill(128);
  window.setRobotPose=values=>{pose=[...values];};
  window.dropPoseReplies=false;
  const emit=bytes=>{notify.value=new DataView(bytes.buffer);notify.dispatchEvent(new Event('characteristicvaluechanged'));};
  const command={writeValueWithoutResponse:async bytes=>{
   window.robotWrites.push(Array.from(bytes));
   if(bytes[0]===0x1a)emit(pack(0x1a,[1,0,1]));
   if(bytes[0]===9&&!window.dropPoseReplies)emit(pack(9,pose));
   if(bytes[0]===24)emit(pack(24,[bytes[1],0,...Array.from(bytes[1]===1?'INTRODUCE':`PRESET ${bytes[1]}`,c=>c.charCodeAt(0))]));
   if(bytes[0]===8)pose=Array.from(bytes.slice(1,9));
   if(bytes[0]===1){const payload=Array(17).fill(0);payload[13]=20;payload[12]=2;emit(pack(1,payload));}
  }};
  const device=new EventTarget();device.name='MECCANOID simulated';device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return {getPrimaryService:async()=>({getCharacteristic:async id=>id===0xfff2?command:notify})};},disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
  Object.defineProperty(navigator,'bluetooth',{value:{requestDevice:async()=>device},configurable:true});
}
