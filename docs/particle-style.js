// Four normalized bytes per grain; generated once, never during animation.
const directions=new Uint8Array(512);
for(let i=0;i<256;i++){
  const angle=i*Math.PI/128;
  directions[i*2]=Math.round((Math.cos(angle)*.5+.5)*255);
  directions[i*2+1]=Math.round((Math.sin(angle)*.5+.5)*255);
}
export function createParticleStyle(count,tones=null){
  const values=new Uint8Array(count*4);
  let seed=0x1f123bb5;
  const randomByte=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>24;};
  for(let i=0;i<values.length;i+=4){
    values[i]=randomByte();if(tones)values[i]=tones[i/4];values[i+1]=randomByte();
    const direction=randomByte()*2;
    values[i+2]=directions[direction];values[i+3]=directions[direction+1];
  }
  return values;
}
