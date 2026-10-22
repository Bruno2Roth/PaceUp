// Acceso explícito a Google Drive: no se almacenan contraseñas ni tokens persistentes.
// Google aplica los permisos del usuario al ID fijo de Running.xlsm.
import { RUNNING_DRIVE } from './driveConfig.js';
import { updateDriveWorkbook } from './driveArchive.js';

const CLIENT_ID=import.meta.env.VITE_GOOGLE_CLIENT_ID||'';
const SCOPE='https://www.googleapis.com/auth/drive';
let token='',tokenExpiry=0,scriptPromise=null,tokenClient=null;

export function driveWriteConfigured(){return Boolean(CLIENT_ID);}
export function driveWriteConnected(){return Boolean(token && Date.now()<tokenExpiry-60000);}
export function disconnectDriveWrite(){const previous=token;token='';tokenExpiry=0;if(previous)globalThis.google?.accounts?.oauth2?.revoke?.(previous,()=>{});}
export function loadGoogleIdentity(){
  if(!CLIENT_ID)return Promise.reject(new Error('Para guardar en Drive falta configurar VITE_GOOGLE_CLIENT_ID en Netlify.'));
  if(globalThis.google?.accounts?.oauth2?.initTokenClient)return Promise.resolve();
  if(scriptPromise)return scriptPromise;
  scriptPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';script.async=true;
    script.onload=()=>globalThis.google?.accounts?.oauth2?.initTokenClient?resolve():reject(new Error('Google Identity no está disponible'));
    script.onerror=()=>reject(new Error('No se pudo cargar la conexión segura con Google.'));
    document.head.append(script);
  }).catch(err=>{scriptPromise=null;throw err;});
  return scriptPromise;
}
export async function requestGoogleWriteAccess(){
  if(driveWriteConnected())return token;
  await loadGoogleIdentity();
  return new Promise((resolve,reject)=>{
    let closed=false;
    const timeout=setTimeout(()=>finish(null,new Error('La autorización con Google no respondió. Volvé a intentarlo.')),90000);
    function finish(data,error){
      if(closed)return;closed=true;clearTimeout(timeout);
      if(error){reject(error);return;}
      token=data.access_token;
      tokenExpiry=Date.now()+Math.max(0,Number(data.expires_in)||0)*1000;
      resolve(token);
    }
    try {
      tokenClient=globalThis.google.accounts.oauth2.initTokenClient({
        client_id:CLIENT_ID,scope:SCOPE,include_granted_scopes:false,
        callback:response=>response.error?
          finish(null,new Error('Google no autorizó la edición: '+response.error)):
          finish(response,null),
        error_callback:response=>finish(null,new Error(response?.type==='popup_closed'?
          'Cerraste el acceso a Google; no se modificó Drive.':'No se pudo completar la autorización de Google.'))
      });
      // Esta función debe llamarse desde una interacción explícita del usuario.
      tokenClient.requestAccessToken({prompt:'consent'});
    } catch(error){finish(null,error);}
  });
}
async function authorized(url,options={}){
  const key=driveWriteConnected()?token:await requestGoogleWriteAccess();
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+key,...options.headers},cache:'no-store'});
  if(response.status===401){disconnectDriveWrite();throw new Error('Expiró el acceso a Google. Volvé a conectarte.');}
  return response;
}
export async function saveDayToGoogleDrive(change) {
  if(!navigator.onLine)throw new Error('No hay Internet. El cambio todavía no se guardó en Drive.');
  const id=RUNNING_DRIVE.id;
  // Los permisos reales de edición se verifican en Google, nunca con un secreto en el navegador.
  const metadataResponse=await authorized('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,capabilities(canEdit)');
  if(!metadataResponse.ok)throw new Error('Tu cuenta no puede consultar el Excel. Usá la cuenta propietaria de Running.xlsm.');
  const metadata=await metadataResponse.json();
  if(metadata.id!==id||metadata.capabilities?.canEdit!==true)
    throw new Error('Esta cuenta no tiene permisos de edición sobre Running.xlsm.');
  const mime=String(metadata.mimeType||'').toLowerCase();
  if(mime!=='application/vnd.ms-excel.sheet.macroenabled.12' && mime!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    throw new Error('El archivo de Drive no es un Excel compatible. No se modificó.');
  const downloaded=await authorized('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media');
  if(!downloaded.ok)throw new Error('Google no permitió leer el Excel antes de actualizarlo.');
  const bytes=new Uint8Array(await downloaded.arrayBuffer());
  if(bytes.length>RUNNING_DRIVE.maxBytes)throw new Error('El Excel supera el tamaño permitido por PaceUp.');
  const changed=updateDriveWorkbook(bytes,change);
  if(changed.length>RUNNING_DRIVE.maxBytes)throw new Error('El Excel actualizado supera el tamaño permitido.');
  // El permiso no autoriza borrar ni renombrar archivos: sólo se actualiza el ID configurado.
  const uploaded=await authorized('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(id)+'?uploadType=media&fields=id,name,mimeType,version', {
    method:'PATCH',
    headers:{'Content-Type':metadata.mimeType},
    body:changed
  });
  if(!uploaded.ok){
    let detail='';
    try{detail=(await uploaded.json()).error?.message||'';}catch{}
    throw new Error(uploaded.status===403?'Google rechazó la edición. Comprobá los permisos de la cuenta.':
      'No se pudo guardar en Drive'+(detail?': '+detail:'.') );
  }
  const result=await uploaded.json();
  if(result.id!==id)throw new Error('Google no confirmó la actualización del archivo correcto.');
  return {buffer:changed,fileId:id,name:metadata.name,version:result.version};
}
