const round = number => Math.round(number * 10) / 10;
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const number = (value, unit) => Number(unit === 'm' && /^\d{1,3}\.\d{3}$/.test(value) ? value.replace('.', '') : value.replace(',', '.'));

function readDistance(text) {
  const source = normalize(text);
  const explicit = source.match(/(?:total(?:\s+aprox(?:imado)?)?|distancia\s+total)\s*[:=≈]?\s*(\d+(?:[.,]\d+)?)\s*(km|k|m)\b/) ||
    source.match(/(\d+(?:[.,]\d+)?)\s*(km|k|m)\s*(?:en\s+)?total\b/);
  if (explicit) {
    const km = number(explicit[1], explicit[2]) / (explicit[2] === 'm' ? 1000 : 1);
    return { kilometers: round(km), total: true, parts: [{ label: explicit[0], kilometers: round(km) }], warning: '' };
  }
  const summary = source.match(/^\s*(\d+(?:[.,]\d+)?)\s*(km|k)\b[^+;()]*\(([^)]+)\)\s*$/);
  if (summary) {
    const breakdown = readDistance(summary[3]);
    const declared = number(summary[1], summary[2]);
    if (breakdown.kilometers !== null && Math.abs(breakdown.kilometers - declared) < .05) return breakdown;
    if (breakdown.parts.length && breakdown.parts.every(part => part.role !== 'work')) {
      return { kilometers: round(declared + breakdown.kilometers), parts: [{ label: summary[1] + summary[2], kilometers: declared, role: 'work' }, ...breakdown.parts], warning: '' };
    }
    return { kilometers: null, parts: [], warning: 'La distancia principal y el desglose no coinciden; revisá el total.' };
  }
  if (/\d+(?:[.,]\d+)?\s*(?:km|k|m)?\s*(?:[-–]|a|o)\s*\d+(?:[.,]\d+)?\s*(?:km|k|m)\b/.test(source)) {
    return { kilometers: null, parts: [], warning: 'La sesión indica un rango o alternativas de distancia; no se sumó automáticamente.' };
  }
  const regex = /(?<![\d:/.])\b(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(km|k|m)\b/gi;
  const parts = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(source))) {
    const following = source.slice(regex.lastIndex, regex.lastIndex + 16);
    // Distances in pace units and reference labels do not add running volume.
    if (/^\s*\//.test(following)) continue;
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const lineEnd = source.indexOf('\n', match.index);
    const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
    const separators = [...source.matchAll(/(?<!\d)\.|\.(?!\d)|[+;\n()]/g)].map(item => item.index);
    const segmentStart = (separators.filter(index => index < match.index).at(-1) ?? -1) + 1;
    const segmentEnd = separators.find(index => index >= regex.lastIndex) ?? source.length;
    const segment = source.slice(segmentStart, segmentEnd);
    if (/\b(?:objetivo|ritmo\s+(?:de\s+)?(?:5|10|15)|record|marca|referencia)\b/.test(segment) && !/\b(?:ec|vc|calentamiento|vuelta|series|rodaje)\b/.test(segment)) continue;
    const prefix = source.slice(Math.max(lineStart, match.index - 24), match.index);
    if (/\b(?:rec(?:uperacion)?|pausa)\s*[:=]?\s*$/.test(prefix)) {
      return { kilometers: null, parts: [], warning: 'Hay una recuperación en metros sin cantidad de repeticiones; revisá la distancia total.' };
    }
    // Repeated identical lines are descriptions of the same block.
    const identity = line + ':' + (match.index - lineStart);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const km = (match[1] ? Number(match[1]) : 1) * number(match[2], match[3]) / (match[3] === 'm' ? 1000 : 1);
    const role = /\b(?:vc|vuelta\s+a\s+la\s+calma|enfriamiento)\b/.test(segment) ? 'cooldown' : /\b(?:ec|entrada\s+en\s+calor|calentamiento)\b/.test(segment) ? 'warmup' : 'work';
    parts.push({ label: match[0], kilometers: round(km), role });
  }
  if (parts.length > 1 && !/[+\n;]/.test(source) && !/\b(?:ec|vc|calentamiento|vuelta|mas|luego|despues)\b/.test(source)) {
    return { kilometers: null, parts: [], warning: 'Se encontraron varias distancias sin un desglose claro; no se sumaron automáticamente.' };
  }
  return { kilometers: parts.length ? round(parts.reduce((sum, part) => sum + part.kilometers, 0)) : null, parts, warning: '' };
}

export function sessionDistance(title, description = '') {
  const main = readDistance(title);
  const detail = readDistance(description);
  let chosen;
  let source;
  if (main.total) { chosen = main; source = 'Total explícito del título'; }
  else if (detail.total) { chosen = detail; source = 'Total explícito de la descripción'; }
  else if (main.warning || detail.warning) {
    // A complete structured title remains usable when the detail is only guidance.
    if (main.parts.length > 1 && main.kilometers !== null && !main.warning) { chosen = main; source = 'Desglose del título'; }
    else { chosen = { kilometers: null, parts: [], warning: main.warning || detail.warning }; source = 'Revisar distancia'; }
  } else if (main.parts.length === 1 && main.parts[0].role === 'work' && detail.parts.length && detail.parts.every(part => part.role !== 'work')) {
    const parts = [...detail.parts.filter(part => part.role === 'warmup'), ...main.parts, ...detail.parts.filter(part => part.role === 'cooldown')];
    chosen = { kilometers: round(parts.reduce((sum, part) => sum + part.kilometers, 0)), parts, warning: '' }; source = 'Título + calentamiento y vuelta a la calma';
  } else if (detail.parts.length > 1 && (main.parts.length < 2 || detail.kilometers > main.kilometers)) {
    chosen = detail; source = 'Desglose de la descripción';
  } else if (main.kilometers !== null) { chosen = main; source = 'Distancias del título'; }
  else { chosen = detail; source = 'Distancias de la descripción'; }
  return { ...chosen, source };
}

export function estimateKilometers(text) {
  return readDistance(text).kilometers;
}
