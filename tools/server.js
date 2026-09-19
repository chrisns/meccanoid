import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('dist');
const port=Number(process.env.PORT||8080);
const base=(process.env.BASE_PATH||'/').replace(/\/?$/,'/');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.task':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(base)){res.writeHead(404).end();return;}
  const relative=path.slice(base.length)||'index.html';
  const file=resolve(root,relative);
  if(!file.startsWith(root+sep)||relative.split('/').some(p=>p.startsWith('.'))){res.writeHead(404).end();return;}
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(body);
 }catch{res.writeHead(404).end();}
}).listen(port,'127.0.0.1',()=>console.log(`Robot club: http://localhost:${port}${base}`));
