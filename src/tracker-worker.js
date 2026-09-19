// Classic worker is required by MediaPipe's generated WASM loader (ModuleFactory).
const siteRoot=new URL('../',self.location.href);
importScripts(new URL('vendor/mediapipe/vision_bundle.js',siteRoot).href);
const { FilesetResolver, PoseLandmarker } = Vision;
let detector;
async function unpack(url) {
  const response=await fetch(url);
  if(!response.ok)throw new Error('A camera download failed. Please try again.');
  return new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      self.postMessage({type:'progress',message:'Downloading camera tools… you can cancel while you wait.'});
      const files=await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm',siteRoot).href);
      const modelURL=new URL('assets/pose_landmarker_lite.task',siteRoot).href;
      let binaryURL;
      try {
        let baseOptions={modelAssetPath:modelURL,delegate:'CPU'};
        if(typeof DecompressionStream==='function') {
          const [wasm,model]=await Promise.all([unpack(`${files.wasmBinaryPath}.gz`),unpack(`${modelURL}.gz`)]);
          binaryURL=URL.createObjectURL(new Blob([wasm],{type:'application/wasm'}));
          files.wasmBinaryPath=binaryURL;
          baseOptions={modelAssetBuffer:model,delegate:'CPU'};
        }
        self.postMessage({type:'progress',message:'Camera tools ready. Setting up your preview…'});
        detector=await PoseLandmarker.createFromOptions(files,{
          baseOptions,runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.65,minPosePresenceConfidence:0.65,minTrackingConfidence:0.65,
        });
      }finally{if(binaryURL)URL.revokeObjectURL(binaryURL);}
      self.postMessage({type:'ready'});
    } else if(data.type==='frame') {
      try {
        const result=detector.detectForVideo(data.bitmap,data.timestamp);
        self.postMessage({type:'result',timestamp:data.timestamp,landmarks:result.landmarks[0]??null,world:result.worldLandmarks[0]??null});
      } finally { data.bitmap.close(); }
    }
  } catch(error) { self.postMessage({type:'error',message:error.message}); }
};
