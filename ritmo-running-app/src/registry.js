// Registro personal de PaceUp. El plan de Drive permanece sin modificar.
const KINDS = [
  ['steady','Amarillo / suave'], ['controlled','Naranja / calidad'],
  ['hard','Rojo / carrera'], ['rest','Verde / descanso'],
  ['lesion','Celeste / lesión'], ['travel','Azul / viaje']
];
const LABELS = Object.fromEntries(KINDS);

export function applySessionOverride(day, record = {}) {
  const sourceDay = day.sourceDay || day;
  const edit = record.edit;
  if (!edit) return day;
  const kind = LABELS[edit.kind] ? edit.kind : sourceDay.trainingColor;
  const kilometers = edit.plannedKm === null || edit.plannedKm === undefined ? sourceDay.kilometers : edit.plannedKm;
  return {
    ...sourceDay, sourceDay,
    title: edit.title || sourceDay.title,
    description: edit.description ?? sourceDay.description,
    visibleDescription: edit.description ?? sourceDay.visibleDescription,
    trainingRefs: edit.description === sourceDay.description ? sourceDay.trainingRefs : [],
    status: {kind, label: LABELS[kind] || sourceDay.status.label},
    trainingColor: kind,
    kilometers,
    distance: {kilometers, source:'Distancia ajustada en PaceUp',parts:[]}
  };
}

export function recoveryMessage(before) {
  if (!before || Object.values(before).every(value => value === '' || value === null || value === undefined)) return '';
  if (before.pain === 'strong') return 'Molestia importante o que altera la pisada: evitá la sesión exigente y buscá evaluación si persiste.';
  if (before.pain === 'mild' || before.fatigue >= 4 || (before.sleepHours > 0 && before.sleepHours < 6 && before.fatigue >= 3))
    return 'Conviene revisar la intensidad o duración según tus sensaciones y el calentamiento.';
  return 'No aparecen alertas claras en estas respuestas. Volvé a evaluar cómo te sentís durante el calentamiento.';
}

function numericInput(name, label, value, {min=0,max=1000,step='any',placeholder=''} = {}) {
  return '<label class="registry-field"><span>' + label + '</span><input name="' + name + '" type="number" min="' + min + '" max="' + max + '" step="' + step +
    '" placeholder="' + placeholder + '" value="' + (value ?? '') + '"></label>';
}
function choiceInput(name, label, value, options) {
  return '<label class="registry-field"><span>' + label + '</span><select name="' + name + '">' +
    options.map(([key,text]) => '<option value="' + key + '"' + (String(value ?? '') === key ? ' selected' : '') + '>' + text + '</option>').join('') + '</select></label>';
}

