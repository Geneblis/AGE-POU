// Excel do planejador: gera o .xlsx exportado e lê de volta tanto a planilha da empresa
// quanto um Excel gerado aqui. Abas geradas:
//   1 Orçamento                 Realizado, Projetado e Variação por conta e mês (fórmulas).
//   2 Índices                   índices editáveis a partir da linha 10.
//   3 Organograma Orçamentário  painel (workbook-visual.js) + detalhes mensais por setor.
//   4 Cálculo (oculta)          memória do cálculo padrão e da referência fixa.
//   5 _Planejador (oculta)      JSON do planejamento, em pedaços de 30.000 caracteres.
//   6 Despesas por setor       contas de despesa e percentuais diretos por setor administrativo.
//   7 Histórico anterior       meses excluídos do cenário, em uma aba oculta opcional.
// Ao reabrir, o JSON embutido é a fonte da verdade; as abas visíveis só trazem de volta
// números digitados. Fórmulas alteradas são recusadas.
import { nextMonth, previousMonth, budgetLayout, hasSemesterActivity, modelYears, periodValues, periodsForYear, projectionKind, standardAverage, usesHistoricalMedian, variance } from "../models/budget.js";
import { allocationIssues, organogramValues, parentIds } from "../models/organogram.js";
import { createProject, restoreProject } from "./planning.js";
import { XML, escapeXml, decodeXml, columnName, monthLabel, parseMonth, readCells, readMatrix, entry, sheetXml, styles } from "./workbook-xml.js";
import { dashboardSize, dashboardTitle, fillOrganogramDashboard, addCharts, chartParts, styleBudget } from "./workbook-visual.js";

// Estilos de célula (índices de workbook-xml.js): 1 dinheiro, 2 percentual, 3 cabeçalho, 13 texto editável.
// ponytail: Excel aceita até 255 argumentos por função; a base real usa no máximo 84. Agrupar em SUM(SUM(..),..) se crescer.
const sum = refs => refs.length ? `SUM(${refs.join(",")})` : "0";
// Soma que fica vazia quando todas as células estão vazias (mês sem Realizado não vira 0).
const sumOrBlank = refs => `IF(COUNT(${refs.join(",")})=0,"",${sum(refs)})`;
const amountSum = values => values.every(v => v === null) ? null : values.reduce((n, v) => n + (v ?? 0), 0);
const header = values => values.map(v => entry(v, 3));
// Forma comparável de uma fórmula: sem prefixo _xlfn., sem $ e sem aspas em nomes de aba.
const canonicalFormula = formula => (formula ?? "").replace(/_xlfn\./g, "").replaceAll("$", "").replace(/'((?:[^']|'')+)'!/g, (_, name) => `${name.replaceAll("''", "'")}!`);
// Excel e Calc serializam números com precisões diferentes; diferenças de centavos continuam inválidas.
const sameWorkbookValue = (a, b) => a === b || typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= Math.min(0.0001, Math.max(1e-8, Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)) * 8));
const cadenceLabels = { monthly: "Mensal", annual: "Anual" }, scopeLabels = { all: "Todos", group: "Grupo", sector: "Setor", account: "Conta" };
// Aceita também os códigos em inglês das exportações anteriores.
const fromLabel = (labels, text) => Object.keys(labels).find(key => key === text || labels[key] === text) ?? text;
const firstYearOf = model => Number(model.actualPeriods[0].slice(0, 4));

function projectionLabels(model) {
  const { historyStart, copyThrough = model.lastActual, resumeAt = model.forecastPeriods[0] } = model.projection ?? {};
  const limits = `Ir até ${monthLabel(nextMonth(copyThrough))} · Retomar em ${monthLabel(previousMonth(resumeAt))}`;
  return historyStart ? `Começar em ${monthLabel(historyStart)} · ${limits}` : limits;
}

// Fator de um índice num mês, em fórmula. Lê a linha do índice na aba Índices (linha 10 em diante),
// para que mudar a taxa no Excel recalcule o Projetado. Espelha variableFactor() de budget.js.
function variableFormula(variable, index, record, period) {
  const row = index + 10, ref = col => `'Índices'!$${col}$${row}`;
  const date = `DATE(${period.slice(0, 4)},${Number(period.slice(5))},1)`;
  const start = `DATE(VALUE(LEFT(${ref("F")},4)),VALUE(RIGHT(${ref("F")},2)),1)`;
  const end = `DATE(VALUE(LEFT(${ref("G")},4)),VALUE(RIGHT(${ref("G")},2)),1)`;
  const elapsed = `DATEDIF(${start},MIN(${date},${end}),"m")`;
  const scope = `OR(${ref("D")}="Todos",AND(${ref("D")}="Grupo",${ref("E")}="${record.group}"),AND(${ref("D")}="Setor",${ref("E")}="${escapeXml(record.sectorCode).replaceAll("&apos;", "'")}"),AND(${ref("D")}="Conta",${ref("E")}="${record.account}"))`;
  return `IF(AND(${ref("A")}="Sim",${date}>=${start},${scope}),POWER(1+${ref("C")}/100,IF(${ref("B")}="Anual",INT(${elapsed}/12)+1,${elapsed}+1)),1)`;
}

