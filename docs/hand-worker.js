// Inference stays off the animation thread. Runtime and model are served locally.
import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', import.meta.url).href, true);
      let delegate = data.delegate === 'GPU' ? 'GPU' : 'CPU';
      const options = {
        baseOptions: { modelAssetPath: new URL('./models/hand_landmarker.task', import.meta.url).href, delegate },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .5,
      };
      try { detector = await HandLandmarker.createFromOptions(files, options); }
      catch { delegate = delegate === 'GPU' ? 'CPU' : 'GPU'; options.baseOptions.delegate = delegate; detector = await HandLandmarker.createFromOptions(files, options); }
      self.postMessage({ type: 'ready', delegate });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  } else if (data.type === 'frame') {
    try {
      const begin = performance.now();
      const result = detector.detectForVideo(data.bitmap, data.timestamp);
      const hands=result.landmarks.map((landmarks,index)=>({landmarks,label:result.handedness?.[index]?.[0]?.categoryName||''}));
      self.postMessage({ type: 'result', hands, timestamp: data.timestamp, inferenceMs: performance.now() - begin });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.bitmap.close(); }
  }
};
