/** Local-only camera lifecycle; inference lives in a worker, away from Bluetooth/stop controls. */
export class BodyTracker extends EventTarget {
  running=false;
  #worker; #stream; #raf; #epoch=0; #busy=false; #last=0; #cancelLoad;
  constructor(video,canvas) { super();this.video=video;this.canvas=canvas; }
  #emit(type,detail) {this.dispatchEvent(new CustomEvent(type,{detail}));}
  async start() {
    this.stop();const epoch=this.#epoch;this.running=true;this.#emit('state','Getting the camera ready… the first download may take a minute.');
    try {
      const worker=this.#worker=new Worker(new URL('./tracker-worker.js',import.meta.url));
      await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);this.#cancelLoad=null;};
        const timer=setTimeout(()=>{cleanup();reject(new Error('Camera tools took too long to download. Check your connection and try again.'));},120000);
        this.#cancelLoad=()=>{cleanup();resolve();};
        worker.onerror=e=>{cleanup();reject(new Error(e.message || 'Tracking worker failed'));};
        worker.onmessage=({data})=>{
          if(data.type==='progress')this.#emit('state',data.message);
          if(data.type==='ready'){cleanup();resolve();}
          if(data.type==='error'){cleanup();reject(new Error(data.message));}
        };
        worker.postMessage({type:'init'});
      });
      if(epoch!==this.#epoch) return;
      worker.onerror=e=>{this.#emit('error',e.message||'Tracking worker failed');this.stop();};
      worker.onmessage=({data})=>{
        this.#busy=false;
        if(epoch!==this.#epoch) return;
        if(data.type==='error'){this.#emit('error',data.message);this.stop();return;}
        if(data.type==='result'){this.#draw(data.landmarks);this.#emit('frame',data);}
      };
      this.#emit('state','Opening your camera… allow access if Chrome asks.');
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:15},facingMode:'user'},audio:false});
      if(epoch!==this.#epoch){stream.getTracks().forEach(t=>t.stop());return;}
      this.#stream=stream;this.video.srcObject=stream;await this.video.play();
      if(epoch!==this.#epoch) return;
      stream.getVideoTracks()[0].addEventListener('ended',()=>{this.#emit('error','Camera disconnected');this.stop();});
      this.#emit('state','Camera ready — preview only');this.#loop(epoch);
    } catch(error) {if(epoch===this.#epoch){this.stop();throw error;}}
  }
  async #loop(epoch) {
    if(!this.running||epoch!==this.#epoch)return;
    const now=performance.now();
    if(!this.#busy && now-this.#last>100 && this.video.readyState>=2) {
      this.#busy=true;this.#last=now;
      try {
        const bitmap=await createImageBitmap(this.video);
        if(epoch!==this.#epoch){bitmap.close();return;}
        this.#worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);
      } catch(error){this.#emit('error',error.message);this.stop();return;}
    }
    this.#raf=requestAnimationFrame(()=>this.#loop(epoch));
  }
  #draw(points) {
    const canvas=this.canvas,ctx=canvas.getContext('2d');
    canvas.width=this.video.videoWidth||640;canvas.height=this.video.videoHeight||480;
    ctx.clearRect(0,0,canvas.width,canvas.height);if(!points)return;
    ctx.lineWidth=3;ctx.strokeStyle='#bcf279';ctx.fillStyle='#bcf279';
    for(const [a,b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[7,0],[0,8]]) {
      if((points[a]?.visibility??0)<0.65||(points[b]?.visibility??0)<0.65)continue;
      ctx.beginPath();ctx.moveTo(points[a].x*canvas.width,points[a].y*canvas.height);ctx.lineTo(points[b].x*canvas.width,points[b].y*canvas.height);ctx.stroke();
    }
  }
  stop() {
    this.#epoch++;this.running=false;this.#cancelLoad?.();cancelAnimationFrame(this.#raf);
    this.#worker?.terminate();this.#worker=null;
    this.#stream?.getTracks().forEach(t=>t.stop());this.#stream=null;
    this.video.srcObject=null;this.#busy=false;
    this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);
    this.#emit('state','Camera off');
  }
}
