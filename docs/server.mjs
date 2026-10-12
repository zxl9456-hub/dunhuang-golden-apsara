import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('./',import.meta.url))),port=Number(process.env.PORT||4287);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.bin':'application/octet-stream','.glb':'model/gltf-binary','.png':'image/png','.mp3':'audio/mpeg','.ogg':'audio/ogg','.task':'application/octet-stream','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
  try{
    let urlPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(urlPath.endsWith('/'))urlPath+='index.html';
    const target=path.resolve(root,'.'+urlPath);if(!target.startsWith(root+path.sep)&&target!==root)throw new Error('path');
    const info=await stat(target);if(!info.isFile())throw new Error('file');
    const body=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/`));
