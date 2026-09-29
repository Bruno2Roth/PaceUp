const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const DAY_HEADERS = [
  ["LUN", "MON"],
  ["MAR", "TUE"],
  ["MIE", "WED"],
  ["JUE", "THU"],
  ["VIE", "FRI"],
  ["SAB", "SAT"],
  ["DOM", "SUN"]
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function cellText(cell) {
  if (!cell) return "";
  const text = cell.text;
  if (text !== undefined && text !== null && String(text).trim() !== "") {
    return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value.richText) {
    return value.richText.map(part => part.text || "").join("").trim();
  }
  if (typeof value === "object" && value.text) return String(value.text).trim();
  return String(value).trim();
}

function getMonthIndex(sheetName) {
  const name = normalize(sheetName);
  return MONTHS.findIndex(month => name.includes(normalize(month)));
}

function findCalendarHeader(worksheet) {
  const lastRow = Math.min(worksheet.rowCount || 0, 40);
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let firstDayCol = 1; firstDayCol <= 18; firstDayCol += 1) {
      const matches = DAY_HEADERS.every((aliases, index) => {
        const header = normalize(cellText(row.getCell(firstDayCol + index)));
        return aliases.some(alias => header.startsWith(alias));
      });
      if (matches) return { headerRow: rowNumber, firstDayCol, weekLabelCol: firstDayCol - 1 };
    }
  }
  return null;
}

function isWeekLabel(value) {
  return /^(?:S|SEMANA)\s*0*\d{1,2}\b/i.test(String(value || "").trim());
}

function findWeekLabelColumn(worksheet) {
  const lastRow = Math.min(worksheet.rowCount || 0, 40);
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let col = 1; col <= 5; col += 1) {
      if (isWeekLabel(cellText(row.getCell(col)))) return col;
    }
  }
  return 1;
}

function getFillColor(cell) {
  const color = cell?.fill?.fgColor || cell?.fill?.bgColor;
  if (!color) return "";
  return String(color.argb || color.rgb || "").replace(/^#/, "").toUpperCase();
}

function extractDay(cell, year, monthIndex) {
  if (!cell || cell.value === null || cell.value === undefined || cell.value === "") return null;
  let dayNumber = null;
  let title = "";

  if (cell.value instanceof Date && !Number.isNaN(cell.value.valueOf())) {
    dayNumber = cell.value.getDate();
    title = cellText(cell);
  } else if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
    if (cell.value >= 20000 && cell.value <= 80000) {
      const serialDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(cell.value) * 86400000);
      if (serialDate.getUTCMonth() !== monthIndex) return null;
      return {
        date: new Date(serialDate.getUTCFullYear(), serialDate.getUTCMonth(), serialDate.getUTCDate()),
        title: ""
      };
    }
    dayNumber = Math.round(cell.value);
  } else {
    const lines = cellText(cell).split("\n").map(line => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    const match = lines[0].match(/^(\d{1,2})(?:[.)]?\s*|$)(.*)$/);
    if (!match) return null;
    dayNumber = Number(match[1]);
    const firstLineRemainder = (match[2] || "").trim();
    title = [firstLineRemainder, ...lines.slice(1)].filter(Boolean).join("\n");
  }

  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return null;
  const date = new Date(year, monthIndex, dayNumber);
  if (date.getMonth() !== monthIndex) return null;
  return { date, title };
}