export function registryEditorMarkup(day, record, escapeHTML, disabled=false, options={}) {
  const edit=record.edit||{};
  const source=day.sourceDay||day;
  const before=record.before||{};
  const after=record.after||{};
  const message=recoveryMessage(before);
  const lock=disabled?' disabled':'';
  const isTraining=['steady','controlled','hard','easy','gym','planned'].includes(day.trainingColor||day.status?.kind);
  const doneControl=isTraining
    ? '<button type="button" class="registry-done-button'+(record.done?' is-done':'')+'" data-toggle-done="'+escapeHTML(day.id)+'"'+lock+'>'+
      (record.done?'✓ Listo · Marcar pendiente':'✓ Marcar como listo')+'</button>'
    : '';
  const pending=record.pendingDrive?
    '<p class="registry-sync-pending" role="status">Pendiente de guardar en Drive. Los cambios están únicamente en este navegador. '+escapeHTML(record.driveSyncError||'')+'</p>':'';
  const setup=!options.configured?
    '<p class="registry-sync-pending">La edición en Google Drive requiere configurar la conexión OAuth en Netlify. Mientras tanto, se conserva como cambio local pendiente.</p>':
    (options.connected?'<p class="registry-tip">Google Drive conectado. Al guardar se actualizará el archivo original.</p>':
    '<p class="registry-tip">Al guardar, Google te pedirá autorización para editar Running.xlsm.</p>');
  return '<section class="registry-edit-section"><div class="registry-edit-heading"><h3>Acciones del entrenamiento</h3>'+
    '<p>Podés editar el plan, marcarlo como listo o registrar tus resultados.</p></div>' + doneControl + pending +
    '<details class="registry-quick-edit"><summary>✎ Editar entrenamiento</summary>'+
    '<form id="paceup-edit-form" class="registry-form">'+
    '<label class="registry-field registry-field-wide"><span>¿Qué entrenamiento toca?</span><textarea name="title" rows="3" maxlength="1500" required>'+escapeHTML(edit.title??source.title)+'</textarea></label>'+
    '<label class="registry-field registry-field-wide"><span>Indicaciones y recuperaciones (opcional)</span><textarea name="description" rows="3" maxlength="3000">'+escapeHTML(edit.description??source.description)+'</textarea></label>'+
    '<div class="registry-fields">'+
      choiceInput('kind','Color / tipo de día',edit.kind||source.trainingColor,KINDS)+
      numericInput('plannedKm','Kilómetros (opcional)',edit.plannedKm??source.kilometers,{min:0,max:250,step:'0.01'})+
    '</div>'+
    '<button class="registry-save-button" type="submit"'+lock+'>Guardar entrenamiento</button>'+
    '<button class="registry-secondary-button" type="button" data-quick-cancel>Cancelar</button>'+
    setup+'</form></details>'+
    '<form id="registry-day-form" class="registry-form">'+
    '<details><summary>Antes de entrenar · check-in</summary><div class="registry-fields">'+
    numericInput('sleepHours','Horas de sueño',before.sleepHours,{min:0,max:24,step:'0.5'})+
    choiceInput('fatigue','Fatiga (1 poca – 5 mucha)',String(before.fatigue??''),[['','Sin responder'],...Array.from({length:5},(_,i)=>[String(i+1),String(i+1)])])+
    choiceInput('stress','Estrés (1 poco – 5 mucho)',String(before.stress??''),[['','Sin responder'],...Array.from({length:5},(_,i)=>[String(i+1),String(i+1)])])+
    choiceInput('pain','¿Molestias?',before.pain,[['','Sin responder'],['none','No'],['mild','Leves, sin alterar el movimiento'],['strong','Importantes o modifican la pisada']])+
    '</div>'+(message?'<p class="registry-feedback" role="status">'+escapeHTML(message)+'</p>':'')+'</details>'+
    '<details><summary>Después de entrenar · datos reales</summary><div class="registry-fields">'+
    numericInput('actualKm','Kilómetros realizados',after.actualKm,{min:0,max:250,step:'0.01'})+
    numericInput('durationMin','Duración total (minutos)',after.durationMin,{min:0,max:1440,step:'0.1'})+
    choiceInput('rpe','Esfuerzo percibido (1–10)',String(after.rpe??''),[['','Sin responder'],...Array.from({length:10},(_,i)=>[String(i+1),String(i+1)])])+
    choiceInput('painAfter','Molestias posteriores',after.pain,[['','Sin responder'],['none','No'],['mild','Leves'],['strong','Importantes o alteran el movimiento']])+
    '</div></details>'+
    '<button class="registry-save-button" type="submit"'+lock+'>Guardar respuestas</button>'+
    '</form>'+
    '<p class="registry-tip">Sueño, molestias y notas son registros personales y no se agregan al Excel compartido por enlace.</p>'+
    '</section>';
}

function driveColorDone(day) {
  const raw=String((day.sourceDay||day).rawColor||'').toUpperCase();
  return ['FFFFFF00','FFFF9900','FFFF0000','FF00FF00','FF00FFFF','FF4A86E8'].includes(raw.slice(-8));
}
function dayDone(day,record) {
  return typeof record?.done==='boolean'?record.done:driveColorDone(day);
}

function field(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""').replace(/\r?\n/g,' ') + '"';
}

export function registryCsv(days, records) {
  const map = new Map(days.map(day => [day.date.getFullYear() + '-' + String(day.date.getMonth()+1).padStart(2,'0') + '-' + String(day.date.getDate()).padStart(2,'0'),day]));
  const headers = ['fecha','estado','entrenamiento_plan','entrenamiento_editado','categoria','km_plan','km_real','minutos_reales','esfuerzo_rpe','sueño_horas','fatiga','estres','molestia_antes','molestia_despues','nota','ultima_actualizacion'];
  const rows = Object.keys(records).sort().map(date => {
    const r = records[date] || {}, day = map.get(date), before=r.before||{},after=r.after||{},edit=r.edit||{};
    return [date,r.done?'hecho':'pendiente',day?.sourceDay?.title || day?.title || r.planTitle || '',edit.title || '',edit.kind || day?.trainingColor || '',
      edit.plannedKm ?? day?.kilometers ?? '',after.actualKm ?? '',after.durationMin ?? '',after.rpe ?? '',before.sleepHours ?? '',
      before.fatigue ?? '',before.stress ?? '',before.pain || '',after.pain || '',r.note || '',r.updatedAt ? new Date(r.updatedAt).toISOString() : ''];
  });
  return '\uFEFF' + [headers.map(field).join(';'),...rows.map(row=>row.map(field).join(';'))].join('\r\n');
}

