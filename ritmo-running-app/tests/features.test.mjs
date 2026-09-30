import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { zipSync, strToU8 } from 'fflate';
import { readXlsx } from '../src/readXlsx.js';
import { DEFAULT_LOCATION, PILAR_LOCATION, readWeatherPreferences, saveWeatherPreferences } from '../src/weather.js';
import { dayWeatherMarkup, weatherPanelMarkup } from '../src/weatherView.js';
import { sessionDistance, estimateKilometers } from '../src/distance.js';
import { parseRunningWorkbook, colorCategory } from '../src/parser.js';
import { dateKey, trainingKilometers, weeklyLoad, planSignature, planChanged, isActivity, historicalSessionRecords } from '../src/training.js';

const cases = [
  ['2K EC + 6×1000 m + 2K VC', '2K EC + 6×1000 m + 2K VC', 10],
  ['6×1000 m', '2K EC + 6×1000 m + 2K VC', 10],
  ['8K extensivo', 'EC 2K + VC 1K', 11],
  ['10K (2K EC + 6K + 2K VC)', '', 10],
  ['2K EC + 8K + 2K VC', '8K extensivo a 5:40/km', 12],
  ['Total 10 km', '2km EC + 6km + 2km VC', 10],
  ['6×400m + 2,5K EC + 1K VC', '', 5.9],
  ['8K extensivo', '2km EC. 8km extensivo. 2km VC.', 12],
  ['Carrera 10K', '3K EC + carrera 10K + 2K VC', 15],
  ['2K EC + 8K', 'Objetivo 10K a 4:00/km', 10],
  ['8–10 km', '', null], ['6×1000m + rec 200m', '', null],
  ['10K (2K EC + 8K + 2K VC)', '', null],
  ['30 min a 5:30/km', '', null], ['Series 6×1000', '', null]
];
for (const [title, description, km] of cases) {
  test('distance: ' + title + ' / ' + description, () => assert.equal(sessionDistance(title, description).kilometers, km));
}
test('duplicate description lines are not double-counted', () => assert.equal(estimateKilometers('2K EC\n6×1000m\n2K VC\n6×1000m'), 10));
test('thousands of meters and decimal commas', () => assert.equal(estimateKilometers('2,5K EC + 6×1.000m + 1K VC'), 9.5));