// Fórmula do Projetado de uma conta (null = célula fica com o valor, editável).
// - cópia: repete a célula do Realizado;
// - fixa: lê a referência inicial guardada na aba Cálculo;
// - dinâmica: projeção padrão da aba Cálculo × fator de cada índice. Edição manual fica como valor.
function projectedFormula(model, record, period, ref) {
  const mode = projectionKind(model, period);
  if (mode === "copy") return `IF(COUNT(${ref(record.account, period)})=0,"",${ref(record.account, period)})`;
  const calculationRow = model.records.indexOf(record) + 4, index = model.forecastPeriods.indexOf(period);
  if (mode === "fixed") return `'Cálculo'!${columnName(7 + model.forecastPeriods.length + index)}${calculationRow}`;
  if (Object.hasOwn(model.overrides, `${record.account}|${period}`)) return null;
  return `'Cálculo'!${columnName(7 + index)}${calculationRow}*${model.variables.map((v, i) => variableFormula(v, i, record, period)).join("*") || "1"}`;
}

// Aba Orçamento. Colunas A–E: Tipo, Grupo, Setor, Conta, Rubrica. Depois, 3 colunas por mês
// (Realizado, Projetado, Variação) e 3 de total anual. annualPlacement "interleaved" põe o total
// logo após dezembro; "legacy" (exportações antigas) põe todos os totais no fim.
// Devolve também ref(conta, mês, tipo), o endereço de cada célula, usado pelas outras abas.
function budgetData(model, annualPlacement = "interleaved", legacyVariance = false) {
  const periods = [...new Set(modelYears(model).flatMap(year => periodsForYear(model, year)))].sort();
  const layout = budgetLayout(model), recordRows = new Map(layout.flatMap((item, i) => item.record ? [[item.record.account, i + 4]] : []));
  const years = [...new Set(periods.map(p => p.slice(0, 4)))];
  const columns = annualPlacement === "legacy"
    ? [...periods.map(period => ({ period })), ...years.map(year => ({ year }))]
    : years.flatMap(year => [...periods.filter(period => period.startsWith(year)).map(period => ({ period })), { year }]);
  const periodColumns = new Map(columns.flatMap((item, index) => item.period ? [[item.period, 5 + index * 3]] : []));
  const ref = (account, period, kind = "actual") => `${columnName(periodColumns.get(period) + (kind === "projected" ? 1 : 0))}${recordRows.get(account)}`;
  function varianceCell(group, actual, projected, column, row) {
    const actualRef = `${columnName(column)}${row}`, projectedRef = `${columnName(column + 1)}${row}`;
    const inverted = legacyVariance && group === "Despesa";
    const difference = inverted ? `${projectedRef}-${actualRef}` : `${actualRef}-${projectedRef}`;
    const hasNoValues = legacyVariance ? `COUNT(${actualRef})=0` : `COUNT(${actualRef},${projectedRef})<2`;
    const formula = `IF(OR(${hasNoValues},${projectedRef}=0),0,(${difference})/ABS(${projectedRef}))`;
    const ratio = variance(actual, projected);
    return entry(inverted ? -ratio : ratio, 2, formula);
  }
  const rows = [[entry("Orçamento", 3)], [entry(projectionLabels(model))],
    header(["Tipo", "Grupo", "Setor", "Conta", "Rubrica", ...columns.flatMap(item => {
      const label = item.period ? monthLabel(item.period) : item.year;
      return [`${label} Realizado`, `${label} Projetado`, `${label} Variação`];
    })])];
  for (const [index, item] of layout.entries()) {
    const record = item.record, row = index + 4;
    const values = record ? [record.isReconciliation ? "Ajuste" : "Conta", record.group, record.sector, record.account, record.rubric] : [item.kind === "group" ? "Total" : "Subtotal", item.group, item.kind === "sector" ? item.label : "", "", item.label];
    for (const column of columns) {
      if (column.period) {
        // Mês: conta tem valor (Realizado) ou fórmula (Projetado); total e subtotal somam as contas.
        const period = column.period;
        const amounts = Object.fromEntries(["actual", "projected"].map(kind => [kind, amountSum(item.records.map(r => periodValues(model, r, period)[kind]))]));
        for (const kind of ["actual", "projected"]) {
          let formula = null;
          if (!record) formula = sumOrBlank(item.records.map(r => ref(r.account, period, kind)));
          else if (kind === "projected") formula = projectedFormula(model, record, period, ref);
          values.push(entry(amounts[kind], 1, formula));
        }
        const base = periodColumns.get(period);
        values.push(varianceCell(item.group, amounts.actual, amounts.projected, base, row));
      } else {
        // Total anual: soma as colunas mensais do ano na mesma linha.
        const yearly = periods.filter(period => period.startsWith(column.year));
        const amounts = ["actual", "projected"].map(kind => amountSum(item.records.flatMap(record => yearly.map(period => periodValues(model, record, period)[kind]))));
        const base = 5 + columns.indexOf(column) * 3;
        for (const offset of [0, 1]) {
          values.push(entry(amounts[offset], 1, sumOrBlank(yearly.map(period => `${columnName(periodColumns.get(period) + offset)}${row}`))));
        }
        values.push(varianceCell(item.group, amounts[0], amounts[1], base, row));
      }
    }
    rows.push(values);
  }
  // Última linha: RESULTADO = linha RECEITAS − linha DESPESAS, coluna a coluna.
  const groupRows = ["Receita", "Despesa"].map(g => layout.findIndex(item => item.kind === "group" && item.group === g) + 4);
  const result = ["Resultado", "", "", "", "RECEITA − DESPESA"], resultRow = rows.length + 1;
  for (let col = 5; col < rows[2].length; col++) {
    const a = rows[groupRows[0] - 1][col].value, b = rows[groupRows[1] - 1][col].value;
    const isVarianceColumn = (col - 5) % 3 === 2;
    if (isVarianceColumn) {
      result.push(varianceCell("Resultado", result[col - 2].value, result[col - 1].value, col - 2, resultRow));
    } else {
      const ra = `${columnName(col)}${groupRows[0]}`, rb = `${columnName(col)}${groupRows[1]}`;
      result.push(entry(a === null && b === null ? null : (a ?? 0) - (b ?? 0), 1, `IF(COUNT(${ra},${rb})=0,"",${ra}-${rb})`));
    }
  }
  rows.push(result);
  return { rows, periods, columns, recordRows, ref, periodColumns };
}

