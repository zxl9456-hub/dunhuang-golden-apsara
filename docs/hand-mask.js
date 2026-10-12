import * as THREE from 'three';

const FINGERS=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function matchHands(hands,slots,now){
  // Match the two possible permutations, retaining identity across crossings.
  const cost=(hand,slot)=>{
    const wrist=hand.landmarks[0],recent=now-slot.seen<650;
    const movement=slot.wrist?(recent?dist(wrist,slot.wrist):.24):.30;
    const identity=hand.label&&slot.label?(hand.label===slot.label?-.28:.42):0;
    return movement+identity;
  };
  if(!hands.length)return [];
  if(hands.length===1)return [[hands[0],cost(hands[0],slots[0])<=cost(hands[0],slots[1])?0:1]];
  const straight=cost(hands[0],slots[0])+cost(hands[1],slots[1]);
  const crossed=cost(hands[0],slots[1])+cost(hands[1],slots[0]);
  return straight<=crossed?[[hands[0],0],[hands[1],1]]:[[hands[0],1],[hands[1],0]];
}

export function createHandMask(){
  const hands=[new THREE.Vector4(.3,.5,.10,0),new THREE.Vector4(.7,.5,.10,0)];
  const velocities=[new THREE.Vector2(),new THREE.Vector2()];
  const frameVelocity=new THREE.Vector2();
  const bounds=[new THREE.Vector4(),new THREE.Vector4()];
  const capsules=Array.from({length:32},()=>new THREE.Vector4());
  const radii=new Float32Array(32);
  const slots=Array.from({length:2},()=>({label:'',wrist:null,seen:-Infinity,target:[],motion:[],points:[],presence:0,center:null}));
  let width=1,height=1;
  function resize(w,h){width=w;height=h;clear();}
  function setHands(detected,now,vw,vh){
    const valid=detected.filter(h=>h.landmarks?.length===21).slice(0,2);
    const scale=Math.max(width/vw,height/vh),dw=vw*scale,dh=vh*scale;
    const assignments=matchHands(valid,slots,now);
    for(const [hand,index] of assignments){
      const slot=slots[index];
      const fresh=now-slot.seen>300,elapsed=(now-slot.seen)/1000;
      if(fresh){slot.points=[];slot.center=null;slot.motion=[];}
      const target=hand.landmarks.map(p=>({x:(1-p.x)*dw+(width-dw)/2,y:p.y*dh+(height-dh)/2}));
      slot.motion=target.map((p,j)=>{
        if(fresh||!slot.target[j]||elapsed<.005)return {x:0,y:0};
        let vx=(p.x-slot.target[j].x)/elapsed,vy=(p.y-slot.target[j].y)/elapsed;
        const clamp=Math.min(1,height*2.5/Math.max(1,Math.hypot(vx,vy)));vx*=clamp;vy*=clamp;
        return {x:(slot.motion[j]?.x||0)*.25+vx*.75,y:(slot.motion[j]?.y||0)*.25+vy*.75};
      });
      slot.target=target;
      slot.seen=now;slot.wrist=hand.landmarks[0];slot.label=hand.label||slot.label;
    }
    // Missing hands release their collision force while existing sand settles.
    const assigned=new Set(assignments.map(pair=>pair[1]));
    slots.forEach((s,i)=>{if(!assigned.has(i))s.target=[];});
  }
  function update(now,dt){
    slots.forEach((slot,i)=>{
      const seen=slot.target.length===21&&now-slot.seen<300;
      slot.presence+=(Number(seen)-slot.presence)*(1-Math.exp(-dt*(seen?55:14)));
      if(seen){
        if(slot.points.length!==21)slot.points=slot.target.map(p=>({...p}));
        const blend=1-Math.exp(-dt*90),age=Math.max(0,(now-slot.seen)/1000);
        const lead=Math.min(.080,age+.010)*.8*Math.exp(-Math.max(0,age-.12)*8);
        slot.points.forEach((p,j)=>{p.x+=(slot.target[j].x+(slot.motion[j]?.x||0)*lead-p.x)*blend;p.y+=(slot.target[j].y+(slot.motion[j]?.y||0)*lead-p.y)*blend;});
        const p=slot.points,centerX=(p[0].x+p[5].x+p[9].x+p[17].x)*.25/width,centerY=1-(p[0].y+p[5].y+p[9].y+p[17].y)*.25/height;
        if(slot.center&&dt>0){frameVelocity.set((centerX-slot.center.x)/dt,(centerY-slot.center.y)/dt).clampLength(0,2.5);velocities[i].lerp(frameVelocity,1-Math.exp(-dt*45));}else velocities[i].set(0,0);
        if(!slot.center)slot.center={x:centerX,y:centerY};else{slot.center.x=centerX;slot.center.y=centerY;}
        const palm=Math.max(dist(p[5],p[17]),dist(p[0],p[9])*.73)/height;
        hands[i].set(centerX,centerY,palm,slot.presence);
        // Screen metric capsules are only collision obstacles; they never emit sand.
        let capsule=i*16;
        const put=(a,b,r)=>{capsules[capsule].set(a.x/height,1-a.y/height,b.x/height,1-b.y/height);radii[capsule++]=r;};
        put({x:p[0].x*.72+p[9].x*.28,y:p[0].y*.72+p[9].y*.28},{x:(p[5].x+p[9].x+p[13].x+p[17].x)*.25,y:(p[5].y+p[9].y+p[13].y+p[17].y)*.25},palm*.40);
        FINGERS.forEach((finger,f)=>{for(let j=0;j<3;j++)put(p[finger[j]],p[finger[j+1]],palm*(f===0?.115:f===4?.078:.093)*(1-j*.11));});
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        for(const point of p){const x=point.x/width,y=1-point.y/height;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
        const pad=palm*.33;
        bounds[i].set(minX-pad/(width/height),minY-pad,maxX+pad/(width/height),maxY+pad);
      }else{hands[i].w=slot.presence;velocities[i].multiplyScalar(Math.exp(-dt*8));}
    });
  }
  function clear(){slots.forEach(s=>{s.seen=-Infinity;s.target=[];s.motion=[];s.points=[];s.wrist=null;s.label='';s.presence=0;s.center=null;});hands.forEach(h=>h.w=0);velocities.forEach(v=>v.set(0,0));}
  return {hands,velocities,bounds,capsules,radii,resize,setHands,update,clear,get count(){return slots.filter(s=>s.target.length===21&&performance.now()-s.seen<300).length;}};
}
