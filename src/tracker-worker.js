// Classic worker is required by MediaPipe's generated WASM loader (ModuleFactory).
const siteRoot=new URL('../',self.location.href);
importScripts(new URL('vendor/mediapipe/vision_bundle.js',siteRoot).href);
const { FilesetResolver, PoseLandmarker } = Vision;
let detector;
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      const files=await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm',siteRoot).href);
      detector=await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL('assets/pose_landmarker_lite.task',siteRoot).href,delegate:'CPU'},
        runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.65,minPosePresenceConfidence:0.65,minTrackingConfidence:0.65,
      });
      self.postMessage({type:'ready'});
    } else if(data.type==='frame') {
      try {
        const result=detector.detectForVideo(data.bitmap,data.timestamp);
        self.postMessage({type:'result',timestamp:data.timestamp,landmarks:result.landmarks[0]??null,world:result.worldLandmarks[0]??null});
      } finally { data.bitmap.close(); }
    }
  } catch(error) { self.postMessage({type:'error',message:error.message}); }
};
