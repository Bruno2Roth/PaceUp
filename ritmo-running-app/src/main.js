import { dateKey, weeklyLoad, trainingKilometers, planSignature, planChanged, isActivity, historicalSessionRecords } from "./training.js";
import { readSessionRecords, seedHistoricalSessions, updateSessionRecord, saveWorkbook, readWorkbook, deleteWorkbook } from "./storage.js";
import { parseRunningWorkbook } from "./parser.js";
import { readXlsx } from "./readXlsx.js";
import "./style.css";

const state = {
  records: {},
  noteDrafts: {},
  recordsReady: false,
  savingSession: false,
  storageMessage: "",
  installHelp: "",
  view: "calendar",
  statsYear: "",
  fileName: "",
  weeks: [],
  months: [],
  activeMonth: "",
  search: "",
  loading: false,
  error: "",
  selectedDay: null
};

const app = document.querySelector("#app");
let dragDepth = 0;
let installPrompt = null;
let isInstalled = window.matchMedia('(display-mode: standalone)').matches;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  state.installHelp = '';
  render();
});
window.addEventListener('appinstalled', () => {
  isInstalled = true;
  installPrompt = null;
  state.installHelp = '';
  render();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}


function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function cleanText(value) {
  return escapeHTML(value).replace(/\n/g, "<br>");
}

function formatKm(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value) + " km";
}

function formatDate(date, options = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("es-AR", options).format(date).replace(/^\w/, letter => letter.toUpperCase());
}

function monthTitle(month) {
  if (!month) return "";
  const name = month.name.charAt(0).toUpperCase() + month.name.slice(1);
  return month.year === new Date().getFullYear() ? name : name + " " + month.year;
}

function monthKey(month) {
  return month.name + "-" + month.year;
}

function selectedWeeks() {
  return state.weeks.filter(week => {
    if (state.activeMonth && week.month + "-" + week.year !== state.activeMonth) return false;
    if (!state.search.trim()) return true;
    const query = state.search.trim().toLocaleLowerCase("es-AR");
    const weekText = [week.label, week.note, ...week.days.flatMap(day => [day.title, day.description, day.status.label])]
      .join(" ").toLocaleLowerCase("es-AR");
    return weekText.includes(query);
  });
}

function countedKm(day) {
  return trainingKilometers(day);
}

function uniqueDays(weeks) {
  return [...new Map(weeks.flatMap(week => week.days).map(day => [day.date.toDateString(), day])).values()];
}

function monthStatistics(weeks) {
  const days = uniqueDays(weeks);
  const training = days.filter(day => ["steady", "controlled", "hard"].includes(day.trainingColor));
  return { kilometers: Math.round(days.reduce((sum, day) => sum + countedKm(day), 0) * 10) / 10,
    sessions: training.length, weeks: weeks.length,
    quality: training.filter(day => ["hard", "controlled"].includes(day.trainingColor)).length };
}

function sessionRecord(day) {
  return state.records[dateKey(day.date)] || {};
}

function doneBadge(day) {
  return sessionRecord(day).done ? '<span class="done-badge">✓ Hecha</span>' : '';
}

function doneButton(day) {
  if (!isActivity(day) && !sessionRecord(day).done) return '';
  const done = Boolean(sessionRecord(day).done);
  return '<button class="completion-button' + (done ? ' is-done' : '') + '" type="button" data-toggle-done="' + escapeHTML(day.id) + '" aria-pressed="' + done + '"' + (!state.recordsReady || state.savingSession || state.loading ? ' disabled' : '') + '>' + (done ? '✓ Hecha · desmarcar' : 'Marcar como hecha') + '</button>';
}

function planChangeMarkup(day) {
  const record = sessionRecord(day);
  if (!planChanged(day, record)) return '';
  return '<p class="record-warning">El entrenamiento cambió en el nuevo Excel. Tu registro y tu nota se conservaron.</p>' +
    (record.done && record.planTitle ? '<details class="record-original"><summary>Ver entrenamiento marcado como hecho</summary><p>' + cleanText(record.planTitle) + '</p>' + (record.planDescription ? '<p>' + cleanText(record.planDescription) + '</p>' : '') + '</details>' : '');
}

function nearbyMarkup(today, days) {
  return '<section class="nearby-grid" aria-label="Ayer y mañana">' + [[-1, 'Ayer'], [1, 'Mañana']].map(([offset, label]) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const day = days.find(item => dateKey(item.date) === dateKey(date));
    return '<article class="nearby-card ' + (day ? toneClass(day) : '') + '"><div class="nearby-top"><span>' + label + '</span><time datetime="' + dateKey(date) + '">' + formatDate(date) + '</time></div>' +
      (day ? '<div class="nearby-status"><span class="day-status">' + escapeHTML(day.status.label) + '</span>' + doneBadge(day) + '</div><h2>' + cleanText(day.title) + '</h2>' +
        '<p class="nearby-distance">' + (countedKm(day) > 0 ? formatKm(countedKm(day)) + ' en el plan' : ['rest', 'lesion'].includes(day.trainingColor) ? 'Sin kilómetros de running' : 'Sin distancia contabilizada') + '</p>' +
        (planChanged(day, sessionRecord(day)) ? '<p class="record-warning">El plan cambió; tu registro se conserva.</p>' : '') +
        '<div class="nearby-actions"><button class="text-button" type="button" data-day-id="' + escapeHTML(day.id) + '">Ver detalle ↗</button>' + doneButton(day) + '</div>' : '<h2>Sin sesión cargada</h2><p class="stats-note">El Excel no incluye esta fecha.</p>') + '</article>';
  }).join('') + '</section>';
}

