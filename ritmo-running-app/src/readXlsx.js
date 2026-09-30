import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
  trimValues: false
});

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attribute(node, name) {
  if (!node || typeof node !== "object") return undefined;
  const direct = node["@_" + name];
  if (direct !== undefined) return direct;
  const key = Object.keys(node).find(item =>
    item.startsWith("@_") && item.slice(2).split(":").pop() === name
  );
  return key ? node[key] : undefined;
}

function nodeText(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node["#text"] !== undefined) return String(node["#text"]);
  return Object.entries(node)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, value]) => nodeText(value))
    .join("");
}

function parseXml(files, path, required = false) {
  const bytes = files[path];
  if (!bytes) {
    if (required) throw new Error("El archivo Excel no contiene " + path + ".");
    return null;
  }
  const text = strFromU8(bytes).replace(/^\uFEFF/, "");
  const parsed = xmlParser.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("No se pudo interpretar " + path + " dentro del Excel.");
  return parsed;
}

function colorFromFill(fill) {
  if (!fill || typeof fill !== "object") return "";
  const pattern = fill.patternFill || fill.gradientFill || fill;
  const color = pattern.fgColor || pattern.bgColor || fill.fgColor || fill.bgColor;
  if (!color) return "";
  return String(attribute(color, "rgb") || attribute(color, "argb") || "").toUpperCase();
}

function columnNumber(reference) {
  const letters = String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let number = 0;
  for (const letter of letters) number = number * 26 + letter.charCodeAt(0) - 64;
  return number;
}

function sharedStringValues(files) {
  const parsed = parseXml(files, "xl/sharedStrings.xml");
  const list = asArray(parsed?.sst?.si);
  return list.map(item => {
    if (item && typeof item === "object" && item.t !== undefined) return nodeText(item.t);
    if (item && typeof item === "object" && item.r !== undefined) return asArray(item.r).map(run => nodeText(run.t)).join("");
    return nodeText(item);
  });
}

function styleColors(files) {
  const parsed = parseXml(files, "xl/styles.xml");
  const root = parsed?.styleSheet || {};
  const fills = asArray(root.fills?.fill).map(colorFromFill);
  return asArray(root.cellXfs?.xf).map(style => {
    const fillId = Number(attribute(style, "fillId") || 0);
    return fills[fillId] || "";
  });
}

function readCell(cell, sharedStrings, colors) {
  const type = String(attribute(cell, "t") || "");
  const rawValue = nodeText(cell?.v);
  let value = rawValue;

  if (type === "s") {
    value = sharedStrings[Number(rawValue)] ?? "";
  } else if (type === "inlineStr") {
    value = nodeText(cell?.is);
  } else if (type === "b") {
    value = rawValue === "1";
  } else if (type === "e") {
    value = "";
  } else if (rawValue !== "" && Number.isFinite(Number(rawValue))) {
    value = Number(rawValue);
  } else if (rawValue === "") {
    value = "";
  }

  const styleIndex = Number(attribute(cell, "s") || 0);
  const color = colors[styleIndex] || "";
  return {
    value,
    text: value === null || value === undefined ? "" : String(value),
    fill: color ? { fgColor: { argb: color } } : undefined
  };
}

function resolveSheetPath(target) {
  const normalized = String(target || "").replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : "xl/" + normalized;
}

function makeWorksheet(name, path, files, sharedStrings, colors) {
  const xml = parseXml(files, path, true);
  const rows = new Map();
  const sheetRows = asArray(xml?.worksheet?.sheetData?.row);
  let rowCount = 0;

  for (const rowNode of sheetRows) {
    const rowNumber = Number(attribute(rowNode, "r") || 0);
    if (!rowNumber) continue;
    rowCount = Math.max(rowCount, rowNumber);
    const cells = new Map();
    for (const cellNode of asArray(rowNode.c)) {
      const col = columnNumber(attribute(cellNode, "r"));
      if (!col) continue;
      cells.set(col, readCell(cellNode, sharedStrings, colors));
    }
    rows.set(rowNumber, cells);
  }

  return {
    name,
    rowCount,
    getRow(rowNumber) {
      const row = rows.get(rowNumber) || new Map();
      return {
        getCell(col) {
          return row.get(col) || { value: null, text: "" };
        }
      };
    }
  };
}

export function readXlsx(arrayBuffer) {
  const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("No se pudo abrir el Excel. Comprobá que el archivo no esté dañado o protegido con contraseña.");
  }

  const workbookXml = parseXml(files, "xl/workbook.xml", true);
  const relationsXml = parseXml(files, "xl/_rels/workbook.xml.rels", true);
  const relations = asArray(relationsXml?.Relationships?.Relationship);
  const relationById = new Map(relations.map(relation => [
    String(attribute(relation, "Id") || ""),
    resolveSheetPath(attribute(relation, "Target"))
  ]));
  const sheetNodes = asArray(workbookXml?.workbook?.sheets?.sheet);
  if (!sheetNodes.length) throw new Error("No encontré hojas dentro del Excel.");

  const sharedStrings = sharedStringValues(files);
  const colors = styleColors(files);
  const worksheets = sheetNodes.map(sheet => {
    const name = String(attribute(sheet, "name") || "");
    const relationshipId = String(attribute(sheet, "id") || "");
    const path = relationById.get(relationshipId);
    if (!path) throw new Error("No se pudo localizar la pestaña " + name + " del Excel.");
    return makeWorksheet(name, path, files, sharedStrings, colors);
  });
  return { worksheets };
}
