import { createHash } from 'node:crypto';
import { RUNNING_DRIVE } from '../../src/driveConfig.js';

const commonHeaders = { 'Cache-Control':'no-store', 'CDN-Cache-Control':'no-store', 'Netlify-CDN-Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };
const errorResponse = (message, status) => new Response(JSON.stringify({error:message}), {status,headers:{...commonHeaders,'Content-Type':'application/json'}});
async function limitedBytes(response) {
  if (Number(response.headers.get('content-length')) > RUNNING_DRIVE.maxBytes) throw new Error('size');
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RUNNING_DRIVE.maxBytes) { await reader.cancel(); throw new Error('size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);let offset = 0;
  chunks.forEach(chunk=>{bytes.set(chunk,offset);offset+=chunk.length;});
  return bytes;
}
export function createRunningDriveHandler(fetcher = globalThis.fetch) {
  return async request => {
    if (request.method !== 'GET') return errorResponse('Método no permitido',405);
    // Only the configured workbook is fetched. Request URLs cannot choose a file,
    // remote host, credentials, or an arbitrary target for this endpoint.
    const url = new URL('https://drive.usercontent.google.com/download');
    url.search = new URLSearchParams({id:RUNNING_DRIVE.id,export:'download',confirm:'t',_paceup:String(Date.now())});
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),20000);
    try {
      const upstream = await fetcher(url,{signal:controller.signal,cache:'no-store',redirect:'follow'});
      if (!upstream.ok) return errorResponse('No se pudo leer Running.xlsx en Drive. Se conserva la copia local.',502);
      const bytes = await limitedBytes(upstream);
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
        return errorResponse('Drive no devolvió el Excel. Revisá que el archivo siga permitiendo lectura mediante enlace.',502);
      const revision = createHash('sha256').update(bytes).digest('hex');
      return new Response(bytes,{headers:{...commonHeaders,
        'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':'attachment; filename="Running.xlsx"',
        'X-PaceUp-Revision':revision,'X-PaceUp-File-Id':RUNNING_DRIVE.id}});
    } catch (error) {
      return errorResponse(error.message === 'size' ? 'El Excel supera los 4 MB permitidos para sincronizar. Podés importarlo desde el dispositivo.' : 'No se pudo consultar Drive. Se conserva la copia local.', error.message === 'size' ? 413 : 502);
    } finally { clearTimeout(timeout); }
  };
}
export default createRunningDriveHandler();