function todayMarkup() {
  const today = new Date();
  const days = uniqueDays(state.weeks);
  const day = days.find(item => dateKey(item.date) === dateKey(today));
  const next = days.filter(item => item.date > today && ["steady", "controlled", "hard"].includes(item.trainingColor)).sort((a,b) => a.date - b.date)[0];
  const date = formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return '<section class="today-focus ' + (day ? toneClass(day) : '') + '" aria-labelledby="today-title"><div class="today-focus-heading"><p class="eyebrow">TU ENTRENAMIENTO DE HOY</p><span>' + escapeHTML(date) + '</span></div>' +
    (day ? '<div class="nearby-status"><span class="day-status">' + escapeHTML(day.status.label) + '</span>' + doneBadge(day) + '</div><h1 id="today-title">' + cleanText(day.title) + '</h1>' +
      (day.description ? '<p class="today-details">' + cleanText(day.description) + '</p>' : '') +
      planChangeMarkup(day) +
      '<div class="today-focus-bottom"><strong>' + (["lesion", "rest"].includes(day.trainingColor) ? 'Sin kilómetros de running' : countedKm(day) > 0 ? formatKm(day.kilometers) + ' en el plan' : 'Sin distancia contabilizada') +
      '</strong><div class="nearby-actions">' + doneButton(day) + '<button class="primary-button" type="button" data-day-id="' + escapeHTML(day.id) + '">Ver detalle y nota ↗</button></div></div>' :
      '<h1 id="today-title">Hoy no tiene una sesión cargada</h1><p class="today-details">El Excel no incluye un entrenamiento para esta fecha. Podés explorar los meses disponibles debajo.</p>') + '</section>' + nearbyMarkup(today, days) +
      (next ? '<button class="next-session" type="button" data-day-id="' + escapeHTML(next.id) + '"><span>PRÓXIMA SESIÓN DE RUNNING</span><strong>' + formatDate(next.date) + ' · ' + escapeHTML(next.title) + '</strong><span aria-hidden="true">↗</span></button>' : '');
}

function weeklyLoadMarkup(days, scope = "") {
  const weeks = weeklyLoad(days);
  if (!weeks.length) return '';
  const max = Math.max(1, ...weeks.map(week => week.kilometers));
  return '<section class="calendar-panel load-panel"><div class="load-heading"><div><p class="eyebrow">DE LUNES A DOMINGO</p><h2>Carga semanal del plan</h2></div><span class="load-caption">' + escapeHTML(scope) + ' · Kilómetros planificados</span></div>' +
    '<p class="stats-note">Amarillo, naranja y rojo suman distancia. Lesión y descanso quedan fuera. Cada color representa el día completo. La carga refleja el Excel, aunque marques sesiones como hechas.</p><div class="load-legend"><span><i class="load-steady"></i>Amarillo</span><span><i class="load-controlled"></i>Naranja</span><span><i class="load-hard"></i>Rojo</span></div>' +
    '<div class="load-scroll" tabindex="0" aria-label="Gráfico de kilómetros por semana; desplazable horizontalmente"><div class="load-chart">' + weeks.map(week => {
      const label = formatDate(week.start, { day: 'numeric', month: 'short' }) + '–' + formatDate(week.end, { day: 'numeric', month: 'short' });
      return '<div class="load-column"><strong>' + formatKm(week.kilometers) + '</strong><div class="load-column-track" aria-hidden="true">' + ['steady','controlled','hard'].map(kind => '<span class="load-' + kind + '" style="height:' + (week.colors[kind]/max*100) + '%"></span>').join('') + '</div><span class="load-week-label">' + escapeHTML(label) + '</span><small>' + (week.partial ? 'Parcial · '+week.days.length+'/7 días' : week.change !== null ? (week.change > 0 ? '+' : '') + Math.round(week.change) + '% vs. anterior' : 'Semana completa') + '</small><span class="sr-only">' + escapeHTML(label) + ': ' + formatKm(week.kilometers) + '; amarillo ' + week.counts.steady + ', naranja ' + week.counts.controlled + ', rojo ' + week.counts.hard + ' días.</span></div>';
    }).join('') + '</div></div><details class="load-table-details"><summary>Ver kilómetros y días por semana</summary><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>Semana</th><th>Km</th><th>🟡 Días</th><th>🟠 Días</th><th>🔴 Días</th><th>Datos</th></tr></thead><tbody>' + weeks.map(w => '<tr><th scope="row">' + formatDate(w.start, {day:'numeric',month:'short',year:'numeric'}) + '</th><td>' + formatKm(w.kilometers) + '</td><td>' + w.counts.steady + '</td><td>' + w.counts.controlled + '</td><td>' + w.counts.hard + '</td><td>' + w.days.length + '/7 días</td></tr>').join('') + '</tbody></table></div></details><p class="stats-note">Las semanas parciales se identifican y no se comparan en porcentaje. Las fechas duplicadas se cuentan una sola vez.</p></section>';
}