// Aba Cálculo (oculta): uma linha por conta, na ordem de model.records (linha = índice + 4).
// Colunas B–G: parcelas do ajuste mensal. Os blocos Dinâmico e Fixo são seguidos pelo histórico.
function trendCalculationData(model, budget) {
  const usesMedian = usesHistoricalMedian(model.forecastMethod);
  const usesActivity = model.forecastMethod === "trend";
  const { history, ranges } = usesMedian ? forecastHistoryLayout(model) : { history: [], ranges: new Map() };
  const activityColumn = columnName(7 + 2 * model.forecastPeriods.length + history.length);
  // As contas já estão ordenadas por setor. O intervalo também cobre linhas de ajuste, que ficam vazias.
  const sectorBounds = new Map();
  if (usesActivity) {
    for (const [index, record] of model.records.entries()) {
      const row = index + 4;
      const first = sectorBounds.get(record.sectorCode)?.[0] ?? row;
      sectorBounds.set(record.sectorCode, [first, row]);
    }
  }
  const rows = [[entry("Memória de cálculo", 3)], ["Base dinâmica e referência inicial fixa"], header(["Conta", "Variação rubrica", "Mediana setor", "Momentum", "Desvio padrão", "Limite", "Ajuste", ...model.forecastPeriods.map(p => `Dinâmico ${monthLabel(p)}`), ...model.forecastPeriods.map(p => `Fixo ${monthLabel(p)}`), ...history.map(p => `Realizado ${monthLabel(p)}`), ...(usesActivity ? ["Variação com movimento"] : [])])];
  for (const [index, record] of model.records.entries()) {
    const row = index + 4, c = record.calculation;
    const historyStart = model.projection?.historyStart;
    const actual = period => historyStart && period < historyStart ? "0" : `'Orçamento'!${budget.ref(record.account, period)}`;
    const h1 = year => Array.from({ length: 6 }, (_, m) => actual(`${year}-${String(m + 1).padStart(2, "0")}`));
    const current = h1(model.targetYear), prior = h1(model.targetYear - 1);
    let sectorFormula;
    if (usesActivity) {
      const [first, last] = sectorBounds.get(record.sectorCode);
      const range = first === last ? `${activityColumn}${first}` : `${activityColumn}${first}:${activityColumn}${last}`;
      sectorFormula = `IF(COUNT(${range}),MEDIAN(${range}),0)`;
    } else {
      const peers = model.records.flatMap((r, i) => r.sectorCode === record.sectorCode && !r.isReconciliation ? [`B${i + 4}`] : []);
      sectorFormula = peers.length ? `MEDIAN(${peers.join(",")})` : "0";
    }
    const secondary = `MEDIAN(0,C${row},D${row})`;
    // A fórmula atual conta células vazias como zero no desvio, assim como o cálculo no site.
    const semesters = [...prior, ...current];
    const deviationInputs = usesMedian ? semesters.map(ref => `N(${ref})`) : semesters;
    const values = [record.account, entry(c.rubricChange, 1, `(${sum(current)}-${sum(prior)})/6`), entry(c.sectorChange, 1, sectorFormula),
      entry(c.momentum, 1, `(${sum(current.slice(3))}-${sum(current.slice(0, 3))})/3`), entry(c.deviation, 1, `_xlfn.STDEV.P(${deviationInputs.join(",")})`),
      entry(c.deviation * 2, 1, `E${row}*2`), entry(c.adjustment, 1, `B${row}+IF(F${row}<=0.01,${secondary},MIN(F${row},MAX(-F${row},${secondary})))`)];
    const recentHistory = model.forecastHistory.slice(-12);
    const fallback = recentHistory.length ? `MAX(0,${sum(recentHistory.map(actual))}/${recentHistory.length})` : "0";
    for (const period of model.forecastPeriods) {
      const previous = `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
      const previousIndex = model.forecastPeriods.indexOf(previous);
      if (previousIndex < 0) {
        if (usesMedian) {
          const bounds = ranges.get(period.slice(5));
          const range = bounds ? forecastHistoryRange(bounds, row) : null;
          const formula = range ? `IF(COUNT(${range}),MAX(0,MEDIAN(${range})+$G${row}),${fallback})` : fallback;
          values.push(entry(record.forecast[period], 1, formula));
          continue;
        }
        if (model.forecastMethod === "historical-average" && !Object.hasOwn(record.actuals, previous)) {
          values.push(entry(record.forecast[period], 1, fallback));
          continue;
        }
      }
      const ref = previousIndex >= 0 ? `${columnName(7 + previousIndex)}${row}` : actual(previous);
      values.push(entry(record.forecast[period], 1, `MAX(0,${ref}+$G${row})`));
    }
    for (const period of model.forecastPeriods) values.push(entry(projectionKind(model, period) === "fixed" ? record.final[period] : null, 1));
    for (const period of history) values.push(forecastHistoryEntry(model, budget, record, period));
    if (usesActivity && !record.isReconciliation) {
      const hasMovement = hasSemesterActivity(record, model.targetYear);
      const conditions = deviationInputs.map(ref => `${ref}<>0`).join(",");
      values.push(entry(hasMovement ? c.rubricChange : null, 1, `IF(OR(${conditions}),B${row},"")`));
    }
    rows.push(values);
  }
  return rows;
}

// Aba Índices: explicação nas linhas 1–8, cabeçalho na 9 e um índice por linha a partir da 10.
// Agrupa o Realizado por mês do calendário para que as fórmulas usem intervalos contínuos.
function forecastHistoryLayout({ forecastPeriods, forecastHistory }) {
  const months = [...new Set(forecastHistory.map(period => period.slice(5)))].sort();
  const history = [];
  const ranges = new Map();
  const historyStartColumn = 7 + 2 * forecastPeriods.length;
  for (const month of months) {
    const firstColumn = historyStartColumn + history.length;
    history.push(...forecastHistory.filter(period => period.slice(5) === month));
    ranges.set(month, [firstColumn, historyStartColumn + history.length - 1]);
  }

  return { history, ranges, historyStartColumn };
}

function forecastHistoryRange([first, last], row) {
  return `${columnName(first)}${row}:${columnName(last)}${row}`;
}

function forecastHistoryEntry(model, budget, record, period) {
  const cell = `'Orçamento'!${budget.ref(record.account, period)}`;
  return entry(periodValues(model, record, period).actual, 1, `IF(COUNT(${cell}),${cell},"")`);
}

function calculationData(model, budget) {
  if (model.forecastMethod !== "seasonal") return trendCalculationData(model, budget);
  const { forecastPeriods } = model;
  const { history, ranges, historyStartColumn } = forecastHistoryLayout(model);
  const rows = [[entry("Memória de cálculo", 3)], ["Média por mês do Realizado anterior à projeção"], header([
    "Conta", "", "", "", "", "", "",
    ...forecastPeriods.map(period => `Dinâmico ${monthLabel(period)}`),
    ...forecastPeriods.map(period => `Fixo ${monthLabel(period)}`),
    ...history.map(period => `Realizado ${monthLabel(period)}`),
  ])];
  for (const [index, record] of model.records.entries()) {
    const row = index + 4;
    const allHistory = history.length ? forecastHistoryRange([historyStartColumn, historyStartColumn + history.length - 1], row) : null;
    const fallback = allHistory ? `IF(COUNT(${allHistory}),MAX(0,AVERAGE(${allHistory})),0)` : "0";
    const values = [record.account, "", "", "", "", "", ""];
    for (const period of forecastPeriods) {
      const bounds = ranges.get(period.slice(5));
      const sameMonth = bounds ? forecastHistoryRange(bounds, row) : null;
      const formula = sameMonth ? `IF(COUNT(${sameMonth}),MAX(0,AVERAGE(${sameMonth})),${fallback})` : fallback;
      values.push(entry(record.forecast[period], 1, formula));
    }
    for (const period of forecastPeriods) {
      values.push(entry(projectionKind(model, period) === "fixed" ? record.final[period] : null, 1));
    }
    for (const period of history) values.push(forecastHistoryEntry(model, budget, record, period));
    rows.push(values);
  }
  return rows;
}

function indicesData(model) {
  const rows = [[entry("Índices", 3)], ["Edite a partir da linha 10. Ativa: Sim/Não. Datas: AAAA-MM."],
    [projectionLabels(model)],
    ["Índices acumulam durante a vigência e mantêm o fator após o fim."],
    [], [], [],
    [`Média padrão ${model.targetYear}`, entry(standardAverage(model, model.targetYear), 1)],
    header(["Ativa", "Periodicidade", "Taxa (%)", "Escopo", "Alvo", "Início", "Fim", "Nome"])];
  for (const v of model.variables) rows.push([v.active ? "Sim" : "Não", cadenceLabels[v.cadence], v.rate, scopeLabels[v.scope], v.target, v.start, v.end, v.name].map(value => entry(value, 13)));
  return rows;
}

// Aba Organograma Orçamentário. O topo (dashboardSize linhas) é o painel; abaixo, um bloco por ano
// com três linhas (Receita, Despesa, Resultado) para cada vínculo, valor próprio e consolidado de cada setor.
// Colunas A–I descrevem a linha; da J em diante, um mês por coluna e o total do ano.
function organogramData(model, budget) {
  const rows = Array.from({ length: dashboardSize(model) }, () => []);
  rows.push([entry("Organograma Orçamentário — somente Realizado", 3)], ["Percentuais diretos por origem; consolidação sem nova atribuição percentual."]);
  const yearlyRows = new Map();
  for (let year = firstYearOf(model); year <= model.endYear; year++) {
    const data = organogramValues(model.organogram, model, year), refs = new Map();
    rows.push(header(["Setor administrativo", "Nível", "Superiores", "Tipo", "Origem", "Descrição", "Percentual", "Subtotal", "Grupo", ...data.periods.map(monthLabel), `Total ${year}`]));
    for (const node of data.nodes) {
      // Linhas de cada parte do setor, por grupo: { Receita: nº da linha, Despesa: ..., Resultado: ... }.
      const nodeRefs = { links: [], own: {}, consolidated: {} };
      refs.set(node.id, nodeRefs);
      for (const part of [...node.links.map(link => ({ kind: "link", link, values: link.values })), { kind: "own", values: node.own }, { kind: "consolidated", values: node.consolidated }]) {
        const groupRefs = {};
        for (const group of ["Receita", "Despesa", "Resultado"]) {
          const row = rows.length + 1;
          groupRefs[group] = row;
          const link = part.link;
          const superiors = parentIds(node).map(id => model.organogram.boxes.find(b => b.id === id)?.name).filter(Boolean).join(" · ");
          const values = [`${"  ".repeat(node.depth)}${node.name}`, node.depth, superiors, link ? (link.type === "account" ? "Conta" : "Setor") : "", link?.origin ?? "", link?.description ?? "", link ? entry(link.percent / 100, 2) : "", { link: "Vínculo direto", own: "Próprio", consolidated: "Consolidado" }[part.kind], group];
          for (const [i, period] of data.periods.entries()) {
            const column = columnName(9 + i);
            let formula;
            // Vínculo: soma do Realizado das contas da origem × percentual (coluna G).
            // Próprio: soma dos vínculos. Resultado: Receita − Despesa.
            if (group === "Resultado") formula = `${column}${groupRefs.Receita}-${column}${groupRefs.Despesa}`;
            else if (link) {
              const records = model.records.filter(r => r.group === group && (link.type === "account" ? r.account === link.origin : r.sectorCode === link.origin));
              formula = `${sum(records.map(r => `'Orçamento'!${budget.ref(r.account, period)}`))}*$G${row}`;
            } else if (part.kind === "own") formula = sum(nodeRefs.links.map(ref => `${column}${ref[group]}`));
            // As referências das filhas são resolvidas após todas as linhas existirem.
            values.push(entry(part.values[period][group], 1, formula ?? "0"));
          }
          values.push(entry(data.periods.reduce((n, p) => n + part.values[p][group], 0), 1, sum(data.periods.map((_, i) => `${columnName(9 + i)}${row}`))));
          rows.push(values);
        }
        if (part.kind === "link") nodeRefs.links.push(groupRefs); else nodeRefs[part.kind] = groupRefs;
      }
    }
    // Consolidado = soma dos vínculos próprios de cada setor alcançado, sem duplicar
    // um setor que aparece por mais de um caminho de superiores.
    for (const node of data.nodes) for (const group of ["Receita", "Despesa"]) {
      const own = refs.get(node.id);
      const members = node.members ?? [node.id];
      for (const [i] of data.periods.entries()) rows[own.consolidated[group] - 1][9 + i].formula = sum(members.map(id => `${columnName(9 + i)}${refs.get(id).own[group]}`));
    }
    yearlyRows.set(year, data.nodes.map(node => ({ id: node.id, name: node.name, depth: node.depth, ownExpense: node.totals.own.Despesa, ownRevenue: node.totals.own.Receita,
      expense: node.totals.consolidated.Despesa, revenue: node.totals.consolidated.Receita, result: node.totals.consolidated.Resultado, refs: refs.get(node.id) })));
    for (const group of ["Receita", "Despesa", "Resultado"]) {
      const row = rows.length + 1, roots = data.nodes.filter(n => parentIds(n).length === 0), members = [...new Set(roots.flatMap(n => n.members ?? [n.id]))];
      rows.push(["TOTAL GERAL", "", "", "", "", "", "", "Consolidado das raízes", group,
        ...data.periods.map((p, i) => entry(data.total[p][group], 1, sum(members.map(id => `${columnName(9 + i)}${refs.get(id).own[group]}`)))),
        entry(data.periods.reduce((n, p) => n + data.total[p][group], 0), 1, sum(data.periods.map((_, i) => `${columnName(9 + i)}${row}`)))]);
    }
  }
  return { rows, dashboard: fillOrganogramDashboard(rows, model, yearlyRows) };
}

// As cinco abas, na ordem do arquivo. Também usado na leitura para comparar fórmulas.
function expenseAllocationData(model) {
  const rows = [header(["Conta", "Despesa", "Setor da base", "Setor administrativo", "Percentual"])];
  for (const record of model.records.filter(record => record.group === "Despesa")) {
    const percentages = new Map();
    for (const link of model.organogram.links) {
      if (link.type === "account" ? link.origin === record.account : link.origin === record.sectorCode) {
        percentages.set(link.box, (percentages.get(link.box) ?? 0) + link.percent);
      }
    }
    for (const box of model.organogram.boxes) {
      const percent = percentages.get(box.id);
      if (percent > 0) rows.push([entry(record.account, 8), record.rubric, record.sector, box.name, entry(percent / 100, 2)]);
    }
  }
  return rows;
}

function historicalSheet(model) {
  const historyStart = model.projection?.historyStart;
  if (!historyStart) return null;
  const periods = model.availableActualPeriods.filter(period => period < historyStart);
  if (!periods.length) return null;
  const rows = [
    [entry("Histórico anterior", 3)],
    [`Meses anteriores a ${monthLabel(historyStart)}, fora do cenário.`],
    header(["Conta", "Descrição", ...periods.map(monthLabel)]),
  ];
  for (const row of model.rows) {
    rows.push([row.account, row.rubric, ...periods.map(period => {
      const key = `${row.account}|${period}`;
      return entry(model.actualOverrides[key] ?? row.values[period] ?? null, 1);
    })]);
  }
  return { name: "Histórico anterior", visibility: "hidden", rows, widths: [23, 56, ...periods.map(() => 18)], freeze: { x: 2, y: 3 } };
}

function workbookSheets(model, sourceName = "", annualPlacement = "interleaved", legacyVariance = false) {
  const budget = budgetData(model, annualPlacement, legacyVariance), project = createProject(model, sourceName);
  const startPeriod = budget.periods.find(period => period.startsWith(`${model.targetYear}-`));
  const organogram = organogramData(model, budget);
  const metadata = JSON.stringify(project), metadataRows = [[`orca-planejamento-v${project.version}`]];
  // Uma célula guarda no máximo 32.767 caracteres: o JSON vai em pedaços.
  for (let i = 0; i < metadata.length; i += 30000) metadataRows.push([metadata.slice(i, i + 30000)]);
  return [
    { name: "Orçamento", rows: styleBudget(budget.rows), widths: [12, 14, 36, 23, 62, ...budget.columns.flatMap(() => [22, 22, 16])], freeze: { x: 5, y: 3 }, layout: { kind: "budget", merges: ["A1:E1", "A2:E2"], startCell: `${columnName(budget.periodColumns.get(startPeriod))}4` } },
    { name: "Índices", rows: indicesData(model), widths: [32, 36, 16, 20, 24, 16, 16, 42], layout: { kind: "indices", merges: ["A1:H1", "A2:H2", "A3:H3", "A4:H4", "B5:H5", "B6:H6", "B7:H7"] } },
    { name: "Organograma Orçamentário", rows: organogram.rows, dashboard: organogram.dashboard, widths: [38, 12, 30, 24, 26, 42, 26, 24, 16, ...Array(13).fill(20), ...Array(10).fill(16)], freeze: { x: 0, y: 3 }, layout: { kind: "organogram", merges: organogram.dashboard.merges, bars: organogram.dashboard.bars, detailStart: dashboardSize(model) + 1, years: `${firstYearOf(model)}:${model.endYear}` } },
    { name: "Cálculo", visibility: "veryHidden", rows: calculationData(model, budget) },
    { name: "_Planejador", visibility: "veryHidden", rows: metadataRows },
    { name: "Despesas por setor", rows: expenseAllocationData(model), widths: [24, 62, 42, 62, 18], freeze: { x: 2, y: 1 } },
  ];
}

// Arquivos de "pacote" do .xlsx (o Excel é um ZIP de XMLs): tipos, relações e lista de abas.
function contentTypesXml(sheets) {
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${chartParts.map(name => `<Override PartName="/xl/charts/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")}<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
}