export function registryPageMarkup({days,records,filter='all',month='all',query='',escapeHTML,formatDate}) {
  const byDate = new Map(days.map(day => [day.date.getFullYear() + '-' + String(day.date.getMonth()+1).padStart(2,'0') + '-' + String(day.date.getDate()).padStart(2,'0'), day]));
  // Include older saved records even when the Excel no longer contains their dates.
  for (const [key,r] of Object.entries(records)) {
    if (byDate.has(key)) continue;
    const date = new Date(key+'T12:00:00');
    if (Number.isNaN(date.valueOf())) continue;
    byDate.set(key,{date,id:'',title:r.edit?.title || r.planTitle || 'Registro sin plan disponible',trainingColor:r.edit?.kind || ''});
  }
  const months = [...new Set([...byDate.keys()].map(key=>key.slice(0,7)))].sort().reverse();
  const period = [...byDate].filter(([key])=>month==='all'||key.startsWith(month));
  const registered = period.filter(([key]) => records[key]?.done || records[key]?.edit || records[key]?.before || records[key]?.after || records[key]?.note?.trim());
  const completed = period.filter(([key,day])=>dayDone(day,records[key]));
  const realKm = period.reduce((sum,[key])=>sum+(Number(records[key]?.after?.actualKm)||0),0);
  const matches = period.filter(([key,day])=>{
    const r=records[key]||{};
    if(filter==='done'&&!dayDone(day,r) || filter==='pending'&&dayDone(day,r) || filter==='records'&&!(dayDone(day,r)||r.edit||r.before||r.after||r.note?.trim()))return false;
    if(filter==='edited'&&!r.edit)return false;
    if(filter==='answers'&&!(r.before||r.after))return false;
    return !query || [key,day.title,r.note||'',r.edit?.title||''].join(' ').toLowerCase().includes(query.toLowerCase());
  }).sort(([a],[b])=>b.localeCompare(a));
  const option=(value,label,current)=>'<option value="'+value+'"'+(current===value?' selected':'')+'>'+escapeHTML(label)+'</option>';
  return '<main class="main-shell registry-shell" data-page="records">' +
    '<div class="view-heading"><p class="eyebrow">PACEUP · REGISTRO</p><h1 tabindex="-1">Tu registro privado</h1>' +
    '<p>Plan, modificaciones, respuestas y resultados reales, organizados por fecha.</p></div>' +
    '<section class="registry-notice"><strong>Guardado privado en este navegador</strong><p>Los datos no se publican ni se envían a otra persona. La sincronización entre dispositivos todavía no está habilitada. Exportá una copia para respaldarlos.</p></section>' +
    '<section class="registry-summary" aria-label="Resumen del período">' +
    [['Días con registros',registered.length],['Sesiones marcadas listas',completed.length],['Km reales registrados',realKm.toLocaleString('es-AR',{maximumFractionDigits:2})]].map(([name,value])=>'<article><span>'+name+'</span><strong>'+value+'</strong></article>').join('')+'</section>' +
    '<section class="calendar-panel registry-panel"><div class="registry-topline"><h2>Historial día por día</h2><button type="button" class="outline-button" data-export-registry>Exportar CSV</button></div>' +
    '<div class="registry-filters"><label>Mes<select data-registry-month>'+option('all','Todos',month)+months.map(m=>option(m,m,month)).join('')+'</select></label>' +
    '<label>Estado<select data-registry-filter>'+[['all','Todos'],['records','Con registro'],['done','Completados'],['pending','Pendientes'],['edited','Editados'],['answers','Con respuestas']].map(([v,t])=>option(v,t,filter)).join('')+'</select></label>' +
    '<label>Buscar<input type="search" data-registry-search placeholder="Fecha o entrenamiento" value="'+escapeHTML(query)+'"></label></div>' +
    (matches.length?'<div class="registry-records">'+matches.slice(0,100).map(([key,day])=>{
      const r=records[key]||{}, plan=day.sourceDay||day;
      const changed=Boolean(r.edit);
      const actual=r.after?.actualKm!==undefined && r.after.actualKm!==null?' · '+r.after.actualKm+' km reales':'';
      const note=r.note?.trim()?' · Con nota':'';
      return '<article class="registry-row '+(r.done?'registry-row-done':'')+'"><div><time datetime="'+key+'">'+escapeHTML(formatDate(day.date,{day:'numeric',month:'long',year:'numeric'}))+'</time><h3>'+escapeHTML(day.title||plan.title)+'</h3>' +
        '<p>'+escapeHTML((dayDone(day,r)?'✓ Listo':'Pendiente')+(changed?' · Editado':'')+(r.pendingDrive?' · Sin sincronizar en Drive':'')+actual+note)+'</p></div>' +
        (day.id?'<button type="button" class="registry-open" data-day-id="'+escapeHTML(day.id)+'">Ver / editar ↗</button>':'<span class="registry-orphan">Sin día en el Excel</span>')+'</article>';
    }).join('')+'</div>' + (matches.length>100?'<p class="registry-tip">Se muestran los 100 resultados más recientes. Filtrá por mes para ver el resto.</p>':'') :
    '<p class="registry-empty">No hay días que coincidan con estos filtros.</p>') +
    '</section></main>';
}