function viewNavigation() {
  return '<nav class="view-navigation" aria-label="Vistas de PaceUp">' +
    [["calendar", "Calendario"], ["year", "Estadísticas del año"], ["all", "Estadísticas generales"]].map(([key, label]) =>
      '<button type="button" data-view="' + key + '" aria-pressed="' + (state.view === key) + '" class="month-tab' + (state.view === key ? ' is-active' : '') + '">' + label + '</button>').join('') + '</nav>';
}

function statsPage() {
  const allDays = uniqueDays(state.weeks);
  const years = [...new Set(allDays.map(day => day.date.getFullYear()))].sort((a,b) => b-a);
  const days = state.view === "year" ? allDays.filter(day => day.date.getFullYear() === Number(state.statsYear)) : allDays;
  const buckets = new Map();
  days.forEach(day => {
    const key = day.date.getFullYear() + '-' + String(day.date.getMonth() + 1).padStart(2, '0');
    if (!buckets.has(key)) buckets.set(key, { date: day.date, days: [] });
    buckets.get(key).days.push(day);
  });
  const months = [...buckets].sort(([a],[b]) => a.localeCompare(b));
  const stats = monthStatistics([{ days }]);
  const injury = days.filter(day => day.trainingColor === "lesion").length;
  const rest = days.filter(day => day.trainingColor === "rest").length;
  const unknown = days.filter(day => !day.trainingColor).length;
  const maxKm = Math.max(1, ...months.map(([,m]) => m.days.reduce((sum,d) => sum + countedKm(d),0)));
  const cards = [["Kilómetros del plan",formatKm(stats.kilometers)], ["Sesiones de running",stats.sessions], ["Días de lesión",injury], ["Días de descanso",rest]];
  return '<main id="drop-target" class="main-shell">' + viewNavigation() +
    '<section class="page-intro"><div><p class="eyebrow">PACEUP · ESTADÍSTICAS</p><h1>' + (state.view === "year" ? 'Tu año,<br><span>en perspectiva.</span>' : 'Todo tu plan,<br><span>en perspectiva.</span>') +
    '</h1><p class="intro-copy">' + escapeHTML(state.fileName) + ' · Datos del plan, incluidas fechas futuras</p></div>' +
    (state.view === "year" ? '<label class="year-picker">Año<select id="stats-year">' + years.map(y => '<option value="'+y+'"'+(Number(state.statsYear)===y?' selected':'')+'>'+y+'</option>').join('')+'</select></label>' : '<div class="stats-period">'+years.join(' · ')+'</div>') + '</section>' +
    '<section class="metrics-grid">' + cards.map(([label,value],i) => '<article class="metric-card metric-'+i+'"><span class="metric-label">'+label+'</span><strong>'+escapeHTML(value)+'</strong></article>').join('') + '</section>' +
    '<section class="calendar-panel"><h2>Kilómetros por mes</h2><p class="stats-note">Solo amarillo, naranja y rojo suman kilómetros y sesiones. Celeste y azul = lesión; verde = descanso. Los días sin color reconocido quedan fuera.</p>' +
    '<div class="stats-bars">' + months.map(([,m]) => {
      const km = m.days.reduce((sum,d) => sum + countedKm(d),0);
      return '<div class="stats-bar-row"><span>'+escapeHTML(formatDate(m.date,{month:'long',year:'numeric'}))+'</span><div class="stats-bar-track"><span style="width:'+(km/maxKm*100)+'%"></span></div><strong>'+formatKm(km)+'</strong></div>';
    }).join('') + '</div></section><section class="calendar-panel stats-breakdown"><h2>Distribución de días</h2><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>Categoría</th><th>Días</th><th>Kilómetros</th></tr></thead><tbody>' +
    [["steady","Amarillo"],["controlled","Naranja"],["hard","Rojo"],["lesion","Celeste / azul · lesión"],["rest","Verde · descanso"]].map(([kind,label]) => {
      const group = days.filter(d=>d.trainingColor===kind);
      return '<tr><th scope="row">'+label+'</th><td>'+group.length+'</td><td>'+formatKm(group.reduce((sum,d)=>sum+countedKm(d),0))+'</td></tr>';
    }).join('') + '<tr><th scope="row">Sin color reconocido</th><td>'+unknown+'</td><td>Excluidos</td></tr></tbody></table></div><p class="stats-note">Promedio por sesión con distancia: '+formatKm(stats.kilometers / (days.filter(d => countedKm(d)>0).length || 1))+'. Sesiones sin distancia: '+days.filter(d=>["steady","controlled","hard"].includes(d.trainingColor) && d.kilometers===null).length+'. Se muestra únicamente el período disponible en el Excel.</p></section>' +
    weeklyLoadMarkup(days, state.view === "year" ? String(state.statsYear) : "Todo el archivo") + (state.error ? '<p class="error-message" role="alert">'+escapeHTML(state.error)+'</p>' : '') + '</main>';
}

