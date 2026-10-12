import * as THREE from 'three';
import {createHandMask} from './hand-mask.js';
import {createParticleStyle} from './particle-style.js';

const REBUILD_TRAVEL_SECONDS=5.4;
// Reach the target before leaving rebuild, even when a frame straddles the end.
const REBUILD_HOLD_SECONDS=.2;

// All particle motion and permanent fracture state live on the GPU.
// Model inputs: equally sampled Float32 XYZ positions/normals, Y up, facing +Z.
const quadVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

const handFieldFragment = `precision highp float;
varying vec2 vUv;
uniform vec4 uHands[2],uBounds[2],uCapsules[32],uPointer;
uniform float uRadii[32],uAspect;
uniform vec2 uHandVelocities[2],uPointerVelocity;
void main(){
  vec2 p=vec2(vUv.x*uAspect,vUv.y),push=vec2(0.);
  float contact=0.,speed=0.;
  for(int hand=0;hand<2;hand++){
    vec4 box=uBounds[hand];float presence=uHands[hand].w;
    if(presence<.015||vUv.x<box.x-.025||vUv.x>box.z+.025||vUv.y<box.y-.025||vUv.y>box.w+.025)continue;
    float closest=10.;vec2 normal=vec2(0.,1.);
    for(int j=0;j<16;j++){
      int index=hand*16+j;vec4 cap=uCapsules[index];vec2 ab=cap.zw-cap.xy;
      vec2 delta=p-cap.xy-ab*clamp(dot(p-cap.xy,ab)/max(dot(ab,ab),.000001),0.,1.);
      float distance=length(delta),surface=distance-uRadii[index];
      if(surface<closest){closest=surface;normal=delta/max(distance,.00001);}
    }
    float weight=(1.-smoothstep(-.003,.014,closest))*presence;
    vec2 velocity=uHandVelocities[hand]*vec2(uAspect,1.);
    float movement=min(2.5,length(velocity));
    push+=(normal*(.26+movement*.12)+velocity*.72)*weight;
    contact=max(contact,weight);speed=max(speed,movement*weight);
  }
  if(uPointer.w>.01){
    vec2 delta=p-uPointer.xy*vec2(uAspect,1.);
    float distance=length(delta);
    float weight=(1.-smoothstep(uPointer.z*.68,uPointer.z,distance))*uPointer.w;
    vec2 normal=distance>.0001?delta/distance:vec2(0.,1.);
    vec2 velocity=uPointerVelocity*vec2(uAspect,1.);
    float movement=min(2.5,length(velocity));
    push+=(normal*(.30+movement*.1)+velocity*.75)*weight;
    contact=max(contact,weight);speed=max(speed,movement*weight);
  }
  gl_FragColor=vec4(contact,clamp(push,vec2(-2.5),vec2(2.5)),speed);
}`;

// One copy per transition freezes the latest simulated positions and velocities.
const captureFragment = `precision highp float;
in vec2 vUv;
layout(location=0) out vec4 outPosition;
layout(location=1) out vec4 outVelocity;
uniform sampler2D uPositions,uVelocities;
void main(){outPosition=texture(uPositions,vUv);outVelocity=texture(uVelocities,vUv);}`;

