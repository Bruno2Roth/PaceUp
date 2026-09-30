export function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function trainingKilometers(day) {
  return ['steady', 'controlled', 'hard'].includes(day.trainingColor) ? (day.kilometers || 0) : 0;
}

export function isActivity(day) {
  const kind = day.trainingColor || day.status?.kind;
  return ['steady', 'controlled', 'hard', 'easy', 'gym', 'planned'].includes(kind);
}

// This is a fixed historical import, never a rolling "before today" rule.
export const HISTORICAL_CUTOFF = '2026-09-30';
export function historicalSessionRecords(days) {
  return [...new Map(days.filter(day => isActivity(day) && dateKey(day.date) <= HISTORICAL_CUTOFF)
    .map(day => [dateKey(day.date), {
      date: dateKey(day.date), done: true, historicalCutoff: HISTORICAL_CUTOFF,
      planSignature: planSignature(day), planTitle: day.title, planDescription: day.description
    }])).values()];
}

export function weeklyLoad(days) {
  const unique = [...new Map(days.map(day => [dateKey(day.date), day])).values()];
  const buckets = new Map();
  unique.forEach(day => {
    const start = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const key = dateKey(start);
    if (!buckets.has(key)) buckets.set(key, { key, start, days: [], kilometers: 0, colors: { steady: 0, controlled: 0, hard: 0 }, counts: { steady: 0, controlled: 0, hard: 0 } });
    const week = buckets.get(key);
    week.days.push(day);
    const km = trainingKilometers(day);
    week.kilometers += km;
    if (Object.hasOwn(week.colors, day.trainingColor)) {
      week.colors[day.trainingColor] += km;
      week.counts[day.trainingColor] += 1;
    }
  });
  return [...buckets.values()].sort((a, b) => a.start - b.start).map((week, index, list) => {
    const end = new Date(week.start);
    end.setDate(end.getDate() + 6);
    const previous = list[index - 1];
    const adjacent = previous && dateKey(new Date(previous.start.getFullYear(), previous.start.getMonth(), previous.start.getDate() + 7)) === week.key;
    return { ...week, end, partial: week.days.length < 7,
      change: adjacent && week.days.length === 7 && previous.days.length === 7 && previous.kilometers > 0 ? (week.kilometers / previous.kilometers - 1) * 100 : null };
  });
}

export function planSignature(day) {
  return JSON.stringify([day.title, day.description, day.rawColor || '', day.kilometers]);
}

export function planChanged(day, record) {
  return Boolean(record?.planSignature && record.planSignature !== planSignature(day));
}
