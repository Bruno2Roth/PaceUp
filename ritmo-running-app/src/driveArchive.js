// Conserva todas las entradas del ZIP de Running.xlsm, incluidas imágenes y otros objetos.
// Sólo reemplaza las dos celdas del día y, si cambia su categoría o estado, su estilo.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { readXlsx } from './readXlsx.js';
import { parseRunningWorkbook } from './parser.js';
import { dateKey } from './training.js';

const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,parseAttributeValue:false,removeNSPrefix:false});
export const COLORS = {
  steady:{pending:'FFFFD966',done:'FFFFFF00'},
  controlled:{pending:'FFF6B26B',done:'FFFF9900'},
  hard:{pending:'FFE06666',done:'FFFF0000'},
  rest:{pending:'FF93C47D',done:'FF00FF00'},
  lesion:{pending:'FF76A5AF',done:'FF00FFFF'},
  travel:{pending:'FF6D9EEB',done:'FF4A86E8'}
};
export function isDriveCompleted(color) {
  const actual=String(color||'').replace(/^#/,'').toUpperCase().slice(-8);
  return Object.values(COLORS).some(x=>x.done===actual);
}
const arrays=x=>x===undefined||x===null?[]:Array.isArray(x)?x:[x];
const attr=(node,name)=>{
  if(!node||typeof node!=='object')return '';
  return node['@_'+name] ?? Object.entries(node).find(([k])=>k.endsWith(':'+name))?.[1] ?? '';
};
const validDate=s=>/^\d{4}-\d\d-\d\d$/.test(s);
function xmlEscape(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function sheetPath(files,name) {
  const workbook=parser.parse(strFromU8(files['xl/workbook.xml']||new Uint8Array()));
  const relationships=parser.parse(strFromU8(files['xl/_rels/workbook.xml.rels']||new Uint8Array()));
  const sheet=arrays(workbook.workbook?.sheets?.sheet).find(x=>attr(x,'name')===name);
  if(!sheet)throw new Error('No encontré el mes en el Excel de Drive.');
  const rel=arrays(relationships.Relationships?.Relationship).find(x=>attr(x,'Id')===attr(sheet,'id'));
  if(!rel)throw new Error('No encontré la pestaña en el archivo.');
  const target=String(attr(rel,'Target')).replace(/^\/+/,'');
  const path=target.startsWith('xl/')?target:'xl/'+target;
  if(!files[path])throw new Error('El archivo no contiene la pestaña del mes.');
  return path;
}
function getStyle(xml,ref) {
  const pattern=new RegExp('<c\\b(?=[^>]*\\br="'+ref+'")([^>]*?)(?:\\/\\>|\\>[\\s\\S]*?<\\/c>)','g');
  const matches=[...xml.matchAll(pattern)];
  if(matches.length!==1)throw new Error('No se pudo encontrar una celda única para '+ref);
  const old=matches[0][0];
  if(/<f(?:\s|>)/.test(old))throw new Error('La celda contiene una fórmula; no se modificó.');
  return {old,style:Number(old.match(/\bs="(\d+)"/)?.[1]||0)};
}
function replaceCell(xml,ref,text,style) {
  const old=getStyle(xml,ref);
  const tag='<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xmlEscape(text)+'</t></is></c>';
  return xml.replace(old.old,tag);
}
function fillIndex(styles,color) {
  const match=styles.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/);
  if(!match)throw new Error('No se encontraron colores de celdas en el Excel.');
  const fills=match[1].match(/<fill\b[^>]*>[\s\S]*?<\/fill>/g)||[];
  const index=fills.findIndex(fill=>new RegExp('rgb="'+color+'"','i').test(fill));
  if(index<0)throw new Error('Falta el color requerido en Running.xlsm. No se modificó el archivo.');
  return index;
}
function styleForColor(styles,originalStyle,color) {
  const fill=fillIndex(styles,color);
  const match=styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  if(!match)throw new Error('El Excel no contiene estilos de celdas válidos.');
  const xfs=match[2].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)||[];
  if(!xfs[originalStyle])throw new Error('El estilo original de la celda no es válido.');
  const base=xfs[originalStyle];
  const target=base.replace(/\bfillId="\d+"/,'fillId="'+fill+'"')
    .replace(/\bapplyFill="[^"]*"/,'applyFill="1"');
  const desired=target.includes('fillId="'+fill+'"')?target:target.replace(/^<xf/,'<xf fillId="'+fill+'"');
  const existing=xfs.indexOf(desired);
  if(existing>=0)return {styles,index:existing};
  const attributes=match[1].replace(/\bcount="\d+"/,'count="'+(xfs.length+1)+'"');
  const newBlock='<cellXfs'+attributes+'>'+match[2]+desired+'</cellXfs>';
  return {styles:styles.replace(match[0],newBlock),index:xfs.length};
}
function splitRef(day) {
  const parts=String(day.id||'').match(/-(\d+)-(\d+)$/);
  if(!parts)throw new Error('No se pudo determinar la celda del día.');
  const row=Number(parts[1]),column=Number(parts[2]);
  if(!(row>=1&&row<1000&&column>=1&&column<=26))throw new Error('Coordenadas de Excel inválidas.');
  return {row,col:String.fromCharCode(64+column)};
}
function checkText(input,max,name) {
  const value=String(input??'').replace(/\r/g,'').trim();
  if(!value||value.length>max)throw new Error('Revisá el '+name+' del entrenamiento.');
  return value;
}
export function updateDriveWorkbook(buffer,change) {
  if(!validDate(change?.date))throw new Error('Fecha de entrenamiento inválida.');
  const kind=change.kind;
  if(!COLORS[kind])throw new Error('Elegí una categoría válida.');
  const title=checkText(change.title,1500,'título');
  const description=String(change.description??'').replace(/\r/g,'').trim();
  if(description.length>3000)throw new Error('La descripción es demasiado larga.');
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.length<4||bytes[0]!==80||bytes[1]!==75)throw new Error('Drive no devolvió un Excel válido.');
  const current=parseRunningWorkbook(readXlsx(bytes),'Running_2026.xlsm');
  const original=current.weeks.flatMap(w=>w.days).find(d=>dateKey(d.date)===change.date);
  if(!original)throw new Error('No se encontró la fecha en el Excel original.');
  const expected=change.expected||{};
  if(expected.title!==undefined &&
     (original.title!==expected.title || original.description!==expected.description ||
      original.trainingColor!==expected.kind || isDriveCompleted(original.rawColor)!==Boolean(expected.done)))
    throw new Error('Este día cambió en Drive. Recargá el calendario antes de guardar para no pisar modificaciones.');
  const {row,col}=splitRef(original);
  const mainRef=col+row,descRef=col+(row+1);
  const files=unzipSync(bytes);
  const path=sheetPath(files,current.weeks.find(w=>w.days.some(d=>d.id===original.id))?.sheet);
  let sheet=strFromU8(files[path]);
  let styles=strFromU8(files['xl/styles.xml']);
  const baseStyle=getStyle(sheet,mainRef).style;
  const color=COLORS[kind][change.done?'done':'pending'];
  const resolved=styleForColor(styles,baseStyle,color);
  styles=resolved.styles;
  // El día permanece como primera línea para el lector de calendarios de PaceUp.
  sheet=replaceCell(sheet,mainRef,String(original.date.getDate())+'\n'+title,resolved.index);
  const descStyle=getStyle(sheet,descRef).style;
  sheet=replaceCell(sheet,descRef,description,descStyle);
  files[path]=strToU8(sheet);files['xl/styles.xml']=strToU8(styles);
  const output=zipSync(files,{level:6});
  const verified=parseRunningWorkbook(readXlsx(output),'Running_2026.xlsm');
  const updated=verified.weeks.flatMap(w=>w.days).find(d=>dateKey(d.date)===change.date);
  if(!updated||updated.title!==title||updated.description!==description||
     updated.trainingColor!==kind||isDriveCompleted(updated.rawColor)!==Boolean(change.done))
    throw new Error('El archivo modificado no pasó la validación; no se envió a Drive.');
  return output;
}
