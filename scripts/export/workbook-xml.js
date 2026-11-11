// Peças de XML do formato .xlsx (SpreadsheetML), sem biblioteca: endereços de célula,
// leitura de células e geração de abas e estilos. O ZIP fica com JSZip (scripts/vendor).
export const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Remove caracteres de controle proibidos em XML e escapa & < > " '.
export const escapeXml = value => String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export const decodeXml = value => String(value ?? "").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");

// Coluna por índice a partir de 0: columnName(0) → "A", columnName(26) → "AA".
export function columnName(index) {
  let name = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
// Inverso de columnName: columnNumber("AA12") → 26.
export const columnNumber = ref => [...ref.match(/^[A-Z]+/)[0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
// "2026-07" → "07/2026"
export const monthLabel = period => `${period.slice(5)}/${period.slice(0, 4)}`;

// Cabeçalho de mês da planilha → "AAAA-MM". Aceita data do Excel (número de dias desde 1899-12-30),
// "2026-07", "2026/7" e "07/2026". Outro texto → null.
export function parseMonth(value) {
  if (typeof value === "number" && value > 20000 && value < 100000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const match = String(value ?? "").match(/^(\d{4})[-/](0?[1-9]|1[0-2])(?:\D|$)/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}`;
  const br = String(value ?? "").match(/^(0?[1-9]|1[0-2])\/(\d{4})(?:\D|$)/);
  return br ? `${br[2]}-${br[1].padStart(2, "0")}` : null;
}

// Valor de uma célula conforme o atributo t: texto inline, texto compartilhado ("s"),
// texto de fórmula ("str") ou número (sem t). Vazio → null.
function cellValue(type, inner, shared) {
  if (type === "inlineStr") return [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1])).join("");
  const raw = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined || raw === "") return null;
  if (type === "s") return shared[Number(raw)];
  if (type === "str") return decodeXml(raw);
  return Number(raw);
}

// XML de uma aba → Map("B3" → { value, formula }). shared: textos de xl/sharedStrings.xml.
export function readCells(xml, shared = []) {
  const cells = new Map();
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = match[1].match(/\br="([^"]+)"/)?.[1];
    if (!ref) continue;
    const type = match[1].match(/\bt="([^"]+)"/)?.[1];
    const inner = match[2] ?? "";
    const formula = inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    cells.set(ref, { value: cellValue(type, inner, shared), formula: formula ? decodeXml(formula) : null });
  }
  return cells;
}

// XML de uma aba → matriz de valores [linha][coluna], a partir de 0.
export function readMatrix(xml, shared = []) {
  const rows = [];
  for (const [ref, cell] of readCells(xml, shared)) {
    const row = Number(ref.match(/\d+$/)[0]) - 1;
    rows[row] ??= [];
    rows[row][columnNumber(ref)] = cell.value;
  }
  return rows;
}

// Célula a gerar: valor (o resultado já calculado), estilo (índice em cellXfs) e fórmula opcional.
// O valor vai junto da fórmula para o arquivo abrir com números mesmo antes de recalcular.
export const entry = (value, style = 0, formula = null) => ({ value, style, formula });

function cellXml(item, ref) {
  const { value, style = 0, formula } = item && typeof item === "object" ? item : entry(item);
  const attr = `r="${ref}" s="${style}"`;
  if (formula) return `<c ${attr}${typeof value === "number" ? "" : ' t="str"'}><f>${escapeXml(formula)}</f><v>${typeof value === "number" ? value : escapeXml(value)}</v></c>`;
  if (value === null || value === undefined || value === "") return `<c ${attr}/>`;
  return typeof value === "number" ? `<c ${attr}><v>${value}</v></c>` : `<c ${attr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

// XML completo de uma aba. rows: matriz de entry() ou valores simples.
// layout: kind ("budget", "indices", "organogram"), merges, bars (barras de dados),
// detailStart (linhas recolhidas a partir daqui), years ("2025:2046", validação do ano em B3), startCell.
export function sheetXml(rows, widths = [], freeze = { x: 0, y: 0 }, layout = {}) {
  const cells = rows.map((values, i) => {
    const detail = layout.detailStart && i + 1 >= layout.detailStart;
    const height = i === 0 ? 36 : i === 2 || layout.kind === "indices" && i < 9 ? 42 : 32;
    return `<row r="${i + 1}" ht="${height}" customHeight="1"${detail ? ' hidden="1" outlineLevel="1"' : ""}>${values.map((item, j) => cellXml(item, `${columnName(j)}${i + 1}`)).join("")}</row>`;
  }).join("");
  const pane = freeze.x || freeze.y ? `<pane${freeze.x ? ` xSplit="${freeze.x}"` : ""}${freeze.y ? ` ySplit="${freeze.y}"` : ""} topLeftCell="${layout.startCell ?? `${columnName(freeze.x)}${freeze.y + 1}`}" activePane="${freeze.x && freeze.y ? "bottomRight" : freeze.y ? "bottomLeft" : "topRight"}" state="frozen"/>` : "";
  const merges = layout.merges?.length ? `<mergeCells count="${layout.merges.length}">${layout.merges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  const bars = layout.bars?.map((bar, i) => `<conditionalFormatting sqref="${bar.ref}"><cfRule type="dataBar" priority="${i + 1}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${bar.rgb}"/></dataBar></cfRule></conditionalFormatting>`).join("") ?? "";
  const years = layout.years?.split(":").map(Number);
  const validation = years ? `<dataValidations count="1"><dataValidation type="whole" operator="between" allowBlank="0" showErrorMessage="1" errorTitle="Ano inválido" error="Informe um ano dentro do planejamento." sqref="B3"><formula1>${years[0]}</formula1><formula2>${years[1]}</formula2></dataValidation></dataValidations>` : "";
  // Na aba do organograma, as colunas W em diante são auxiliares do painel e ficam ocultas.
  const columns = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${layout.kind === "organogram" && i >= 22 ? ' hidden="1"' : ""}/>`).join("")}</cols>` : "";
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><outlinePr summaryBelow="0"/><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="85">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="32" outlineLevelRow="1"/>${columns}<sheetData>${cells}</sheetData>${merges}${bars}${validation}<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${layout.kind === "organogram" ? '<drawing r:id="drawing"/>' : ""}</worksheet>`;
}

// Estilos. Cada estilo de célula (o "s" de entry) é [formato numérico, fonte, preenchimento]:
// formatos 0 geral, 10 percentual, 49 texto, 164 R$; fontes e preenchimentos pelos índices abaixo
// (preenchimento 0 e 1 são os padrões do Excel; 2 em diante são workbookFills).
//   0 texto                 1 R$                     2 percentual (fundo verde)
//   3 cabeçalho (azul)      4 título grande (azul)   5 rótulo em destaque
//   6 R$ (fundo azul-claro) 7 R$ em destaque         8 código como texto
//   9 nota cinza            10 negrito (fundo laranja) 11 negrito (fundo azul-claro)
//   12 R$ negrito (azul-claro) 13 texto editável (fundo laranja) 14 percentual negrito
const workbookFonts = [{ color: "10253F", size: 11 }, { color: "FFFFFF", size: 11, bold: true }, { color: "FFFFFF", size: 20, bold: true }, { color: "123A5A", size: 11, bold: true }, { color: "64748B", size: 10 }];
const workbookFills = ["123A5A", "EAF3F8", "FFF4E8", "E6F1EE", "D9E9F2"];
const workbookFormats = [
  [0, 0, 0], [164, 0, 0], [10, 0, 5], [0, 1, 2], [0, 2, 2],
  [0, 3, 6], [164, 0, 3], [164, 3, 6], [49, 0, 0], [0, 4, 0],
  [0, 3, 4], [0, 3, 3], [164, 3, 3], [0, 0, 4], [10, 3, 3],
];
export const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00;[Red](&quot;R$&quot; #,##0.00);&quot;R$&quot; 0.00"/></numFmts><fonts count="${workbookFonts.length}">${workbookFonts.map(font => `<font>${font.bold ? "<b/>" : ""}<sz val="${font.size}"/><color rgb="FF${font.color}"/><name val="Arial"/></font>`).join("")}</fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${workbookFills.map(color => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills><borders count="2"><border/><border><bottom style="hair"><color rgb="FFD9DFDF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${workbookFormats.length}">${workbookFormats.map(([number, font, fill]) => `<xf numFmtId="${number}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"${number === 0 || number === 49 ? ' wrapText="1"' : ' horizontal="right"'}/></xf>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
