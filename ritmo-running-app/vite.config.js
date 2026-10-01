import { defineConfig } from 'vite';
import runningDrive from './netlify/functions/running-drive.mjs';
import { RUNNING_DRIVE } from './src/driveConfig.js';

export default defineConfig({plugins:[{
  name:'paceup-local-drive',
  configureServer(server) {
    server.middlewares.use(async (req,res,next)=>{
      if (new URL(req.url,'http://localhost').pathname !== RUNNING_DRIVE.endpoint) return next();
      try {
        const response = await runningDrive(new Request('http://localhost'+req.url,{method:req.method}));
        res.statusCode = response.status;
        response.headers.forEach((value,key)=>res.setHeader(key,value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.statusCode = 502;res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({error:'No se pudo consultar Drive. Se conserva la copia local.'}));
      }
    });
  }
}]});