// MRT: attachment 0 = world XYZ + permanent damage, attachment 1 = velocity XYZ.
const simulationFragment = `precision highp float;
in vec2 vUv;
layout(location=0) out vec4 outPosition;
layout(location=1) out vec4 outVelocity;
uniform sampler2D uPositions,uVelocities,uHome,uPreviousHome,uField,uStartPositions,uStartVelocities;
uniform highp sampler3D uCurlNoise;
uniform mat4 uModelMatrix,uViewProjection,uViewMatrix,uCameraWorldMatrix,uPreviousModelMatrix;
uniform vec4 uWorldBounds;
uniform vec2 uDepthBounds;
uniform float uDt,uReset,uPhase,uPhaseTime,uLocked,uAspect,uScreenHeight,uCount,uSize,uImpact,uPoseOnly,uReferenceDepth,uMotionTime,uScatterKick,uPreviousPhaseTime,uRebuildDuration;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float quintic(float x){x=clamp(x,0.,1.);return clamp(x*x*x*(x*(x*6.-15.)+10.),0.,1.);}
vec3 rebuildPath(float time,vec3 startPosition,vec3 startVelocity,vec3 localHome,mat4 modelMatrix){
  if(time<=0.)return startPosition;
  vec3 home=(modelMatrix*vec4(localHome,1.)).xyz;
  if(time>=uRebuildDuration)return home;
  float progress=quintic(time/uRebuildDuration);
  // The initial derivative is exactly the captured velocity, with no target snap.
  vec3 inertia=startPosition+startVelocity*(.70*(1.-exp(-time/.70)));
  vec3 base=mix(inertia,home,progress);
  float envelope=smoothstep(0.,.75,time)*quintic((uRebuildDuration-time)/(uRebuildDuration-3.));
  vec3 travel=vec3(time*.11,-time*.078,time*.095);
  vec3 broad=texture(uCurlNoise,base*.48+travel).rgb*2.-1.;
  vec3 detail=texture(uCurlNoise,base*1.12+travel*.76+vec3(.37,.08,.61)).rgb*2.-1.;
  // Neighbouring grains share a moving volume and broad curved stream, not jitter.
  vec3 arc=cross(normalize(vec3(.18,1.,.12)),home-startPosition)*(.24*sin(progress*3.14159265));
  return base+envelope*((broad+detail*.20)*(.85+uImpact*.18)+arc);
}
void collidePlane(inout vec3 pos,inout vec3 velocity,vec3 planeNormal,float offset,float restitution,float friction){
  float inverseLength=inversesqrt(dot(planeNormal,planeNormal));
  float distance=(dot(planeNormal,pos)-offset)*inverseLength;
  if(distance<=0.)return;
  vec3 normal=planeNormal*inverseLength;
  pos-=normal*distance*(1.+restitution);
  float outward=dot(velocity,normal);
  vec3 tangent=velocity-normal*outward;
  velocity=tangent*friction+normal*(outward>0.?-outward*restitution:outward);
}
void collideDepth(inout vec3 pos,inout vec3 velocity){
  if(pos.z<uDepthBounds.x){pos.z=uDepthBounds.x+(uDepthBounds.x-pos.z)*.35;velocity.z=abs(velocity.z)*.35;}
  if(pos.z>uDepthBounds.y){pos.z=uDepthBounds.y-(pos.z-uDepthBounds.y)*.35;velocity.z=-abs(velocity.z)*.35;}
  pos.z=clamp(pos.z,uDepthBounds.x,uDepthBounds.y);
}
void main(){
  float index=floor(gl_FragCoord.y)*uSize+floor(gl_FragCoord.x);
  if(index>=uCount){outPosition=vec4(0.,0.,0.,1.);outVelocity=vec4(0.);return;}
  vec3 localHome=texture(uHome,vUv).xyz;
  vec3 home=(uModelMatrix*vec4(localHome,1.)).xyz;
  if(uReset>.5||uPhase>2.5){outPosition=vec4(home,0.);outVelocity=vec4(0.);return;}
  vec4 old=texture(uPositions,vUv),oldVelocity=texture(uVelocities,vUv);
  vec3 pos=old.xyz,velocity=oldVelocity.xyz;
  float damaged=old.w,seed=hash(vUv*713.1);
  if(uPoseOnly>.5){outPosition=vec4(damaged<.5?home:pos,damaged);outVelocity=oldVelocity;return;}
  if(uDt<=0.){outPosition=old;outVelocity=oldVelocity;return;}
  // Velocity alpha is time since local contact, independent of permanent damage.
  float quietAge=min(12.,oldVelocity.w+uDt),contact=0.,homeContact=0.;
  if(uPhase<.5){
    if(damaged<.5){pos=home;velocity=vec3(0.);}
    if(uLocked<.5){
      vec4 clip=uViewProjection*vec4(pos,1.);
      vec2 uv=clip.xy/max(clip.w,.0001)*.5+.5;
      if(clip.w>0.&&all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){
        vec4 field=texture(uField,uv);
        contact=field.r;
        if(field.r>.16){
          quietAge=0.;
          if(damaged<.5){
            damaged=1.;
            velocity=mat3(uCameraWorldMatrix)*vec3(field.gb*uScreenHeight*(.60+uImpact*.20),(seed-.5)*.64*field.r);
          }else velocity+=mat3(uCameraWorldMatrix)*vec3(field.gb*uScreenHeight*uDt*3.2,0.);
        }
      }
    }
    if(damaged<.5){outPosition=vec4(home,0.);outVelocity=vec4(0.);return;}
    if(uLocked<.5){
      vec4 homeClip=uViewProjection*vec4(home,1.);
      vec2 homeUv=homeClip.xy/max(homeClip.w,.0001)*.5+.5;
      if(homeClip.w>0.&&all(greaterThanEqual(homeUv,vec2(0.)))&&all(lessThanEqual(homeUv,vec2(1.))))homeContact=texture(uField,homeUv).r;
    }
  }
  if(uPhase>1.5){
    vec3 startPosition=texture(uStartPositions,vUv).xyz;
    vec3 startVelocity=texture(uStartVelocities,vUv).xyz;
    float previousTime=min(uPhaseTime,max(0.,uPreviousPhaseTime));
    vec3 previousPath=rebuildPath(previousTime,startPosition,startVelocity,localHome,uPreviousModelMatrix);
    vec3 nextPath=rebuildPath(uPhaseTime,startPosition,startVelocity,localHome,uModelMatrix);
    // Carry collision corrections from the real previous position instead of
    // overwriting them with the ideal path every frame. They fade smoothly to zero.
    float previousResidual=quintic((uRebuildDuration-previousTime)/(uRebuildDuration-3.6));
    float nextResidual=quintic((uRebuildDuration-uPhaseTime)/(uRebuildDuration-3.6));
    float residualWeight=exp(-uDt*.75)*nextResidual/max(previousResidual,.0000001);
    pos=nextPath+(pos-previousPath)*residualWeight;
    velocity=(pos-old.xyz)/uDt;
  }else{
    // Suspension, not gravity: a weak spring remembers the original silhouette.
    // A single slow cross-axis field supplies low-amplitude, unbiased sand motion.
    // Neither position recovery nor this drift clears the fracture ledger.
    if(uPhase>.5&&uScatterKick>.5){
      vec3 burst=vec3(hash(vUv+17.1),hash(vUv+83.7),hash(vUv+117.3))-.5;
      velocity+=burst/max(length(burst),.001)*(.8+seed*.5);
    }
    vec3 drift=vec3(sin(pos.y*1.8+uMotionTime*.48+seed*1.1),
      sin(pos.z*1.5-uMotionTime*.39+seed*5.8),
      sin(pos.x*1.65+uMotionTime*.43+seed*3.9));
    float returnGate=uPhase<.5?smoothstep(.45,1.30,quietAge)*(1.-smoothstep(.02,.22,max(contact,homeContact))):0.;
    float damping=exp(-uDt*2.);
    vec3 force=drift*(.038+uImpact*.012)+(home-pos)*(.38*returnGate);
    velocity=velocity*damping+force*((1.-damping)*.5);
    pos+=velocity*uDt;
  }
  vec3 unconstrainedPosition=pos;
  // Resolve the tray in camera-local coordinates, with z=0 at its look-at plane.
  // This keeps all four screen walls correct while orbiting or dollying the camera.
  float referenceDepth=max(.5,uReferenceDepth);
  pos=(uViewMatrix*vec4(pos,1.)).xyz;pos.z+=referenceDepth;
  velocity=mat3(uViewMatrix)*velocity;
  vec2 center=(uWorldBounds.xy+uWorldBounds.zw)*.5;
  vec2 halfExtent=(uWorldBounds.zw-uWorldBounds.xy)*.5;
  vec2 slope=halfExtent/referenceDepth;
  collideDepth(pos,velocity);
  collidePlane(pos,velocity,vec3(-1.,0.,slope.x),-uWorldBounds.x,.42,.85);
  collidePlane(pos,velocity,vec3(1.,0.,slope.x),uWorldBounds.z,.42,.85);
  collidePlane(pos,velocity,vec3(0.,-1.,slope.y),-uWorldBounds.y,.32,.79);
  collidePlane(pos,velocity,vec3(0.,1.,slope.y),uWorldBounds.w,.42,.85);
  // A corner correction can reach the rear wall. Reconcile depth, then clamp
  // the tiny remaining corner overshoot inside this depth's screen rectangle.
  collideDepth(pos,velocity);
  float perspectiveScale=max(.025,(referenceDepth-pos.z)/referenceDepth);
  pos.xy=clamp(pos.xy,center-halfExtent*perspectiveScale,center+halfExtent*perspectiveScale);
  velocity=clamp(velocity,vec3(-8.),vec3(8.));
  pos.z-=referenceDepth;pos=(uCameraWorldMatrix*vec4(pos,1.)).xyz;
  velocity=mat3(uCameraWorldMatrix)*velocity;
  if(uPhase>1.5){
    // A zoomed-in finished sculpture may extend beyond the viewport. Release only
    // the final assembly from the tray gradually, so settle cannot add a snap.
    float release=quintic((uPhaseTime-(uRebuildDuration-.85))/.85);
    pos=mix(pos,unconstrainedPosition,release);
    velocity=(pos-old.xyz)/uDt;
    velocity*=min(1.,16./max(length(velocity),.00001));
  }
  outPosition=vec4(pos,damaged);outVelocity=vec4(velocity,quietAge);
}`;

