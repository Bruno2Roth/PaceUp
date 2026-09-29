import { parseRunningWorkbook } from "./parser.js";
import { readXlsx } from "./readXlsx.js";
import "./style.css";

const state = {
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
  return month ? month.name.charAt(0).toUpperCase() + month.name.slice(1) + " " + month.year : "";
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

function monthStatistics(weeks) {
  const days = weeks.flatMap(week => week.days);
  const kilometers = days.reduce((sum, day) => sum + (day.kilometers || 0), 0);
  const sessions = days.filter(day => day.kilometers !== null ||
    !["rest", "travel", "lesion", "gym", "empty"].includes(day.status.kind)).length;
  const quality = days.filter(day => ["hard", "controlled"].includes(day.status.kind)).length;
  return { kilometers: Math.round(kilometers * 10) / 10, sessions, weeks: weeks.length, quality };
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
  const km = day.kilometers !== null ? '<span class="day-km">' + formatKm(day.kilometers) + "</span>" : "";
  return '<button class="day-card ' + toneClass(day) + '" type="button" data-day-id="' + escapeHTML(day.id) + '">' +
    '<div class="day-card-top"><span class="day-date">' + formatDate(day.date) + "</span>" +
    (isToday ? '<span class="today-label">Hoy</span>' : "") + "</div>" +
    '<span class="day-status">' + escapeHTML(day.status.label) + "</span>" +
    '<strong class="day-title">' + cleanText(day.title) + "</strong>" +
    detail + '<span class="day-card-bottom">' + km + '<span class="open-hint">Ver detalle <span aria-hidden="true">↗</span></span></span>' +
    "</button>";
}

function weekCard(week, maximumKm) {
  const distance = week.days.reduce((sum, day) => sum + (day.kilometers || 0), 0);
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

function emptyState() {
  return '<div class="empty-state">' +
    '<div class="empty-illustration"><span class="track-ring"></span><span class="track-dot"></span><span class="shoe-mark">↗</span></div>' +
    '<p class="eyebrow">TU PLAN, MÁS CLARO</p><h2>Cargá tu Excel de running</h2>' +
    '<p class="empty-copy">La app va a leer las pestañas por mes, las semanas, las descripciones y los colores de cada entrenamiento.</p>' +
    '<button class="primary-button" type="button" data-open-file>Elegir archivo Excel</button>' +
    '<p class="file-hint">Compatible con .xlsx y .xlsm · El archivo se procesa en este navegador</p>' +
    "</div>";
}

function modalMarkup(day) {
  if (!day) return "";
  return '<div class="modal-backdrop" data-close-modal>' +
    '<section class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">' +
    '<button class="modal-close" type="button" aria-label="Cerrar" data-close-modal>×</button>' +
    '<span class="day-status ' + toneClass(day) + '">' + escapeHTML(day.status.label) + "</span>" +
    '<p class="modal-date">' + formatDate(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + "</p>" +
    '<h2 id="detail-title">' + cleanText(day.title) + "</h2>" +
    (day.kilometers !== null ? '<div class="modal-distance">' + formatKm(day.kilometers) + "</div>" : "") +
    (day.description ? '<div class="modal-description">' + cleanText(day.description) + "</div>" :
      '<p class="modal-description muted">La planilla no tiene una descripción para este día.</p>') +
    '<p class="modal-footnote">El kilometraje se estima a partir de las distancias explícitas del entrenamiento.</p>' +
    "</section></div>";
}

function bindEvents() {
  document.querySelectorAll("[data-open-file]").forEach(button =>
    button.addEventListener("click", () => document.querySelector("#excel-file").click())
  );
  document.querySelector("#excel-file").addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (file) loadFile(file);
    event.target.value = "";
  });

  const drop = document.querySelector("#drop-target");
  if (drop) {
    ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, event => {
      event.preventDefault();
      drop.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach(type => drop.addEventListener(type, event => {
      event.preventDefault();
      drop.classList.remove("is-dragging");
    }));
    drop.addEventListener("drop", event => {
      const file = event.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    });
  }

  const month = document.querySelector("#month-filter");
  if (month) month.addEventListener("change", event => {
    state.activeMonth = event.target.value;
    render();
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

function render() {
  const weeks = selectedWeeks();
  const currentMonth = state.months.find(month => month.name + "-" + month.year === state.activeMonth);
  const maximumKm = Math.max(0, ...weeks.map(week => week.days.reduce((sum, day) => sum + (day.kilometers || 0), 0)));
  const monthOptions = state.months.map(month =>
    '<option value="' + escapeHTML(month.name + "-" + month.year) + '"' +
    (state.activeMonth === month.name + "-" + month.year ? " selected" : "") + ">" + escapeHTML(monthTitle(month)) + "</option>"
  ).join("");
  const header = '<header class="topbar"><a class="brand" href="#" aria-label="Ritmo, inicio">' +
    '<span class="brand-symbol"><span></span><span></span><span></span></span><span>ritmo<span class="brand-period">.</span></span></a>' +
    '<div class="topbar-right"><span class="local-badge"><span class="status-dot"></span>Se procesa en tu navegador</span>' +
    '<button class="outline-button" type="button" data-open-file>' +
    (state.fileName ? "Cambiar Excel" : "Importar Excel") + "</button></div></header>";

  let body;
  if (!state.weeks.length) {
    body = '<main id="drop-target" class="main-shell empty-shell">' +
      (state.loading ? '<div class="loading-state"><span class="loader"></span><strong>Leyendo tu planilla...</strong><span>Un momento</span></div>' : emptyState()) +
      (state.error ? '<p class="error-message">' + escapeHTML(state.error) + "</p>" : "") + "</main>";
  } else {
    body = '<main id="drop-target" class="main-shell">' +
      '<section class="page-intro"><div><p class="eyebrow">PLAN DE ENTRENAMIENTO</p><h1>Tu running,<br><span>semana a semana.</span></h1>' +
      '<p class="intro-copy">Una vista simple de tus sesiones, ritmos y carga semanal.</p></div>' +
      '<div class="file-card"><div class="file-icon">XLS</div><div class="file-meta"><strong>' + escapeHTML(state.fileName) +
      '</strong><span>Plan importado localmente</span></div><button class="file-change" type="button" data-open-file aria-label="Cambiar Excel">↻</button></div></section>' +
      '<section class="metrics-grid" aria-label="Resumen del plan">' + metricsMarkup(weeks) + "</section>" +
      '<section class="calendar-toolbar"><div><p class="eyebrow">CALENDARIO</p><h2>' +
      escapeHTML(currentMonth ? monthTitle(currentMonth) : "Entrenamientos") + "</h2></div>" +
      '<div class="filters"><label class="select-wrap"><span class="sr-only">Filtrar por mes</span><select id="month-filter">' + monthOptions +
      "</select><span aria-hidden=\"true\">⌄</span></label>" +
      '<label class="search-box"><span class="search-icon" aria-hidden="true">⌕</span><span class="sr-only">Buscar entrenamiento</span>' +
      '<input id="search-input" type="search" placeholder="Buscar entrenamiento" value="' + escapeHTML(state.search) + '">' +
      (state.search ? '<button type="button" data-clear-search aria-label="Borrar búsqueda">×</button>' : "") + "</label></div></section>" +
      '<div class="legend"><span><i class="legend-dot tone-lesion"></i>Lesión</span><span><i class="legend-dot tone-easy"></i>Suave</span>' +
      '<span><i class="legend-dot tone-steady"></i>Extensivo</span><span><i class="legend-dot tone-controlled"></i>Controlado</span>' +
      '<span><i class="legend-dot tone-hard"></i>Intenso</span></div>' +
      (state.error ? '<p class="error-message">' + escapeHTML(state.error) + "</p>" : "") +
      (weeks.length ? weeks.map(week => weekCard(week, maximumKm)).join("") :
        '<div class="no-results"><strong>No hay entrenamientos para mostrar.</strong><span>Probá con otro mes o cambiá la búsqueda.</span>' +
        (state.search ? '<button class="text-button" data-clear-search type="button">Borrar búsqueda</button>' : "") + "</div>") +
      '<p class="estimate-note"><span>i</span> Los kilómetros se estiman leyendo las distancias escritas en cada sesión. Las sesiones sin distancia explícita no se suman.</p>' +
      "</main>";
  }

  app.innerHTML = '<div class="app-frame">' + header + body +
    '<input id="excel-file" type="file" accept=".xlsx,.xlsm" hidden>' + modalMarkup(state.selectedDay) + "</div>";
  bindEvents();
}

async function loadFile(file) {
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
      throw new Error("No encontré pestañas mensuales con semanas y columnas de lunes a domingo. Revisá que la planilla conserve el formato habitual.");
    }
    state.fileName = file.name;
    state.weeks = parsed.weeks;
    state.months = parsed.months;
    const todayMonth = parsed.months.find(month => month.index === new Date().getMonth());
    const preferredMonth = todayMonth || parsed.months[parsed.months.length - 1];
    state.activeMonth = preferredMonth.name + "-" + preferredMonth.year;
    state.search = "";
  } catch (error) {
    state.error = error?.message || "No se pudo leer el archivo. Probá con otra copia de Excel.";
  } finally {
    state.loading = false;
    render();
  }
}

render();