function weekRange(week) {
  if (!week.days.length) return "";
  const first = week.days[0].date;
  const last = week.days[week.days.length - 1].date;
  if (first.getMonth() === last.getMonth()) {
    return first.getDate() + "–" + last.getDate() + " " + formatDate(first, { month: "short" });
  }
  return formatDate(first, { day: "numeric", month: "short" }) + " – " + formatDate(last, { day: "numeric", month: "short" });
}

function toneClass(day) {
  return "tone-" + (day.status.kind || "planned");
}

function dayCard(day) {
  const today = new Date();
  const isToday = day.date.toDateString() === today.toDateString();
  const detail = day.description ? '<p class="day-description">' + cleanText(day.description) + "</p>" : "";
  const km = ["steady", "controlled", "hard"].includes(day.trainingColor) && day.kilometers !== null ? '<span class="day-km">' + formatKm(day.kilometers) + "</span>" : "";
  return '<button class="day-card ' + toneClass(day) + '" type="button" data-day-id="' + escapeHTML(day.id) + '">' +
    '<div class="day-card-top"><span class="day-date">' + formatDate(day.date) + "</span>" +
    (isToday ? '<span class="today-label">Hoy</span>' : "") + "</div>" +
    '<span class="day-status">' + escapeHTML(day.status.label) + "</span>" + doneBadge(day) +
    '<strong class="day-title">' + cleanText(day.title) + "</strong>" +
    detail + (planChanged(day, sessionRecord(day)) ? '<span class="day-change">Plan actualizado · registro conservado</span>' : '') + (day.distance?.warning ? '<span class="day-change">Revisar distancia</span>' : '') + '<span class="day-card-bottom">' + km + '<span class="open-hint">Ver detalle <span aria-hidden="true">↗</span></span></span>' +
    "</button>";
}

function weekCard(week, maximumKm) {
  const distance = week.days.reduce((sum, day) => sum + countedKm(day), 0);
  const width = maximumKm ? Math.min(100, (distance / maximumKm) * 100) : 0;
  const note = week.note ? '<p class="week-note">' + cleanText(week.note) + "</p>" : "";
  return '<section class="week-section">' +
    '<header class="week-heading"><div><span class="week-eyebrow">SEMANA ' + (week.weekNumber || "") + "</span>" +
    '<h3>' + escapeHTML(week.label) + ' <span class="week-dates">' + escapeHTML(weekRange(week)) + "</span></h3></div>" +
    '<div class="week-total"><strong>' + formatKm(Math.round(distance * 10) / 10) + "</strong><span>estimados</span></div></header>" +
    '<div class="week-progress" aria-label="Kilómetros estimados de la semana"><span style="width:' + width + '%"></span></div>' +
    note + '<div class="days-grid">' + week.days.map(dayCard).join("") + "</div></section>";
}

function metricsMarkup(weeks) {
  const stats = monthStatistics(weeks);
  const labels = [
    { name: "Km planificados", value: formatKm(stats.kilometers), caption: "Estimados desde las distancias escritas" },
    { name: "Sesiones", value: String(stats.sessions), caption: "Días con actividad en el plan" },
    { name: "Semanas", value: String(stats.weeks), caption: "Semanas visibles" },
    { name: "Días controlados o intensos", value: String(stats.quality), caption: "Según la categoría o el color" }
  ];
  return labels.map((item, index) => '<article class="metric-card metric-' + index + '">' +
    '<span class="metric-label">' + escapeHTML(item.name) + "</span><strong>" + escapeHTML(item.value) + "</strong>" +
    '<span class="metric-caption">' + escapeHTML(item.caption) + "</span></article>").join("");
}

function loadingMarkup() {
  return '<main class="boot" aria-label="Cargando PaceUp"><div class="boot-mark" aria-hidden="true"><i></i><i></i><i></i></div><h1>PaceUp</h1><p>Tu próximo paso empieza acá.</p><div class="boot-progress" aria-hidden="true"><span></span></div><small role="status">Preparando tu plan…</small><span class="boot-footer">Tu ritmo. Tu camino.</span></main>';
}

