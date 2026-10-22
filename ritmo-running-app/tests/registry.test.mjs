import test from 'node:test';
import assert from 'node:assert/strict';
import {applySessionOverride, recoveryMessage, registryCsv, registryPageMarkup, registryEditorMarkup} from '../src/registry.js';

const day = {
  id:'Noviembre-1-1', date:new Date(2026,10,12), title:'4×1 minuto medio',
  description:'2K EC y 2K VC',kilometers:5,trainingColor:'controlled',
  status:{kind:'controlled',label:'Naranja'},visibleDescription:'2K EC y 2K VC',
  trainingRefs:[],distance:{kilometers:5}
};
const records = {
  '2026-11-12':{done:true,updatedAt:1794499200000,
    edit:{title:"3×5' umbral",description:'2K EC y 3×5 minutos',kind:'controlled',plannedKm:7},
    before:{sleepHours:8,fatigue:2,stress:1,pain:'none'},
    after:{actualKm:7.12,durationMin:42,rpe:6,pain:'none'},note:'Ritmo controlado'}
};
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate=()=> '12 de noviembre de 2026';

test('la edición visual conserva el día base y aplica el cambio',()=>{
  const result=applySessionOverride(day,records['2026-11-12']);
  assert.equal(result.title,"3×5' umbral");
  assert.equal(result.kilometers,7);
  assert.equal(result.sourceDay,day);
  assert.equal(day.title,'4×1 minuto medio');
});

test('la recuperación no presenta un semáforo falso sin datos',()=>{
  assert.equal(recoveryMessage(null),'');
  assert.match(recoveryMessage({pain:'strong'}),/evitá la sesión exigente/);
  assert.match(recoveryMessage({fatigue:5,pain:'none'}),/revisar/);
});

test('registro visible incluye entrenamiento y resultados del día',()=>{
  const html=registryPageMarkup({days:[applySessionOverride(day,records['2026-11-12'])],
    records,month:'2026-11',filter:'done',query:'',escapeHTML,formatDate});
  assert.match(html,/Tu registro privado/);
  assert.match(html,/3×5&#39; umbral/);
  assert.match(html,/7.12 km reales/);
  assert.match(html,/Ver \/ editar/);
  assert.match(html,/Guardado privado en este navegador/);
});

test('los formularios permiten actualizar el plan y las preguntas',()=>{
  const html=registryEditorMarkup(day,records['2026-11-12'],escapeHTML);
  for(const value of ['data-toggle-done','name="sleepHours"','name="pain"','name="actualKm"','name="rpe"','name="description"']){
    assert.ok(html.includes(value),value);
  }
});

test('CSV exporta datos reales y protege valores interpretados como fórmulas',()=>{
  const spreadsheet=registryCsv([day],{'2026-11-12':{...records['2026-11-12'],note:'=HYPERLINK("danger")'}});
  assert.match(spreadsheet,/7.12/);
  assert.match(spreadsheet,/'=HYPERLINK/);
  assert.match(spreadsheet,/2026-11-12/);
});

test('los registros sin día de calendario permanecen visibles',()=>{
  const html=registryPageMarkup({days:[],records:{'2026-09-18':{done:true,planTitle:'Rodaje antiguo'}},
    month:'all',filter:'all',query:'',escapeHTML,formatDate});
  assert.match(html,/Rodaje antiguo/);
  assert.match(html,/Sin día en el Excel/);
});