// Só a aba de consulta do histórico usa "hidden" para permitir reexibição no Excel.
function workbookXml(sheets) {
  return `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.visibility ? ` state="${s.visibility}"` : ""}/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
}

function workbookRelationsXml(sheets) {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

// Gera o .xlsx (bytes). Toda conta precisa somar 100% na precisão exibida (duas casas).
export async function createBudgetWorkbook(model, metadata = {}, Zip = globalThis.JSZip) {
  if (!Zip) throw new Error("O gerador de Excel não foi carregado.");
  // Passa pelo mesmo caminho de salvar e reabrir: o Excel nasce de entradas validadas.
  const checked = restoreProject(createProject(model, metadata.sourceName)).model;
  const issues = allocationIssues(checked.organogram, checked);
  if (issues.length) throw new Error(`Distribua todas as contas e ajustes em 100%. ${issues.map(i => `${i.account}: ${i.percent}%`).join("; ")}`);
  const annualPlacement = metadata.annualPlacement === "legacy" ? "legacy" : "interleaved";
  const sheets = workbookSheets(checked, metadata.sourceName, annualPlacement), zip = new Zip();
  const history = historicalSheet(checked);
  if (history) sheets.push(history);
  const add = (path, content) => zip.file(path, content, { createFolders: false });
  add("[Content_Types].xml", contentTypesXml(sheets));
  add("_rels/.rels", `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add("xl/workbook.xml", workbookXml(sheets));
  add("xl/_rels/workbook.xml.rels", workbookRelationsXml(sheets));
  add("xl/styles.xml", styles);
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths, s.freeze, s.layout)));
  addCharts(add, sheets[2].dashboard);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

