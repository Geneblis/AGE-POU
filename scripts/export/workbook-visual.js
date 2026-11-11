// Visual do Excel: painel da aba Organograma Orçamentário (destaques, gráficos de rosca, ranking)
// e estilos da aba Orçamento. Os números vêm de xlsx.js; aqui só se monta layout, fórmulas do painel e gráficos.
import { XML, entry, escapeXml } from "./workbook-xml.js";
import { sectorColors } from "../models/organogram.js";

// Linhas reservadas ao painel no topo da aba (os detalhes mensais começam depois, recolhidos).
// 1–5 títulos e destaques, 6–22 gráficos, 24–25 cabeçalho da hierarquia, 26+ um setor por linha.
export const dashboardSize = model => 27 + model.organogram.boxes.length;
export const dashboardTitle = "Organograma Orçamentário — painel";

// Painel no topo da aba: destaques, duas roscas e hierarquia com ranking.
// Os valores seguem o ano em B3 via SUMIFS na tabela auxiliar oculta (Z:AF), que tem uma linha
// por setor e ano apontando para as linhas de detalhe. W:X guardam os valores positivos dos gráficos.
// Altera rows no lugar e devolve o que addCharts e sheetXml precisam (nós, faixa, barras, mesclas).
export function fillOrganogramDashboard(rows, model, yearlyRows) {
  const nodes = yearlyRows.get(model.targetYear), count = nodes.length, first = 26, last = 25 + count;
  const range = column => `$${column}$${first}:$${column}$${last}`;
  const positive = key => nodes.reduce((sum, node) => sum + Math.max(0, node[key]), 0);
  const expenses = positive("ownExpense"), revenues = positive("ownRevenue");
  const pick = (key, fn) => nodes.find(node => node[key] === Math[fn.toLowerCase()](...nodes.map(n => n[key])));
  const highlight = (label, key, column, fn) => [entry(label, 5),
    entry(pick(key, fn).name, 11, `TRIM(INDEX(${range("A")},MATCH(${fn}(${range(column)}),${range(column)},0)))`), "",
    entry(pick(key, fn)[key], 12, `${fn}(${range(column)})`)];
  rows[0] = [entry(dashboardTitle, 4)];
  rows[1] = [entry("Somente Realizado. Altere o ano em B3. Ranking e fatias usam valores próprios; colunas consolidadas somam os subordinados.", 9)];
  rows[2] = [entry("Ano", 5), entry(model.targetYear, 10), "", entry("Despesa própria total", 5), entry(nodes.reduce((n, node) => n + node.ownExpense, 0), 7, `SUM(${range("D")})`),
    entry("Receita própria total", 5), entry(nodes.reduce((n, node) => n + node.ownRevenue, 0), 7, `SUM(${range("G")})`)];
  for (const [row, label, key, column] of [[3, "despesa", "ownExpense", "D"], [4, "receita", "ownRevenue", "G"]]) {
    const [maxLabel, maxName, , maxValue] = highlight(`Maior ${label}`, key, column, "MAX");
    const [minLabel, minName, , minValue] = highlight(`Menor ${label}`, key, column, "MIN");
    rows[row] = [maxLabel, maxName, "", maxValue, minLabel, minName, minValue];
  }
  rows[23] = [entry("Hierarquia da empresa", 4)];
  rows[24] = ["Setor administrativo", "", "", "Despesa própria", "Despesa c/ subordinados", "Ranking despesa", "Receita própria", "Receita c/ subordinados", "Ranking receita", "Resultado consolidado", "% da despesa", "% da receita"].map(v => entry(v, 3));
  const helpers = [...yearlyRows].flatMap(([year, list]) => list.map(node => ({ year, ...node })));
  const end = helpers.length + 3;
  for (let i = 0; i < count; i++) {
    const node = nodes[i], r = i + first, helper = column => `SUMIFS($${column}$4:$${column}$${end},$AA$4:$AA$${end},$Y${r},$Z$4:$Z$${end},$B$3)`;
    const rank = (key, column) => entry(nodes.filter(other => other[key] > node[key]).length + 1, 10, `RANK(${column}${r},${range(column)},0)`);
    rows[r - 1] = [entry(`${"    ".repeat(node.depth)}${node.name}`, node.depth === 0 ? 5 : 0), "", "",
      entry(node.ownExpense, 6, helper("AB")), entry(node.expense, 7, helper("AC")), rank("ownExpense", "D"),
      entry(node.ownRevenue, 6, helper("AD")), entry(node.revenue, 7, helper("AE")), rank("ownRevenue", "G"),
      entry(node.result, 7, helper("AF")),
      entry(expenses ? Math.max(0, node.ownExpense) / expenses : 0, 2, `IF(SUM(${range("W")})=0,0,W${r}/SUM(${range("W")}))`),
      entry(revenues ? Math.max(0, node.ownRevenue) / revenues : 0, 2, `IF(SUM(${range("X")})=0,0,X${r}/SUM(${range("X")}))`)];
    rows[r - 1][22] = entry(Math.max(0, node.ownExpense), 1, `MAX(0,D${r})`);
    rows[r - 1][23] = entry(Math.max(0, node.ownRevenue), 1, `MAX(0,G${r})`);
    rows[r - 1][24] = node.id;
  }
  const fields = [["own", "Despesa", "ownExpense"], ["consolidated", "Despesa", "expense"], ["own", "Receita", "ownRevenue"], ["consolidated", "Receita", "revenue"], ["consolidated", "Resultado", "result"]];
  for (const [index, helper] of helpers.entries()) {
    const row = rows[index + 3] ??= [];
    row[25] = helper.year; row[26] = helper.id;
    for (const [offset, [kind, group, key]] of fields.entries()) row[27 + offset] = entry(helper[key], 1, `V${helper.refs[kind][group]}`);
  }
  const color = node => sectorColors[model.organogram.boxes.findIndex(box => box.id === node.id) % sectorColors.length];
  return { nodes: nodes.map(node => ({ ...node, color: color(node) })), first, last,
    bars: [["D", "B42318"], ["E", "B42318"], ["G", "0C7C75"], ["H", "0C7C75"]].map(([column, rgb]) => ({ ref: `${column}${first}:${column}${last}`, rgb })),
    merges: ["A1:L1", "A2:L2", "B4:C4", "B5:C5", "A24:L24", "A25:C25", ...nodes.map((_, i) => `A${i + first}:C${i + first}`)] };
}