function emptyState() {
  return '<section class="welcome-layout"><div class="welcome-copy"><p class="eyebrow">TU RUNNING, CON PERSPECTIVA</p><h1>Cada día cuenta.<br><span>Tu plan también.</span></h1><p class="welcome-description">Convertí tu Excel en un espacio claro para entrenar: hoy, tus próximas semanas y todo lo que tenés por delante.</p>' +
    '<div class="welcome-features"><span><i>01</i>El entrenamiento de hoy, protagonista</span><span><i>02</i>Todos tus meses, a un toque</span><span><i>03</i>Tu carga y estadísticas en perspectiva</span></div></div>' +
    '<div class="welcome-import"><div class="welcome-preview" aria-hidden="true"><div class="preview-top"><span>ASÍ SE VE TU PLAN</span><span>↗</span></div><div class="preview-title">Tu próximo paso.</div><div class="preview-lines"><i></i><i></i></div><div class="preview-week">' + ['L','M','M','J','V','S','D'].map((d,i)=>'<span class="preview-day preview-day-'+i+'">'+d+'<i></i></span>').join('') + '</div></div>' +
    '<div class="empty-state"><p class="eyebrow">EMPEZÁ CON TU PLAN</p><h2>Arrastrá tu Excel acá</h2><p class="empty-copy">O elegilo desde tu dispositivo para ver tus entrenamientos.</p><button class="primary-button" type="button" data-open-file>＋ Elegir archivo Excel</button><p class="file-hint">.xlsx o .xlsm · Hasta 25 MB</p><p class="welcome-privacy">Tu archivo se procesa en este navegador.</p></div></div></section>';
}

function modalMarkup(day) {
  if (!day) return '';
  const key = dateKey(day.date);
  const record = sessionRecord(day);
  const note = Object.hasOwn(state.noteDrafts, key) ? state.noteDrafts[key] : record.note || '';
  const distance = day.distance;
  return '<div class="modal-backdrop" data-close-modal><section class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button class="modal-close" type="button" aria-label="Cerrar" data-close-modal>×</button>' +
    '<div class="modal-badges"><span class="day-status ' + toneClass(day) + '">' + escapeHTML(day.status.label) + '</span>' + doneBadge(day) + '</div>' +
    '<p class="modal-date">' + formatDate(day.date, { weekday:'long',day:'numeric',month:'long',year:'numeric' }) + '</p><h2 id="detail-title">' + cleanText(day.title) + '</h2>' +
    (['steady','controlled','hard'].includes(day.trainingColor) && day.kilometers !== null ? '<div class="modal-distance">' + formatKm(day.kilometers) + ' en el plan</div>' : '') +
    (day.description ? '<div class="modal-description">' + cleanText(day.description) + '</div>' : '<p class="modal-description muted">La planilla no tiene una descripción para este día.</p>') +
    (distance?.warning ? '<p class="record-warning">' + escapeHTML(distance.warning) + '</p>' : distance?.parts?.length ? '<details class="distance-breakdown"><summary>Cómo se calculó la distancia</summary><p>' + escapeHTML(distance.source) + '</p><ul>' + distance.parts.map(part => '<li>' + escapeHTML(part.label) + ' = ' + formatKm(part.kilometers) + '</li>').join('') + '</ul><p>El título y la descripción no se suman dos veces.</p></details>' : '') +
    planChangeMarkup(day) + '<div class="session-controls">' + doneButton(day) + '</div><label class="session-note-label" for="session-note">Tu nota del entrenamiento</label><textarea id="session-note" rows="3" maxlength="3000" placeholder="Sensaciones, cambios o cómo salió…"' + (!state.recordsReady || state.savingSession ? ' disabled' : '') + '>' + escapeHTML(note) + '</textarea><button class="outline-button" type="button" data-save-note="' + escapeHTML(day.id) + '"' + (!state.recordsReady || state.savingSession ? ' disabled' : '') + '>Guardar nota</button><p class="modal-footnote">Las marcas de hecha y las notas se guardan en este navegador por fecha y se conservan al actualizar el Excel.</p></section></div>';
}

async function saveDayRecord(day, patch) {
  if (!state.recordsReady || state.savingSession || state.loading) return;
  state.savingSession = true;
  render();
  try {
    const record = await updateSessionRecord(dateKey(day.date), patch);
    state.records[record.date] = record;
    state.storageMessage = 'Registro guardado. Se conserva al actualizar el Excel.';
  } catch {
    state.storageMessage = 'No se pudo guardar el registro. La marca y la nota guardadas antes se conservaron; volvé a intentarlo.';
  } finally { state.savingSession = false; render(); }
}

