export const DEFAULT_LOCATION = { name: 'Buenos Aires', latitude: -34.6037, longitude: -58.3816, timezone: 'America/Argentina/Buenos_Aires' };
export const PILAR_LOCATION = { name: 'Pilar · Hebraica', latitude: -34.4587, longitude: -58.9142, timezone: 'America/Argentina/Buenos_Aires' };
export const WEATHER_TTL = 60 * 60 * 1000;
const CACHE_KEY = 'paceup-weather-cache-v1';
const PREFERENCES_KEY = 'paceup-weather-preferences-v1';
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

function localStorageOrNull() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
function readJSON(storage, key) {
  try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
}
function validTimezone(timezone, allowAuto = false) {
  if (timezone === 'auto') return allowAuto;
  if (typeof timezone !== 'string' || !timezone) return false;
  try { new Intl.DateTimeFormat('en', {timeZone:timezone}); return true; } catch { return false; }
}
function validLocation(location) {
  return location && typeof location.name === 'string' && location.name.length <= 100 &&
    finite(location.latitude) !== null && Math.abs(location.latitude) <= 90 &&
    finite(location.longitude) !== null && Math.abs(location.longitude) <= 180 &&
    validTimezone(location.timezone, true);
}
export function locationKey(location) {
  return [location.latitude.toFixed(3), location.longitude.toFixed(3), location.timezone].join(',');
}
export function readWeatherPreferences(storage = localStorageOrNull()) {
  const saved = readJSON(storage, PREFERENCES_KEY);
  return { location: validLocation(saved?.location) ? saved.location : { ...DEFAULT_LOCATION },
    hour: Number.isInteger(saved?.hour) && saved.hour >= 0 && saved.hour <= 23 ? saved.hour : 18 };
}
export function saveWeatherPreferences(preferences, storage = localStorageOrNull()) {
  try { if (!storage) return false; storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); return true; } catch { return false; }
}
export function forecastURL(location) {
  const params = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude,
    timezone: location.timezone, forecast_days: '16', past_days: '1', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' });
  return 'https://api.open-meteo.com/v1/forecast?' + params;
}
function fieldsAt(section, index, fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, source]) => [key, finite(section[source]?.[index])]));
}
export function normalizeForecast(payload, location, savedAt) {
  if (payload?.error || !Array.isArray(payload?.daily?.time) || !payload.daily.time.length) throw new Error('Pronóstico no disponible');
  const days = {};
  payload.daily.time.slice(0, 17).forEach((date, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    days[date] = { ...fieldsAt(payload.daily, index, { code:'weather_code',max:'temperature_2m_max',min:'temperature_2m_min',rainProbability:'precipitation_probability_max',rain:'precipitation_sum',wind:'wind_speed_10m_max',gust:'wind_gusts_10m_max' }), hours: {}, capturedAt: savedAt };
  });
  (payload.hourly?.time || []).slice(0, 17 * 24).forEach((time, index) => {
    if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time)) return;
    const day = days[time.slice(0, 10)];
    if (day) day.hours[Number(time.slice(11, 13))] = fieldsAt(payload.hourly, index,
      { temperature:'temperature_2m',feelsLike:'apparent_temperature',rainProbability:'precipitation_probability',rain:'precipitation',code:'weather_code',wind:'wind_speed_10m',gust:'wind_gusts_10m' });
  });
  if (!Object.values(days).some(day => day.code !== null || day.max !== null)) throw new Error('Respuesta de clima incompleta');
  let timezone = payload.timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(savedAt)); } catch { timezone = DEFAULT_LOCATION.timezone; }
  return { locationKey: locationKey(location), savedAt, timezone: timezone || DEFAULT_LOCATION.timezone, days };
}
function validCache(record, key) {
  return record?.locationKey === key && finite(record.savedAt) !== null && record.savedAt > 0 && validTimezone(record.timezone) && record.days && typeof record.days === 'object' && !Array.isArray(record.days);
}
export function cacheIsFresh(record, now = Date.now()) {
  return Boolean(record && now >= record.savedAt && now - record.savedAt < WEATHER_TTL);
}
export function createWeatherClient({ storage = localStorageOrNull(), fetcher = globalThis.fetch, now = Date.now } = {}) {
  const pending = new Map();
  const memory = new Map();
  function read(location) {
    const key = locationKey(location);
    const record = memory.get(key) || readJSON(storage, CACHE_KEY)?.[key];
    return validCache(record, key) ? record : null;
  }
  function persist(record) {
    memory.set(record.locationKey, record);
    let cache = readJSON(storage, CACHE_KEY) || {};
    cache = Object.fromEntries([...Object.entries(cache).filter(([key, value]) => validCache(value, key) && key !== record.locationKey), [record.locationKey, record]]
      .sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 3));
    try { if (!storage) return false; storage.setItem(CACHE_KEY, JSON.stringify(cache)); return true; } catch { return false; }
  }
  async function load(location, { force = false, onCache = () => {} } = {}) {
    const key = locationKey(location), cached = read(location);
    if (cached) onCache(cached);
    if (!force && cacheIsFresh(cached, now())) return { record: cached, source: 'cache', persisted: Boolean(storage) && cached.cachePersisted !== false };
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetcher(forecastURL(location), { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('No se pudo actualizar el clima');
        const record = normalizeForecast(await response.json(), location, now());
        // Retain previous forecasts for recent past days; these are saved predictions,
        // never described as measured historical weather.
        const oldest = new Date(record.savedAt - 30 * 86400000).toISOString().slice(0, 10);
        record.days = { ...Object.fromEntries(Object.entries(cached?.days || {}).filter(([date]) => date >= oldest)), ...record.days };
        const persisted = persist(record);
        record.cachePersisted = persisted;
        return { record, source: 'network', persisted };
      } catch (error) {
        if (cached) return { record: cached, source: 'offline', persisted: Boolean(storage) && cached.cachePersisted !== false, error: true };
        throw error;
      } finally { clearTimeout(timeout); }
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return { load, read };
}
export function cityDate(record, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: record?.timezone || DEFAULT_LOCATION.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function weatherForDate(record, date, hour = 18) {
  const day = record?.days?.[date];
  if (!day || typeof day !== 'object') return null;
  const hourly = day.hours?.[hour];
  const point = hourly && typeof hourly === 'object' ? { ...hourly, granularity:'hour',hour } : { ...day, temperature:day.max,feelsLike:day.max,granularity:'day' };
  return { ...point, max: finite(day.max), min: finite(day.min), capturedAt: day.capturedAt || record.savedAt };
}
export function weatherDescription(code) {
  if (code === 0) return { icon:'☀️',label:'Despejado' };
  if ([1,2].includes(code)) return { icon:'🌤️',label:'Parcialmente nublado' };
  if (code === 3) return { icon:'☁️',label:'Nublado' };
  if ([45,48].includes(code)) return { icon:'🌫️',label:'Niebla' };
  if ([51,53,55].includes(code)) return { icon:'🌦️',label:'Llovizna' };
  if ([61,63,65,80,81,82].includes(code)) return { icon:'🌧️',label:'Lluvia' };
  if ([56,57,66,67].includes(code)) return { icon:'🌨️',label:'Precipitación helada' };
  if ([71,73,75,77,85,86].includes(code)) return { icon:'🌨️',label:'Nieve' };
  if ([95,96,97,99].includes(code)) return { icon:'⛈️',label:'Tormenta' };
  return { icon:'🌡️',label:'Condición sin informar' };
}
export function weatherAssessment(point) {
  if (!point) return { level:'unknown',label:'Sin pronóstico',reason:'Todavía no hay datos para esta fecha.' };
  const severe = [];
  if ([95,96,97,99].includes(point.code)) severe.push('tormenta');
  if ([56,57,66,67,75,82,86].includes(point.code)) severe.push('precipitación intensa o helada');
  if (finite(point.feelsLike) !== null && point.feelsLike >= 35) severe.push('sensación térmica muy alta');
  if (finite(point.gust) !== null && point.gust >= 60) severe.push('ráfagas fuertes');
  if (finite(point.rain) !== null && point.rain >= (point.granularity === 'hour' ? 5 : 20)) severe.push('lluvia intensa');
  if (severe.length) return { level:'bad',label:'Mejor bajo techo',reason:severe.join(' · ') };
  const caution = [];
  if (finite(point.feelsLike) !== null && point.feelsLike >= 28) caution.push('calor');
  if (finite(point.temperature) !== null && point.temperature <= 5) caution.push('frío');
  if (finite(point.wind) !== null && point.wind >= 25 || finite(point.gust) !== null && point.gust >= 40) caution.push('viento');
  if (finite(point.rainProbability) !== null && point.rainProbability >= 50 || finite(point.rain) !== null && point.rain > 0 || [51,53,55,61,63,65,71,73,77,80,81,85].includes(point.code)) caution.push('lluvia o nieve');
  if ([45,48].includes(point.code)) caution.push('niebla');
  if (caution.length) return { level:'caution',label:'Revisá las condiciones',reason:caution.join(' · ') };
  if ([point.temperature, point.feelsLike, point.wind, point.gust, point.rainProbability, point.rain, point.code].some(value => finite(value) === null) || weatherDescription(point.code).label === 'Condición sin informar')
    return { level:'unknown',label:'Datos incompletos',reason:'No alcanza la información para orientar la salida.' };
  return { level:'good',label:'Condiciones favorables',reason:'Sin lluvia, calor o viento destacados en este pronóstico.' };
}
