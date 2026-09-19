import { packet } from './protocol.js';

/** An in-memory robot. Never requests Bluetooth or produces physical movement. */
export class PracticeTransport extends EventTarget {
  pose = Array(8).fill(128);
  async connect() { return 'Practice robot'; }
  async write(bytes) {
    const command=bytes[0];
    const reply=(id,payload)=>this.dispatchEvent(new CustomEvent('notification',{detail:packet(id,payload)}));
    if(command===8)this.pose=Array.from(bytes.slice(1,9));
    if(command===9)reply(9,this.pose);
    if(command===1){const payload=Array(17).fill(0);payload[13]=19;reply(1,payload);}
    if(command===24){const names=['','INTRODUCE','HI FIVE','JOKE','WALK WITH ME','EXERCISE','DANCE','KUNG FU','STOP','VOLUME','SYSTEM CHECK','USER NAME','ROBOT NAME','FORWARD','BACKWARD','LEFT','RIGHT','TURN AROUND','TELL TIME','SHAKE HANDS'];reply(24,[bytes[1],0,...Array.from(names[bytes[1]]??'',c=>c.charCodeAt(0))]);}
    this.dispatchEvent(new CustomEvent('command',{detail:Array.from(bytes)}));
  }
  disconnect() { this.dispatchEvent(new Event('disconnect')); }
}