function bindEvents() {
  document.querySelectorAll('[data-toggle-done]').forEach(button => button.addEventListener('click', () => {
    const day = uniqueDays(state.weeks).find(day => day.id === button.dataset.toggleDone);
    if (!day) return;
    const done = !sessionRecord(day).done;
    saveDayRecord(day, { done, ...(done ? { planSignature: planSignature(day), planTitle: day.title, planDescription: day.description } : {}) });
  }));
  document.querySelector('#session-note')?.addEventListener('input', event => {
    if (state.selectedDay) state.noteDrafts[dateKey(state.selectedDay.date)] = event.target.value;
  });
  document.querySelector('[data-save-note]')?.addEventListener('click', event => {
    const day = uniqueDays(state.weeks).find(day => day.id === event.currentTarget.dataset.saveNote);
    if (day) saveDayRecord(day, { note: document.querySelector('#session-note').value });
  });
  document.querySelector('[data-forget-file]')?.addEventListener('click', async () => {
    if (state.loading || state.savingSession) return;
    state.loading = true;
    render();
    try {
      await deleteWorkbook();
      Object.assign(state, { fileName: '', weeks: [], months: [], activeMonth: '', search: '', selectedDay: null, view: 'calendar', error: '', storageMessage: 'Excel eliminado. Tus sesiones hechas y tus notas se conservan por fecha.' });
    } catch {
      state.storageMessage = 'No se pudo borrar el Excel guardado. Volvé a intentarlo.';
    } finally { state.loading = false; render(); }
  });
  document.querySelector('[data-install]')?.addEventListener('click', async () => {
    if (!installPrompt) {
      state.installHelp = 'En Android, abrí PaceUp en Chrome y usá el menú ⋮ → Instalar app o Agregar a la pantalla principal. Si todavía no aparece, volvé a intentarlo después de navegar por la página.';
      render();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      state.installHelp = choice.outcome === 'accepted' ? 'Instalación solicitada. Confirmá los pasos que muestre Android.' : 'Podés instalar PaceUp más adelante desde el menú del navegador.';
    } catch {
      state.installHelp = 'Usá el menú ⋮ del navegador → Instalar app o Agregar a la pantalla principal.';
    }
    render();
  });
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.selectedDay = null;
    render();
  }));
  document.querySelector("#stats-year")?.addEventListener("change", event => {
    state.statsYear = event.target.value;
    render();
  });
  document.querySelectorAll("[data-open-file]").forEach(button =>
    button.addEventListener("click", () => { if (!state.loading && !state.savingSession) document.querySelector("#excel-file").click(); })
  );
  document.querySelector("#excel-file").addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (file) loadFile(file);
    event.target.value = "";
  });

  const drop = document.querySelector("#drop-target");
  if (drop) {
    drop.addEventListener("dragenter", event => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      dragDepth += 1;
      drop.classList.add("is-dragging");
    });
    drop.addEventListener("dragover", event => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    drop.addEventListener("dragleave", event => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) drop.classList.remove("is-dragging");
    });
    drop.addEventListener("drop", event => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      dragDepth = 0;
      drop.classList.remove("is-dragging");
      const file = event.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    });
  }

  document.querySelectorAll("[data-month-key]").forEach(button => button.addEventListener("click", () => {
    setActiveMonth(button.dataset.monthKey, true);
  }));
  document.querySelectorAll("[data-month-step]").forEach(button => button.addEventListener("click", () => {
    moveMonth(Number(button.dataset.monthStep));
  }));
  const currentMonthButton = document.querySelector("[data-current-month]");
  if (currentMonthButton) currentMonthButton.addEventListener("click", () => {
    setActiveMonth(currentMonthButton.dataset.currentMonth, true);
  });

  const search = document.querySelector("#search-input");
  if (search) search.addEventListener("input", event => {
    const cursor = event.target.selectionStart;
    state.search = event.target.value;
    render();
    const next = document.querySelector("#search-input");
    next.focus();
    next.setSelectionRange(cursor, cursor);
  });

  document.querySelectorAll("[data-day-id]").forEach(button => button.addEventListener("click", () => {
    state.selectedDay = state.weeks.flatMap(week => week.days).find(day => day.id === button.dataset.dayId) || null;
    render();
  }));
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", event => {
    if (event.target === button || button.classList.contains("modal-close")) {
      state.selectedDay = null;
      render();
    }
  }));
  document.querySelectorAll("[data-clear-search]").forEach(button => button.addEventListener("click", () => {
    state.search = "";
    render();
  }));
}

function setActiveMonth(key, center = false) {
  state.activeMonth = key;
  render();
  if (!center) return;
  scrollToMonth(key, "smooth");
}

function scrollToMonth(key, behavior = "auto") {
  const activeButton = Array.from(document.querySelectorAll("[data-month-key]"))
    .find(button => button.dataset.monthKey === key);
  activeButton?.scrollIntoView({ behavior, block: "nearest", inline: "center" });
}

function moveMonth(step) {
  const index = state.months.findIndex(month => monthKey(month) === state.activeMonth);
  const nextMonth = state.months[index + step];
  if (nextMonth) setActiveMonth(monthKey(nextMonth), true);
}