function fixture(version = 1) {
  const header = 1 + (version === 2 ? 3 : 0);
  const rows = new Map();
  const cell = (text, color = '') => ({ value: text, text, fill: { fgColor: { argb: color } } });
  rows.set(header, [cell(''), ...['LUN','MAR','MIE','JUE','VIE','SAB','DOM'].map(t => cell(t))]);
  rows.set(header + 1, [cell('S1'), cell('29\n' + (version === 2 ? '8K extensivo' : '6K extensivo'), 'FFFFD966'), cell('30\nDescanso', 'FF93C47D')]);
  rows.set(header + 2, [cell(''), cell('2K EC + ' + (version === 2 ? '8K' : '6K') + ' extensivo + 1K VC')]);
  return { worksheets: [{ name: version === 2 ? 'Septiembre 2026' : 'Septiembre', rowCount: header + 2,
    getRow(n) { return { getCell(c) { return rows.get(n)?.[c-1] || { value: null, text: '' }; } }; } }] };
}
test('parser reads description distances and calendar headers after moving rows', () => {
  const a = parseRunningWorkbook(fixture(1), 'Running 2026.xlsx');
  const b = parseRunningWorkbook(fixture(2), 'plan nuevo 2026.xlsx');
  assert.equal(a.weeks[0].days[0].kilometers, 9);
  assert.equal(b.weeks[0].days[0].kilometers, 11);
  assert.notEqual(a.weeks[0].days[0].id, b.weeks[0].days[0].id);
  assert.equal(dateKey(a.weeks[0].days[0].date), dateKey(b.weeks[0].days[0].date));
});
test('week groups combine month/year boundaries and ignore duplicates, injury and rest', () => {
  const days = Array.from({length:14}, (_,i) => ({date:new Date(2026,11,28+i),trainingColor:i===0?'lesion':i===1?'rest':i<7?'steady':'hard',kilometers:10}));
  const w = weeklyLoad([...days, days[0], days[5]]);
  assert.equal(w.length,2); assert.equal(w[0].kilometers,50); assert.equal(w[1].kilometers,70);
  assert.equal(w[0].key,'2026-12-28'); assert.equal(w[1].key,'2027-01-04');
  assert.equal(Math.round(w[1].change),40); assert.equal(w[0].counts.steady,5);
  assert.equal(weeklyLoad(days.slice(1))[0].partial,true);
  assert.equal(weeklyLoad(days.slice(1))[1].change,null);
});
test('blue, cyan and green never add distance even when text contains running kilometers', () => {
  for (const color of ['0000FF','6D9EEB','00FFFF','93C47D','00FF00']) assert.equal(trainingKilometers({trainingColor:colorCategory(color),kilometers:50}),0);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function appHarness(database, { failSave = false } = {}) {
  const app = { innerHTML: '' };
  const handlers = {};
  const context = vm.createContext({
    document: { querySelector(selector) {
      if (selector === '#app') return app;
      if (selector === '#excel-file' || selector === '[data-forget-file]') return { addEventListener(event,fn) { handlers[selector]=fn; } };
      return null;
    }, querySelectorAll() { return []; } },
    window: { matchMedia: () => ({matches:false}), addEventListener() {} }, navigator:{},
    Intl, Date, Map, Set, Object, Math, ArrayBuffer, File, setInterval() {},
    dateKey, weeklyLoad, trainingKilometers, planSignature, planChanged, isActivity, historicalSessionRecords, parseRunningWorkbook,
    DEFAULT_LOCATION,PILAR_LOCATION,readWeatherPreferences,saveWeatherPreferences,dayWeatherMarkup,weatherPanelMarkup,
    createWeatherClient: () => ({load:async()=>{throw Error('No network in test');}}),
    readXlsx(buffer) { const n = new Uint8Array(buffer)[0]; if (!n) throw Error('Invalid workbook'); return fixture(n); },
    saveWorkbook: async (name,buffer) => { database.workbook = {name,buffer}; },
    readWorkbook: async () => database.workbook,
    deleteWorkbook: async () => { database.workbook = null; },
    readSessionRecords: async () => Object.values(database.records),
    seedHistoricalSessions: async candidates => {
      let marked = 0;
      for (const candidate of candidates) {
        const old = database.records[candidate.date];
        if (old?.historicalCutoff === candidate.historicalCutoff) continue;
        database.records[candidate.date] = old?.done ? {...candidate,...old,historicalCutoff:candidate.historicalCutoff} : {...old,...candidate};
        if (!old?.done) marked++;
      }
      return marked;
    },
    updateSessionRecord: async (date,patch) => {
      if (failSave) throw Error('Storage quota');
      const record = {...database.records[date],...patch,date}; database.records[date]=record; return record;
    }
  });
  vm.runInContext(fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  return { app, handlers, context, run: code => vm.runInContext(code,context) };
}

test('made session and note survive renamed Excel, moved rows, changed text, reload, removed/reintroduced date, invalid upload and deleting only Excel', async () => {
  const db = { records:{} };
  const a = appHarness(db); await tick();
  await a.run(`loadFile(new File([new Uint8Array([1])], 'Running 2026.xlsx'))`);
  await a.run(`saveDayRecord(state.weeks[0].days[0], {done:true, planSignature:planSignature(state.weeks[0].days[0]), planTitle:state.weeks[0].days[0].title})`);
  await a.run(`saveDayRecord(state.weeks[0].days[0], {note:'Me sentí bien <script>'})`);
  const snapshot = structuredClone(db.records);
  await a.run(`loadFile(new File([new Uint8Array([2])], 'otro nombre 2026.xlsm'))`);
  assert.deepEqual(db.records,snapshot);
  assert.equal(a.run('sessionRecord(state.weeks[0].days[0]).done'),true);
  assert.equal(a.run('planChanged(state.weeks[0].days[0],sessionRecord(state.weeks[0].days[0]))'),true);
  assert.match(a.run('modalMarkup(state.weeks[0].days[0])'),/Me sentí bien &lt;script&gt;/);
  // Invalid upload must leave both the saved plan and record intact.
  await a.run(`loadFile(new File([new Uint8Array([0])], 'invalid.xlsx'))`);
  assert.equal(db.workbook.name,'otro nombre 2026.xlsm'); assert.deepEqual(db.records,snapshot);
  const b = appHarness(db); await tick();
  assert.equal(b.run('sessionRecord(state.weeks[0].days[0]).done'),true);
  assert.equal(b.run('sessionRecord(state.weeks[0].days[0]).note'),'Me sentí bien <script>');
  await b.handlers['[data-forget-file]'](); assert.equal(db.workbook,null); assert.deepEqual(db.records,snapshot);
  await b.run(`loadFile(new File([new Uint8Array([1])], 'vuelta 2026.xlsx'))`);
  assert.equal(b.run('sessionRecord(state.weeks[0].days[0]).done'),true);
  await b.run(`saveDayRecord(state.weeks[0].days[0], {done:false})`);
  assert.equal(db.records['2026-09-29'].note,'Me sentí bien <script>');
});

test('failed session write does not show a false saved state or destroy the note', async () => {
  const db = {records:{'2026-09-29':{date:'2026-09-29',done:true,note:'Anterior'}}};
  const a = appHarness(db,{failSave:true}); await tick();
  await a.run(`loadFile(new File([new Uint8Array([1])], 'Running 2026.xlsx'))`);
  await a.run(`saveDayRecord(state.weeks[0].days[0], {done:false,note:'Nuevo'})`);
  assert.equal(a.run('sessionRecord(state.weeks[0].days[0]).done'),true);
  assert.equal(a.run('sessionRecord(state.weeks[0].days[0]).note'),'Anterior');
  assert.match(a.run('state.storageMessage'),/No se pudo guardar/);
});

test('yesterday and tomorrow cross month/year boundaries and use calendar dates', async () => {
  const a=appHarness({records:{}});await tick();
  a.run(`state.weeks=[{days:[{id:'a',date:new Date(2026,11,31),title:'8K',description:'',kilometers:8,status:{kind:'steady',label:'Amarillo'},trainingColor:'steady'},{id:'b',date:new Date(2027,0,2),title:'10K',description:'',kilometers:10,status:{kind:'hard',label:'Rojo'},trainingColor:'hard'}]}]`);
  const html=a.run(`nearbyMarkup(new Date(2027,0,1),uniqueDays(state.weeks))`);
  assert.match(html,/2026-12-31/); assert.match(html,/2027-01-02/); assert.match(html,/Ayer/);assert.match(html,/Mañana/);
});

test('historical import includes cutoff and older years, excludes future dates, rest and both injury colors', () => {
  const make = (date, kind) => ({date:new Date(...date), title:'Actividad', description:'', kilometers:8, trainingColor:kind, status:{kind}});
  const days = [make([2026,8,30],'steady'),make([2026,9,1],'hard'),make([2027,0,1],'controlled'),
    make([2025,11,31],'hard'),make([2026,8,29],'rest'),make([2026,8,28],'lesion'),
    {...make([2026,8,27],null),status:{kind:'gym'}}, {...make([2026,8,26],null),status:{kind:'empty'}}];
  assert.deepEqual(historicalSessionRecords(days).map(r=>r.date),['2026-09-30','2025-12-31','2026-09-27']);
  assert.equal(isActivity(make([2026,9,1],'steady')),true);
});

test('historical sessions are saved automatically on import and manual undo survives reload and changed Excel', async () => {
  const db={records:{}};const a=appHarness(db);await tick();
  await a.run(`loadFile(new File([new Uint8Array([1])], 'Running 2026.xlsx'))`);
  assert.equal(db.records['2026-09-29'].done,true);
  assert.equal(db.records['2026-09-30'],undefined); // Green rest is not an activity.
  await a.run(`saveDayRecord(state.weeks[0].days[0], {done:false,note:'No la hice'})`);
  const b=appHarness(db);await tick();
  assert.equal(b.run('sessionRecord(state.weeks[0].days[0]).done'),false);
  await b.run(`loadFile(new File([new Uint8Array([2])], 'otro nombre 2026.xlsx'))`);
  assert.equal(db.records['2026-09-29'].done,false);
  assert.equal(db.records['2026-09-29'].note,'No la hice');
  const day={id:'future',date:new Date(2026,9,1),title:'8K',description:'',kilometers:8,trainingColor:'steady',status:{kind:'steady',label:'Amarillo'}};
  b.context.futureDay=day;
  assert.match(b.run('doneButton(futureDay)'),/Marcar como hecha/);
});

test('real XLSX numeric entities render accented titles, descriptions and sheet names without double decoding', () => {
  const xml = {
    'xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Septiembre &#xE1;" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>t&#233;cnica &amp; movilidad</t></si><si><t>&amp;#233; literal</t></si></sst>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>c&#xF3;modo &lt;script&gt;</t></is></c><c r="C1" t="s"><v>1</v></c></row></sheetData></worksheet>'
  };
  const workbook=readXlsx(zipSync(Object.fromEntries(Object.entries(xml).map(([path,text])=>[path,strToU8(text)]))));
  assert.equal(workbook.worksheets[0].name,'Septiembre á');
  assert.equal(workbook.worksheets[0].getRow(1).getCell(1).text,'técnica & movilidad');
  assert.equal(workbook.worksheets[0].getRow(1).getCell(2).text,'cómodo <script>');
  assert.equal(workbook.worksheets[0].getRow(1).getCell(3).text,'&#233; literal');
});
