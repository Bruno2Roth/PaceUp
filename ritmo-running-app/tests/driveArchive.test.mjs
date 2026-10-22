import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {updateDriveWorkbook,isDriveCompleted} from '../src/driveArchive.js';
import {readXlsx} from '../src/readXlsx.js';
import {parseRunningWorkbook} from '../src/parser.js';

const workbook='<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Noviembre" sheetId="1" r:id="rId1"/></sheets></workbook>';
const rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
const fills='<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6B26B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF9900"/><bgColor indexed="64"/></patternFill></fill>';
const styles='<styleSheet><fills count="3">'+fills+'</fills><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="1" borderId="0"/></cellXfs></styleSheet>';
const day='<c r="E2" s="1" t="inlineStr"><is><t>5&#10;6K suaves</t></is></c>';
const detail='<c r="E3" s="0" t="inlineStr"><is><t>Extensivo suave</t></is></c>';
const weekDays=['B','C','D','E','F','G','H'].map((col,i)=>'<c r="'+col+'1" t="inlineStr"><is><t>'+['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'][i]+'</t></is></c>').join('');
const sheet='<worksheet><sheetData><row r="1">'+weekDays+'</row><row r="2"><c r="A2" t="inlineStr"><is><t>S45</t></is></c>'+day+'</row><row r="3">'+detail+'</row></sheetData></worksheet>';
const files={
 'xl/workbook.xml':strToU8(workbook),
 'xl/_rels/workbook.xml.rels':strToU8(rels),
 'xl/styles.xml':strToU8(styles),
 'xl/worksheets/sheet1.xml':strToU8(sheet),
 'xl/media/image1.png':new Uint8Array([1,2,3,4]),
 'xl/vbaProject.bin':new Uint8Array([0,255,5,128])
};
const input=zipSync(files);
const change={date:'2026-11-05',title:'7K progresivos',description:'2K EC + 5K controlados',kind:'controlled',done:true,
  expected:{title:'6K suaves',description:'Extensivo suave',kind:'controlled',done:false}};
function findDay(buffer){return parseRunningWorkbook(readXlsx(buffer),'Running_2026.xlsm').weeks.flatMap(w=>w.days).find(d=>d.date.getDate()===5);}
test('una edición mantiene las demás entradas del Excel y actualiza título, detalle y color',()=>{
 const output=updateDriveWorkbook(input,change);
 const result=findDay(output);
 assert.equal(result.title,'7K progresivos');
 assert.equal(result.description,'2K EC + 5K controlados');
 assert.equal(result.trainingColor,'controlled');
 assert.ok(isDriveCompleted(result.rawColor));
 const outputFiles=unzipSync(output);
 assert.deepEqual(outputFiles['xl/media/image1.png'],files['xl/media/image1.png']);
 assert.deepEqual(outputFiles['xl/vbaProject.bin'],files['xl/vbaProject.bin']);
 assert.equal(strFromU8(outputFiles['xl/workbook.xml']),workbook);
 assert.equal(findDay(input).title,'6K suaves');
});
test('el día vuelve al color pastel al marcarlo pendiente',()=>{
 const once=updateDriveWorkbook(input,change);
 const twice=updateDriveWorkbook(once,{...change,done:false,
   expected:{title:'7K progresivos',description:'2K EC + 5K controlados',kind:'controlled',done:true}});
 assert.equal(isDriveCompleted(findDay(twice).rawColor),false);
});
test('rechaza sobrescribir cambios concurrentes en Drive',()=>{
 assert.throws(()=>updateDriveWorkbook(input,{...change,expected:{...change.expected,title:'Otro título'}}),/cambió en Drive/);
});
test('rechaza categorías y fechas inválidas',()=>{
 assert.throws(()=>updateDriveWorkbook(input,{...change,kind:'arbitrario'}),/categoría/);
 assert.throws(()=>updateDriveWorkbook(input,{...change,date:'2026-13-99'}),/no se encontró|No se encontró|Fecha/);
});