const particleVertex = `attribute vec2 aLookup;attribute vec4 aStyle;attribute vec3 aPigment;
uniform sampler2D uPositions,uNormals;
uniform mat4 uModelMatrix;
uniform float uViewHeight,uReferenceDepth,uIntensity,uBloom,uPhase,uPhaseTime,uPointScale,uMotionTime,uGold;
varying vec3 vColor;varying vec2 vFacet;
void main(){
  vec4 particle=texture2D(uPositions,aLookup);
  vec3 surface=normalize(mat3(uModelMatrix)*texture2D(uNormals,aLookup).xyz);
  vFacet=aStyle.zw*2.-1.;
  vec3 grainNormal=normalize(vec3(vFacet,.45+aStyle.y));
  float assembled=1.-particle.w;
  if(uPhase>1.5&&uPhase<2.5)assembled=smoothstep(3.2,5.4,uPhaseTime);
  if(uPhase>2.5)assembled=1.;
  vec3 normal=normalize(mix(grainNormal,surface,assembled*.96));
  vec3 light=normalize(vec3(-.45,.72,1.2)),view=normalize(cameraPosition-particle.xyz);
  float diffuse=max(dot(normal,light),0.);
  float fill=max(dot(normal,normalize(vec3(.8,.15,.2))),0.);
  float spec=pow(max(dot(normal,normalize(light+view)),0.),22.);
  float facet=smoothstep(.88,.998,aStyle.y)*(.28+uBloom*.44);
  vec3 bronze=vec3(.20,.074,.013),gold=vec3(.92,.56,.115),shine=vec3(1.,.92,.68);
  vec3 color=mix(bronze,gold,.28+diffuse*.72)*(.43+diffuse*.92+fill*.18);
  color+=shine*(spec*.68+facet*pow(max(dot(grainNormal,light),0.),12.));
  float albedo=.14+pow(aStyle.x,2.4)*1.6;
  float shimmer=1.+sin(uMotionTime*1.4+aStyle.y*173.)*smoothstep(.95,1.,aStyle.y)*.15;
  color*=uIntensity*albedo*shimmer;
  vec3 golden=color/(.66+max(color.r,max(color.g,color.b))*.48);
  vec3 pigment=pow(aPigment,vec3(2.2))*(.98+spec*.03)*uIntensity;
  vColor=mix(pigment,golden,uGold);
  vec4 mvPosition=modelViewMatrix*vec4(particle.xyz,1.);
  gl_Position=projectionMatrix*mvPosition;
  float grainSize=(2.05+aStyle.y*.25)*uViewHeight/720.*uPointScale;
  gl_PointSize=clamp(grainSize*uReferenceDepth/max(.35,-mvPosition.z),1.,3.8);
}`;
const particleFragment = `varying vec3 vColor;varying vec2 vFacet;
void main(){
  vec2 p=gl_PointCoord*2.-1.,q=vec2(dot(p,vFacet),dot(p,vec2(-vFacet.y,vFacet.x)));
  float edge=max(abs(q.x)*.93+abs(q.y)*.30,abs(q.y)*1.06);
  if(edge>.94)discard;
  float bevel=.93+.06*step(q.y+q.x*.35,0.)+.03*(1.-abs(q.x));
  gl_FragColor=vec4(vColor*bevel,1.);
  #include <colorspace_fragment>
}`;