// Abre o ZIP e devolve: textos compartilhados, mapa nome da aba → caminho e read(nome) → XML da aba.
async function openWorkbook(file, Zip) {
  const zip = await Zip.loadAsync(typeof file?.arrayBuffer === "function" ? await file.arrayBuffer() : file);
  const book = await zip.file("xl/workbook.xml")?.async("string"), relations = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!book || !relations) throw new Error("Arquivo XLSX inválido.");
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") ?? "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => decodeXml(t[1])).join(""));
  const paths = new Map([...relations.matchAll(/<Relationship\b([^>]+)\/>/g)].map(m => [m[1].match(/\bId="([^"]+)"/)?.[1], m[1].match(/\bTarget="([^"]+)"/)?.[1]]));
  const sheets = new Map([...book.matchAll(/<sheet\b([^>]+)\/>/g)].map(m => [decodeXml(m[1].match(/\bname="([^"]+)"/)?.[1]), paths.get(m[1].match(/\br:id="([^"]+)"/)?.[1])]));
  const read = async name => {
    const path = sheets.get(name)?.replace(/^\//, "");
    const xml = path && await zip.file(path.startsWith("xl/") ? path : `xl/${path.replace(/^\.\.\//, "")}`)?.async("string");
    if (!xml) throw new Error(`Aba obrigatória ausente: ${name}.`);
    return xml;
  };
  return { zip, shared, sheets, read };
}

