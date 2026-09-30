import { cacheIsFresh, cityDate, weatherForDate, weatherDescription, weatherAssessment } from './weather.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function weatherIcon(code) {
  const cloud = '<path d="M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0-1 9Z"/>';
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  let shape;
  if (code === 0) shape = sun;
  else if ([1,2].includes(code)) shape = '<circle cx="8" cy="7" r="4"/>' + cloud;
  else if (code === 3) shape = cloud;
  else if ([45,48].includes(code)) shape = '<path d="M3 7h18M5 12h14M3 17h18"/>';
  else if ([95,96,97,99].includes(code)) shape = cloud + '<path d="m13 13-3 6h4l-3 4"/>';
  else if ([56,57,66,67,71,73,75,77,85,86].includes(code)) shape = cloud + '<path d="M8 20h.01M12 22h.01M16 20h.01"/>';
  else if ([51,53,55,61,63,65,80,81,82].includes(code)) shape = cloud + '<path d="m8 20-1 2m5-2-1 2m5-2-1 2"/>';
  else shape = '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 8v10"/>';
  return '<svg class="weather-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + shape + '</svg>';
}
const rainIcon = '<svg class="weather-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/></svg>';
const value = (number, unit = '') => typeof number === 'number' && Number.isFinite(number) ? Math.round(number) + unit : '—';
function todayFor(weather) { return cityDate(weather.record, new Date(weather.now ?? Date.now())); }
function freshFor(weather) { return cacheIsFresh(weather.record, weather.now ?? Date.now()); }
function pointFor(weather, date) { return weatherForDate(weather.record, date, weather.hour); }
function absentText(weather, date) {
  if (weather.loading) return 'Consultando pronóstico…';
  if (weather.error) return 'Clima no disponible. Volvé a intentarlo con conexión.';
  if (date < todayFor(weather)) return 'No hay clima guardado para esta fecha.';
  return 'Todavía sin pronóstico: se consulta hasta 16 días hacia adelante.';
}
function savedLabel(weather, date) {
  if (!weather.record) return '';
  if (date < todayFor(weather)) return 'Pronóstico guardado · no es una medición histórica';
  if (!freshFor(weather) || weather.source === 'offline') return 'Caché anterior · necesita actualización';
  return weather.source === 'cache' ? 'Pronóstico en caché' : 'Pronóstico actualizado';
}
export function dayWeatherMarkup(weather, date) {
  return '<span class="day-weather-surface" data-weather-surface="compact" data-weather-date="' + escape(date) + '">' + dayWeatherContent(weather, date) + '</span>';
}
function dayWeatherContent(weather, date) {
  const point = pointFor(weather, date);
  if (!point) return '<span class="day-weather is-unavailable">' + weatherIcon(null) + ' ' + (weather.loading ? 'Consultando clima' : date < todayFor(weather) ? 'Sin clima guardado' : 'Sin pronóstico aún') + '</span>';
  const description = weatherDescription(point.code), assessment = weatherAssessment(point);
  const past = date < todayFor(weather);
  const stale = !freshFor(weather) || weather.source === 'offline';
  return '<span class="day-weather weather-' + (past || stale ? 'unknown' : assessment.level) + '" title="' + escape(description.label + ' · ' + (past ? 'Pronóstico guardado' : stale ? 'Caché anterior' : assessment.label) + ' · ' + (point.granularity === 'hour' ? String(weather.hour).padStart(2,'0') + ':00' : 'Resumen diario') + ' · ' + savedLabel(weather, date)) + '"><span>' + weatherIcon(point.code) + ' ' + value(point.temperature,'°') + '</span><span>' + rainIcon + ' ' + value(point.rainProbability,'%') + '</span>' + (!past && (!freshFor(weather) || weather.source === 'offline') ? '<span>Caché anterior</span>' : '') + '</span>';
}
export function weatherPanelMarkup(weather, date, { title = 'Clima para este día', controls = false } = {}) {
  const point = pointFor(weather, date), assessment = weatherAssessment(point), description = weatherDescription(point?.code);
  const past = date < todayFor(weather);
  const stale = !freshFor(weather) || weather.source === 'offline';
  const scope = point?.granularity === 'day' ? 'Resumen del día · máximos' : String(weather.hour).padStart(2,'0') + ':00 · hora del lugar';
  let body;
  if (!point) body = '<div class="weather-empty"><span>' + weatherIcon(2) + '</span><p>' + escape(absentText(weather, date)) + '</p></div>';
  else body = '<div class="weather-temperature"><span>' + weatherIcon(point.code) + '</span><strong>' + value(point.temperature,'°') + '</strong><div><span>' + escape(description.label) + '</span><small>' + escape(scope) + '</small></div></div>' +
    '<p class="weather-range">Mín. ' + value(point.min,'°') + ' · Máx. ' + value(point.max,'°') + (point.granularity === 'hour' ? ' · Sensación ' + value(point.feelsLike,'°') : '') + '</p>' +
    '<dl class="weather-metrics"><div><dt>Lluvia</dt><dd>' + value(point.rainProbability,'%') + '</dd></div><div><dt>Viento</dt><dd>' + value(point.wind,' km/h') + '</dd></div><div><dt>Ráfagas</dt><dd>' + value(point.gust,' km/h') + '</dd></div></dl>' +
    (past ? '<p class="weather-assessment weather-unknown">Pronóstico guardado para esta fecha</p>' : stale ? '<div class="weather-assessment weather-unknown"><strong>Pronóstico anterior</strong><span>Actualizá el clima antes de decidir la salida.</span></div>' : '<div class="weather-assessment weather-' + assessment.level + '"><strong>' + escape(assessment.label) + '</strong><span>' + escape(assessment.reason) + '</span></div>') +
    '<p class="weather-freshness">' + escape(savedLabel(weather, date)) + ' · ' + escape(new Intl.DateTimeFormat('es-AR',{timeZone:weather.record.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(point.capturedAt))) + '</p>';
  const controlsMarkup = controls ? '<div class="weather-controls"><label>Lugar<select id="weather-location"><option value="buenos-aires"' + (weather.location.name === 'Buenos Aires' ? ' selected' : '') + '>Buenos Aires</option><option value="pilar"' + (weather.location.name === 'Pilar · Hebraica' ? ' selected' : '') + '>Pilar · Hebraica</option>' + (!['Buenos Aires','Pilar · Hebraica'].includes(weather.location.name) ? '<option value="custom" selected>' + escape(weather.location.name) + '</option>' : '') + '</select></label><label>Hora<select id="weather-hour">' + Array.from({length:24},(_,hour) => '<option value="' + hour + '"' + (hour === weather.hour ? ' selected' : '') + '>' + String(hour).padStart(2,'0') + ':00</option>').join('') + '</select></label></div><div class="weather-actions"><button type="button" class="outline-button" data-weather-geolocate' + (weather.locating ? ' disabled' : '') + '>' + (weather.locating ? 'Buscando ubicación…' : 'Usar mi ubicación') + '</button><button type="button" class="text-button" data-weather-refresh' + (weather.loading ? ' disabled' : '') + '>Actualizar</button></div>' : '';
  return '<div class="weather-panel-surface" data-weather-surface="panel" data-weather-date="' + escape(date) + '" data-weather-title="' + escape(title) + '" data-weather-controls="' + controls + '"><section class="weather-panel" aria-label="' + escape(title) + '"><div class="weather-heading"><p class="eyebrow">CLIMA Y RUNNING</p><h2>' + escape(title) + '</h2><p>' + escape(weather.location.name) + '</p></div>' + body + controlsMarkup +
    (weather.error && point ? '<p class="weather-message" role="status">No se pudo actualizar. Se muestra el último pronóstico guardado.</p>' : '') +
    (weather.message && controls ? '<p class="weather-message" role="status">' + escape(weather.message) + '</p>' : '') +
    '<details class="weather-explanation"><summary>Cómo se interpreta</summary><p>Indicador orientativo del pronóstico, no una alerta oficial. Tormenta, precipitación helada, lluvia intensa, sensación desde 35 °C o ráfagas desde 60 km/h sugieren entrenar bajo techo. Se destacan calor desde 28 °C, frío hasta 5 °C, lluvia, niebla y viento desde 25 km/h.</p><p>Revisá las condiciones reales y las alertas locales antes de salir. Los datos antiguos en caché no describen el clima actual.</p></details><a class="weather-source" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Datos: Open-Meteo · resumen e indicador de PaceUp</a></section></div>';
}
