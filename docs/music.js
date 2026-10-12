// Music starts only from an explicit user action; the 3D scene loads independently.
const $=id=>document.getElementById(id);
const audio=$('bgm'),toggle=$('music-toggle'),panel=$('music-panel'),play=$('music-play');
const volume=$('music-volume'),output=$('music-volume-value'),mute=$('music-mute');
let pending=false,request=0,previousVolume=.35,suspended=false;
audio.volume=.35;

function render(){
  const active=!audio.paused,muted=audio.muted||audio.volume===0;
  toggle.setAttribute('aria-pressed',String(active));
  toggle.setAttribute('aria-label',active?'暂停背景音乐':'播放背景音乐');
  toggle.title=active?'暂停《阳关三叠》 / M':'播放《阳关三叠》 / M';
  toggle.classList.toggle('music-playing',active&&!muted);
  play.textContent=pending?'正在载入乐声…':active?'暂停配乐':'播放配乐';
  play.setAttribute('aria-label',active?'暂停配乐':'播放配乐');
  mute.setAttribute('aria-pressed',String(muted));
  mute.setAttribute('aria-label',muted?'取消静音':'静音配乐');
  mute.textContent=muted?'取消静音':'静音';
  volume.value=String(Math.round(audio.volume*100));
  output.value=Math.round(audio.volume*100)+'%';
  $('music-status').textContent=pending?'正在载入乐声…':active?(muted?'乐声已静音':'乐声流转 · 循环播放'):'点击播放，让乐声伴飞天起舞';
}
function reveal(){panel.hidden=false;toggle.setAttribute('aria-expanded','true');}
function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}
async function start(){
  const token=++request;pending=true;suspended=false;render();
  try{await audio.play();}
  catch(error){
    if(token!==request||error.name==='AbortError')return;
    audio.pause();$('music-status').textContent='乐声暂未载入，请点击播放重试';
  }finally{if(token===request){pending=false;render();if(audio.error)$('music-status').textContent='乐声暂未载入，请点击播放重试';}}
}
function pause(){request++;pending=false;suspended=false;audio.pause();render();}
function switchMusic(){
  if(pending||!audio.paused)pause();
  else{if(audio.error)audio.load();start();}
}
toggle.onclick=()=>{reveal();switchMusic();};
play.onclick=switchMusic;
$('music-close').onclick=()=>{close();toggle.focus();};
volume.oninput=()=>{audio.volume=Number(volume.value)/100;audio.muted=false;if(audio.volume>0)previousVolume=audio.volume;render();};
mute.onclick=()=>{
  if(audio.muted||audio.volume===0){audio.muted=false;if(audio.volume===0)audio.volume=previousVolume;}
  else audio.muted=true;
  render();
};
for(const event of ['play','playing','pause','volumechange','ended'])audio.addEventListener(event,render);
audio.addEventListener('error',()=>{pending=false;render();$('music-status').textContent='乐声暂未载入，请点击播放重试';});
document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!toggle.contains(event.target))close();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!panel.hidden){close();toggle.focus();return;}
  if(event.repeat||event.metaKey||event.ctrlKey||event.altKey||/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)||event.target.isContentEditable||$('reference-dialog').open)return;
  if(event.key.toLowerCase()==='m'){event.preventDefault();switchMusic();}
});
// Prevent sound in a hidden tab; resume only music that was playing before hiding.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){suspended=!audio.paused||pending;request++;pending=false;audio.pause();render();}
  else if(suspended){suspended=false;start();}
});
window.addEventListener('pagehide',()=>{suspended=false;pause();});
render();