// Índices editados na aba Índices (linha 10 em diante; linha sem nome é ignorada).
function readIndexRows(matrix) {
  return matrix.slice(9).filter(row => row?.[7]).map((r, i) => {
    if (!["Sim", "Não"].includes(r[0])) throw new Error(`Ativação inválida no índice da linha ${i + 10}.`);
    return { id: `excel-${i}`, active: r[0] === "Sim", cadence: fromLabel(cadenceLabels, r[1]), rate: r[2], scope: fromLabel(scopeLabels, r[3]), target: String(r[4] ?? ""), start: parseMonth(r[5]), end: parseMonth(r[6]), name: String(r[7]) };
  });
}

// Traz de volta os números digitados na aba Orçamento como edições manuais do planejamento.
// Células com fórmula são ignoradas; Projetado de cópia ou faixa fixa não pode mudar.
function readBudgetEdits(cells, budget, model, project) {
  for (const record of model.records) {
    const row = budget.recordRows.get(record.account);
    if (cells.get(`D${row}`)?.value !== record.account) throw new Error("A estrutura de contas foi alterada.");
    for (const period of budget.periods) for (const kind of ["actual", "projected"]) {
      const key = `${record.account}|${period}`, cell = cells.get(budget.ref(record.account, period, kind));
      if (cell?.formula) continue;
      if (kind === "projected" && projectionKind(model, period) !== "dynamic") {
        if (!sameWorkbookValue(cell?.value ?? null, periodValues(model, record, period).projected)) throw new Error("Projetado de cópia ou período fixo foi alterado.");
        continue;
      }
      const overrides = kind === "actual" ? project.actualOverrides : project.overrides;
      const amount = cell?.value;
      if (amount !== null && amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount))) throw new Error(`Valor inválido em ${budget.ref(record.account, period, kind)}.`);
      if (amount === null || amount === undefined) delete overrides[key];
      else if (kind === "projected" || amount !== (record.actuals[period] ?? null)) overrides[key] = amount;
    }
  }
}