function render() {
  const monthStripScroll = document.querySelector(".month-strip")?.scrollLeft;
  const weeks = selectedWeeks();
  const currentMonth = state.months.find(month => month.name + "-" + month.year === state.activeMonth);
  const activeMonthIndex = state.months.findIndex(month => monthKey(month) === state.activeMonth);
  const actualMonth = state.months.find(month =>
    month.index === new Date().getMonth() && month.year === new Date().getFullYear()
  );
  const maximumKm = Math.max(0, ...weeks.map(week => week.days.reduce((sum, day) => sum + countedKm(day), 0)));
  const monthTabs = state.months.map(month => {
    const key = monthKey(month);
    const active = state.activeMonth === key;
    return '<button class="month-tab' + (active ? " is-active" : "") + '" type="button" data-month-key="' + escapeHTML(key) +
      '" aria-pressed="' + active + '" aria-label="Ver ' + escapeHTML(monthTitle(month)) + '">' +
      '<span>' + escapeHTML(monthTitle(month)) + '</span></button>';
  }).join("");
  const header = '<header class="topbar"><a class="brand" href="#" aria-label="PaceUp, inicio">' +
    '<span class="brand-symbol"><span></span><span></span><span></span></span><span>PaceUp</span></a>' +
    '<div class="topbar-right">' + (isInstalled ? '' : '<button class="outline-button install-button" type="button" data-install>Instalar app</button>') + '<span class="local-badge"><span class="status-dot"></span>Se procesa en tu navegador</span>' +
    '<button class="outline-button" type="button" data-open-file>' +
    (state.fileName ? "Cambiar Excel" : "Importar Excel") + "</button>" + (state.fileName ? '<button class="outline-button" type="button" data-forget-file' + (state.loading ? ' disabled' : '') + '>Borrar Excel</button>' : '') + "</div></header>";

  let body;
  if (!state.weeks.length) {
    body = '<main id="drop-target" class="main-shell empty-shell">' +
      (state.loading ? loadingMarkup() : emptyState()) +
      (state.error ? '<p class="error-message" role="alert">' + escapeHTML(state.error) + "</p>" : "") + "</main>";
  } else {
    body = '<main id="drop-target" class="main-shell">' + viewNavigation() +
      todayMarkup() + '<div class="loaded-file-line"><span>' + escapeHTML(state.fileName) + '</span><button class="text-button" type="button" data-open-file>Cambiar Excel</button></div>' +
      '<section class="metrics-grid" aria-label="Resumen del plan">' + metricsMarkup(weeks) + "</section>" +
      weeklyLoadMarkup(uniqueDays(state.weeks).filter(day => currentMonth && day.date.getMonth() === currentMonth.index && day.date.getFullYear() === currentMonth.year), currentMonth ? monthTitle(currentMonth) : "") +
      '<section class="calendar-panel"><div class="calendar-toolbar"><div class="calendar-heading"><p class="eyebrow">CALENDARIO DEL PLAN</p>' +
      '<h2>Entrenamientos</h2></div><div class="month-navigation">' +
      '<button class="month-arrow" type="button" data-month-step="-1" aria-label="Mes anterior"' + (activeMonthIndex <= 0 ? " disabled" : "") + '>‹</button>' +
      '<div class="active-month"><span>MES SELECCIONADO</span><strong>' + escapeHTML(currentMonth ? monthTitle(currentMonth) : "Entrenamientos") + "</strong></div>" +
      '<button class="month-arrow" type="button" data-month-step="1" aria-label="Mes siguiente"' + (activeMonthIndex >= state.months.length - 1 ? " disabled" : "") + '>›</button>' +
      (actualMonth ? '<button class="today-button" type="button" data-current-month="' + escapeHTML(monthKey(actualMonth)) + '">Ir a este mes</button>' : "") +
      '</div></div><div class="calendar-controls"><div class="month-strip-area"><span class="control-label">MESES DEL PLAN</span>' +
      '<nav class="month-strip" aria-label="Meses del plan">' + monthTabs + '</nav></div>' +
      '<div class="filters"><label class="search-box"><span class="search-icon" aria-hidden="true">⌕</span><span class="sr-only">Buscar entrenamiento</span>' +
      '<input id="search-input" type="search" placeholder="Buscar entrenamiento" value="' + escapeHTML(state.search) + '">' +
      (state.search ? '<button type="button" data-clear-search aria-label="Borrar búsqueda">×</button>' : "") + "</label></div></div>" +
      '<div class="legend"><span><i class="legend-dot tone-lesion"></i>Lesión</span><span><i class="legend-dot tone-rest"></i>Descanso</span>' +
      '<span><i class="legend-dot tone-steady"></i>Amarillo</span><span><i class="legend-dot tone-controlled"></i>Naranja</span>' +
      '<span><i class="legend-dot tone-hard"></i>Rojo</span></div>' +
      (state.error ? '<p class="error-message" role="alert">' + escapeHTML(state.error) + "</p>" : "") +
      (weeks.length ? weeks.map(week => weekCard(week, maximumKm)).join("") :
        '<div class="no-results"><strong>No hay entrenamientos para mostrar.</strong><span>Probá con otro mes o cambiá la búsqueda.</span>' +
        (state.search ? '<button class="text-button" data-clear-search type="button">Borrar búsqueda</button>' : "") + "</div>") +
      '<p class="estimate-note"><span>i</span> Los kilómetros se estiman leyendo las distancias escritas en cada sesión. Solo se suman días amarillos, naranjas y rojos con distancia explícita. Lesión y descanso quedan excluidos.</p>' +
      "</section></main>";
  }

  if (state.weeks.length && state.view !== "calendar") body = statsPage();

  app.innerHTML = '<div class="app-frame">' + header + (state.storageMessage ? '<p class="install-help" role="status">' + escapeHTML(state.storageMessage) + '</p>' : '') + (state.installHelp ? '<p class="install-help" role="status">' + escapeHTML(state.installHelp) + '</p>' : '') + body +
    '<input id="excel-file" type="file" accept=".xlsx,.xlsm" hidden>' + modalMarkup(state.selectedDay) + "</div>";
  bindEvents();
  const monthStrip = document.querySelector(".month-strip");
  if (monthStrip && monthStripScroll !== undefined) monthStrip.scrollLeft = monthStripScroll;
}

