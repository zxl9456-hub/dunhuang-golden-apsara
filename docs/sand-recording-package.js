import {sha256} from './particle-recorder.js';
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;}
const bytes=value=>typeof value==='string'?encoder.encode(value):value instanceof Uint8Array?value:new Uint8Array(value.buffer??value,value.byteOffset??0,value.byteLength);

// ZIP's STORE method keeps export fast and preserves every float bit.
export function createStoredZip(entries){
  const chunks=[],directory=[];let offset=0,centralSize=0;
  for(const {path,data} of entries){
    const name=encoder.encode(path),body=bytes(data),crc=crc32(body),header=new Uint8Array(30+name.length),view=new DataView(header.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,33,true);
    view.setUint32(14,crc,true);view.setUint32(18,body.length,true);view.setUint32(22,body.length,true);view.setUint16(26,name.length,true);header.set(name,30);
    const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,body.length,true);cv.setUint32(24,body.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46);
    chunks.push(header,body);directory.push(central);offset+=header.length+body.length;centralSize+=central.length;
  }
  const end=new Uint8Array(22),ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}

export async function createRecordingPackage(recording,{resources,checkpoints=[]}){
  const entries=[],checkpointManifest=[];
  for(const [path,data] of resources)entries.push({path,data});
  for(const checkpoint of checkpoints){
    if(!checkpoint)continue;
    if(checkpoint.error){checkpointManifest.push({name:checkpoint.name,error:checkpoint.error});continue;}
    const positionPath='checkpoints/'+checkpoint.name+'.positions.f32.bin',velocityPath='checkpoints/'+checkpoint.name+'.velocities.f32.bin';
    entries.push({path:positionPath,data:checkpoint.positions},{path:velocityPath,data:checkpoint.velocities});
    checkpointManifest.push({name:checkpoint.name,stepIndex:checkpoint.stepIndex,count:checkpoint.count,size:checkpoint.size,
      positionPath,velocityPath,format:'Float32LE RGBA, texture row zero first',positionChannels:'world X,Y,Z, permanent damage',velocityChannels:'world X,Y,Z, time since touch'});
  }
  recording.checkpoints=checkpointManifest;
  entries.push({path:'recording.sandrec.json',data:JSON.stringify(recording)});
  entries.push({path:'README.txt',data:'敦煌壁画粒子动作数据包\n\n这是底层运动数据，不包含摄像头视频。录制时壁画固定正面、停止自旋，保留手势与鼠标扰动。\n\n将整个 ZIP 发给 Codex，可使用原始 GPU 计算规则重放，再烘焙为 Blender 粒子动画。无需另外寻找模型、噪波或 shader。\n\nrecording.sandrec.json：每次实际模拟的输入、时间步、阶段、模型索引与生产 shader。\nassets：壁画的采样坐标、法线、原画颜色、亮度、三维 curl 噪波与来源信息。\ncheckpoints：开始和结束时的真实 GPU 坐标、速度、碎裂标记。若设备读取失败，日志中会明确说明，完整输入仍可重演。\nmanifest.json：每个包内文件的 SHA-256 与字节数（不包含 manifest 本身）。\n\n重放须从首个 uReset=1 的步骤开始，按 steps 顺序重画手势力场、必要的重塑起点拷贝及粒子模拟。不要离线重新判断损伤阈值；使用记录中的真实阶段。矩阵为列主序、坐标为 Three.js 右手 Y-up，Blender 中按 (x,-z,y) 转换。\n'});
  const files=await Promise.all(entries.map(async entry=>({path:entry.path,bytes:bytes(entry.data).byteLength,sha256:await sha256(bytes(entry.data))})));
  const manifest={schema:'golden-sand-data-package',version:1,createdAt:recording.metadata.createdAt,recording:'recording.sandrec.json',
    durationSeconds:recording.summary.simulationSeconds,stepCount:recording.steps.length,particleCount:recording.metadata.count,
    autoRotate:false,cameraVideoIncluded:false,files,checkpoints:checkpointManifest};
  entries.push({path:'manifest.json',data:JSON.stringify(manifest,null,2)});
  return {blob:createStoredZip(entries),manifest};
}
