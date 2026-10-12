// A compact input log: no camera frames and no per-frame GPU readback.
export const RECORDING_SCHEMA='golden-sand-recording';
export const RECORDING_VERSION=1;
const RESOURCE_PATHS=['assets/mural.samples.bin','assets/mural.tones.bin','assets/mural.colors.bin','assets/curl-noise.bin','assets/model-report.json','particle-style.js'];

export function snapshotUniforms(uniforms){
  const result={};
  for(const [name,{value}] of Object.entries(uniforms)){
    if(value?.isTexture||value===null||value===undefined)continue;
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Non-finite uniform '+name);result[name]=value;continue;}
    let numbers;
    if(value.elements)numbers=Array.from(value.elements);
    else if(ArrayBuffer.isView(value))numbers=Array.from(value);
    else if(Array.isArray(value))numbers=value.flatMap(item=>typeof item==='number'?[item]:item.toArray());
    else if(value.toArray)numbers=value.toArray();
    else continue;
    if(!numbers.every(Number.isFinite))throw new Error('Non-finite uniform '+name);
    result[name]=numbers;
  }
  return result;
}

export async function sha256(data){
  const bytes=typeof data==='string'?new TextEncoder().encode(data):data;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// Called before recording starts, so hashing and network IO never enter a frame.
export async function createRecordingManifest(descriptor,{fetchImpl=fetch,onResource=()=>{}}={}){
  const [resources,shaderHashes]=await Promise.all([
    Promise.all(RESOURCE_PATHS.map(async path=>{
      const response=await fetchImpl(new URL('./'+path,import.meta.url));
      if(!response.ok)throw new Error('录制资源读取失败：'+path);
      const buffer=await response.arrayBuffer();
      const expected=/\.(json|js)$/.test(path)?null:path.endsWith('curl-noise.bin')?32**3*4:path.endsWith('tones.bin')?descriptor.count:path.endsWith('colors.bin')?descriptor.count*3:descriptor.count*6*4;
      if(!buffer.byteLength||(expected!==null&&buffer.byteLength!==expected))throw new Error('录制资源长度不正确：'+path);
      onResource(path,new Uint8Array(buffer));
      return {path,bytes:buffer.byteLength,sha256:await sha256(buffer)};
    })),
    Promise.all(Object.entries(descriptor.shaders).map(async([name,source])=>[name,await sha256(source)])),
  ]);
  return {...descriptor,resources,shaderHashes:Object.fromEntries(shaderHashes),createdAt:new Date().toISOString(),
    coordinateSystem:'Three.js right-handed, Y up; matrices are column-major',
    modelPose:{yaw:0,pitch:0,autoRotate:false},cameraVideoIncluded:false,
    replay:{initialState:'first step has uReset=1',order:['field when fieldRendered','copy state when captureRendered','simulation','present particles'],
      phasesAreRecorded:true,damageReductionRequired:false,fieldFormat:'RGBA16F, linear, clamp-to-edge',stateFormat:'MRT RGBA32F, nearest, clamp-to-edge',noiseFormat:'32x32x32 RGBA8, linear, repeat XYZ',
      sampleFileLayout:'Float32LE: count*3 XYZ positions, then count*3 XYZ normals; 24 bytes per particle',
      homeTextureLayout:'RGBA32F: sample XYZ + W=1, nearest, clamp-to-edge; normal XYZ is normalized, W=0, fallback=(0,0,1)',
      noiseUpload:'flipY=false, unpackAlignment=1, NoColorSpace, no mipmaps',
      styleAttribute:'aStyle = createParticleStyle(count, tones); four normalized Uint8 values per particle. aStyle.x is image luminance. aPigment = RGB Uint8 from mural.colors.bin',
      lookupAttribute:'aLookup = ((i % size + 0.5) / size, (floor(i / size) + 0.5) / size)',
      particleRows:'index = y * size + x; texture row zero is bottom',timebase:'steps contain actual simulation dt; no self-rotation'}};
}

export class ParticleRecorder{
  constructor({maxSeconds=90,maxSteps=10000,onLimit=()=>{},onError=()=>{},now=()=>performance.now()}={}){
    Object.assign(this,{maxSeconds,maxSteps,onLimit,onError,now});this.active=false;this.steps=[];this.simulationTime=0;
  }
  start(metadata){
    if(this.active)throw new Error('录制已经开始');
    this.metadata=metadata;this.steps=[];this.simulationTime=0;this.startedAt=this.now();this.active=true;this.limitSent=false;
  }
  capture(uniforms,info){
    if(!this.active||this.limitSent)return;
    try{
      const values=snapshotUniforms(uniforms);
      if(!this.steps.length&&values.uReset!==1)throw new Error('录制必须从壁画重置的第一帧开始');
      this.simulationTime+=values.uDt;
      this.steps.push({...info,index:this.steps.length,wallTimeMs:this.now()-this.startedAt,simulationTime:this.simulationTime,uniforms:values});
      if(this.elapsedSeconds>=this.maxSeconds||this.steps.length>=this.maxSteps){this.limitSent=true;queueMicrotask(()=>this.onLimit());}
    }catch(error){this.limitSent=true;queueMicrotask(()=>this.onError(error));}
  }
  get elapsedSeconds(){return this.active?(this.now()-this.startedAt)/1000:0;}
  stop(reason='manual'){
    if(!this.active)return null;
    const elapsedSeconds=this.elapsedSeconds;this.active=false;
    return {schema:RECORDING_SCHEMA,version:RECORDING_VERSION,metadata:this.metadata,
      summary:{reason,stepCount:this.steps.length,elapsedSeconds,simulationSeconds:this.simulationTime},steps:this.steps};
  }
}

export function recordingFilename(recording){return '飞天金沙_'+recording.metadata.createdAt.replace(/[:.]/g,'-')+'.sandpack.zip';}
export async function saveRecording(recording,blob){return {blob,filename:recordingFilename(recording),saved:null};}