// XML de um gráfico de rosca que lê nomes da coluna A e valores da coluna informada.
// O cache (strCache/numCache) faz o gráfico aparecer antes do primeiro recálculo.
function doughnut(title, nodes, key, column, first, last) {
  const points = nodes.map((node, i) => `<c:pt idx="${i}"><c:v>${escapeXml(node.name)}</c:v></c:pt>`).join("");
  const values = nodes.map((node, i) => `<c:pt idx="${i}"><c:v>${Math.max(0, node[key])}</c:v></c:pt>`).join("");
  const colors = nodes.map((node, i) => `<c:dPt><c:idx val="${i}"/><c:spPr><a:solidFill><a:srgbClr val="${node.color.slice(1)}"/></a:solidFill></c:spPr></c:dPt>`).join("");
  return `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:lang val="pt-BR"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="1400"/><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${colors}<c:cat><c:strRef><c:f>'Organograma Orçamentário'!$A$${first}:$A$${last}</c:f><c:strCache><c:ptCount val="${nodes.length}"/>${points}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>'Organograma Orçamentário'!$${column}$${first}:$${column}$${last}</c:f><c:numCache><c:formatCode>#,##0.00</c:formatCode><c:ptCount val="${nodes.length}"/>${values}</c:numCache></c:numRef></c:val></c:ser><c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/></c:dLbls><c:firstSliceAng val="270"/><c:holeSize val="55"/></c:doughnutChart></c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="0"/><c:dispBlanksAs val="zero"/></c:chart></c:chartSpace>`;
}

export const chartParts = ["chart1", "chart2"];

// Grava os dois gráficos, o desenho que os posiciona (linhas 6–22) e as relações com a aba 3.
export function addCharts(add, dashboard) {
  const { nodes, first, last } = dashboard;
  add("xl/charts/chart1.xml", doughnut("Despesas próprias por setor", nodes, "ownExpense", "W", first, last));
  add("xl/charts/chart2.xml", doughnut("Receitas próprias por setor", nodes, "ownRevenue", "X", first, last));
  const anchor = (id, from, to, name) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${from}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${to}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>22</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id + 1}" name="${name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="chart${id}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  add("xl/drawings/drawing1.xml", `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchor(1, 0, 5, "Despesas por setor")}${anchor(2, 5, 12, "Receitas por setor")}</xdr:wsDr>`);
  const relations = list => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([type, target, id]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;
  add("xl/drawings/_rels/drawing1.xml.rels", relations(chartParts.map((name, i) => ["chart", `../charts/${name}.xml`, `chart${i + 1}`])));
  add("xl/worksheets/_rels/sheet3.xml.rels", relations([["drawing", "../drawings/drawing1.xml", "drawing"]]));
}

// Estilo de cada célula da aba Orçamento conforme a linha (título, cabeçalho, total, subtotal, conta)
// e a coluna (descrição, Realizado, Projetado, Variação). Índices de estilo em workbook-xml.js.
export function styleBudget(rows) {
  return rows.map((row, index) => row.map((item, column) => {
    const cell = item && typeof item === "object" ? { ...item } : entry(item);
    if (index === 0) cell.style = 4;
    else if (index === 1) cell.style = 9;
    else if (index === 2) cell.style = 3;
    else {
      const type = row[0]?.value ?? row[0];
      if (["Total", "Resultado"].includes(type)) cell.style = column < 5 ? 5 : (column - 5) % 3 === 2 ? 14 : 7;
      else if (type === "Subtotal") cell.style = column < 5 ? 11 : (column - 5) % 3 === 2 ? 14 : 12;
      else cell.style = column < 5 ? (column === 3 ? 8 : 0) : (column - 5) % 3 === 2 ? 2 : (column - 5) % 3 === 1 ? 6 : 1;
    }
    return cell;
  }));
}
