export const JOINT_KEYS=[
  {plus:'q',minus:'a'}, {plus:'w',minus:'s'}, {plus:'e',minus:'d'}, {plus:'r',minus:'f'},
  {plus:'u',minus:'j'}, {plus:'i',minus:'k'}, {plus:'o',minus:'l'}, {plus:'p',minus:';'},
];
export const DRIVE_KEYS={ArrowUp:'forward',ArrowDown:'backward',ArrowLeft:'left',ArrowRight:'right'};
const recognised=new Set([...Object.keys(DRIVE_KEYS),...JOINT_KEYS.flatMap(k=>[k.plus,k.minus])]);
const keyOf=e=>e.key.length===1?e.key.toLowerCase():e.key;
export const editing=target=>Boolean(target?.closest?.('textarea,select,input:not([type="checkbox"]):not([type="button"]):not([type="submit"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));

/** Bounded repeat loop, independent of OS key-repeat. Every async start rechecks its lease. */
export class KeyboardControls {
  held=new Set();epoch=0;busy=false;timer;stopping=Promise.resolve();
  constructor({target=window,document:doc=document,enabled,drive,nudge,stop,release=stop,halt,report,onchange=()=>{}}) {
    Object.assign(this,{enabled,drive,nudge,release,stop,halt,report,onchange});
    target.addEventListener('keydown',e=>{
      const key=keyOf(e);
      if(key==='Escape'||(key===' '&&!editing(e.target)&&enabled())){
        e.preventDefault();this.clear();Promise.resolve(halt()).catch(report);return;
      }
      if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||e.isComposing||editing(e.target)||!recognised.has(key)||!enabled())return;
      e.preventDefault();if(this.held.has(key))return;
      this.held.add(key);this.epoch++;this.onchange(this.held);this.tick();
    });
    target.addEventListener('keyup',e=>{
      const key=keyOf(e);if(!this.held.delete(key))return;e.preventDefault();
      this.epoch++;clearTimeout(this.timer);this.onchange(this.held);
      const finish=key in DRIVE_KEYS?stop:release;
      this.stopping=Promise.resolve(finish(key)).catch(report);this.stopping.then(()=>this.tick());
    });
    const releaseAll=()=>{if(this.held.size){this.clear();this.stopping=Promise.resolve(stop()).catch(report);}};
    target.addEventListener('blur',releaseAll);
    target.addEventListener('hashchange',releaseAll);
    target.addEventListener('pointerdown',releaseAll);
    doc.addEventListener('visibilitychange',()=>{if(doc.hidden)releaseAll();});
    doc.addEventListener('focusin',e=>{if(editing(e.target))releaseAll();});
  }
  clear() {this.held.clear();this.epoch++;clearTimeout(this.timer);this.onchange(this.held);}
  async tick() {
    if(this.busy||!this.held.size||!this.enabled())return;
    clearTimeout(this.timer);this.busy=true;
    const epoch=this.epoch,valid=()=>epoch===this.epoch&&this.enabled();
    let delay=100;
    try {
      await this.stopping;if(!valid())return;
      const arrows=[...this.held].filter(key=>key in DRIVE_KEYS);
      if(arrows.length){
        delay=250;
        if(arrows.length===1)await this.drive(DRIVE_KEYS[arrows[0]],valid);
        else await this.stop();
      } else {
        const deltas=JOINT_KEYS.map(k=>(this.held.has(k.plus)?4:0)-(this.held.has(k.minus)?4:0));
        if(deltas.some(Boolean))await this.nudge(deltas,valid);
      }
    }catch(error){this.clear();this.report(error);await this.stop().catch(this.report);}
    finally{this.busy=false;if(this.held.size&&this.enabled())this.timer=setTimeout(()=>this.tick(),delay);}
  }
}