// Compara cada aba do arquivo com a que seria gerada hoje: toda fórmula precisa ser igual.
// Nas abas Cálculo e Organograma, os valores fixos também (exceto o ano em B3 e o cabeçalho antigo "Caixinha").
async function checkSheets(workbook, expected, model) {
  for (const sheet of expected.filter(s => s.name !== "_Planejador")) {
    const actual = readCells(await workbook.read(sheet.name), workbook.shared);
    const original = readCells(sheetXml(sheet.rows), []);
    for (const [ref, cell] of actual) if (cell.formula && canonicalFormula(cell.formula) !== canonicalFormula(original.get(ref)?.formula)) throw new Error(`Fórmula alterada: ${sheet.name}!${ref}.`);
    if (!["Cálculo", "Organograma Orçamentário"].includes(sheet.name)) continue;
    for (const [ref, cell] of original) {
      const observed = actual.get(ref);
      const legacyHeader = sheet.name === "Organograma Orçamentário" && cell.value === "Setor administrativo" && observed?.value === "Caixinha";
      const viewYear = sheet.name === "Organograma Orçamentário" && ref === "B3" && Number.isInteger(observed?.value) && observed.value >= firstYearOf(model) && observed.value <= model.endYear;
      if (cell.formula ? !observed?.formula : !sameWorkbookValue(cell.value, observed?.value ?? null) && !legacyHeader && !viewYear) throw new Error(`Estrutura ou referência inicial alterada: ${sheet.name}!${ref}.`);
    }
  }
}