// Four-by-four exact sums, including odd sizes and partially filled final rows.
const reductionFragment = `precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uSourceSize;
uniform float uFirst,uCount;
void main(){
  vec2 origin=floor(gl_FragCoord.xy)*4.;vec2 total=vec2(0.);
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    vec2 p=origin+vec2(float(x),float(y));
    if(p.x>=uSourceSize.x||p.y>=uSourceSize.y)continue;
    if(uFirst>.5&&p.y*uSourceSize.x+p.x>=uCount)continue;
    vec4 value=texture2D(uSource,(p+.5)/uSourceSize);
    total+=uFirst>.5?vec2(step(.5,value.w),1.):value.xy;
  }
  gl_FragColor=vec4(total,0.,1.);
}`;

// Small CPU controller; damage counts come only from GPU reduction, never a timer.
export class SculptureCycle {
  constructor(count){this.count=count;this.reset();}
  reset(index=0){this.modelIndex=index===1?1:0;this.phase='intact';this.elapsed=0;this.progress=0;this.completed=0;}
  reportDamage(count){
    if(!['intact','breaking'].includes(this.phase))return false;
    const previous=this.progress;this.progress=Math.max(this.progress,Math.min(1,count/this.count));
    if(this.progress>=1){this.phase='rebuild';this.modelIndex=1-this.modelIndex;this.elapsed=0;this.completed++;return true;}
    if(this.progress>0&&this.phase==='intact'){this.phase='breaking';return true;}
    return Math.floor(previous*100)!==Math.floor(this.progress*100);
  }
  advance(dt){
    if(!['rebuild','settle'].includes(this.phase))return null;
    this.elapsed+=Math.max(0,dt);
    if(this.phase==='rebuild'&&this.elapsed>=REBUILD_TRAVEL_SECONDS+REBUILD_HOLD_SECONDS){this.phase='settle';this.elapsed=0;this.progress=0;return 'settle';}
    if(this.phase==='settle'&&this.elapsed>=.55){this.phase='intact';this.elapsed=0;return 'intact';}
    return null;
  }
}

function dataTexture(values,size){
  const texture=new THREE.DataTexture(values,size,size,THREE.RGBAFormat,THREE.FloatType);
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}