async function loadFile(file, { restore = false } = {}) {
  if ((state.loading || state.savingSession) && !restore) return;
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xlsm"].includes(extension)) {
    state.error = "Elegí un archivo .xlsx o .xlsm. Los archivos .xls antiguos todavía no son compatibles.";
    render();
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    state.error = "El archivo supera los 25 MB. Guardá una copia más liviana y volvé a intentarlo.";
    render();
    return;
  }
  state.loading = true;
  state.error = "";
  render();
  try {
    const buffer = await file.arrayBuffer();
    const workbook = readXlsx(buffer);
    const parsed = parseRunningWorkbook(workbook, file.name);
    if (!parsed.weeks.length) {
      const monthSheets = parsed.diagnostics?.monthSheets || [];
      const missingHeaders = parsed.diagnostics?.sheetsWithoutCalendar || [];
      if (!monthSheets.length) {
        const names = workbook.worksheets.map(sheet => sheet.name).slice(0, 6).join(", ");
        throw new Error("Este archivo no tiene pestañas mensuales con entrenamientos. Encontré: " + (names || "ninguna pestaña legible") + ". Elegí la planilla completa del plan, que incluye meses como Septiembre, Octubre o Noviembre.");
      }
      if (missingHeaders.length) {
        throw new Error("Encontré las pestañas " + missingHeaders.join(", ") + ", pero no pude reconocer sus días. Revisá que las columnas tengan los encabezados LUN, MAR, MIÉ, JUE, VIE, SÁB y DOM.");
      }
      throw new Error("Encontré pestañas de meses (" + monthSheets.join(", ") + "), pero no pude leer fechas de entrenamiento. Cada semana debe tener una etiqueta S1, S2, etc., y sus fechas en las columnas de lunes a domingo.");
    }
    let markedHistorical = 0;
    let historicalFailed = false;
    try {
      markedHistorical = await seedHistoricalSessions(historicalSessionRecords(uniqueDays(parsed.weeks)));
    } catch { historicalFailed = true; }
    try {
      const records = await readSessionRecords();
      state.records = Object.fromEntries(records.map(record => [record.date, record]));
      state.recordsReady = true;
    } catch {
      state.recordsReady = false;
    }
    state.view = "calendar";
    state.selectedDay = null;
    state.fileName = file.name;
    state.weeks = parsed.weeks;
    state.months = parsed.months;
    const years = [...new Set(uniqueDays(parsed.weeks).map(day => day.date.getFullYear()))];
    state.statsYear = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : Math.max(...years);
    const today = new Date();
    const todayMonth = parsed.months.find(month =>
      month.index === today.getMonth() && month.year === today.getFullYear()
    );
    const preferredMonth = todayMonth || parsed.months[parsed.months.length - 1];
    state.activeMonth = preferredMonth.name + "-" + preferredMonth.year;
    state.search = "";
    if (restore) {
      if (state.recordsReady) state.storageMessage = '';
    } else {
      try {
        await saveWorkbook(file.name, buffer);
        state.storageMessage = 'Excel guardado en este navegador. Tus marcas y notas se conservan.';
      } catch {
        state.storageMessage = 'El plan está abierto, pero no se pudo guardar en este navegador. Tendrás que cargarlo de nuevo al volver.';
      }
    }
    if (historicalFailed) state.storageMessage += ' No se pudieron guardar las marcas históricas; volvé a abrir el Excel para reintentarlo.';
    else if (markedHistorical) state.storageMessage += ' ' + markedHistorical + ' actividades hasta el 30/09/2026 quedaron hechas.';
  } catch (error) {
    state.error = error?.message || "No se pudo leer el archivo. Probá con otra copia de Excel.";
  } finally {
    if (!state.recordsReady) state.storageMessage += ' No se pudieron leer tus registros: marcar sesiones y guardar notas queda desactivado para protegerlos.';
    state.loading = false;
    render();
    scrollToMonth(state.activeMonth);
  }
}

async function restoreSavedWorkbook() {
  state.loading = true;
  render();
  try {
    try {
      const records = await readSessionRecords();
      state.records = Object.fromEntries(records.map(record => [record.date, record]));
      state.recordsReady = true;
    } catch {
      state.recordsReady = false;
      state.storageMessage = 'No se pudieron recuperar tus registros. Podés ver el plan; marcar sesiones y guardar notas queda desactivado para proteger lo guardado.';
    }
    const saved = await readWorkbook();
    if (saved) {
      if (typeof saved.name !== 'string' || !(saved.buffer instanceof ArrayBuffer)) throw new Error('Archivo guardado inválido');
      await loadFile(new File([saved.buffer], saved.name), { restore: true });
    }
  } catch {
    state.storageMessage = 'No se pudo recuperar el Excel guardado. Podés volver a cargarlo.';
  } finally {
    state.loading = false;
    render();
  }
}
restoreSavedWorkbook();

let lastToday = new Date().toDateString();
setInterval(() => {
  const current = new Date().toDateString();
  if (current !== lastToday) { lastToday = current; render(); }
}, 60000);