export function estimateKilometers(text) {
  if (!text) return null;
  const expression = /(?:\b(\d+(?:[.,]\d+)?)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(km\b|k\b|m\b)/gi;
  let total = 0;
  let found = false;
  let match;
  while ((match = expression.exec(text)) !== null) {
    const multiplier = match[1] ? Number(match[1].replace(",", ".")) : 1;
    const distance = Number(match[2].replace(",", "."));
    const unit = match[3].toLowerCase();
    total += multiplier * (unit === "m" ? distance / 1000 : distance);
    found = true;
  }
  return found ? Math.round(total * 10) / 10 : null;
}

function classify(title, description, fillColor) {
  const text = normalize(title + " " + description);
  const titleText = normalize(title);
  const color = fillColor.slice(-6);

  if (color === "00FFFF" || /LESION|MOLESTIA/.test(titleText)) return { kind: "lesion", label: "Lesión" };
  if (color === "6D9EEB" || /VIAJE|CORDOBA|BARILOCHE/.test(text)) return { kind: "travel", label: "Viaje" };
  if (/DESC|DESCANSO/.test(text)) return { kind: "rest", label: "Descanso" };
  if (/GYM|GIMNASIO|FUERZA/.test(text)) return { kind: "gym", label: "Gimnasio" };
  if (color === "FF0000" || color === "E06666" || /CARRERA|TEST 5K|TEST 10K/.test(text)) return { kind: "hard", label: "Intenso" };
  if (color === "F6B26B") return { kind: "controlled", label: "Controlado" };
  if (color === "FFD966" || color === "FFFF00") return { kind: "steady", label: "Extensivo" };
  if (color === "93C47D" || color === "00FF00") return { kind: "easy", label: "Suave" };

  if (/VIAJE|✈/.test(text)) return { kind: "travel", label: "Viaje" };
  if (/LESION|MOLESTIA/.test(text)) return { kind: "lesion", label: "Lesión" };
  if (/REGENERATIVO|RECUPERACION/.test(text)) return { kind: "easy", label: "Regenerativo" };
  if (/EXTENSIVO/.test(text)) return { kind: "steady", label: "Extensivo" };
  if (/UMBRAL|INTENSIVO|SUPRA|PASADAS|SERIES|INTERVALOS|TEST|CARRERA/.test(text)) return { kind: "hard", label: "Calidad" };
  if (/HEBRAICA|CONTROLADO/.test(text)) return { kind: "controlled", label: "Controlado" };
  if (text.trim()) return { kind: "planned", label: "Planificado" };
  return { kind: "empty", label: "Sin sesión" };
}

function combineNotes(first, second) {
  const notes = [first, second].map(value => String(value || "").trim()).filter(Boolean);
  return [...new Set(notes)].join("\n");
}

function sourceYear(fileName) {
  const match = String(fileName || "").match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function sheetYear(sheetName, fallbackYear) {
  const match = String(sheetName || "").match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : fallbackYear;
}

function getWeekNumber(label) {
  const match = String(label || "").match(/(?:S|SEMANA)\s*0*(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function parseRunningWorkbook(workbook, fileName = "") {
  const year = sourceYear(fileName);
  const months = [];
  const weeks = [];
  const monthSheets = [];
  const sheetsWithoutCalendar = [];

  workbook.worksheets.forEach(worksheet => {
    const monthIndex = getMonthIndex(worksheet.name);
    if (monthIndex < 0) return;
    const yearForSheet = sheetYear(worksheet.name, year);
    monthSheets.push(worksheet.name);
    const header = findCalendarHeader(worksheet);
    const weekLabelCol = header?.weekLabelCol || findWeekLabelColumn(worksheet);
    const firstDayCol = header?.firstDayCol || weekLabelCol + 1;
    const firstWeekRow = header ? header.headerRow + 1 : 1;
    if (!header) sheetsWithoutCalendar.push(worksheet.name);
    months.push({ name: MONTHS[monthIndex], index: monthIndex, year: yearForSheet });

    for (let rowNumber = firstWeekRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const weekLabel = cellText(row.getCell(weekLabelCol));
      if (!isWeekLabel(weekLabel)) continue;

      const detailRow = worksheet.getRow(rowNumber + 1);
      const week = {
        id: worksheet.name + "-" + rowNumber,
        sheet: worksheet.name,
        month: MONTHS[monthIndex],
        monthIndex,
        year: yearForSheet,
        label: weekLabel.toUpperCase().replace(/\s+/g, ""),
        weekNumber: getWeekNumber(weekLabel),
        note: combineNotes(cellText(row.getCell(firstDayCol + 7)), cellText(detailRow.getCell(firstDayCol + 7))),
        days: []
      };

      for (let offset = 0; offset < 7; offset += 1) {
        const col = firstDayCol + offset;
        const mainCell = row.getCell(col);
        const detailCell = detailRow.getCell(col);
        const parsed = extractDay(mainCell, yearForSheet, monthIndex);
        if (!parsed) continue;
        const description = cellText(detailCell);
        const rawColor = getFillColor(mainCell);
        const status = classify(parsed.title, description, rawColor);
        const kilometers = estimateKilometers(parsed.title || description);
        week.days.push({
          id: week.id + "-" + col,
          date: parsed.date,
          weekday: offset,
          title: parsed.title || (description ? "Detalle del entrenamiento" : "Sin sesión cargada"),
          description,
          kilometers,
          status,
          rawColor
        });
      }
      week.days.sort((a, b) => a.date - b.date);
      if (week.days.length) weeks.push(week);
    }
  });

  months.sort((a, b) => a.year - b.year || a.index - b.index);
  weeks.sort((a, b) => a.days[0].date - b.days[0].date);
  const uniqueMonths = months.filter((month, index) =>
    months.findIndex(item => item.name === month.name && item.year === month.year) === index
  );
  return {
    months: uniqueMonths,
    weeks,
    year,
    diagnostics: {
      monthSheets,
      sheetsWithoutCalendar: [...new Set(sheetsWithoutCalendar)]
    }
  };
}