// Excel gerado pelo planejador: restaura o JSON embutido e aplica o que foi digitado nas abas.
async function readPlannerWorkbook(workbook) {
  const { sheets, shared, read, zip } = workbook;
  const input = JSON.parse(sheets.has("_Planejador") ? readMatrix(await read("_Planejador"), shared).slice(1).map(row => row?.[0] ?? "").join("") : await zip.file("planejador.json").async("string"));
  let forecastMethod;
  if (input.version === 5 || input.version === 6) {
    forecastMethod = "unfiltered-trend";
  } else if (input.version === 4) {
    forecastMethod = "seasonal";
  } else if (input.version === 3) {
    const calculationCells = sheets.has("Cálculo") ? readCells(await read("Cálculo"), shared) : new Map();
    const usesHistoricalAverage = [...calculationCells.values()].some(cell => cell.formula?.startsWith("MAX(0,SUM("));
    forecastMethod = input.projection?.historyStart || usesHistoricalAverage ? "historical-average" : "legacy-trend";
  }
  const legacyCutoff = input.version >= 3 && input.version < 6;
  const restored = restoreProject(input, forecastMethod, legacyCutoff);
  // Versões 1 e 2: só o JSON é usado.
  if (input.version < 3) return { ...restored.project.source, planning: restored.project };
  // Layouts anteriores do painel não são conferidos: a aba só exibe valores derivados de _Planejador.
  const currentLayout = readCells(await read("Organograma Orçamentário"), shared).get("A1")?.value === dashboardTitle;
  const cells = readCells(await read("Orçamento"), shared);
  // Descobre onde estão os totais anuais procurando o cabeçalho "<primeiro ano> Realizado".
  const interleavedBudget = budgetData(restored.model);
  const legacyBudget = budgetData(restored.model, "legacy");
  const firstYear = restored.model.actualPeriods[0].slice(0, 4);
  const annualHeaderRef = budget => `${columnName(5 + budget.columns.findIndex(column => column.year === firstYear) * 3)}3`;
  const annualHeader = `${firstYear} Realizado`;
  const interleavedLayout = cells.get(annualHeaderRef(interleavedBudget))?.value === annualHeader;
  const legacyLayout = cells.get(annualHeaderRef(legacyBudget))?.value === annualHeader;
  if (!interleavedLayout && !legacyLayout) throw new Error("A estrutura anual da aba Orçamento foi alterada.");
  const annualPlacement = interleavedLayout ? "interleaved" : "legacy";
  // As exportações até a versão 7 invertiam a variação em Despesa.
  const expected = workbookSheets(restored.model, "", annualPlacement, input.version <= 7).filter(s => (currentLayout || s.name !== "Organograma Orçamentário") && (s.name !== "Despesas por setor" || sheets.has(s.name)));
  const budget = annualPlacement === "interleaved" ? interleavedBudget : legacyBudget;
  const variables = readIndexRows(readMatrix(await read("Índices"), shared));
  const project = restored.project;
  readBudgetEdits(cells, budget, restored.model, project);
  await checkSheets(workbook, expected, restored.model);
  project.variables = variables;
  const final = restoreProject(project).project;
  return { ...final.source, planning: final };
}

// Planilha da empresa: aba "Dados Analíticos" com Novo Cosif (ou Conta COSIF/Interna),
// Descrição e uma coluna por mês. Devolve só as linhas de receita e despesa.
async function readSourceWorkbook({ sheets, shared, read }) {
  const source = [...sheets.keys()].find(name => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "dados analiticos");
  if (!source) throw new Error("A aba obrigatória Dados Analíticos não foi encontrada.");
  const matrix = readMatrix(await read(source), shared), headers = matrix[0] ?? [];
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const accountColumn = headers.findIndex(v => ["novo cosif", "conta cosif/interna"].includes(normalize(v))), description = headers.findIndex(v => normalize(v) === "descricao");
  if (accountColumn < 0 || description < 0) throw new Error("A aba deve conter Novo Cosif (ou Conta COSIF/Interna) e Descrição.");
  const columns = headers.flatMap((v, i) => parseMonth(v) ? [{ index: i, period: parseMonth(v) }] : []);
  const rows = matrix.slice(1).flatMap((r, i) => {
    const account = String(r?.[accountColumn] ?? "").replace(/\.0$/, "").trim(), rubric = String(r?.[description] ?? "").trim();
    if (!/^[78]\d+$/.test(account) || ![10, 14].includes(account.length) || !rubric) return [];
    return [{ sourceRow: i + 2, account, rubric, values: Object.fromEntries(columns.map(c => [c.period, typeof r[c.index] === "number" && Number.isFinite(r[c.index]) ? r[c.index] : null])) }];
  });
  if (!rows.length) throw new Error("Nenhuma conta válida de receita ou despesa foi encontrada.");
  return { sheetName: source, rows, periods: columns.map(c => c.period) };
}

// Lê um .xlsx. Devolve { sheetName, rows, periods } e, se o arquivo veio do planejador, planning.
export async function readBudgetWorkbook(file, Zip = globalThis.JSZip) {
  if (!Zip) throw new Error("O leitor de Excel não foi carregado.");
  const workbook = await openWorkbook(file, Zip);
  const fromPlanner = workbook.sheets.has("_Planejador") || workbook.zip.file("planejador.json");
  return fromPlanner ? readPlannerWorkbook(workbook) : readSourceWorkbook(workbook);
}
