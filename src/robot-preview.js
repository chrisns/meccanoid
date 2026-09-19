import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { defaultCalibration, calibratedPose, clamp } from './joints.js';

/** Procedural G15KS-style model. Angles illustrate intent; measured travel remains TBC. */
export class RobotPreview {
  targets=Array(8).fill(0);joints=[];wheels=[];speed=[0,0];virtualPose=Array(8).fill(128);
  constructor(host,status) {
    this.host=host;this.status=status;
    try {
      this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      this.renderer.setClearColor(0xf4efe7,1);
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;
      host.append(this.renderer.domElement);
      this.renderer.domElement.setAttribute('aria-label','Interactive 3D Meccanoid preview. Drag to turn the view.');
      this.renderer.domElement.setAttribute('role','img');
      this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(37,1,.1,50);
      this.scene.add(new THREE.HemisphereLight(0xffffff,0x736358,3));
      const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,6,5);this.scene.add(key);
      this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enablePan=false;this.controls.enableDamping=true;
      this.controls.minDistance=4.5;this.controls.maxDistance=10;this.controls.maxPolarAngle=Math.PI*.65;
      this.controls.addEventListener('change',()=>this.dirty=true);
      this.build();this.resetView();
      this.resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(w&&h){this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.dirty=true;}});this.resize.observe(host);
      this.frame=0;this.previous=0;this.dirty=true;
      const animate=time=>{
        this.frame=requestAnimationFrame(animate);if(document.hidden||time-this.previous<32)return;
        const dt=Math.min((time-this.previous)/1000,.08);this.previous=time;let moving=false;
        this.joints.forEach((j,i)=>{const difference=this.targets[i]-j.group.rotation[j.axis];if(Math.abs(difference)>.0005){j.group.rotation[j.axis]+=difference*Math.min(1,dt*12);moving=true;}});
        this.wheels.forEach((w,i)=>{if(this.speed[i]){w.rotation.x+=this.speed[i]*dt*5;moving=true;}});
        this.controls.update();if(this.dirty||moving){this.renderer.render(this.scene,this.camera);this.dirty=false;}
      };this.frame=requestAnimationFrame(animate);
      addEventListener('pagehide',()=>this.dispose(),{once:true});
      host.dataset.ready='true';status.textContent='On-screen preview · movement ranges TBC';
    }catch(error){host.dataset.ready='false';status.textContent='3D preview needs WebGL. Robot controls still work.';this.renderer?.dispose();}
  }
  build() {
    const materials={metal:new THREE.MeshStandardMaterial({color:0x9ca9b0,metalness:.65,roughness:.38}),white:new THREE.MeshStandardMaterial({color:0xe8e5dd,metalness:.2,roughness:.5}),orange:new THREE.MeshStandardMaterial({color:0xe88920,metalness:.3,roughness:.38}),black:new THREE.MeshStandardMaterial({color:0x24282a,roughness:.8}),bolt:new THREE.MeshStandardMaterial({color:0x3b4448,metalness:.65,roughness:.45}),joint:new THREE.MeshStandardMaterial({color:0xdbe58b,emissive:0x83953a,emissiveIntensity:.25})};
    const group=(parent,x=0,y=0,z=0)=>{const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;};
    const mesh=(parent,geometry,mat,x=0,y=0,z=0)=>{const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);parent.add(m);return m;};
    const box=(p,w,h,d,mat,x=0,y=0,z=0)=>mesh(p,new THREE.BoxGeometry(w,h,d),mat,x,y,z);
    const rod=(p,a,b,width,mat)=>{const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const m=box(p,width,delta.length(),width,mat);m.position.copy(start.add(end).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;};
    const rail=(p,length,width,mat,x=0,y=0,z=0)=>{
      const r=group(p,x,y,z);box(r,width,length,.055,mat);
      for(let n=-length/2+.06;n<length/2-.03;n+=.12)mesh(r,new THREE.CircleGeometry(.014,6),materials.bolt,0,n,.029);
      return r;
    };
    const limb=(p,length,width,mat)=>{rail(p,length,.065,mat,-width/2,-length/2);rail(p,length,.065,mat,width/2,-length/2);rod(p,[-width/2,-.07,0],[width/2,-length+.07,0],.042,mat);rod(p,[width/2,-.07,0],[-width/2,-length+.07,0],.042,mat);};
    const servo=(p)=>{box(p,.23,.18,.20,materials.orange);box(p,.19,.13,.035,materials.joint,0,0,.12);};
    this.model=group(this.scene);
    mesh(this.scene,new THREE.CylinderGeometry(1.2,1.2,.035,64),new THREE.MeshStandardMaterial({color:0xe4dbcd,roughness:1}),0,.02,0);
    const ring=mesh(this.scene,new THREE.TorusGeometry(1.16,.009,6,64),materials.metal,0,.045,0);ring.rotation.x=Math.PI/2;
    for(const side of [-1,1]){
      const foot=group(this.model,side*.30,.11,.07);box(foot,.35,.15,.58,materials.black);
      const wheel=group(foot,0,0,.22);const tyre=mesh(wheel,new THREE.CylinderGeometry(.14,.14,.33,20),materials.black);tyre.rotation.z=Math.PI/2;
      box(wheel,.335,.025,.24,materials.metal);this.wheels.push(wheel);
      const leg=group(this.model,side*.30,1.43,0);limb(leg,1.23,.24,materials.white);box(leg,.31,.15,.19,materials.metal,0,-.64,0);
      box(leg,.31,.14,.24,materials.orange,0,0,0);
    }
    // Open Meccano frame, central brain and perforated shoulder braces.
    for(const x of [-.24,.24])rail(this.model,.96,.08,materials.metal,x,1.94,-.06);
    for(const y of [1.5,2.35]){const r=rail(this.model,.70,.10,materials.metal,0,y,0);r.rotation.z=Math.PI/2;}
    box(this.model,.36,.63,.22,materials.orange,0,1.98,.06);box(this.model,.29,.51,.045,materials.white,0,1.99,.197);
    this.chest=[];for(let i=0;i<4;i++){const colour=[0x398fe6,0xef4844,0x4aad51,0xf3d13f][i],mat=new THREE.MeshStandardMaterial({color:colour,emissive:colour,emissiveIntensity:.1});this.chest.push(mat);box(this.model,.044,.055,.014,mat,-.085+i*.056,1.97,.23);}
    for(const side of [-1,1]){
      rod(this.model,[0,2.35,0],[side*.49,2.43,0],.09,materials.metal);rod(this.model,[side*.49,2.43,0],[side*.25,2.12,0],.065,materials.metal);
      const swing=group(this.model,side*.53,2.34,0),lift=group(swing);servo(lift);
      limb(lift,.55,.18,materials.metal);const elbow=group(lift,0,-.59,0);servo(elbow);limb(elbow,.55,.17,materials.metal);
      const hand=group(elbow,0,-.67,0);box(hand,.20,.15,.065,materials.metal);
      for(let f=0;f<3;f++){const finger=box(hand,.045,.17,.055,materials.metal,-.068+f*.068,-.12,.03);finger.rotation.x=-.3;}
      const thumb=box(hand,.12,.045,.055,materials.metal,side*.14,-.015,.03);thumb.rotation.z=side*.3;
      if(side===-1){this.joints[0]={group:elbow,axis:'x',scale:-1.8};this.joints[1]={group:lift,axis:'z',scale:-1.4};this.joints[2]={group:swing,axis:'x',scale:-1.3};}
      else{this.joints[3]={group:swing,axis:'x',scale:-1.3};this.joints[4]={group:lift,axis:'z',scale:1.4};this.joints[5]={group:elbow,axis:'x',scale:-1.8};}
    }
    rail(this.model,.31,.09,materials.metal,-.07,2.55);rail(this.model,.31,.09,materials.metal,.07,2.55);
    const turn=group(this.model,0,2.69,0),tilt=group(turn);box(tilt,.20,.12,.18,materials.metal);
    this.eyeMaterial=new THREE.MeshStandardMaterial({color:0xe5197f,emissive:0xe5197f,emissiveIntensity:.65,roughness:.22});
    for(const side of [-1,1]){
      const eye=group(tilt,side*.25,.20,.05);const shell=mesh(eye,new THREE.CylinderGeometry(.245,.245,.12,40),materials.white);shell.rotation.x=Math.PI/2;
      mesh(eye,new THREE.TorusGeometry(.22,.038,10,40),materials.orange,0,0,.09);
      mesh(eye,new THREE.CircleGeometry(.185,40),this.eyeMaterial,0,0,.102);
      mesh(eye,new THREE.CircleGeometry(.075,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.65}),0,0,.104);
      for(let i=0;i<12;i++){const angle=i*Math.PI/6;mesh(eye,new THREE.CircleGeometry(.012,6),materials.bolt,Math.cos(angle)*.218,Math.sin(angle)*.218,.129);}
    }
    this.joints[6]={group:turn,axis:'y',scale:1};this.joints[7]={group:tilt,axis:'z',scale:.5};
  }
  resetView() {if(!this.camera)return;this.camera.position.set(3.7,2.9,6.7);this.controls.target.set(0,1.54,0);this.controls.update();this.dirty=true;}
  setPose(pose,calibration=defaultCalibration(),label='Joint targets · approximate preview') {
    if(!this.joints.length||!pose)return;
    this.targets=calibration.map((c,i)=>{const delta=pose[c.slot]-c.centre,span=delta>=0?c.max-c.centre:c.centre-c.min;return clamp(span?delta/span:0,-1,1)*(c.reversed?-1:1)*this.joints[i].scale;});
    this.host.dataset.pose=JSON.stringify(pose);this.host.dataset.source=label;this.status.textContent=label;this.dirty=true;
  }
  setSignals(signals,calibration,gain) {
    const config=calibration.map(c=>({...c,enabled:true}));
    this.virtualPose=calibratedPose(signals,config,this.virtualPose,gain);
    this.setPose(this.virtualPose,config,'Camera preview · on screen only');
  }
  command(p) {
    if(!this.renderer||!this.eyeMaterial)return;
    if(p[0]===17){const color=new THREE.Color((p[3]&7)/7,((p[3]>>3)&7)/7,p[4]/7);this.eyeMaterial.color.copy(color);this.eyeMaterial.emissive.copy(color);}
    if(p[0]===28)this.chest.forEach((mat,i)=>mat.emissiveIntensity=p[i+1]?1:.1);
    if(p[0]===13)this.speed=[(p[1]===1?1:-1)*p[3]/255,(p[2]===1?1:-1)*p[4]/255];
    if(p[0]===25){const speeds={8:[0,0],13:[1,1],14:[-1,-1],15:[-1,1],16:[1,-1]};if(speeds[p[1]])this.speed=speeds[p[1]];}
    this.dirty=true;
  }
  trackingLost() {if(this.host.dataset.source?.startsWith('Camera'))this.status.textContent='Tracking lost · holding the last preview pose';}
  stop() {this.speed=[0,0];this.dirty=true;}
  dispose(){cancelAnimationFrame(this.frame);this.resize?.disconnect();this.controls?.dispose();this.scene?.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.renderer?.dispose();}
}