export class SculptureSand {
  constructor({models,curlNoise=null,onState=null,tones=null,colors=null}={}){
    if(!Array.isArray(models)||models.length!==2)throw new Error('SculptureSand requires exactly two sampled models.');
    const count=models[0].positions?.length/3;
    if(!Number.isInteger(count)||count<1)throw new Error('Model positions must contain XYZ samples.');
    this.count=count;this.size=Math.ceil(Math.sqrt(count));this.onState=onState;
    this._bounds=new THREE.Box3();this._bounds.makeEmpty();
    this._models=models.map((model,index)=>{
      if(model.positions?.length!==count*3||model.normals?.length!==count*3)throw new Error('Both models must have the same number of XYZ positions and normals.');
      const positions=new Float32Array(this.size*this.size*4),normals=new Float32Array(positions.length);
      for(let i=0;i<count;i++){
        const j=i*3,k=i*4,x=model.positions[j],y=model.positions[j+1],z=model.positions[j+2];
        if(!Number.isFinite(x+y+z))throw new Error('Model positions contain invalid numbers.');
        positions[k]=x;positions[k+1]=y;positions[k+2]=z;positions[k+3]=1;
        this._bounds.min.x=Math.min(this._bounds.min.x,x);this._bounds.min.y=Math.min(this._bounds.min.y,y);this._bounds.min.z=Math.min(this._bounds.min.z,z);
        this._bounds.max.x=Math.max(this._bounds.max.x,x);this._bounds.max.y=Math.max(this._bounds.max.y,y);this._bounds.max.z=Math.max(this._bounds.max.z,z);
        const nx=model.normals[j],ny=model.normals[j+1],nz=model.normals[j+2],length=Math.hypot(nx,ny,nz);
        if(Number.isFinite(length)&&length>.00001){normals[k]=nx/length;normals[k+1]=ny/length;normals[k+2]=nz/length;}else normals[k+2]=1;
      }
      return {name:model.name||['佛像','恶魔'][index],positions:dataTexture(positions,this.size),normals:dataTexture(normals,this.size)};
    });
    const noiseSize=curlNoise?.size??1,noiseData=curlNoise?.data??new Uint8Array([128,128,128,128]);
    if(!Number.isInteger(noiseSize)||noiseSize<1||noiseData.length!==noiseSize**3*4)throw new Error('Invalid curl noise volume.');
    this._curlTexture=new THREE.Data3DTexture(noiseData,noiseSize,noiseSize,noiseSize);
    this._curlTexture.format=THREE.RGBAFormat;this._curlTexture.type=THREE.UnsignedByteType;
    this._curlTexture.minFilter=this._curlTexture.magFilter=THREE.LinearFilter;
    this._curlTexture.wrapS=this._curlTexture.wrapT=this._curlTexture.wrapR=THREE.RepeatWrapping;
    this._curlTexture.colorSpace=THREE.NoColorSpace;this._curlTexture.unpackAlignment=1;
    this._curlTexture.generateMipmaps=false;this._curlTexture.needsUpdate=true;
    this._cycle=new SculptureCycle(count);this._mask=createHandMask();
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(35,1,.05,40);
    this._simCamera=new THREE.Camera();this._simScene=new THREE.Scene();
    this._rotationDirty=false;this._width=this._height=1;this._ratio=1;this._read=0;this._reset=true;this._disposed=false;
    this._epoch=0;this._pendingRead=false;this._lastReduction=-Infinity;this._lastInput=-Infinity;
    this._motionTime=0;this._scatterStarted=false;this._rebuildCaptured=false;
    this._previousModelMatrix=new THREE.Matrix4();
    this._readBuffer=new Float32Array(4);this._rearm=false;this._diagnosticError=null;
    this._pointer={x:.5,y:.5,down:false,presence:0,time:-Infinity,vx:0,vy:0};
    this._pointerUniform=new THREE.Vector4(.5,.5,.043,0);this._pointerVelocity=new THREE.Vector2();
    this._matrix=new THREE.Matrix4();this._rotation=new THREE.Euler(0,0,0,'YXZ');
    this._viewProjection=new THREE.Matrix4();
    this._cameraTarget=new THREE.Vector3();this._cameraYaw=0;this._cameraPitch=0;this._cameraZoom=1;
    this._cameraBaseDistance=5;this._cameraMinDistance=1;this._cameraDistance=5;
    const options={type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false};
    this._states=Array.from({length:2},()=>new THREE.WebGLRenderTarget(this.size,this.size,{...options,count:2}));
    this._rebuildStart=new THREE.WebGLRenderTarget(this.size,this.size,{...options,count:2});
    this._field=new THREE.WebGLRenderTarget(1,1,{...options,type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    this._uniforms={
      uPositions:{value:this._states[0].textures[0]},uVelocities:{value:this._states[0].textures[1]},
      uStartPositions:{value:this._rebuildStart.textures[0]},uStartVelocities:{value:this._rebuildStart.textures[1]},
      uHome:{value:this._models[0].positions},uPreviousHome:{value:this._models[0].positions},uNormals:{value:this._models[0].normals},uField:{value:this._field.texture},
      uCurlNoise:{value:this._curlTexture},
      uModelMatrix:{value:this._matrix},uViewProjection:{value:this._viewProjection},uPreviousModelMatrix:{value:this._previousModelMatrix},
      uViewMatrix:{value:this.camera.matrixWorldInverse},uCameraWorldMatrix:{value:this.camera.matrixWorld},
      uHands:{value:this._mask.hands},uBounds:{value:this._mask.bounds},uCapsules:{value:this._mask.capsules},uRadii:{value:this._mask.radii},uHandVelocities:{value:this._mask.velocities},
      uPointer:{value:this._pointerUniform},uPointerVelocity:{value:this._pointerVelocity},
      uWorldBounds:{value:new THREE.Vector4(-2.,-1.65,2.,1.65)},uDepthBounds:{value:new THREE.Vector2(-1.8,1.8)},
      uDt:{value:1/60},uReset:{value:1},uPoseOnly:{value:0},uPhase:{value:0},uPhaseTime:{value:0},uLocked:{value:0},uMotionTime:{value:0},uScatterKick:{value:0},
      uPreviousPhaseTime:{value:0},uRebuildDuration:{value:REBUILD_TRAVEL_SECONDS},
      uAspect:{value:1},uScreenHeight:{value:3.8},uCount:{value:count},uSize:{value:this.size},uImpact:{value:1.4},
      uViewHeight:{value:720},uReferenceDepth:{value:5.},uIntensity:{value:1},uBloom:{value:.3},uPointScale:{value:1},uGold:{value:0},
    };
    this._fieldMaterial=new THREE.ShaderMaterial({uniforms:this._uniforms,vertexShader:quadVertex,fragmentShader:handFieldFragment,depthTest:false,depthWrite:false});
    this._simulationMaterial=new THREE.ShaderMaterial({uniforms:this._uniforms,vertexShader:quadVertex,fragmentShader:simulationFragment,glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false});
    this._captureMaterial=new THREE.ShaderMaterial({uniforms:this._uniforms,vertexShader:quadVertex,fragmentShader:captureFragment,glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false});
    this._quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this._fieldMaterial);this._quad.frustumCulled=false;this._simScene.add(this._quad);
    const lookup=new Float32Array(count*2);
    for(let i=0;i<count;i++){lookup[i*2]=(i%this.size+.5)/this.size;lookup[i*2+1]=(Math.floor(i/this.size)+.5)/this.size;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));geometry.setAttribute('aLookup',new THREE.BufferAttribute(lookup,2));geometry.setAttribute('aStyle',new THREE.BufferAttribute(createParticleStyle(count,tones),4,true));geometry.setAttribute('aPigment',new THREE.BufferAttribute(colors??new Uint8Array(count*3).fill(255),3,true));
    this._particleMaterial=new THREE.ShaderMaterial({uniforms:this._uniforms,vertexShader:particleVertex,fragmentShader:particleFragment,depthTest:true,depthWrite:true,transparent:false});
    this._points=new THREE.Points(geometry,this._particleMaterial);this._points.frustumCulled=false;this.scene.add(this._points);
    this._reductionUniforms={uSource:{value:null},uSourceSize:{value:new THREE.Vector2()},uFirst:{value:1},uCount:{value:count}};
    this._reductionMaterial=new THREE.ShaderMaterial({uniforms:this._reductionUniforms,vertexShader:quadVertex,fragmentShader:reductionFragment,depthTest:false,depthWrite:false});
    this._reductions=[];let reduceSize=this.size;
    do{reduceSize=Math.ceil(reduceSize/4);this._reductions.push(new THREE.WebGLRenderTarget(reduceSize,reduceSize,options));}while(reduceSize>1);
    this.resize(1280,720,1);
  }
  get phase(){return this._cycle.phase;}
  get progress(){return this._cycle.progress;}
  get modelIndex(){return this._cycle.modelIndex;}
  get name(){return this._models[this.modelIndex].name;}
  get handCount(){return this._mask.count;}
  get tracked(){return this.handCount>0;}
  get collisionLocked(){return !['intact','breaking'].includes(this.phase)||this._rearm;}
  get status(){return {phase:this.phase,progress:this.progress,modelIndex:this.modelIndex,name:this.name,collisionLocked:this.collisionLocked,count:this.count,completed:this._cycle.completed,error:this._diagnosticError};}
  setStepRecorder(callback){this._stepRecorder=typeof callback==='function'?callback:null;}
  async captureRecordingCheckpoint(renderer,stepIndex,timeoutMs=10000){
    const target=this._states[this._read],positions=new Float32Array(this.size*this.size*4),velocities=new Float32Array(positions.length);
    let timer;
    try{
      await Promise.race([
        Promise.all([
          renderer.readRenderTargetPixelsAsync(target,0,0,this.size,this.size,positions,undefined,0),
          renderer.readRenderTargetPixelsAsync(target,0,0,this.size,this.size,velocities,undefined,1),
        ]),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('GPU 检查点读取超过 10 秒，保留完整输入记录')),timeoutMs);}),
      ]);
    }finally{clearTimeout(timer);}
    if(!positions.every(Number.isFinite)||!velocities.every(Number.isFinite))throw new Error('GPU 检查点包含非有限数据');
    return {stepIndex,count:this.count,size:this.size,positions,velocities};
  }
  getRecordingDescriptor(){
    return {count:this.count,size:this.size,models:this._models.map((model,index)=>({index,name:model.name})),
      shaders:{quadVertex,handFieldFragment,captureFragment,simulationFragment,particleVertex,particleFragment},
      appearance:{colorFile:"assets/mural.colors.bin",toneFile:"assets/mural.tones.bin",aPigment:"RGB Uint8 normalized sRGB, shader pow(2.2)",aStyle:"createParticleStyle(count, tones)"},camera:{fov:this.camera.fov,near:this.camera.near,far:this.camera.far},
      initialViewport:[this._width,this._height,this._ratio],rebuildTravelSeconds:REBUILD_TRAVEL_SECONDS};
  }
  _notify(){if(this.onState)this.onState(this.status);}
  resize(width,height,pixelRatio=1){
    this._width=Math.max(1,width);this._height=Math.max(1,height);this._ratio=pixelRatio;
    this._mask.resize(this._width,this._height);
    const aspect=this._width/this._height,maxSide=Math.max(this._width,this._height);
    this._field.setSize(Math.max(1,Math.round(320*this._width/maxSide)),Math.max(1,Math.round(320*this._height/maxSide)));
    const extent=this._bounds.getSize(new THREE.Vector3()),center=this._bounds.getCenter(new THREE.Vector3());
    const radial=Math.max(extent.x,extent.z),tan=Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5));
    const distance=Math.max(extent.y*.5/tan,radial*.5/(tan*aspect))*1.18+extent.z*.52;
    this._cameraTarget.set(0,center.y,0);this._cameraBaseDistance=Math.max(3.4,distance);
    // A sphere around the origin covers every model pose; keep the eye outside it.
    const lo=this._bounds.min,hi=this._bounds.max;
    const radius=Math.hypot(Math.max(Math.abs(lo.x),Math.abs(hi.x)),Math.max(Math.abs(lo.y),Math.abs(hi.y)),Math.max(Math.abs(lo.z),Math.abs(hi.z)))+Math.abs(center.y);
    this._cameraMinDistance=Math.max(.9,radius*1.12+.1);
    this.camera.aspect=aspect;this._uniforms.uAspect.value=aspect;
    this._uniforms.uViewHeight.value=this._height*pixelRatio;this._syncCamera();
  }
  _syncCamera(){
    this._cameraZoom=THREE.MathUtils.clamp(this._cameraZoom,this._cameraMinDistance/this._cameraBaseDistance,3.);
    const distance=this._cameraDistance=this._cameraBaseDistance*this._cameraZoom;
    const cosPitch=Math.cos(this._cameraPitch);
    this.camera.position.set(Math.sin(this._cameraYaw)*cosPitch*distance,Math.sin(this._cameraPitch)*distance,Math.cos(this._cameraYaw)*cosPitch*distance).add(this._cameraTarget);
    this.camera.far=Math.max(40,distance+this._cameraMinDistance*2+4);
    this.camera.lookAt(this._cameraTarget);this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    this._viewProjection.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    const screenHeight=2*distance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5)),halfHeight=screenHeight*.46;
    this._uniforms.uScreenHeight.value=screenHeight;this._uniforms.uReferenceDepth.value=distance;
    this._uniforms.uWorldBounds.value.set(-halfHeight*this.camera.aspect,-halfHeight,halfHeight*this.camera.aspect,halfHeight);
    const depth=Math.min(1.8,distance*.36);this._uniforms.uDepthBounds.value.set(-depth,depth);
  }
  // Relative orbit angles (radians); zoom receives normalized wheel pixels.
  orbit(deltaYaw,deltaPitch){
    if(!Number.isFinite(deltaYaw)||!Number.isFinite(deltaPitch))return;
    this._cameraYaw=(this._cameraYaw+deltaYaw)%(Math.PI*2);
    this._cameraPitch=THREE.MathUtils.clamp(this._cameraPitch+deltaPitch,-1.35,1.35);this._syncCamera();
  }
  zoom(delta){
    if(!Number.isFinite(delta))return;
    this._cameraZoom*=Math.exp(THREE.MathUtils.clamp(delta,-1000,1000)*.001);this._syncCamera();
  }
  resetView(){this._cameraYaw=0;this._cameraPitch=0;this._cameraZoom=1;this._syncCamera();}
  setHands(hands,timestamp,videoWidth=640,videoHeight=480){this._mask.setHands(hands,timestamp,videoWidth,videoHeight);}
  setPointer(x,y,down,now=performance.now()){
    const pointer=this._pointer,nx=THREE.MathUtils.clamp(x,0,1),ny=1-THREE.MathUtils.clamp(y,0,1),dt=(now-pointer.time)/1000;
    if(down&&pointer.down&&dt>.002&&dt<.2){const vx=(nx-pointer.x)/dt,vy=(ny-pointer.y)/dt,scale=Math.min(1,2.5/Math.max(.001,Math.hypot(vx,vy)));pointer.vx=vx*scale;pointer.vy=vy*scale;}else{pointer.vx=0;pointer.vy=0;}
    Object.assign(pointer,{x:nx,y:ny,down:Boolean(down),time:now});
  }
  setRotation(yaw,pitch=0){this._rotation.set(THREE.MathUtils.clamp(pitch,-.55,.55),yaw,0);this._matrix.makeRotationFromEuler(this._rotation);this._rotationDirty=true;}
  clearHands(){this._mask.clear();this.setPointer(this._pointer.x,1-this._pointer.y,false);}
  clear(){this.clearHands();}
  disperse(){
    this._cycle.phase="scatter";this._cycle.elapsed=0;this._cycle.progress=1;this._scatterStarted=false;this.clearHands();this._notify();
  }
  reassemble(){
    this._cycle.phase="rebuild";this._cycle.elapsed=0;this._rebuildCaptured=false;this.clearHands();this._notify();
  }
  reset(index=0){
    this._epoch++;this._cycle.reset(index);this._rearm=false;this._reset=true;this._lastReduction=-Infinity;this._lastInput=-Infinity;
    this._motionTime=0;this._scatterStarted=false;this._rebuildCaptured=false;
    this._uniforms.uPreviousPhaseTime.value=0;this._previousModelMatrix.copy(this._matrix);
    this._uniforms.uHome.value=this._models[this.modelIndex].positions;this._uniforms.uNormals.value=this._models[this.modelIndex].normals;
    this._uniforms.uPreviousHome.value=this._models[this.modelIndex].positions;
    this.clearHands();this._notify();
  }
  update(now,dt,state={}){
    if(this._disposed)return;
    this._mask.update(now,dt);
    const pointer=this._pointer;
    pointer.presence+=(Number(pointer.down)-pointer.presence)*(1-Math.exp(-dt*50));
    const recent=now-pointer.time<90;
    this._pointerUniform.set(pointer.x,pointer.y,.043,pointer.presence);
    this._pointerVelocity.set(recent?pointer.vx:0,recent?pointer.vy:0);
    const input=this.handCount>0||pointer.down;
    if(input)this._lastInput=now;
    if(this._rearm&&['intact','breaking'].includes(this.phase)){
      const moving=this._mask.velocities.some(v=>v.lengthSq()>.0144)||(pointer.down&&this._pointerVelocity.lengthSq()>.0144);
      if(!input||moving){this._rearm=false;this._notify();}
    }
    this._uniforms.uGold.value=state.gold??0;this._uniforms.uIntensity.value=state.intensity??1;this._uniforms.uBloom.value=state.bloom??.3;this._uniforms.uImpact.value=state.turbulence??1.4;
    this._uniforms.uPhase.value={intact:0,breaking:0,scatter:1,rebuild:2,settle:3}[this.phase];this._uniforms.uPhaseTime.value=this._cycle.elapsed;
    this._uniforms.uLocked.value=this.collisionLocked?1:0;
  }
  step(renderer,now,dt,state={}){
    if(this._disposed||(!this._reset&&state.paused&&!this._rotationDirty))return;
    const previousTarget=renderer.getRenderTarget(),write=1-this._read;
    const simulationDt=state.paused?0:Math.min(.04,Math.max(0,dt))*Math.max(.1,state.speed??1);
    if(state.paused&&this.phase==='rebuild'&&this._rebuildCaptured&&this._rotationDirty&&!this._previousModelMatrix.equals(this._matrix)){
      // A new model pose while paused needs a fresh continuous path, especially
      // near the endpoint. Keep the displayed grains still; capture on resume.
      this._cycle.elapsed=0;this._rebuildCaptured=false;
      this._previousModelMatrix.copy(this._matrix);
    }
    // Phase time advances only when an actual non-paused simulation is rendered.
    this._uniforms.uPreviousPhaseTime.value=this._cycle.elapsed;
    const event=simulationDt>0?this._cycle.advance(simulationDt):null;
    if(event==='settle')this._rearm=true;
    this._uniforms.uPhase.value={intact:0,breaking:0,scatter:1,rebuild:2,settle:3}[this.phase];
    this._uniforms.uPhaseTime.value=this._cycle.elapsed;this._uniforms.uLocked.value=this.collisionLocked?1:0;
    if(event)this._notify();
    this._motionTime+=simulationDt;this._uniforms.uMotionTime.value=this._motionTime;
    this._uniforms.uDt.value=simulationDt;
    this._uniforms.uScatterKick.value=simulationDt>0&&this.phase==='scatter'&&!this._scatterStarted?1:0;
    this._uniforms.uReset.value=this._reset?1:0;this._uniforms.uPoseOnly.value=state.paused&&!this._reset?1:0;
    const fieldRendered=this._reset||(!state.paused&&!this.collisionLocked);
    if(fieldRendered){this._quad.material=this._fieldMaterial;renderer.setRenderTarget(this._field);renderer.render(this._simScene,this._simCamera);}
    this._uniforms.uPositions.value=this._states[this._read].textures[0];this._uniforms.uVelocities.value=this._states[this._read].textures[1];
    const captureRendered=this.phase==='rebuild'&&!this._rebuildCaptured&&simulationDt>0&&!this._reset;
    if(captureRendered){
      this._quad.material=this._captureMaterial;renderer.setRenderTarget(this._rebuildStart);renderer.render(this._simScene,this._simCamera);
      this._rebuildCaptured=true;
    }
    this._quad.material=this._simulationMaterial;renderer.setRenderTarget(this._states[write]);renderer.render(this._simScene,this._simCamera);
    this._read=write;
    // Copy numeric uniforms only after the draw succeeded, before pose history mutates.
    // Per-step logging keeps GPU state resident; only explicit endpoint snapshots read it.
    if(this._stepRecorder)this._stepRecorder(this._uniforms,{modelIndex:this.modelIndex,
      previousModelIndex:this._models.findIndex(model=>model.positions===this._uniforms.uPreviousHome.value),
      phase:this.phase,fieldRendered,captureRendered,fieldSize:[this._field.width,this._field.height],
      viewport:[this._width,this._height,this._ratio]});
    this._reset=false;this._rotationDirty=false;this._uniforms.uPositions.value=this._states[write].textures[0];this._uniforms.uVelocities.value=this._states[write].textures[1];
    if(simulationDt>0||this._uniforms.uReset.value>.5)this._previousModelMatrix.copy(this._matrix);
    if(this.phase!=='rebuild')this._rebuildCaptured=false;
    if(this._uniforms.uScatterKick.value>.5)this._scatterStarted=true;
    if(this.phase!=='scatter'&&simulationDt>0)this._scatterStarted=false;
    if(!state.paused&&!this._pendingRead&&now-this._lastReduction>300&&['intact','breaking'].includes(this.phase)&&(this.phase==='breaking'||now-this._lastInput<1000))this._reduce(renderer,now);
    renderer.setRenderTarget(previousTarget);
  }
  _reduce(renderer,now){
    this._lastReduction=now;const uniforms=this._reductionUniforms;
    uniforms.uSource.value=this._states[this._read].textures[0];uniforms.uSourceSize.value.set(this.size,this.size);uniforms.uFirst.value=1;
    this._quad.material=this._reductionMaterial;
    for(const target of this._reductions){renderer.setRenderTarget(target);renderer.render(this._simScene,this._simCamera);uniforms.uSource.value=target.texture;uniforms.uSourceSize.value.set(target.width,target.height);uniforms.uFirst.value=0;}
    this._pendingRead=true;const epoch=this._epoch,target=this._reductions[this._reductions.length-1];
    renderer.readRenderTargetPixelsAsync(target,0,0,1,1,this._readBuffer).then(()=>{
      if(this._disposed||epoch!==this._epoch)return;
      const damaged=this._readBuffer[0],total=this._readBuffer[1];
      if(total!==this.count||!Number.isFinite(damaged))throw new Error('GPU damage reduction returned an invalid particle count.');
      const previousIndex=this.modelIndex;
      if(this._cycle.reportDamage(damaged)){
        if(previousIndex!==this.modelIndex){
          this._epoch++;this._rebuildCaptured=false;
          this._uniforms.uPreviousHome.value=this._models[previousIndex].positions;
          this._uniforms.uHome.value=this._models[this.modelIndex].positions;
          this._uniforms.uNormals.value=this._models[this.modelIndex].normals;
        }
        this._notify();
      }
    }).catch(error=>{
      if(this._disposed)return;this._diagnosticError=error.message;console.warn('Sculpture damage readback:',error.message);this._notify();
    }).finally(()=>{this._pendingRead=false;});
  }
  dispose(){
    this._disposed=true;this._epoch++;this.clearHands();
    this._states.forEach(target=>target.dispose());this._rebuildStart.dispose();this._captureMaterial.dispose();this._field.dispose();this._reductions.forEach(target=>target.dispose());
    this._models.forEach(model=>{model.positions.dispose();model.normals.dispose();});
    this._curlTexture.dispose();
    this._points.geometry.dispose();this._particleMaterial.dispose();this._quad.geometry.dispose();this._fieldMaterial.dispose();this._simulationMaterial.dispose();this._reductionMaterial.dispose();
  }
}
