import * as THREE from 'three';
import {SculptureSand} from './sculpture-sand.js';
import {HandTracker} from './hand-tracker.js';
import {ParticleRecorder,createRecordingManifest,recordingFilename} from './particle-recorder.js';
import {createRecordingPackage} from './sand-recording-package.js';

const $=id=>document.getElementById(id),stage=$('stage');
const state={paused:false,intensity:1,turbulence:1.4,speed:1,bloom:.3,autoRotate:false,quality:'auto',rotate:false,clean:false,gold:0};
let renderer,sculpture,yaw=0,pitch=0,drag=null,lastTime=0,recordingBusy=false,recordUrl=null,startCheckpoint=null,resources=null,toastTimer;
const recorder=new ParticleRecorder({onLimit:()=>stopRecording('limit'),onError:error=>{console.error(error);stopRecording('capture-error');}});
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4400);}
function setPhase(s){
  const labels={intact:'飞天 · 静候触碰',breaking:'金沙轻散 · '+Math.floor(s.progress*100)+'%',scatter:'形已散 · 舞未尽',rebuild:'金沙回旋 · 飞天重塑',settle:'千年一瞬 · 舞韵归来'};
  $('phase').textContent=s.error?'粒子统计异常，请刷新页面':labels[s.phase];
  $('fracture-fill').style.transform=`scaleX(${s.progress})`;
  document.querySelector('.fracture-track').setAttribute('aria-valuenow',Math.round(s.progress*100));
  stage.dataset.phase=s.phase;stage.dataset.particles=s.count;stage.dataset.palette=state.gold?'gold':'pigment';
}
function resize(){
  if(!renderer)return;cancelDrag();
  const {width,height}=stage.getBoundingClientRect();
  const budget={auto:1000000,high:2000000,low:430000}[state.quality];
  const ratio=Math.min(devicePixelRatio,state.quality==='high'?2:1.5,Math.sqrt(budget/(width*height)));
  renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);sculpture?.resize(width,height,ratio);
}
async function loadModels(){
  const get=async url=>{const r=await fetch(url);if(!r.ok)throw new Error('素材读取失败 '+r.status+'：'+url);return r.arrayBuffer();};
  const [samples,noise,tones,colors,mesh,metaBuffer,texture]=await Promise.all([get('./assets/apsara.samples.bin'),get('./assets/curl-noise.bin'),get('./assets/apsara.tones.bin'),get('./assets/apsara.colors.bin'),get('./assets/apsara.mesh.bin'),get('./assets/apsara.mesh.json'),new THREE.TextureLoader().loadAsync('./assets/apsara-color.png')]);
  const count=262144;if(samples.byteLength!==count*24||noise.byteLength!==32**3*4||tones.byteLength!==count||colors.byteLength!==count*3)throw new Error('粒子素材不完整');
  const positions=new Float32Array(samples,0,count*3),normals=new Float32Array(samples,count*12,count*3);
  const meta=JSON.parse(new TextDecoder().decode(metaBuffer)),v=meta.vertexCount;
  if(!Number.isInteger(v)||v<1||!Number.isInteger(meta.indexCount)||mesh.byteLength!==v*40+meta.indexCount*4)throw new Error('三维模型素材不完整');
  texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.needsUpdate=true;
  const surface={positions:new Float32Array(mesh,0,v*3),normals:new Float32Array(mesh,v*12,v*3),uvs:new Float32Array(mesh,v*24,v*2),lookup:new Float32Array(mesh,v*32,v*2),indices:new Uint32Array(mesh,v*40,meta.indexCount),texture};
  return {surface,tones:new Uint8Array(tones),colors:new Uint8Array(colors),models:[{name:'三维飞天 · 原画色彩',positions,normals},{name:'三维飞天 · 原画色彩',positions,normals}],curlNoise:{size:32,data:new Uint8Array(noise)}};
}
const video=$('camera-video');
const tracker=new HandTracker(video,(hands,timestamp)=>{
  sculpture?.setHands(hands,timestamp,video.videoWidth||640,video.videoHeight||480);
  if(tracker.ready)$('camera-message').textContent=hands.length?`已识别 ${hands.length} 只手 · 轻拨金沙`:'把双手伸入摄像头画面';
},(phase,message)=>{
  const active=!['off','error'].includes(phase);
  $('camera-toggle').setAttribute('aria-pressed',String(active));
  $('camera-toggle').querySelector('span').textContent=active?'关闭手势':'手势';
  $('camera-preview').hidden=!(active&&video.srcObject);$('camera-message').textContent=message;
  if(phase==='error'){toast(message);sculpture?.clearHands();}
  if(phase==='off')sculpture?.clearHands();
});
function animate(now){
  requestAnimationFrame(animate);
  if(!sculpture||document.hidden)return;
  const dt=Math.min(.04,lastTime?(now-lastTime)/1000:1/60);lastTime=now;
  if(!state.paused&&state.autoRotate&&!drag&&!recorder.active){yaw+=dt*.045*state.speed;sculpture.setRotation(yaw,pitch);}
  stage.dataset.palette=state.gold?'gold':'pigment';sculpture.update(now,state.paused?0:dt,state);sculpture.step(renderer,now,dt,state);
  renderer.setRenderTarget(null);renderer.render(sculpture.scene,sculpture.camera);
  if(tracker.active)tracker.tick(now);
  if(recorder.active){const seconds=Math.floor(recorder.elapsedSeconds);$('record-time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
}
function setMode(rotate){
  cancelDrag();state.rotate=rotate;$('brush').classList.toggle('selected',!rotate);$('rotate').classList.toggle('selected',rotate);
  $('brush').setAttribute('aria-pressed',String(!rotate));$('rotate').setAttribute('aria-pressed',String(rotate));stage.style.cursor=rotate?'grab':'crosshair';
}
function setPause(paused){state.paused=paused;$('play').textContent=paused?'▷':'Ⅱ';$('play').setAttribute('aria-label',paused?'继续':'暂停');}
function reset(){if(recorder.active||recordingBusy)return;cancelDrag();yaw=pitch=0;sculpture.setRotation(0,0);sculpture.resetView();sculpture.reset();setPause(false);toast('飞天已归位');}
function cancelDrag(e){
  if(!drag||(e&&drag.id!==e.pointerId))return;
  sculpture?.setPointer(.5,.5,false);try{stage.releasePointerCapture(drag.id);}catch{}drag=null;
}
const pointerCoords=e=>{const r=stage.getBoundingClientRect();return[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height];};
stage.addEventListener('pointerdown',e=>{
  if(!sculpture||drag||recordingBusy||![0,1,2].includes(e.button))return;
  const orbit=e.button===1,rotate=state.rotate||e.button===2||e.shiftKey;
  if(recorder.active&&(orbit||rotate))return;
  e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,rotate,orbit};stage.setPointerCapture(e.pointerId);
  if(!rotate&&!orbit)sculpture.setPointer(...pointerCoords(e),true);
});
stage.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  if(drag.orbit)sculpture.orbit(-(e.clientX-drag.x)*.006,(e.clientY-drag.y)*.006);
  else if(drag.rotate){yaw+=(e.clientX-drag.x)*.008;pitch=THREE.MathUtils.clamp(pitch+(e.clientY-drag.y)*.006,-.5,.5);sculpture.setRotation(yaw,pitch);}
  else sculpture.setPointer(...pointerCoords(e),true);
  drag.x=e.clientX;drag.y=e.clientY;
});
['pointerup','pointercancel','lostpointercapture'].forEach(name=>stage.addEventListener(name,cancelDrag));
stage.addEventListener('contextmenu',e=>e.preventDefault());stage.addEventListener('auxclick',e=>e.preventDefault());
stage.addEventListener('wheel',e=>{if(!sculpture||recorder.active||recordingBusy)return;e.preventDefault();sculpture.zoom(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1));},{passive:false});
$('brush').onclick=()=>setMode(false);$('rotate').onclick=()=>setMode(true);
$('disperse').onclick=()=>{if(!sculpture)return;cancelDrag();setPause(false);sculpture.disperse();};
$('reassemble').onclick=()=>{if(!sculpture)return;cancelDrag();setPause(false);sculpture.reassemble();};
$('play').onclick=()=>setPause(!state.paused);$('reset').onclick=reset;
function palette(gold){state.gold=gold;$('artwork').classList.toggle('nav-active',!gold);$('gold-mode').classList.toggle('nav-active',!!gold);$('artwork').setAttribute('aria-pressed',String(!gold));$('gold-mode').setAttribute('aria-pressed',String(!!gold));}
$('artwork').onclick=()=>palette(0);$('gold-mode').onclick=()=>palette(1);
$('settings').onclick=()=>{$('settings-panel').hidden=!$('settings-panel').hidden;$('record-panel').hidden=true;};$('settings-close').onclick=()=>$('settings-panel').hidden=true;
$('record').onclick=()=>{$('record-panel').hidden=!$('record-panel').hidden;$('settings-panel').hidden=true;};$('record-close').onclick=()=>$('record-panel').hidden=true;
for(const key of ['intensity','turbulence','speed','bloom']){$(key).value=state[key];$(key+'-value').value=state[key].toFixed(2);$(key).oninput=e=>{state[key]=Number(e.target.value);$(key+'-value').value=state[key].toFixed(2);};}
$('quality').onchange=e=>{state.quality=e.target.value;resize();};
$('auto-rotate').onclick=()=>{state.autoRotate=!state.autoRotate;$('auto-rotate').setAttribute('aria-pressed',String(state.autoRotate));};
$('camera-toggle').onclick=()=>tracker.active||tracker.starting?tracker.stop():tracker.start();
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器未开放全屏，可隐藏界面欣赏（H）');}};
$('reference').onclick=()=>$('reference-dialog').showModal();$('reference-close').onclick=()=>$('reference-dialog').close();
$('reference-dialog').onclick=e=>{if(e.target===$('reference-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
function clean(){state.clean=!state.clean;document.body.classList.toggle('clean',state.clean);$('show-ui').hidden=!state.clean;}$('show-ui').onclick=clean;
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('reference-dialog').open)return;if(e.code==='Space'){if(e.target.closest('button,a'))return;e.preventDefault();if(!recorder.active)setPause(!state.paused);}else if(e.key.toLowerCase()==='r')reset();else if(e.key.toLowerCase()==='h')clean();});
function lockControls(locked){
  ['artwork','gold-mode','reset','brush','rotate','disperse','reassemble','play','settings','fullscreen','intensity','turbulence','speed','bloom','quality','auto-rotate'].forEach(id=>$(id).disabled=locked);
  $('record-toggle').disabled=recordingBusy;$('record-toggle').textContent=recordingBusy?'正在处理…':recorder.active?'停止并保存':'开始录制';
}
async function startRecording(){
  if(!sculpture||recordingBusy||recorder.active)return;
  recordingBusy=true;lockControls(true);$('record-message').textContent='正在准备模型、噪波和着色器…';$('record-download').hidden=true;
  try{
    resources=new Map();const metadata=await createRecordingManifest(sculpture.getRecordingDescriptor(),{onResource:(p,b)=>resources.set(p,b)});
    if(document.hidden)throw new Error('请回到当前页面后开始录制');
    cancelDrag();setMode(false);setPause(false);yaw=pitch=0;sculpture.setRotation(0,0);sculpture.resetView();sculpture.reset();
    metadata.initialModelIndex=0;metadata.subject='敦煌飞天 · Hyper3D 原画色彩三维模型';recorder.start(metadata);startCheckpoint=null;
    sculpture.setStepRecorder((uniforms,info)=>{const first=recorder.steps.length===0;recorder.capture(uniforms,info);if(first)startCheckpoint=sculpture.captureRecordingCheckpoint(renderer,0).then(v=>({...v,name:'start'})).catch(e=>({name:'start',error:e.message}));});
    $('record-time').textContent='00:00';$('record-message').textContent='正在记录 · 用鼠标或双手轻拨金沙，最长 90 秒。';document.body.classList.add('recording');
  }catch(error){toast('录制未开始：'+error.message);$('record-message').textContent=error.message;resources=null;}
  finally{recordingBusy=false;lockControls(recorder.active);}
}
function offerDownload(blob,name){if(recordUrl)URL.revokeObjectURL(recordUrl);recordUrl=URL.createObjectURL(blob);const a=$('record-download');a.href=recordUrl;a.download=name;a.hidden=false;a.click();}
async function stopRecording(reason='manual'){
  if(!recorder.active||recordingBusy)return;
  const recording=recorder.stop(reason);sculpture.setStepRecorder(null);cancelDrag();document.body.classList.remove('recording');recordingBusy=true;lockControls(true);
  $('record-message').textContent='正在打包运动数据与 GPU 检查点…';
  try{
    if(!recording.steps.length)throw new Error('没有记录到动画帧，请重试');
    const end=sculpture.captureRecordingCheckpoint(renderer,recording.steps.length-1).then(v=>({...v,name:'end'})).catch(e=>({name:'end',error:e.message}));
    const checkpoints=await Promise.all([startCheckpoint,end]);
    const {blob}=await createRecordingPackage(recording,{resources,checkpoints});offerDownload(blob,recordingFilename(recording));
    $('record-message').textContent=`已导出 ${recording.summary.simulationSeconds.toFixed(1)} 秒 · ${recording.steps.length} 步，包含模型、输入与检查点。`;toast('粒子数据包已生成');
  }catch(error){console.error(error);if(recording.steps.length)offerDownload(new Blob([JSON.stringify(recording)],{type:'application/json'}),recordingFilename(recording).replace('.sandpack.zip','.sandrec.json'));$('record-message').textContent='完整打包失败：'+error.message+'。已保留原始运动日志。';}
  finally{recordingBusy=false;resources=null;startCheckpoint=null;lockControls(false);}
}
$('record-toggle').onclick=()=>recorder.active?stopRecording():startRecording();
document.addEventListener('visibilitychange',()=>{lastTime=0;cancelDrag();sculpture?.clearHands();if(document.hidden&&recorder.active)stopRecording('background');});
window.addEventListener('pagehide',()=>{tracker.stop(false);sculpture?.clearHands();});
window.addEventListener('blur',()=>{cancelDrag();sculpture?.clearHands();});
new ResizeObserver(resize).observe(stage);
async function init(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,powerPreference:'high-performance'});renderer.setClearColor(0x000000,0);
    if(!renderer.extensions.has('EXT_color_buffer_float'))throw new Error('浏览器未提供浮点渲染，请使用开启硬件加速的 Chrome 或 Edge');
    renderer.domElement.setAttribute('aria-label','原画色彩三维敦煌飞天与 262144 颗表面粒子');stage.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();setPause(true);tracker.stop();$('loading').hidden=false;$('loading').innerHTML='<p>图形连接中断</p><button id="retry">重新载入</button>';$('retry').onclick=()=>location.reload();});
    sculpture=new SculptureSand({...await loadModels(),onState:setPhase});sculpture.setRotation(0,0);resize();setPhase(sculpture.status);$('loading').hidden=true;
    window.__apsara={get state(){return {...state,phase:sculpture.phase,progress:sculpture.progress,recording:recorder.active};},sculpture,renderer};requestAnimationFrame(animate);
  }catch(error){console.error(error);$('loading').innerHTML='<p>金沙暂未凝聚</p><small></small><button id="retry">重新载入 ↻</button>';$('loading').querySelector('small').textContent=error.message;$('retry').onclick=()=>location.reload();}
}
init();
