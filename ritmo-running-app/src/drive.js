import { RUNNING_DRIVE } from './driveConfig.js';

export async function fetchDriveWorkbook(fetcher = globalThis.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),25000);
  try {
    const response = await fetcher(RUNNING_DRIVE.endpoint,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    if (!response.ok) {
      let message;
      try { message = (await response.json()).error; } catch {}
      throw new Error(typeof message === 'string' ? message : 'No se pudo consultar Drive. Se conserva la copia local.');
    }
    const revision = response.headers.get('x-paceup-revision');
    if (response.headers.get('x-paceup-file-id') !== RUNNING_DRIVE.id || !/^[a-f0-9]{64}$/.test(revision || ''))
      throw new Error('La conexión con Drive no está disponible en este sitio. Se conserva la copia local.');
    if (Number(response.headers.get('content-length')) > RUNNING_DRIVE.maxBytes) throw new Error('El Excel de Drive es demasiado grande.');
    const buffer = await response.arrayBuffer(),bytes = new Uint8Array(buffer);
    if (bytes.length > RUNNING_DRIVE.maxBytes || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
      throw new Error('Drive no devolvió un Excel válido. Se conserva la copia local.');
    return {name:RUNNING_DRIVE.name,buffer,source:'drive',driveFileId:RUNNING_DRIVE.id,driveRevision:revision,driveCheckedAt:Date.now()};
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'AbortError')
      throw new Error('No se pudo conectar con Drive. Revisá tu conexión y volvé a recargar.');
    throw error;
  } finally { clearTimeout(timeout); }
}
