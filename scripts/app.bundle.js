/* Gerado por npm run build. Execução local sem servidor. */
(() => {
// models/budget.js
// Domínio do orçamento: lê as linhas da planilha, organiza contas e setores da base,
// calcula o Projetado e responde às perguntas da interface (valores, totais, anos).
// Não acessa a página: é usado pela interface, pelo Excel e pelos testes.
//
// Convenções:
// - Mês é texto "AAAA-MM" ("2026-07"). Texto nesse formato ordena como data.
// - Conta com 14 dígitos é analítica (uma rubrica). Conta com 10 dígitos é total ou subtotal.
// - Conta iniciada por 7 é Receita; por 8, Despesa.
// - Edição manual usa a chave "conta|mês".

const GROUP_NAMES = { 7: "Receita", 8: "Despesa" };
const TOLERANCE = 0.01; // diferença em reais tratada como zero
const OUTLIER_DEVIATIONS = 2; // limite do ajuste secundário, em desvios padrão
// Projetar até: do último ano da base (ano de referência) até 20 anos depois.
const HORIZON_YEARS = 20;

function horizonYears(targetYear) {
  return Array.from({ length: HORIZON_YEARS + 1 }, (_, index) => targetYear + index);
}

// ---------------------------------------------------------------------------
// Utilitários de números e meses
// ---------------------------------------------------------------------------

function median(values) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2) {
    return ordered[middle];
  }
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Math.sqrt(values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length);
}

// sumBy(contas, conta => conta.valor): soma da esquerda para a direita, a partir de 0.
function sumBy(items, amount) {
  return items.reduce((sum, item) => sum + amount(item), 0);
}

// Número da planilha; vazio ou inválido vira null (sem valor).
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Igual a number(), mas sem valor conta como 0 (para somas).
function value(value) {
  return number(value) ?? 0;
}

// monthKey(2026, 7) → "2026-07"
function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Meses de um ano, de janeiro até o mês informado: yearMonths(2026, 3) → ["2026-01", "2026-02", "2026-03"].
function yearMonths(year, lastMonth = 12) {
  return Array.from({ length: lastMonth }, (_, index) => monthKey(year, index + 1));
}

// monthRange("2025-11", "2026-02") → ["2025-11", "2025-12", "2026-01", "2026-02"]
function monthRange(start, end) {
  const result = [];
  let [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(monthKey(year, month));
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return result;
}

// addYears("2026-07", -1) → "2025-07"
function addYears(period, years) {
  const [year, month] = period.split("-").map(Number);
  return monthKey(year + years, month);
}

// nextMonth("2026-12") → "2027-01"
function nextMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
}

function previousMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
}

// Quantos meses de start até end: monthDistance("2026-01", "2026-03") → 2.
function monthDistance(start, end) {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  return (endYear - startYear) * 12 + endMonth - startMonth;
}

function validMonth(period) {
  if (typeof period !== "string") {
    return false;
  }

  const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
  return monthPattern.test(period);
}

// ---------------------------------------------------------------------------
// Leitura da base: contas, setores da base e ajustes de conciliação
// ---------------------------------------------------------------------------

// Total do grupo: 7000000009 (Receitas) ou 8000000006 (Despesas).
function isGroupRoot(account) {
  return account.length === 10 && account.slice(1, 9) === "00000000";
}

// Setor da base: 10 dígitos com os 3 primeiros preenchidos e o resto zerado (ex.: 8170000002 → setor "817").
function isSector(account) {
  return account.length === 10 && account[1] !== "0" && account[2] !== "0" && account.slice(3, 9) === "000000";
}

// Limpa as linhas recebidas e mantém só receitas e despesas com 10 ou 14 dígitos e descrição.
function normalizeRows(inputRows) {
  return inputRows
    .map((row, index) => ({
      sourceRow: Number(row.sourceRow) || index + 2,
      account: String(row.account ?? "").replace(/\.0$/, "").trim(),
      rubric: String(row.rubric ?? "").trim(),
      values: Object.fromEntries(Object.entries(row.values ?? {}).map(([period, item]) => [period, number(item)])),
    }))
    .filter(row => /^[78]\d+$/.test(row.account) && [10, 14].includes(row.account.length) && row.rubric)
    .map(row => ({ ...row, group: GROUP_NAMES[row.account[0]] }));
}

// O ano de referência (último ano da base) precisa de: 12 meses do ano anterior e janeiro a junho dele.
function checkRequiredMonths(periods, targetYear) {
  const required = [...yearMonths(targetYear - 1), ...yearMonths(targetYear, 6)];
  const missing = required.filter(period => !periods.includes(period));
  if (missing.length) throw new Error(`Faltam os meses obrigatórios: ${missing.join(", ")}.`);
}

// Último mês realizado: o último em que os dois totais (Receita e Despesa) têm valor.
// Precisa estar entre junho e novembro: projetar exige o 1º semestre e algum mês ainda por vir.
function findLastActual(roots, targetYear) {
  const actualMonths = yearMonths(targetYear)
    .filter(period => roots.every(row => row.values[period] !== null && row.values[period] !== undefined));
  if (!actualMonths.length) throw new Error(`Não há valores realizados em ${targetYear}.`);
  const lastActual = actualMonths.at(-1);
  if (Number(lastActual.slice(5)) < 6) throw new Error(`O primeiro semestre de ${targetYear} precisa estar completo.`);
  if (Number(lastActual.slice(5)) === 12) throw new Error(`A base já possui todos os meses realizados de ${targetYear}.`);
  return lastActual;
}

// Setores da base, por código de 3 dígitos. Também guarda, para cada conta analítica,
// o último setor visto acima dela na planilha ("setor pela posição").
function readSectors(rows, actualPeriods) {
  const sectors = new Map();
  const positionSectors = new Map();
  const currentByGroup = new Map();
  let order = 0;
  for (const row of rows) {
    if (isSector(row.account)) {
      const code = row.account.slice(0, 3);
      if (!sectors.has(code)) {
        sectors.set(code, {
          name: row.rubric.startsWith("(-)") ? row.rubric.slice(3).trim() : row.rubric,
          group: row.group,
          order: order++,
          values: Object.fromEntries(actualPeriods.map(period => [period, row.values[period]])),
        });
      }
      currentByGroup.set(row.group, code);
    }
    if (row.account.length === 14 && currentByGroup.has(row.group)) positionSectors.set(row.sourceRow, currentByGroup.get(row.group));
  }
  if (!sectors.size) throw new Error("Não foi possível identificar os setores da base.");
  return { sectors, positionSectors };
}

// Contas analíticas (14 dígitos) com seus dois candidatos a setor:
// pelo prefixo do código (prefixSector) e pela posição na planilha (positionSector).
// Contas sem nenhum setor ficam de fora; os ajustes de conciliação cobrem esse valor.
function readLeaves(rows, sectors, positionSectors) {
  const leaves = rows.filter(row => row.account.length === 14).flatMap(row => {
    const prefixSector = sectors.has(row.account.slice(0, 3)) ? row.account.slice(0, 3) : null;
    const positionSector = positionSectors.get(row.sourceRow) ?? null;
    const chosenSector = prefixSector ?? positionSector;
    return chosenSector ? [{ ...row, prefixSector, positionSector, chosenSector }] : [];
  });
  if (!leaves.length) throw new Error("Nenhuma rubrica analítica foi encontrada.");
  const seen = new Set();
  for (const leaf of leaves) {
    if (seen.has(leaf.account)) throw new Error(`Conta analítica duplicada na base: ${leaf.account}.`);
    seen.add(leaf.account);
  }
  return leaves;
}

// Distância entre o total de cada setor e a soma das contas atribuídas a ele (quanto menor, melhor).
function assignmentScore(leaves, assignments, sectors, periods, codes) {
  return sumBy(codes, code => sumBy(periods, period => {
    const detail = sumBy(leaves.filter(leaf => assignments.get(leaf.sourceRow) === code), leaf => value(leaf.values[period]));
    return Math.abs(value(sectors.get(code).values[period]) - detail);
  }));
}

// Setor final de cada conta (sourceRow → código). O padrão é o prefixo.
// Quando prefixo e posição discordam, a posição só vence se fechar melhor os totais dos dois setores.
function chooseSectors(leaves, sectors, actualPeriods) {
  const assignments = new Map(leaves.map(leaf => [leaf.sourceRow, leaf.chosenSector]));
  for (const leaf of leaves) {
    if (!leaf.prefixSector || !leaf.positionSector || leaf.prefixSector === leaf.positionSector) continue;
    const codes = [leaf.prefixSector, leaf.positionSector];
    const before = assignmentScore(leaves, assignments, sectors, actualPeriods, codes);
    assignments.set(leaf.sourceRow, leaf.positionSector);
    const after = assignmentScore(leaves, assignments, sectors, actualPeriods, codes);
    if (after >= before - TOLERANCE) assignments.set(leaf.sourceRow, leaf.prefixSector);
  }
  return assignments;
}

// Linha de ajuste: guarda a diferença entre um total da planilha e a soma das contas abaixo dele.
function reconciliationRecord(account, rubric, group, sectorCode, sectorName, sourceRow, actuals) {
  return { account, rubric, group, sectorCode, sector: sectorName, sourceRow, actuals, isReconciliation: true };
}

const hasResidual = residual => Object.values(residual).some(item => Math.abs(item) > TOLERANCE);

// Ajustes de subtotais de Despesa: quando falta valor num setor, procura o subtotal intermediário
// (10 dígitos, abaixo do setor) cuja sobra explica exatamente essa falta no mês.
function isExpenseSubtotal(row, sectors) {
  return row.group === "Despesa" && row.account.length === 10
    && !isGroupRoot(row.account) && !isSector(row.account) && sectors.has(row.account.slice(0, 3));
}

function subtotalAdjustments(rows, leaves, records, sectors, actualPeriods) {
  const subtotals = rows.filter(row => isExpenseSubtotal(row, sectors))
    .map(row => ({ ...row, prefix: row.account.slice(0, -1).replace(/0+$/, ""), sectorCode: row.account.slice(0, 3) }));
  const byPrefix = new Map(subtotals.map(item => [item.prefix, item]));
  if (byPrefix.size !== subtotals.length) throw new Error("Há subtotais COSIF intermediários com prefixo duplicado.");
  // Cada subtotal conhece os subtotais filhos e as contas logo abaixo dele (prefixo mais longo vence).
  const longestPrefix = account => [...byPrefix.keys()].filter(prefix => account.startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
  const children = new Map([...byPrefix.keys()].map(prefix => [prefix, []]));
  const directLeaves = new Map([...byPrefix.keys()].map(prefix => [prefix, []]));
  for (const child of subtotals) {
    const parents = [...byPrefix.keys()].filter(prefix => prefix !== child.prefix && child.prefix.startsWith(prefix));
    if (parents.length) children.get(parents.sort((a, b) => b.length - a.length)[0]).push(child);
  }
  for (const leaf of leaves) {
    const parent = longestPrefix(leaf.account);
    if (parent) directLeaves.get(parent).push(leaf);
  }
  // Sobra de cada subtotal: valor do subtotal − (contas diretas + subtotais filhos).
  const candidates = subtotals.map(subtotal => {
    const residual = Object.fromEntries(actualPeriods.map(period => {
      const detail = sumBy(directLeaves.get(subtotal.prefix), leaf => value(leaf.values[period]))
        + sumBy(children.get(subtotal.prefix), child => value(child.values[period]));
      return [period, value(subtotal.values[period]) - detail];
    }));
    return { subtotal, residual };
  });
  const allocated = new Map(subtotals.map(subtotal => [subtotal.account, Object.fromEntries(actualPeriods.map(period => [period, 0]))]));
  for (const [code, sector] of sectors) {
    const sectorRecords = records.filter(record => record.sectorCode === code);
    const sectorCandidates = candidates.filter(candidate => candidate.subtotal.sectorCode === code);
    for (const period of actualPeriods) {
      const gap = value(sector.values[period]) - sumBy(sectorRecords, record => value(record.actuals[period]));
      if (Math.abs(gap) <= TOLERANCE) continue;
      const closest = [...sectorCandidates].sort((a, b) => Math.abs(a.residual[period] - gap) - Math.abs(b.residual[period] - gap))[0];
      if (closest && Math.abs(closest.residual[period] - gap) <= TOLERANCE) allocated.get(closest.subtotal.account)[period] = gap;
    }
  }
  return subtotals
    .filter(subtotal => hasResidual(allocated.get(subtotal.account)))
    .map(subtotal => reconciliationRecord(`AJUSTE-${subtotal.account}`, subtotal.rubric, "Despesa", subtotal.sectorCode,
      sectors.get(subtotal.sectorCode).name, subtotal.sourceRow, allocated.get(subtotal.account)));
}

// Ajuste por setor: o que o total do setor tem e suas contas (e ajustes) não explicam.
function sectorAdjustments(records, sectors, actualPeriods) {
  const adjustments = [];
  for (const [code, sector] of sectors) {
    const sectorRecords = records.filter(record => record.sectorCode === code);
    const residual = Object.fromEntries(actualPeriods.map(period => [
      period,
      value(sector.values[period]) - sumBy(sectorRecords, record => value(record.actuals[period])),
    ]));
    if (hasResidual(residual)) {
      adjustments.push(reconciliationRecord(`AJUSTE-${code}`, "Valores sem rubrica detalhada na fonte", sector.group, code, sector.name, 999000 + sector.order, residual));
    }
  }
  return adjustments;
}

// Ajuste por grupo: o que o total de Receitas ou Despesas tem e nenhum setor explica.
// Cria um setor artificial ("R-SEM-SETOR" ou "D-SEM-SETOR") para esse valor.
function groupAdjustments(records, roots, sectors, actualPeriods) {
  const groupTotals = new Map();
  for (const row of roots) for (const period of actualPeriods) groupTotals.set(`${row.group}|${period}`, value(row.values[period]));
  let nextOrder = Math.max(...[...sectors.values()].map(sector => sector.order)) + 1;
  const adjustments = [];
  for (const group of ["Receita", "Despesa"]) {
    const groupRecords = records.filter(record => record.group === group);
    const residual = Object.fromEntries(actualPeriods.map(period => [
      period,
      value(groupTotals.get(`${group}|${period}`)) - sumBy(groupRecords, record => value(record.actuals[period])),
    ]));
    if (hasResidual(residual)) {
      const code = `${group[0]}-SEM-SETOR`, name = "Valores sem setor detalhado na fonte";
      sectors.set(code, { name, group, order: nextOrder++, values: residual });
      adjustments.push(reconciliationRecord(`AJUSTE-${group.toUpperCase()}`, name, group, code, name, 999900 + nextOrder, residual));
    }
  }
  return adjustments;
}

// Transforma as linhas da planilha em contas prontas para projetar.
// Etapas: validar meses → ler setores → atribuir contas → conciliar totais → ordenar.
// Os ajustes garantem que contas + ajustes somem exatamente os totais da planilha.
function organize(inputRows, historyStart) {
  const rows = normalizeRows(inputRows);
  if (!rows.length) throw new Error("Nenhuma conta válida de receita ou despesa foi encontrada.");
  const periods = [...new Set(rows.flatMap(row => Object.keys(row.values)))].sort();
  if (!periods.length) throw new Error("A planilha não contém colunas mensais reconhecíveis.");
  const targetYear = Math.max(...periods.map(period => Number(period.slice(0, 4))));
  checkRequiredMonths(periods, targetYear);

  const roots = rows.filter(row => isGroupRoot(row.account));
  for (const group of ["Receita", "Despesa"]) {
    if (roots.filter(row => row.group === group).length !== 1) {
      throw new Error(`A base deve conter um único total principal de ${group}.`);
    }
  }
  const lastActual = findLastActual(roots, targetYear);
  const availableActualPeriods = periods.filter(period => period <= lastActual);
  const actualPeriods = historyStart === undefined
    ? availableActualPeriods
    : availableActualPeriods.filter(period => period >= historyStart);

  const { sectors, positionSectors } = readSectors(rows, actualPeriods);
  const leaves = readLeaves(rows, sectors, positionSectors);
  const assignments = chooseSectors(leaves, sectors, actualPeriods);
  const records = leaves.map(leaf => {
    const sectorCode = assignments.get(leaf.sourceRow);
    return {
      account: leaf.account,
      rubric: leaf.rubric,
      group: leaf.group,
      sectorCode,
      sector: sectors.get(sectorCode).name,
      sourceRow: leaf.sourceRow,
      actuals: Object.fromEntries(actualPeriods.map(period => [period, leaf.values[period]])),
      isReconciliation: false,
    };
  });

  // A ordem importa: cada etapa concilia o que as anteriores não explicaram.
  records.push(...subtotalAdjustments(rows, leaves, records, sectors, actualPeriods));
  records.push(...sectorAdjustments(records, sectors, actualPeriods));
  records.push(...groupAdjustments(records, roots, sectors, actualPeriods));

  // Receitas antes de Despesas; dentro do grupo, na ordem dos setores e da planilha.
  const groupOrder = { Receita: 0, Despesa: 1 };
  records.sort((a, b) => groupOrder[a.group] - groupOrder[b.group]
    || sectors.get(a.sectorCode).order - sectors.get(b.sectorCode).order
    || a.sourceRow - b.sourceRow);
  return { rows, periods, availableActualPeriods, actualPeriods, targetYear, lastActual, records, sectors };
}

// ---------------------------------------------------------------------------
// Projeção padrão (antes dos índices e das edições)
// ---------------------------------------------------------------------------

// Soma dos meses informados de um ano: monthsTotal(conta, 2026, [1, 2, 3]) = 1º trimestre.
function monthsTotal(record, year, months) {
  return sumBy(months, month => value(record.actuals[monthKey(year, month)]));
}

const FIRST_HALF = [1, 2, 3, 4, 5, 6];

function hasSemesterActivity(record, year) {
  return [year - 1, year].some(item => FIRST_HALF.some(month => value(record.actuals[monthKey(item, month)]) !== 0));
}

function usesHistoricalMedian(forecastMethod) {
  return forecastMethod === "trend" || forecastMethod === "unfiltered-trend";
}

// Ajuste mensal da conta: variação do 1º semestre (ano de referência − anterior) / 6,
// mais um ajuste secundário limitado a 2 desvios padrão. O secundário é a mediana de
// 0, da variação típica do setor e do momentum (2º trimestre − 1º trimestre) / 3.
function forecastAdjustment(record, data, rubricChanges, sectorChanges) {
  const previousYear = data.targetYear - 1;
  const momentum = (monthsTotal(record, data.targetYear, [4, 5, 6]) - monthsTotal(record, data.targetYear, [1, 2, 3])) / 3;
  const deviation = standardDeviation([previousYear, data.targetYear].flatMap(year => FIRST_HALF.map(month => value(record.actuals[monthKey(year, month)]))));
  const secondary = median([0, sectorChanges.get(record.sectorCode) ?? 0, momentum]);
  const limit = deviation * OUTLIER_DEVIATIONS;
  const limited = limit <= TOLERANCE ? secondary : Math.min(limit, Math.max(-limit, secondary));
  const adjustment = rubricChanges.get(record.account) + limited;
  return { rubricChange: rubricChanges.get(record.account), sectorChange: sectorChanges.get(record.sectorCode) ?? 0, momentum, deviation, adjustment };
}

// Usa a referência anual e carrega o ajuste de tendência para os anos seguintes.
function projectWithTrend(data, forecastPeriods, forecastHistory, forecastMethod) {
  const history = forecastHistory.slice(-12);
  const months = new Map();
  const usesMedian = usesHistoricalMedian(forecastMethod);
  if (usesMedian) {
    for (const period of forecastHistory) {
      const month = period.slice(5);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(period);
    }
  }
  const firstHalfChange = record => (monthsTotal(record, data.targetYear, FIRST_HALF) - monthsTotal(record, data.targetYear - 1, FIRST_HALF)) / 6;
  const rubricChanges = new Map(data.records.map(record => [record.account, firstHalfChange(record)]));
  // A mediana do setor usa contas com movimento nos meses usados na comparação.
  const peers = data.records.filter(record => !record.isReconciliation
    && (forecastMethod !== "trend" || hasSemesterActivity(record, data.targetYear)));
  const sectorChanges = new Map();
  for (const code of data.sectors.keys()) {
    const changes = peers.filter(record => record.sectorCode === code).map(record => rubricChanges.get(record.account));
    sectorChanges.set(code, median(changes));
  }
  return data.records.map(record => {
    const calculation = forecastAdjustment(record, data, rubricChanges, sectorChanges);
    const forecast = {};
    const historicalAverage = history.length ? sumBy(history, period => value(record.actuals[period])) / history.length : 0;
    for (const period of forecastPeriods) {
      const previousPeriod = addYears(period, -1);
      if (!(previousPeriod in forecast)) {
        if (usesMedian) {
          const observations = (months.get(period.slice(5)) ?? [])
            .map(item => number(record.actuals[item])).filter(amount => amount !== null);
          const estimate = observations.length ? median(observations) + calculation.adjustment : historicalAverage;
          forecast[period] = Math.max(0, estimate);
          continue;
        }
        if (forecastMethod === "historical-average" && !Object.hasOwn(record.actuals, previousPeriod)) {
          forecast[period] = Math.max(0, historicalAverage);
          continue;
        }
      }
      const baseline = previousPeriod in forecast ? forecast[previousPeriod] : value(record.actuals[previousPeriod]);
      forecast[period] = Math.max(0, baseline + calculation.adjustment);
    }
    return { ...record, calculation, forecast };
  });
}

// Reproduz a média sazonal para conferir planilhas da versão 4 na importação.
function seasonalForecast(record, forecastPeriods, forecastHistory) {
  const observations = forecastHistory.flatMap(period => {
    const amount = number(record.actuals[period]);
    return amount === null ? [] : [{ month: period.slice(5), amount }];
  });
  const mean = items => items.length ? Math.max(0, sumBy(items, item => item.amount) / items.length) : 0;
  const fallback = mean(observations);
  const byMonth = new Map();
  for (const period of forecastPeriods) {
    const month = period.slice(5);
    if (byMonth.has(month)) continue;
    const sameMonth = observations.filter(item => item.month === month);
    byMonth.set(month, sameMonth.length ? mean(sameMonth) : fallback);
  }
  const forecast = Object.fromEntries(forecastPeriods.map(period => [period, byMonth.get(period.slice(5))]));
  return { ...record, forecast };
}

function project(data, endYear, start = nextMonth(data.lastActual), forecastMethod = "trend") {
  if (!Number.isInteger(endYear) || endYear < data.targetYear || endYear > data.targetYear + HORIZON_YEARS) {
    throw new Error(`O ano final deve estar entre ${data.targetYear} e ${data.targetYear + HORIZON_YEARS}.`);
  }
  const forecastPeriods = monthRange(start, `${endYear}-12`);
  const forecastHistory = data.actualPeriods.filter(period => period < start);
  const records = forecastMethod === "seasonal"
    ? data.records.map(record => seasonalForecast(record, forecastPeriods, forecastHistory))
    : projectWithTrend(data, forecastPeriods, forecastHistory, forecastMethod);
  return { ...data, records, forecastPeriods, forecastHistory, endYear };
}

// ---------------------------------------------------------------------------
// Índices econômicos
// ---------------------------------------------------------------------------

// Fator acumulado do índice no mês. Ex.: 10% mensal desde 2026-01 → em 2026-03 vale 1,1³.
// Antes do início vale 1; depois do fim mantém o último fator.
function variableFactor(variable, period) {
  if (!variable.active || period < variable.start) return 1;
  const rate = Number(variable.rate);
  if (!Number.isFinite(rate) || rate <= -100) throw new Error(`A taxa de ${variable.name || "uma variável"} deve ser maior que -100%.`);
  const effectivePeriod = period > variable.end ? variable.end : period;
  const elapsed = monthDistance(variable.start, effectivePeriod);
  if (elapsed < 0) return 1;
  const occurrences = variable.cadence === "annual" ? Math.floor(elapsed / 12) + 1 : elapsed + 1;
  return (1 + rate / 100) ** occurrences;
}

function matchesScope(variable, record) {
  return variable.scope === "all"
    || (variable.scope === "group" && variable.target === record.group)
    || (variable.scope === "sector" && variable.target === record.sectorCode)
    || (variable.scope === "account" && variable.target === record.account);
}

// Multiplica o valor pelos fatores de todos os índices que alcançam a conta.
function applyVariables(base, record, period, variables) {
  return variables.filter(variable => matchesScope(variable, record)).reduce((result, variable) => result * variableFactor(variable, period), base);
}

// Vínculos com ajustes fora do recorte ficam guardados sem gerar linhas de cálculo.
function hasBudgetOrigin(model, type, id) {
  if (type === "sector") return model.sectors.has(id) || ["R-SEM-SETOR", "D-SEM-SETOR"].includes(id);
  if (model.records.some(record => record.account === id)) return true;
  if (typeof id !== "string" || !id.startsWith("AJUSTE-")) return false;
  const code = id.slice("AJUSTE-".length);
  return ["RECEITA", "DESPESA"].includes(code)
    || (/^\d{3}$/.test(code) && model.sectors.has(code))
    || model.rows.some(row => row.account === code && isExpenseSubtotal(row, model.sectors));
}

function validateVariables(variables, model) {
  if (!Array.isArray(variables)) throw new Error("A lista de índices é inválida.");
  for (const item of variables) {
    if (!item || !String(item.name ?? "").trim() || !Number.isFinite(item.rate) || item.rate <= -100
      || !validMonth(item.start) || !validMonth(item.end) || item.start > item.end
      || !["monthly", "annual"].includes(item.cadence) || !["all", "group", "sector", "account"].includes(item.scope)
      || typeof item.active !== "boolean"
      || (item.scope === "group" && !["Receita", "Despesa"].includes(item.target))
      || (["account", "sector"].includes(item.scope) && !hasBudgetOrigin(model, item.scope, item.target))) {
      throw new Error(`Índice inválido ou origem inexistente: ${item?.name ?? "sem nome"}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Modelo completo: projeção + índices + edições + três faixas (cópia, fixa, dinâmica)
// ---------------------------------------------------------------------------

// Substitui o Realizado da base pelas edições manuais ("conta|mês" → valor).
function applyActualOverrides(organized, actualOverrides) {
  for (const record of organized.records) {
    for (const period of organized.actualPeriods) {
      const key = `${record.account}|${period}`;
      if (Object.hasOwn(actualOverrides, key)) record.actuals[period] = actualOverrides[key];
    }
  }
}

// Reproduz o recorte antigo somente para conferir fórmulas de exportações anteriores.
function limitLegacyHistory(organized, historyStart) {
  if (historyStart === undefined) return;
  organized.actualPeriods = organized.actualPeriods.filter(period => period >= historyStart);
  for (const record of organized.records) {
    record.actuals = Object.fromEntries(organized.actualPeriods.map(period => [period, record.actuals[period]]));
  }
  for (const sector of organized.sectors.values()) {
    sector.values = Object.fromEntries(organized.actualPeriods.map(period => [period, sector.values[period]]));
  }
}

// projection: { historyStart?, copyThrough, resumeAt, initial }.
// - A partir de historyStart (Começar em): início inclusivo da base histórica.
// - Até copyThrough (Ir até): o Projetado copia o Realizado.
// - Entre os dois: faixa fixa, calculada com as entradas guardadas em initial.
// - A partir de resumeAt (Retomar em): faixa dinâmica, com as entradas atuais.
function validateProjection(model, endYear, projection) {
  if (!validMonth(projection.copyThrough) || !validMonth(projection.resumeAt)
    || projection.copyThrough < previousMonth(model.availableActualPeriods[0]) || projection.copyThrough >= projection.resumeAt
    || projection.resumeAt > `${endYear}-12`) throw new Error("Ir até e Retomar em devem ser meses válidos, em ordem, dentro do horizonte.");
  if (projection.historyStart !== undefined
    && (!model.availableActualPeriods.includes(projection.historyStart) || projection.historyStart > nextMonth(projection.copyThrough))) {
    throw new Error("Começar em deve ser um mês do Realizado até a data de Ir até.");
  }
  if (projection.resumeAt > nextMonth(projection.copyThrough) && !projection.initial) throw new Error("A referência inicial do período fixo está ausente.");
  for (const amount of Object.values(projection.initial?.actualOverrides ?? {})) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) throw new Error("A referência inicial contém um Realizado inválido.");
  }
}

// Recalcula a projeção com as entradas guardadas na primeira escolha da faixa fixa.
function frozenReference(organized, endYear, projection, forecastMethod) {
  const records = organized.records.map(record => ({ ...record, actuals: { ...record.actuals } }));
  const initial = { ...organized, records };
  validateVariables(projection.initial.variables, initial);
  applyActualOverrides(initial, projection.initial.actualOverrides);
  return project(initial, endYear, nextMonth(projection.copyThrough), forecastMethod);
}

// Ponto de entrada do cálculo. Recebe só entradas (linhas da base e escolhas do usuário)
// e devolve o modelo que toda a interface e o Excel leem. Cada conta ganha:
// forecast (projeção padrão), adjusted (com índices) e final (com faixa fixa e edições).
function buildBudget(rows, endYear, variables = [], overrides = {}, actualOverrides = {}, projection = null, forecastMethod = "trend", legacyCutoff = false) {
  const organized = organize(rows, legacyCutoff ? undefined : projection?.historyStart);
  if (projection) validateProjection(organized, Number(endYear), projection);
  if (legacyCutoff) limitLegacyHistory(organized, projection?.historyStart);
  const reference = projection?.initial ? frozenReference(organized, Number(endYear), projection, forecastMethod) : undefined;
  applyActualOverrides(organized, actualOverrides);
  for (const amount of [...Object.values(overrides), ...Object.values(actualOverrides)]) {
    if (amount !== "" && !Number.isFinite(Number(amount))) throw new Error("Há um valor manual inválido no planejamento.");
  }
  validateVariables(variables, organized);
  const model = project(organized, Number(endYear), projection ? nextMonth(projection.copyThrough) : undefined, forecastMethod);
  const records = model.records.map(record => {
    const adjusted = Object.fromEntries(model.forecastPeriods.map(period => [period, applyVariables(record.forecast[period], record, period, variables)]));
    const frozenRecord = reference?.records.find(item => item.account === record.account);
    const final = Object.fromEntries(model.forecastPeriods.map(period => {
      const key = `${record.account}|${period}`;
      // Faixa fixa: usa a referência inicial com os índices da época.
      if (projection && period < projection.resumeAt) {
        return [period, applyVariables(frozenRecord.forecast[period], frozenRecord, period, projection.initial.variables)];
      }
      // Faixa dinâmica: edição manual vence o cálculo.
      return [period, Object.hasOwn(overrides, key) && overrides[key] !== "" ? Number(overrides[key]) : adjusted[period]];
    }));
    if (Object.values(final).some(amount => !Number.isFinite(amount))) throw new Error(`A projeção de ${record.account} excede o limite numérico. Revise valores e índices.`);
    return { ...record, adjusted, final };
  });
  return { ...model, records, variables, overrides, actualOverrides, projection, forecastMethod };
}

// ---------------------------------------------------------------------------
// Consultas usadas pela interface e pelo Excel
// ---------------------------------------------------------------------------

// Faixa do mês: "copy" (copia o Realizado), "fixed" (referência inicial) ou "dynamic" (recalcula).
function projectionKind(model, period) {
  if (period <= (model.projection?.copyThrough ?? model.lastActual)) return "copy";
  return model.projection && period < model.projection.resumeAt ? "fixed" : "dynamic";
}

// A variação tem o sinal da diferença entre Realizado e Projetado.
function variance(actual, projected) {
  if (actual === null || actual === undefined || !Number.isFinite(projected) || projected === 0) return 0;
  return (actual - projected) / Math.abs(projected);
}

const formatMoney = amount => amount === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);

// "R$ 1.234,56" → 1234.56; vazio → null (apaga a edição).
function parseMoney(text) {
  const clean = String(text).replace(/R\$/g, "").replace(/\s/g, "");
  if (!clean) return null;
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(clean)) throw new Error("Informe um valor em reais, como R$ 1.234,56.");
  const amount = Number(clean.replaceAll(".", "").replace(",", "."));
  if (!Number.isFinite(amount)) throw new Error("O valor excede o limite numérico.");
  return amount;
}

// Realizado e Projetado que a tela mostra para uma conta num mês. null = sem valor.
function periodValues(model, record, period) {
  if (model.projection?.historyStart && period < model.projection.historyStart) return { actual: null, projected: null };
  const key = `${record.account}|${period}`;

  let actual;
  if (Object.hasOwn(model.actualOverrides ?? {}, key)) actual = model.actualOverrides[key] === null ? null : Number(model.actualOverrides[key]);
  else if (period <= model.lastActual) actual = number(record.actuals[period]);
  else actual = null;

  const kind = projectionKind(model, period);
  let projected;
  if (model.projection && kind === "copy") projected = actual;
  else if (kind === "fixed") projected = record.final[period];
  else if (Object.hasOwn(model.overrides, key) && model.overrides[key] !== "") projected = model.overrides[key] === null ? null : Number(model.overrides[key]);
  else if (period <= model.lastActual && !model.projection) projected = actual;
  else projected = record.final[period];

  return { actual, projected };
}

// Linhas da tabela do Orçamento: grupo → setores da base → contas.
function budgetLayout(model) {
  const layout = [];
  for (const group of ["Receita", "Despesa"]) {
    const records = model.records.filter(record => record.group === group);
    layout.push({ kind: "group", group, label: group === "Receita" ? "RECEITAS" : "DESPESAS", records });
    for (const code of [...new Set(records.map(record => record.sectorCode))]) {
      const sectorRecords = records.filter(record => record.sectorCode === code);
      layout.push({ kind: "sector", group, label: sectorRecords[0].sector, records: sectorRecords });
      for (const record of sectorRecords) layout.push({ kind: "record", group, record, records: [record] });
    }
  }
  return layout;
}

// Receita, Despesa e Resultado projetados de um mês.
function totalsForPeriod(model, period) {
  const totals = { Receita: 0, Despesa: 0 };
  for (const record of model.records) {
    const amount = periodValues(model, record, period).projected ?? 0;
    totals[record.group] += amount;
  }
  return { ...totals, Resultado: totals.Receita - totals.Despesa };
}

// Média mensal do resultado da projeção padrão (sem índices nem edições) no ano.
function standardAverage(model, year) {
  const periods = model.forecastPeriods.filter(period => Number(period.slice(0, 4)) === Number(year));
  if (!periods.length) return null;
  return periods.reduce((total, period) => total + model.records.reduce((result, record) => {
    const amount = record.forecast[period] ?? 0;
    return result + (record.group === "Receita" ? amount : -amount);
  }, 0), 0) / periods.length;
}

// Meses exibidos do ano: realizados, projetados e, com faixas definidas, todo o horizonte.
function periodsForYear(model, year) {
  const periods = new Set([...model.actualPeriods, ...model.forecastPeriods, ...(model.projection ? monthRange(`${model.targetYear}-01`, `${model.endYear}-12`) : [])]);
  return [...periods].sort().filter(period => Number(period.slice(0, 4)) === Number(year)
    && (!model.projection?.historyStart || period >= model.projection.historyStart));
}

// Anos disponíveis para exibição: do primeiro mês realizado até o fim do horizonte.
function modelYears(model) {
  const first = Number(model.actualPeriods[0].slice(0, 4));
  return Array.from({ length: model.endYear - first + 1 }, (_, index) => first + index);
}

function resultSeries(model, year) {
  return periodsForYear(model, year).map(period => ({
    period,
    result: totalsForPeriod(model, period).Resultado,
  }));
}

function summarizeYear(model, year) {
  return periodsForYear(model, year).reduce((totals, period) => {
    const month = totalsForPeriod(model, period);
    totals.Receita += month.Receita;
    totals.Despesa += month.Despesa;
    totals.Resultado += month.Resultado;
    return totals;
  }, { Receita: 0, Despesa: 0, Resultado: 0 });
}

// models/organogram.js
// Organograma Orçamentário: setores administrativos (boxes) e vínculos (links) que repartem
// o Realizado das contas entre eles. Formato salvo:
//   { format: "orca-organograma", version: 1,
//     boxes: [{ id, name, parent, parents? }],       parent = superior principal; parents = todos
//     links: [{ id, box, type, origin, percent }] }   type "account" (uma conta) ou "sector" (setor da base inteiro)
// Exportação: a soma dos vínculos de cada conta deve arredondar a 100% na precisão da tela.
// O superior soma os subordinados (consolidado) sem gastar percentual de novo.

const emptyOrganogram = () => ({ format: "orca-organograma", version: 1, boxes: [], links: [] });
const sectorColors = ["#123a5a", "#e47734", "#0c7c75", "#497fa7", "#a65c32", "#6865a5", "#64913e", "#ad4d69", "#419b9a", "#926b22", "#66534e", "#385793"];

// Organograma da AGE, com as raízes primeiro. Cada linha: [id, nome, superiores].
const ageSectors = [
  ["conad", "CONAD (Conselho de Administração)", []],
  ["confin", "CONFI (Conselho Fiscal)", []],
  ["auditoria", "Gerência de Auditoria Interna", []],
  ["cpl", "CPL", []],
  ["pad", "Comissão PAD", []],
  ["ouvidoria", "Ouvidoria", []],
  ["presidencia", "Presidência - PRESI", []],
  ["juridica", "Superintendência Jurídica", ["presidencia"]],
  ["comunicacao", "Gerência de Comunicação", ["presidencia"]],
  ["compliance", "Gerência de Compliance e Controles Internos", ["presidencia"]],
  ["governanca", "Secretaria de Governança", ["presidencia"]],
  ["dpg", "Diretoria de Planejamento e Gestão - DIPLAG", ["presidencia"]],
  ["administrativa", "Gerência Administrativa", ["dpg"]],
  ["dados", "Gerência de Planejamento de Dados, Mercado e Orçamento", ["dpg"]],
  ["ti", "Superintendência de Tecnologia da Informação", ["dpg"]],
  ["ger-ti", "Gerência de Tecnologia da Informação", ["ti"]],
  ["don", "Diretoria de Operações e Negócios - DIROP", ["presidencia"]],
  ["sup-pn", "Superintendência de Pequenos Negócios", ["don"]],
  ["ger-pn", "Gerência de Pequenos Negócios", ["sup-pn"]],
  ["sup-oe", "Superintendência de Operações Especiais", ["don"]],
  ["dfin", "Diretoria Financeira - DIRFI", ["presidencia"]],
  ["sup-fin", "Superintendência Financeira", ["dfin"]],
  ["contabil", "Gerência Contábil", ["sup-fin"]],
  ["sup-cc", "Superintendência de Crédito e Cobrança", ["dfin"]],
  ["ger-cc", "Gerência de Crédito e Cobrança", ["sup-cc"]],
];

// Divide todos os setores da base igualmente entre os setores administrativos.
function defaultOrganogram(model) {
  const percent = 100 / ageSectors.length;
  return { ...emptyOrganogram(),
    boxes: ageSectors.map(([id, name, parents]) => boxWithParents({ id, name }, parents)),
    links: ageSectors.flatMap(([box]) => [...model.sectors.keys()].map(origin => ({ id: `${box}:${origin}`, box, type: "sector", origin, percent }))) };
}

// parent identifica o superior principal; parents reúne os superiores quando há mais de um.
function parentIds(box) {
  if (Array.isArray(box.parents)) return [...new Set(box.parents)];
  return box.parent === null || box.parent === undefined ? [] : [box.parent];
}

function boxWithParents(box, parents) {
  const all = [...new Set(parents)];
  const result = { ...box, parent: all[0] ?? null };
  if (all.length > 1) result.parents = all;
  return result;
}

function setParentIds(box, parents) {
  const all = [...new Set(parents)];
  box.parent = all[0] ?? null;
  if (all.length > 1) box.parents = all; else delete box.parents;
  return box;
}

// Cria um setor acima de childId: o novo setor herda o superior antigo e vira o superior do filho.
function addSuperior(config, childId, id, name) {
  const child = config.boxes.find(sector => sector.id === childId);
  if (!child) throw new Error("Selecione o setor administrativo que receberá uma superior.");
  const childParents = parentIds(child);
  const superior = boxWithParents({ id, name: String(name).trim() }, childParents);
  if (!superior.name || superior.name.length > 120 || !id || config.boxes.some(sector => sector.id === id)) throw new Error("Informe um nome válido para o novo setor superior.");
  config.boxes.push(superior);
  setParentIds(child, childParents.length > 1 ? [id, ...childParents] : [id]);
  return superior;
}

// Confere formato, ids únicos, superiores existentes, ausência de ciclos e origens existentes no modelo.
// Não exige 100%: rascunho incompleto é válido. Devolve uma cópia só com os campos salvos.
function validateOrganogram(input, model) {
  if (!input || input.format !== "orca-organograma" || input.version !== 1 || !Array.isArray(input.boxes) || !Array.isArray(input.links)) {
    throw new Error("JSON de organograma incompatível.");
  }
  if (input.boxes.length > 500) throw new Error("O organograma aceita no máximo 500 setores.");
  if (input.links.length > 10000) throw new Error("O organograma aceita no máximo 10000 vínculos.");
  const ids = new Set();
  const names = new Set();
  for (const box of input.boxes) {
    if (!box || typeof box.id !== "string" || !box.id || ids.has(box.id) || typeof box.name !== "string"
      || !box.name.trim() || box.name.length > 120 || (box.parent !== undefined && box.parent !== null && typeof box.parent !== "string")
      || (box.parents !== undefined && !Array.isArray(box.parents))) throw new Error("Setor administrativo inválido ou identificador duplicado.");
    // Acentos, espaços e maiúsculas não criam um setor diferente.
    const name = box.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
    if (names.has(name)) throw new Error(`Nome de setor administrativo duplicado: ${box.name.trim()}.`);
    names.add(name);
    const parents = parentIds(box);
    if ((box.parents !== undefined && parents.length !== box.parents.length)
      || (box.parents !== undefined && box.parent !== undefined && box.parent !== null && box.parent !== parents[0])
      || parents.some(parent => typeof parent !== "string" || !parent)) throw new Error("Setor administrativo inválido ou identificador duplicado.");
    ids.add(box.id);
  }
  const boxes = new Map(input.boxes.map(box => [box.id, box]));
  // Sobe por todos os superiores; passar duas vezes pelo mesmo setor é ciclo.
  function visitParents(box, visited) {
    for (const parent of parentIds(box)) {
      if (!boxes.has(parent)) throw new Error(`Superior inexistente em ${box.name}.`);
      if (visited.has(parent)) throw new Error("A hierarquia não pode conter ciclos.");
      visitParents(boxes.get(parent), new Set([...visited, parent]));
    }
  }
  for (const box of input.boxes) visitParents(box, new Set([box.id]));
  const links = new Set();
  for (const link of input.links) {
    if (!link || typeof link.id !== "string" || !link.id || links.has(link.id) || !ids.has(link.box)
      || !["account", "sector"].includes(link.type) || typeof link.origin !== "string"
      || typeof link.percent !== "number" || !Number.isFinite(link.percent) || link.percent < 0) {
      throw new Error("Vínculo inválido: selecione setor administrativo, origem e percentual não negativo.");
    }
    if (!hasBudgetOrigin(model, link.type, link.origin)) throw new Error(`Origem inexistente: ${link.origin}.`);
    links.add(link.id);
  }
  // Somente a configuração participa da persistência; valores derivados são descartados.
  return { format: "orca-organograma", version: 1,
    boxes: input.boxes.map(({ id, name, parent, parents }) => boxWithParents({ id, name: name.trim() }, parents ?? (parent === null || parent === undefined ? [] : [parent]))),
    links: input.links.map(({ id, box, type, origin, percent }) => ({ id, box, type, origin, percent })) };
}

// Texto de uma origem de vínculo (conta ou setor da base inteiro): "Despesa · código · descrição".
function originLabel(link, model) {
  const origin = link.type === "account" ? model.records.find(record => record.account === link.origin) : model.sectors.get(link.origin);
  if (!origin) return `Fora do recorte · ${link.origin}`;
  return `${origin.group} · ${link.origin} · ${origin.rubric ?? origin.name}`;
}

// Tudo o que pode ser pesquisado numa conta: grupo, código, descrição e setor da base.
function recordSearchText(record) {
  return `${record.group} ${record.account} ${record.rubric} ${record.sectorCode} ${record.sector}${record.isReconciliation ? " ajuste" : ""}`;
}

// Contas alcançadas por um vínculo: a própria conta ou todas as contas do setor da base.
function linkedRecords(link, model) {
  return model.records.filter(record => link.type === "account" ? record.account === link.origin : record.sectorCode === link.origin);
}

// Mesma precisão na apresentação, edição e validação, sem alterar os valores salvos.
function roundAllocationPercent(value) {
  const cleanValue = Number(value.toFixed(8));
  return Math.round((cleanValue + Number.EPSILON) * 100) / 100;
}

// A tela exibe duas casas; a validação usa o mesmo arredondamento.
// difference > 0: falta; < 0: excesso.
function allocationIssues(config, model) {
  validateOrganogram(config, model);
  const percentages = new Map(model.records.map(record => [record.account, 0]));
  for (const link of config.links) for (const record of linkedRecords(link, model)) percentages.set(record.account, percentages.get(record.account) + link.percent);
  return model.records.flatMap(record => {
    const percent = percentages.get(record.account);
    const roundedPercent = roundAllocationPercent(percent);
    if (roundedPercent === 100) return [];
    return [{ account: record.account, rubric: record.rubric, percent, difference: 100 - percent }];
  });
}

// Vínculos que distribuem uma conta (diretos e do setor da base dela), com o nome do setor administrativo.
function allocationBreakdown(config, model, account) {
  validateOrganogram(config, model);
  const record = model.records.find(item => item.account === account);
  if (!record) return [];
  const boxes = new Map(config.boxes.map(box => [box.id, box.name]));
  return config.links
    .filter(link => link.type === "account" ? link.origin === account : link.origin === record.sectorCode)
    .map(link => ({ ...link, boxName: boxes.get(link.box), group: record.group }));
}

// Valores do organograma em cada mês do ano, só com Realizado. Para cada setor:
// own = soma dos vínculos diretos (Realizado × percentual); consolidated = cada setor alcançado
// uma única vez, mesmo quando o setor tem mais de um superior. Devolve os setores em ordem de
// hierarquia (pai antes dos filhos, com depth), os membros alcançados e o total das raízes.
function organogramValues(config, model, year) {
  validateOrganogram(config, model);
  const periods = periodsForYear(model, year);
  const blank = () => Object.fromEntries(periods.map(period => [period, { Receita: 0, Despesa: 0, Resultado: 0 }]));
  const add = (target, source) => {
    for (const period of periods) for (const group of ["Receita", "Despesa", "Resultado"]) {
      target[period][group] += source[period][group];
      if (!Number.isFinite(target[period][group])) throw new Error("Total do setor excede o limite numérico. Revise os valores e percentuais.");
    }
  };
  const nodes = new Map(config.boxes.map(box => [box.id, { ...box, own: blank(), consolidated: blank(), links: [], children: [] }]));
  for (const link of config.links) {
    const records = linkedRecords(link, model);
    if (link.type === "account" ? !records.length : !model.sectors.has(link.origin)) continue;
    const values = blank();
    for (const record of records) for (const period of periods) values[period][record.group] += (periodValues(model, record, period).actual ?? 0) * link.percent / 100;
    for (const period of periods) {
      values[period].Resultado = values[period].Receita - values[period].Despesa;
      if (Object.values(values[period]).some(value => !Number.isFinite(value))) throw new Error("Valor atribuído excede o limite numérico. Revise os percentuais.");
    }
    const node = nodes.get(link.box);
    node.links.push({ ...link, values, description: link.type === "account" ? records[0].rubric : model.sectors.get(link.origin).name });
    add(node.own, values);
  }
  for (const node of nodes.values()) for (const parent of parentIds(node)) nodes.get(parent).children.push(node);
  const roots = [...nodes.values()].filter(node => parentIds(node).length === 0);
  // A profundidade mínima mantém um setor com dois superiores no mesmo nível visual.
  const depth = new Map(roots.map(root => [root.id, 0])), queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index], nextDepth = depth.get(node.id) + 1;
    for (const child of node.children) if (!depth.has(child.id) || nextDepth < depth.get(child.id)) {
      depth.set(child.id, nextDepth);
      queue.push(child);
    }
  }
  const ordered = [], visited = new Set();
  function order(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    node.depth = depth.get(node.id) ?? 0;
    ordered.push(node);
    for (const child of node.children) order(child);
  }
  for (const root of roots) order(root);
  for (const node of nodes.values()) order(node); // configuração sem raiz não passa pela validação, mas mantém a saída total.

  function membersOf(node) {
    const members = [], seen = new Set();
    function collect(current) {
      if (seen.has(current.id)) return;
      seen.add(current.id);
      members.push(current.id);
      for (const child of current.children) collect(child);
    }
    collect(node);
    return members;
  }
  for (const node of ordered) {
    node.members = membersOf(node);
    node.consolidated = blank();
    for (const id of node.members) add(node.consolidated, nodes.get(id).own);
    // Totais do ano: node.totals.own.Despesa, node.totals.consolidated.Receita etc.
    const yearTotal = (kind, group) => periods.reduce((sum, period) => sum + node[kind][period][group], 0);
    node.totals = Object.fromEntries(["own", "consolidated"].map(kind => [kind, Object.fromEntries(["Receita", "Despesa", "Resultado"].map(group => [group, yearTotal(kind, group)]))]));
  }
  const total = blank(), totalMembers = new Set(roots.flatMap(root => membersOf(root)));
  for (const id of totalMembers) add(total, nodes.get(id).own);
  return { periods, nodes: ordered, total };
}

// Dados do visual da página (rosca, ranking e árvore) para um grupo, no ano inteiro ou num mês.
// slices: setores com valor próprio positivo e sua parte (share). credits: soma dos valores próprios negativos.
function expenseView(config, model, year, period = "", group = "Despesa") {
  const data = organogramValues(config, model, year);
  if (period && !data.periods.includes(period)) throw new Error("Período inválido para o ano selecionado.");
  const periods = period ? [period] : data.periods;
  const total = (values, key) => periods.reduce((sum, p) => sum + values[p][key], 0);
  const nodes = data.nodes.map(node => ({ id: node.id, name: node.name, parent: node.parent, parents: parentIds(node), depth: node.depth,
    ownExpense: total(node.own, "Despesa"), expense: total(node.consolidated, "Despesa"),
    ownRevenue: total(node.own, "Receita"), revenue: total(node.consolidated, "Receita"), result: total(node.consolidated, "Resultado"),
    own: total(node.own, group), consolidated: total(node.consolidated, group) }));
  const positive = nodes.reduce((sum, node) => sum + Math.max(0, node.own), 0);
  const slices = nodes.filter(node => node.own > 0).map(node => ({ ...node, share: node.own / positive })).sort((a, b) => b.own - a.own);
  return { group, nodes, slices, positive, total: total(data.total, group), revenueTotal: total(data.total, "Receita"), expenseTotal: total(data.total, "Despesa"), credits: nodes.reduce((sum, node) => sum + Math.min(0, node.own), 0), periods };
}

// export/planning.js
// Planejamento salvo em JSON (versão 8). Guarda só entradas; o resto é recalculado ao abrir:
//   { format: "orca-planejamento", version: 8, sourceName,
//     source: { rows, periods, sheetName }, endYear, variables, overrides, actualOverrides,
//     projection, organogram }

const PROJECT_VERSION = 8;

// Modelo → JSON salvável. "group" sai das linhas porque budget.js o deduz pelo código da conta.
function createProject(model, sourceName = "") {
  return { format: "orca-planejamento", version: PROJECT_VERSION, sourceName,
    source: { rows: model.rows.map(({ group, ...row }) => row), periods: model.periods, sheetName: "Dados Analíticos" },
    endYear: model.endYear, variables: model.variables, overrides: model.overrides,
    actualOverrides: model.actualOverrides, projection: model.projection, organogram: model.organogram ?? emptyOrganogram() };
}

// JSON → { project, model }. Valida o que veio de fora antes de calcular: formato e versão,
// meses e números da base, chaves "conta|mês" das edições e o organograma.
// Sem projection (arquivos antigos): Ir até = último realizado e Retomar em = mês seguinte.
function restoreProject(input, forecastMethod, legacyCutoff = false) {
  if (!input || input.format !== "orca-planejamento") {
    throw new Error("Planejamento incompatível.");
  }
  const supportedVersions = [1, 2, 3, 4, 5, 6, 7, PROJECT_VERSION];
  if (!supportedVersions.includes(input.version) || !Array.isArray(input.source?.rows)) {
    throw new Error("Planejamento incompatível.");
  }
  if (input.comparisonSnapshot) throw new Error("Comparativos não são mais suportados. Abra um planejamento de origem.");
  const project = JSON.parse(JSON.stringify(input));
  for (const row of project.source.rows) {
    if (!row || !row.values || typeof row.values !== "object") throw new Error("Base do planejamento inválida.");
    for (const [period, amount] of Object.entries(row.values)) {
      const invalidAmount = amount !== null && (typeof amount !== "number" || !Number.isFinite(amount));
      if (!validMonth(period) || invalidAmount) {
        throw new Error("A base contém mês ou valor inválido.");
      }
    }
  }
  const editMaps = [project.overrides ?? {}, project.actualOverrides ?? {}, project.projection?.initial?.actualOverrides ?? {}];
  for (const overrides of editMaps) {
    if (!overrides || Array.isArray(overrides) || typeof overrides !== "object") throw new Error("Edições inválidas.");
  }
  if (!project.projection) {
    const base = buildBudget(project.source.rows, Number(project.endYear));
    project.projection = { copyThrough: base.lastActual, resumeAt: base.forecastPeriods[0], initial: null };
  }
  const model = buildBudget(project.source.rows, Number(project.endYear), project.variables ?? [], editMaps[0], editMaps[1], project.projection, forecastMethod, legacyCutoff);
  for (const overrides of editMaps) {
    for (const [key, amount] of Object.entries(overrides)) {
      const [account, period] = key.split("|");
      if (!hasBudgetOrigin(model, "account", account) || !validMonth(period) || period < model.availableActualPeriods[0] || period > `${model.targetYear + HORIZON_YEARS}-12` || typeof amount !== "number" || !Number.isFinite(amount)) throw new Error(`Edição inválida: ${key}.`);
    }
  }
  model.organogram = validateOrganogram(project.organogram ?? emptyOrganogram(), model);
  return { project: createProject(model, project.sourceName ?? ""), model };
}

// export/workbook-xml.js
// Peças de XML do formato .xlsx (SpreadsheetML), sem biblioteca: endereços de célula,
// leitura de células e geração de abas e estilos. O ZIP fica com JSZip (scripts/vendor).
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Remove caracteres de controle proibidos em XML e escapa & < > " '.
const escapeXml = value => String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const decodeXml = value => String(value ?? "").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");

// Coluna por índice a partir de 0: columnName(0) → "A", columnName(26) → "AA".
function columnName(index) {
  let name = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
// Inverso de columnName: columnNumber("AA12") → 26.
const columnNumber = ref => [...ref.match(/^[A-Z]+/)[0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
// "2026-07" → "07/2026"
const monthLabel = period => `${period.slice(5)}/${period.slice(0, 4)}`;

// Cabeçalho de mês da planilha → "AAAA-MM". Aceita data do Excel (número de dias desde 1899-12-30),
// "2026-07", "2026/7" e "07/2026". Outro texto → null.
function parseMonth(value) {
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
function readCells(xml, shared = []) {
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
function readMatrix(xml, shared = []) {
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
const entry = (value, style = 0, formula = null) => ({ value, style, formula });

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
function sheetXml(rows, widths = [], freeze = { x: 0, y: 0 }, layout = {}) {
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
const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00;[Red](&quot;R$&quot; #,##0.00);&quot;R$&quot; 0.00"/></numFmts><fonts count="${workbookFonts.length}">${workbookFonts.map(font => `<font>${font.bold ? "<b/>" : ""}<sz val="${font.size}"/><color rgb="FF${font.color}"/><name val="Arial"/></font>`).join("")}</fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${workbookFills.map(color => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills><borders count="2"><border/><border><bottom style="hair"><color rgb="FFD9DFDF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${workbookFormats.length}">${workbookFormats.map(([number, font, fill]) => `<xf numFmtId="${number}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"${number === 0 || number === 49 ? ' wrapText="1"' : ' horizontal="right"'}/></xf>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// export/workbook-visual.js
// Visual do Excel: painel da aba Organograma Orçamentário (destaques, gráficos de rosca, ranking)
// e estilos da aba Orçamento. Os números vêm de xlsx.js; aqui só se monta layout, fórmulas do painel e gráficos.

// Linhas reservadas ao painel no topo da aba (os detalhes mensais começam depois, recolhidos).
// 1–5 títulos e destaques, 6–22 gráficos, 24–25 cabeçalho da hierarquia, 26+ um setor por linha.
const dashboardSize = model => 27 + model.organogram.boxes.length;
const dashboardTitle = "Organograma Orçamentário — painel";

// Painel no topo da aba: destaques, duas roscas e hierarquia com ranking.
// Os valores seguem o ano em B3 via SUMIFS na tabela auxiliar oculta (Z:AF), que tem uma linha
// por setor e ano apontando para as linhas de detalhe. W:X guardam os valores positivos dos gráficos.
// Altera rows no lugar e devolve o que addCharts e sheetXml precisam (nós, faixa, barras, mesclas).
function fillOrganogramDashboard(rows, model, yearlyRows) {
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

const chartParts = ["chart1", "chart2"];

// Grava os dois gráficos, o desenho que os posiciona (linhas 6–22) e as relações com a aba 3.
function addCharts(add, dashboard) {
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
function styleBudget(rows) {
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

// export/xlsx.js
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
async function createBudgetWorkbook(model, metadata = {}, Zip = globalThis.JSZip) {
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
async function readBudgetWorkbook(file, Zip = globalThis.JSZip) {
  if (!Zip) throw new Error("O leitor de Excel não foi carregado.");
  const workbook = await openWorkbook(file, Zip);
  const fromPlanner = workbook.sheets.has("_Planejador") || workbook.zip.file("planejador.json");
  return fromPlanner ? readPlannerWorkbook(workbook) : readSourceWorkbook(workbook);
}

// views/dom.js
// Utilitários de interface usados por todos os módulos da página.

const $ = selector => document.querySelector(selector);

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function setStatus(message, error = false) {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

function checkFileSize(file) {
  if (file.size > MAX_FILE_SIZE) throw new Error("O arquivo ultrapassa o limite de 25 MB.");
}

async function readJsonFile(file) {
  checkFileSize(file);
  return JSON.parse(await file.text());
}

function download(content, filename, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const deepCopy = value => JSON.parse(JSON.stringify(value));

// "2026-07" → "07/2026"
function periodLabel(period) {
  const [year, month] = period.split("-");
  return `${month}/${year}`;
}

// Busca sem diferenciar acentos nem maiúsculas: "Aluguéis" encontra "alugueis".
function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Cada palavra digitada precisa aparecer no texto, em qualquer ordem:
// "aluguéis de veículos" encontra "DESPESAS DE ALUGUÉIS - VEÍCULOS".
function matchesSearch(text, query) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const target = normalizeSearch(text);
  return words.every(word => target.includes(word));
}

// createElement("button", { type: "button", textContent: "Salvar" })
function createElement(tag, properties = {}) {
  return Object.assign(document.createElement(tag), properties);
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function fillSelect(select, options, selected) {
  select.replaceChildren(...options.map(([value, label]) => option(value, label)));
  if (selected !== undefined) select.value = String(selected);
}

// Percentual com duas casas: 4,333% vira 4,33%; 3,999% vira 4,00%.
function formatPercent(value) {
  return roundAllocationPercent(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVariance(value) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(value);
}

// models/editor-state.js
// Estado da página e histórico de Desfazer/Refazer.
// O estado guarda somente as entradas do usuário; app-controller.js recalcula state.model a partir delas.
const copyEditorData = value => JSON.parse(JSON.stringify(value));
let historyChanged = () => {};

function observeHistory(listener) {
  historyChanged = listener;
}

function historyAvailability() {
  return { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 };
}

const state = {
  source: null,          // base importada: linhas, meses e nome da aba
  sourceName: "",
  endYear: null,         // Projetar até (ano)
  variables: [],         // índices econômicos
  overrides: {},         // Projetado editado à mão, por "conta|mês"
  actualOverrides: {},   // Realizado editado à mão, por "conta|mês"
  projection: null,      // Começar em, Ir até, Retomar em e referência inicial da faixa fixa
  organogram: emptyOrganogram(),
  model: null,           // resultado de buildBudget (derivado)
  viewYear: null,        // ano exibido na aba Orçamento
};

// Cópia das entradas editáveis, usada pelo histórico e para reverter erros.
function editorSnapshot() {
  const { endYear, variables, overrides, actualOverrides, projection, organogram } = state;
  return copyEditorData({ endYear, variables, overrides, actualOverrides, projection, organogram });
}

function applySnapshot(snapshot) {
  Object.assign(state, copyEditorData(snapshot));
}

const HISTORY_LIMIT = 100;
const history = { undo: [], redo: [] };

// Registra o estado anterior a uma alteração confirmada.
function recordHistory(before) {
  history.undo.push(before);
  if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
  history.redo = [];
  historyChanged();
}

function resetHistory() {
  history.undo = [];
  history.redo = [];
  historyChanged();
}

// Guarda o estado atual na pilha oposta e devolve o estado a restaurar (ou null).
function stepHistory(direction) {
  const [from, to] = direction === "undo" ? [history.undo, history.redo] : [history.redo, history.undo];
  if (!from.length) return null;
  to.push(editorSnapshot());
  return from.pop();
}

// views/page-view.js
// Comportamentos gerais da página: Central de ajuda e abas das ferramentas.

function setupHelpDialog() {
  const button = $("#help-button"), dialog = $("#help-dialog");
  button.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => button.focus());
  // Clique fora da janela fecha a ajuda.
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
}

// Abas acessíveis: clique ou setas, Home e End no teclado.
function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function select(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      $(`#${item.getAttribute("aria-controls")}`).hidden = !active;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

function updateHistoryButtons({ canUndo, canRedo }) {
  $("#undo-change").disabled = !canUndo;
  $("#redo-change").disabled = !canRedo;
}

// views/summary-view.js
// Painel de totais da aba Orçamento, em duas faixas alinhadas:
// Projetado do ano exibido (Receita, Despesa, Resultado e gráfico) e, abaixo, o Realizado do mesmo ano
// até o último mês importado. Ano sem realizado (futuro) esconde a faixa do Realizado.

const fullMonthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

// Soma Realizado e Projetado de cada grupo nos meses informados.
function groupTotals(model, periods) {
  const totals = { actual: { Receita: 0, Despesa: 0 }, projected: { Receita: 0, Despesa: 0 } };
  for (const record of model.records) for (const period of periods) {
    const values = periodValues(model, record, period);
    for (const kind of ["actual", "projected"]) totals[kind][record.group] += values[kind] ?? 0;
  }
  for (const kind of ["actual", "projected"]) totals[kind].Resultado = totals[kind].Receita - totals[kind].Despesa;
  return totals;
}

function renderSummary(model, year, endMonth = 12) {
  const projected = groupTotals(model, periodsForYear(model, year).filter(period => Number(period.slice(5)) <= endMonth)).projected;
  const actualPeriods = model.actualPeriods.filter(period => Number(period.slice(0, 4)) === year && period <= model.lastActual && Number(period.slice(5)) <= endMonth);
  const actual = groupTotals(model, actualPeriods).actual;
  const historyStart = model.projection?.historyStart;
  const firstMonth = historyStart?.startsWith(`${year}-`)
    ? fullMonthName.format(new Date(`${historyStart}-01T00:00:00Z`))
    : "janeiro";
  const firstLabel = firstMonth[0].toLocaleUpperCase("pt-BR") + firstMonth.slice(1);
  const endLabel = fullMonthName.format(new Date(Date.UTC(year, endMonth - 1, 1)));
  $("#projected-band-period").textContent = `${firstLabel} a ${endLabel} de ${year}`;
  const hasActual = actualPeriods.length > 0;

  $("#projected-band-title").textContent = `PROJETADO · ${year}`;
  $("#summary-panel").classList.toggle("no-actual", !hasActual);
  for (const element of document.querySelectorAll(".actual-band, .actual-card")) element.hidden = !hasActual;
  if (hasActual) {
    const lastMonth = fullMonthName.format(new Date(`${actualPeriods.at(-1)}-01T00:00:00Z`));
    $("#actual-band-title").textContent = `REALIZADO · ${year}`;
    $("#actual-band-period").textContent = `${firstLabel} a ${lastMonth} de ${year}`;
  }
  for (const [id, group] of [["revenue", "Receita"], ["expense", "Despesa"], ["result", "Resultado"]]) {
    $(`#total-${id}`).textContent = formatMoney(projected[group]);
    $(`#actual-${id}`).textContent = hasActual ? formatMoney(actual[group]) : "—";
  }
  $("#total-result").dataset.sign = projected.Resultado < 0 ? "negative" : "positive";
  $("#actual-result").dataset.sign = actual.Resultado < 0 ? "negative" : "positive";

  const lastActualDate = new Date(`${model.lastActual}-01T00:00:00Z`);
  $("#actual-summary-note").textContent = `Dados referentes até ${fullMonthName.format(lastActualDate).toLocaleUpperCase("pt-BR")}, ${model.lastActual.slice(0, 4)}.`
    + (hasActual ? "" : ` ${year} ainda não tem valores realizados.`);
  renderResultChart(model, year, endMonth);
}

// Barras do resultado projetado de cada mês: acima do eixo = sobra, abaixo = falta.
function renderResultChart(model, year, endMonth) {
  const svg = $("#result-chart");
  const series = resultSeries(model, year).filter(item => Number(item.period.slice(5)) <= endMonth);
  const maximum = Math.max(1, ...series.map(item => Math.abs(item.result)));
  const svgElement = (tag, attributes) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  };
  const bars = series.map(({ period, result }, index) => {
    const height = Math.max(1, Math.abs(result) / maximum * 40);
    const bar = svgElement("rect", { x: index * 30 + 5, y: result >= 0 ? 48 - height : 48, width: 20, height, rx: 1, class: result >= 0 ? "positive" : "negative" });
    const title = svgElement("title", {});
    title.textContent = `${periodLabel(period)}: ${formatMoney(result)}`;
    bar.append(title);
    return bar;
  });
  svg.replaceChildren(svgElement("line", { x1: 0, x2: 360, y1: 48, y2: 48 }), ...bars);
  svg.setAttribute("aria-label", `Resultado projetado mensal de ${year}: ${series.map((item, index) => `${index + 1}, ${formatMoney(item.result)}`).join("; ")}`);
}

function renderAnalysisHeader(year) {
  const average = standardAverage(state.model, year);
  $("#standard-average-label").textContent = `MÉDIA PADRÃO ${year}`;
  $("#standard-average").textContent = average === null ? "—" : formatMoney(average);
  const monthSelect = $("#view-month");
  const historyStart = state.projection.historyStart;
  const firstMonth = historyStart?.startsWith(`${year}-`) ? Number(historyStart.slice(5)) : 1;
  for (const option of monthSelect.options) {
    option.hidden = option.disabled = Number(option.value) < firstMonth;
  }
  if (Number(monthSelect.value) < firstMonth) monthSelect.value = String(firstMonth);
}

// views/budget-view.js
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

function cell(text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  if (text !== undefined) td.textContent = text;
  return td;
}

// Duas linhas de cabeçalho: meses (com Total do ano) e, abaixo, Realizado/Projetado/Variação.
function renderHead(periods, year) {
  const monthRow = document.createElement("tr"), typeRow = document.createElement("tr");
  for (const label of ["Grupo", "Setor", "Conta", "Rubrica"]) {
    const th = document.createElement("th");
    Object.assign(th, { textContent: label, rowSpan: 2, scope: "col" });
    monthRow.append(th);
  }
  for (const period of [...periods, "Total"]) {
    const th = document.createElement("th");
    Object.assign(th, { colSpan: 3, scope: "colgroup" });
    th.textContent = period === "Total" ? `Total do período · ${year}` : `${monthName.format(new Date(`${period}-01T00:00:00Z`))} ${year}`;
    monthRow.append(th);
    for (const label of ["Realizado", "Projetado", "Variação"]) {
      const type = document.createElement("th");
      Object.assign(type, { textContent: label, scope: "col", className: label === "Realizado" ? "actual-header" : "forecast-header" });
      typeRow.append(type);
    }
  }
  $("#budget-head").replaceChildren(monthRow, typeRow);
}

// Campo editável de uma conta. Projetado só aceita edição na faixa dinâmica.
function valueInput(record, period, kind, amount) {
  const input = document.createElement("input");
  const projectedKind = projectionKind(state.model, period);
  Object.assign(input, { type: "text", inputMode: "decimal", placeholder: "—", value: amount === null ? "" : formatMoney(amount) });
  input.readOnly = kind === "projected" && projectedKind !== "dynamic";
  Object.assign(input.dataset, { account: record.account, period, kind });
  input.setAttribute("aria-label", `${kind === "actual" ? "Realizado" : "Projetado"} de ${record.rubric} em ${periodLabel(period)}`);
  input.title = !input.readOnly ? "Edite em reais. Apague para restaurar o cálculo ou deixar o realizado futuro vazio."
    : projectedKind === "fixed" ? "Referência inicial fixa. Edições não alteram este Projetado." : "Projetado replica o Realizado neste mês.";
  return input;
}

// Uma linha da tabela: conta (editável) ou subtotal de setor, grupo ou resultado.
function renderRow(item, records, periods) {
  const row = document.createElement("tr"), record = item.record;
  row.className = `${item.group === "Receita" ? "revenue-row" : "expense-row"} ${item.kind}-row${record?.isReconciliation ? " reconciliation" : ""}`;
  const labels = record ? [record.group, record.sector, record.account, record.rubric]
    : [item.group, item.kind === "sector" ? item.label : "", "", item.kind === "group" || item.kind === "result" ? item.label : "Subtotal do setor"];
  row.append(...labels.map(label => cell(label)));
  const totals = { actual: 0, projected: 0 };
  let hasActual = false;
  for (const period of periods) {
    const month = {};
    for (const kind of ["actual", "projected"]) {
      // No RESULTADO, despesas entram com sinal negativo.
      const amounts = records.map(entry => {
        const value = periodValues(state.model, entry, period)[kind];
        return value === null ? null : value * (item.kind === "result" && entry.group === "Despesa" ? -1 : 1);
      });
      const amount = amounts.every(value => value === null) ? null : amounts.reduce((sum, value) => sum + (value ?? 0), 0);
      totals[kind] += amount ?? 0;
      month[kind] = amount;
      if (kind === "actual" && amount !== null) hasActual = true;
      const manual = record && Object.hasOwn(kind === "actual" ? state.actualOverrides : state.overrides, `${record.account}|${period}`);
      const td = cell(undefined, manual ? "manual-cell" : kind === "actual" ? "actual-cell" : "forecast-cell");
      if (record) td.append(valueInput(record, period, kind, amount));
      else td.textContent = formatMoney(amount);
      row.append(td);
    }
    const ratio = variance(month.actual, month.projected);
    const change = cell(formatVariance(ratio), "variance-cell");
    change.title = ratio > 0 ? "Realizado acima do Projetado" : ratio < 0 ? "Realizado abaixo do Projetado" : "Sem variação percentual";
    row.append(change);
  }
  row.append(cell(formatMoney(totals.actual), "total-cell"), cell(formatMoney(totals.projected), "total-cell"));
  row.append(cell(formatVariance(variance(hasActual ? totals.actual : null, totals.projected))));
  return row;
}

// Atualiza os valores sem substituir o campo em digitação, seu foco ou cursor.
function patchRows(body, content, activeInput) {
  const nextRows = [...content.children];
  for (const [i, row] of [...body.rows].entries()) {
    const cells = [...nextRows[i].cells];
    for (const [j, td] of [...row.cells].entries()) {
      const field = td.querySelector("input[data-account]"), nextField = cells[j].querySelector("input[data-account]");
      if (field && nextField) {
        if (field !== activeInput) field.value = nextField.value;
        field.readOnly = nextField.readOnly;
        field.title = nextField.title;
        td.className = cells[j].className;
      } else td.replaceWith(cells[j]);
    }
  }
}

function createBudgetView() {
  function render(year, activeInput = null) {
    const periods = periodsForYear(state.model, year).filter(period => Number(period.slice(5)) <= Number($("#view-month").value));
    renderHead(periods, year);
    const query = $("#account-search").value;
    const matches = record => matchesSearch(`${record.account} ${record.rubric} ${record.sector} ${record.group}`, query);
    const content = document.createDocumentFragment();
    let count = 0;
    for (const item of [...budgetLayout(state.model), { kind: "result", group: "Resultado", label: "RESULTADO", records: state.model.records }]) {
      const records = item.records.filter(matches);
      if (!records.length) continue;
      if (item.record) count++;
      content.append(renderRow(item, records, periods));
    }
    const body = $("#budget-body");
    if (activeInput && body.contains(activeInput)) patchRows(body, content, activeInput);
    else body.replaceChildren(content);
    const { historyStart, copyThrough, resumeAt } = state.projection;
    const copySummary = historyStart && historyStart > copyThrough ? "sem cópia" : `cópia até ${periodLabel(copyThrough)}`;
    $("#table-count").textContent = `${count} de ${state.model.records.length} contas e ajustes · ${copySummary} · cálculo dinâmico a partir de ${periodLabel(resumeAt)}.`;
  }

  return { render };
}

function renderYearSelector() {
  const years = modelYears(state.model);
  if (!years.includes(Number(state.viewYear))) state.viewYear = state.model.targetYear;
  fillSelect($("#view-year"), years.map(year => [year, year]), state.viewYear);
}


// views/horizon-view.js
function renderHorizon() {
  fillSelect($("#end-year"), horizonYears(state.model.targetYear).map(year => [year, year]), state.endYear);
  const { historyStart, copyThrough, resumeAt } = state.projection;
  const available = state.model.availableActualPeriods;
  const fixedMonths = monthRange(copyThrough, resumeAt).slice(1, -1);
  const copyEnd = `até ${periodLabel(copyThrough)}, inclusive`;
  let copySummary = `Até ${periodLabel(copyThrough)}, inclusive`;
  if (historyStart) {
    copySummary = historyStart <= copyThrough
      ? `De ${periodLabel(historyStart)} ${copyEnd}`
      : "Sem cópia do Realizado neste cenário";
  }
  $("#projection-copy").textContent = copySummary;
  $("#projection-fixed").textContent = fixedMonths.length ? `${periodLabel(fixedMonths[0])} a ${periodLabel(fixedMonths.at(-1))}` : "Sem intervalo fixo neste cenário";
  $("#projection-dynamic").textContent = `A partir de ${periodLabel(resumeAt)}, inclusive`;
  // Os valores salvos continuam sendo os limites efetivos; os rótulos mostram as escolhas do usuário.
  const first = available[0], last = `${state.endYear}-12`;
  const startOptions = available.filter(period => period <= nextMonth(copyThrough));
  fillSelect($("#history-start"), startOptions.map(period => [period, periodLabel(period)]), historyStart ?? first);
  fillSelect($("#copy-through"), monthRange(previousMonth(first), last).map(period => [period, periodLabel(nextMonth(period))]), copyThrough);
  fillSelect($("#resume-at"), monthRange(first, last).map(period => [period, periodLabel(previousMonth(period))]), resumeAt);
}


// views/indices-view.js
function scopeLabel(variable) {
  if (variable.scope === "all") return "Todo o orçamento";
  if (variable.scope === "group") return variable.target;
  if (variable.scope === "sector") return state.model.sectors.get(variable.target)?.name ?? variable.target;
  const account = state.model.records.find(item => item.account === variable.target);
  return account ? `${account.account} · ${account.rubric}` : variable.target;
}

// Opções do campo "Alvo" conforme o alcance escolhido.
function renderTargets() {
  const scope = $("#variable-scope").value;
  $("#target-field").hidden = scope === "all";
  let options = [];
  if (scope === "group") {
    options = [["Receita", "Receita"], ["Despesa", "Despesa"]];
  } else if (scope === "sector") {
    options = [...state.model.sectors].map(([code, sector]) => [code, `${code} · ${sector.name}`]);
  } else if (scope === "account") {
    options = state.model.records
      .filter(record => !record.isReconciliation)
      .map(record => [record.account, `${record.account} · ${record.rubric}`]);
  }
  fillSelect($("#variable-target"), options);
}

function renderList() {
  const rows = state.variables.map(variable => {
    const row = document.createElement("tr");
    const values = [
      variable.name,
      `${Number(variable.rate).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`,
      variable.cadence === "annual" ? "Anual" : "Mensal",
      `${periodLabel(variable.start)} — ${periodLabel(variable.end)}`,
      scopeLabel(variable),
    ];
    for (const value of values) row.append(Object.assign(document.createElement("td"), { textContent: value }));
    const remove = Object.assign(document.createElement("button"), { type: "button", className: "delete-variable", textContent: "Remover" });
    remove.dataset.id = variable.id;
    remove.setAttribute("aria-label", `Remover índice ${variable.name}`);
    const actions = document.createElement("td");
    actions.append(remove);
    row.append(actions);
    return row;
  });
  $("#variables-body").replaceChildren(...rows);
  $("#variables-count").textContent = `${state.variables.length} ${state.variables.length === 1 ? "cadastrada" : "cadastradas"}`;
  $("#variables-empty").hidden = state.variables.length > 0;
  $("#variables-table-wrap").hidden = state.variables.length === 0;
}

function renderIndices() {
  renderTargets();
  renderList();
  // Vigência permitida: de janeiro do ano de referência até dezembro do horizonte.
  const start = `${state.model.targetYear}-01`, end = `${state.endYear}-12`;
  // Campo vazio ou fora do intervalo (ex.: após reduzir Projetar até) volta ao limite.
  for (const [field, fallback] of [[$("#variable-start"), start], [$("#variable-end"), end]]) {
    Object.assign(field, { min: start, max: end });
    if (!field.value || field.value < start || field.value > end) field.value = fallback;
  }
  $("#import-variables").disabled = !state.source;
  $("#export-variables").disabled = !state.source;
}


// views/files-view.js

function resetFileFields() {
  $("#variable-start").value = "";
  $("#variable-end").value = "";
}

function showLoadedProject(message) {
  $("#workspace").hidden = false;
  document.querySelectorAll(".steps li").forEach(item => item.classList.add("active"));
  setStatus(message);
  $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSource() {
  $("#source-name").textContent = state.sourceName;
  $("#source-period").textContent = `${periodLabel(state.source.periods[0])} — ${periodLabel(state.source.periods.at(-1))}`;
  $("#source-accounts").textContent = String(state.source.rows.length);
  $("#source-actual").textContent = periodLabel(state.model.lastActual);
}


// views/organogram-visual.js
// Visual da aba Organograma: rosca com a parte de cada setor, ranking e árvore da hierarquia.
// Todos mostram a mesma dica (tooltip) com os valores do setor ao passar o mouse, tocar ou focar.

const SVG = "http://www.w3.org/2000/svg";
const percentage = value => value.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgElement(tag, attributes) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function escapeSvg(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
}

function boxWithin(node, container) {
  const box = node.getBoundingClientRect(), parent = container.getBoundingClientRect();
  return { left: box.left - parent.left + container.scrollLeft, top: box.top - parent.top + container.scrollTop, width: box.width, height: box.height, right: box.right - parent.left + container.scrollLeft, bottom: box.bottom - parent.top + container.scrollTop };
}

function cssPixels(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function svgLine(parts, x1, y1, x2, y2, color) {
  parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeSvg(color)}" stroke-width="1"/>`);
}

function svgText(parts, text, x, baseline, style, anchor = "start") {
  parts.push(`<text x="${x}" y="${baseline}" text-anchor="${anchor}" fill="${escapeSvg(style.color)}" font-family="${escapeSvg(style.fontFamily)}" font-size="${cssPixels(style.fontSize, 12)}px" font-weight="${escapeSvg(style.fontWeight)}">${escapeSvg(text)}</text>`);
}

function wrapText(text, maxWidth, style, measure) {
  const words = String(text).trim().split(/\s+/).filter(Boolean), lines = [];
  measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawConnectors(parts, tree, lineColor) {
  for (const branch of tree.querySelectorAll(".sector-branch")) {
    const parent = branch.querySelector(":scope > .sector-node"), childrenList = branch.querySelector(":scope > .sector-branches");
    if (!parent || !childrenList) continue;
    const childNodes = [...childrenList.querySelectorAll(":scope > .sector-branch > .sector-node")];
    if (!childNodes.length) continue;
    const parentBox = boxWithin(parent, tree), listBox = boxWithin(childrenList, tree);
    const parentCenter = parentBox.left + parentBox.width / 2, childCenters = childNodes.map(node => { const box = boxWithin(node, tree); return { center: box.left + box.width / 2, top: box.top }; });
    svgLine(parts, parentCenter, parentBox.bottom, parentCenter, listBox.top, lineColor);
    svgLine(parts, childCenters[0].center, listBox.top, childCenters.at(-1).center, listBox.top, lineColor);
    for (const child of childCenters) svgLine(parts, child.center, listBox.top, child.center, child.top, lineColor);
  }
}

function drawNode(parts, node, tree, measure) {
  const box = boxWithin(node, tree), nodeStyle = getComputedStyle(node), line = nodeStyle.getPropertyValue("--line").trim() || "#d6e0eb";
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
  const background = node.classList.contains("is-selected") ? surface : nodeStyle.backgroundColor || surface, borderColor = node.style.borderTopColor || line;
  parts.push(`<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="4" fill="${escapeSvg(background)}" stroke="${escapeSvg(line)}" stroke-width="1"/>`);
  parts.push(`<line x1="${box.left}" y1="${box.top + 2}" x2="${box.right}" y2="${box.top + 2}" stroke="${escapeSvg(borderColor)}" stroke-width="4"/>`);
  const name = node.querySelector(":scope > .sector-node-name"), value = node.querySelector(":scope > strong"), bars = node.querySelectorAll(":scope > .sector-bars");
  if (name) {
    const nameBox = boxWithin(name, tree), style = getComputedStyle(name), fontSize = cssPixels(style.fontSize, 12), lineHeight = cssPixels(style.lineHeight, fontSize * 1.3), maxLines = Math.max(1, Math.floor(nameBox.height / lineHeight + .1));
    let lines = wrapText(name.textContent, nameBox.width, style, measure);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, "")}…`; }
    lines.forEach((line, index) => svgText(parts, line, nameBox.left, nameBox.top + fontSize + index * lineHeight, style));
  }
  if (value) {
    const valueBox = boxWithin(value, tree);
    svgText(parts, value.textContent, valueBox.left, valueBox.top + valueBox.height * .8, getComputedStyle(value));
  }
  for (const bar of bars[0]?.querySelectorAll(":scope > .sector-bar") ?? []) {
    const heading = bar.querySelector(":scope > .sector-bar-heading"), track = bar.querySelector(":scope > .sector-bar-track");
    if (heading) {
      const label = heading.querySelector(":scope > span"), total = heading.querySelector(":scope > strong");
      if (label) { const box = boxWithin(label, tree); svgText(parts, label.textContent, box.left, box.top + box.height * .8, getComputedStyle(label)); }
      if (total) { const box = boxWithin(total, tree); svgText(parts, total.textContent, box.left, box.top + box.height * .8, getComputedStyle(total)); }
    }
    if (track) {
      const trackBox = boxWithin(track, tree), trackStyle = getComputedStyle(track);
      parts.push(`<rect x="${trackBox.left}" y="${trackBox.top}" width="${trackBox.width}" height="${trackBox.height}" rx="${trackBox.height / 2}" fill="${escapeSvg(trackStyle.backgroundColor)}"/>`);
      for (const fill of track.querySelectorAll(":scope > .sector-bar-fill")) {
        const fillBox = boxWithin(fill, tree);
        if (!fillBox.width) continue;
        parts.push(`<rect x="${fillBox.left}" y="${fillBox.top}" width="${fillBox.width}" height="${fillBox.height}" fill="${escapeSvg(getComputedStyle(fill).backgroundColor)}"/>`);
      }
    }
  }
}

// Captura a árvore inteira, inclusive a parte fora do scroll horizontal, sem biblioteca externa.
async function captureOrganogramPng(tree) {
  if (!tree?.querySelector(".sector-node")) throw new Error("Crie pelo menos um setor antes de salvar a imagem.");
  const width = Math.ceil(Math.max(tree.scrollWidth, tree.clientWidth));
  const height = Math.ceil(Math.max(tree.scrollHeight, tree.clientHeight));
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("O navegador não disponibilizou um canvas para a captura.");
  const treeStyle = getComputedStyle(tree), lineColor = treeStyle.getPropertyValue("--line").trim() || "#d6e0eb";
  const parts = [`<rect width="100%" height="100%" fill="#fff"/>`];
  drawConnectors(parts, tree, lineColor);
  for (const node of tree.querySelectorAll(".sector-node")) drawNode(parts, node, tree, measure);
  const svg = `<svg xmlns="${SVG}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
  const imageUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise((resolve, reject) => {
      const item = new Image();
      item.onload = () => resolve(item);
      item.onerror = () => reject(new Error("Não foi possível preparar a imagem do organograma."));
      item.src = imageUrl;
    });
    const scale = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não disponibilizou um canvas para a captura.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG.")), "image/png"));
  } finally { URL.revokeObjectURL(imageUrl); }
}

// Dica com os valores do setor, abaixo do elemento e sempre dentro da janela.
function showTooltip(tooltip, node, event) {
  tooltip.replaceChildren(
    element("strong", "", node.name),
    element("span", "", `Despesa própria: ${formatMoney(node.ownExpense)}`),
    element("span", "", `Despesa com subordinados: ${formatMoney(node.expense)}`),
    element("span", "", `Receita própria: ${formatMoney(node.ownRevenue)}`),
    element("span", "", `Receita com subordinados: ${formatMoney(node.revenue)}`),
    element("span", "", `Resultado: ${formatMoney(node.result)}`),
  );
  tooltip.hidden = false;
  const bounds = event.currentTarget.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(innerWidth - 288, bounds.left))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(innerHeight - 180, bounds.bottom + 8))}px`;
}

// Mouse, toque, foco, Enter e Espaço mostram a dica; sair, perder o foco ou Esc escondem.
function bindTooltip(target, node, tooltip) {
  const show = event => showTooltip(tooltip, node, event);
  const hide = () => { tooltip.hidden = true; };
  target.addEventListener("pointerenter", show);
  target.addEventListener("focus", show);
  target.addEventListener("click", show);
  target.addEventListener("pointerleave", hide);
  target.addEventListener("blur", hide);
  target.addEventListener("keydown", event => {
    if (event.key === "Escape") hide();
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      show(event);
    }
  });
}

// Rosca (raio 120, centro 160,160): uma fatia por setor com valor próprio positivo.
function renderPie(chart, view, colors, noun, tooltip) {
  chart.replaceChildren();
  const point = angle => [160 + 120 * Math.sin(angle), 160 - 120 * Math.cos(angle)];
  let start = 0;
  for (const node of view.slices) {
    const end = start + node.share * Math.PI * 2;
    // Fatia de 100% não fecha o arco: termina um fio antes da volta completa.
    const finish = point(Math.min(end, Math.PI * 2 - 0.000001));
    const largeArc = end - start > Math.PI ? 1 : 0;
    const path = svgElement("path", {
      d: `M160,160 L${point(start).join(",")} A120,120 0 ${largeArc},1 ${finish.join(",")} Z`,
      fill: colors.get(node.id), stroke: "white", "stroke-width": "2", tabindex: "0", role: "button",
      "aria-label": `${node.name}: ${formatMoney(node.own)}, ${percentage(node.share)} das ${noun} positivas`,
    });
    bindTooltip(path, node, tooltip);
    chart.append(path);
    start = end;
  }
  if (!view.slices.length) {
    const text = svgElement("text", { x: "160", y: "160", "text-anchor": "middle" });
    text.textContent = `Sem ${noun} positivas`;
    chart.append(text);
  }
}

// Ranking dos setores pelo valor próprio, do maior para o menor.
function renderRanking(ranking, view, colors, tooltip) {
  ranking.replaceChildren();
  for (const node of [...view.nodes].sort((a, b) => b.own - a.own)) {
    const button = element("button", "expense-rank");
    button.type = "button";
    const dot = element("i", "sector-dot");
    dot.style.backgroundColor = colors.get(node.id);
    button.append(dot, element("span", "", node.name), element("strong", "", formatMoney(node.own)), element("small", "", node.own > 0 ? percentage(node.own / view.positive) : "—"));
    bindTooltip(button, node, tooltip);
    const item = element("li", "");
    item.append(button);
    ranking.append(item);
  }
}

function barShare(value, scale) {
  return scale > 0 ? Math.max(0, Math.min(100, value / scale * 100)) : 0;
}

// Cada setor mostra receitas e despesas; cada barra separa o valor próprio do valor dos filhos.
function renderValueBar(label, group, direct, indirect, scale, directClass, indirectClass) {
  const row = element("div", "sector-bar");
  row.dataset.group = group;
  const heading = element("span", "sector-bar-heading");
  heading.append(element("span", "", label), element("strong", "", formatMoney(direct + indirect)));
  const track = element("span", "sector-bar-track");
  const directFill = element("span", `sector-bar-fill sector-bar-fill-direct ${directClass}`);
  directFill.style.width = `${barShare(direct, scale)}%`;
  directFill.title = `${label} direta: ${formatMoney(direct)}`;
  const indirectFill = element("span", `sector-bar-fill sector-bar-fill-indirect ${indirectClass}`);
  indirectFill.style.width = `${barShare(indirect, scale)}%`;
  indirectFill.title = `${label} indireta: ${formatMoney(indirect)}`;
  track.append(directFill, indirectFill);
  row.append(heading, track);
  row.setAttribute("aria-label", `${label}: direta ${formatMoney(direct)}, indireta ${formatMoney(indirect)}, total ${formatMoney(direct + indirect)}`);
  return row;
}

// Árvore da hierarquia: cada setor mostra o consolidado e duas barras na mesma escala.
function renderBranch(parent, view, colors, group, tooltip, scales) {
  const list = element("ul", "sector-branches");
  for (const node of view.nodes.filter(node => parent === null ? node.parents.length === 0 : node.parents.includes(parent))) {
    const button = element("button", "sector-node");
    button.type = "button";
    button.dataset.sectorId = node.id;
    button.style.borderTopColor = colors.get(node.id);
    const bars = element("div", "sector-bars");
    bars.append(
      renderValueBar("Receita", "Receita", node.ownRevenue, node.revenue - node.ownRevenue, scales.revenue, "sector-bar-fill-revenue-direct", "sector-bar-fill-revenue-indirect"),
      renderValueBar("Despesa", "Despesa", node.ownExpense, node.expense - node.ownExpense, scales.expense, "sector-bar-fill-expense-direct", "sector-bar-fill-expense-indirect"),
    );
    button.append(element("span", "sector-node-name", node.name), element("strong", "", formatMoney(node.consolidated)), bars);
    button.setAttribute("aria-label", `${node.name}. ${group} própria ${formatMoney(node.own)}. Com subordinados ${formatMoney(node.consolidated)}. Receita direta ${formatMoney(node.ownRevenue)}, indireta ${formatMoney(node.revenue - node.ownRevenue)}. Despesa direta ${formatMoney(node.ownExpense)}, indireta ${formatMoney(node.expense - node.ownExpense)}.`);
    bindTooltip(button, node, tooltip);
    const item = element("li", "sector-branch");
    item.append(button);
    if (view.nodes.some(child => child.parents.includes(node.id))) item.append(renderBranch(node.id, view, colors, group, tooltip, scales));
    list.append(item);
  }
  return list;
}

// group: "Despesa" ou "Receita". period: "" para o ano inteiro ou "AAAA-MM".
function renderOrganogramVisual(config, model, year, period, group = "Despesa") {
  const view = expenseView(config, model, year, period, group);
  const noun = group === "Despesa" ? "despesas" : "receitas", title = group === "Despesa" ? "Despesas" : "Receitas";
  const tooltip = document.getElementById("sector-tooltip");
  // Cor fixa por setor (ordem de cadastro), igual no gráfico, no ranking e na árvore.
  const colors = new Map(config.boxes.map((node, index) => [node.id, sectorColors[index % sectorColors.length]]));
  tooltip.hidden = true;
  document.getElementById("expense-total").textContent = formatMoney(view.total);
  document.getElementById("expense-title").textContent = `${title} por setor`;
  document.getElementById("expense-credit").textContent = view.credits < 0
    ? `Estornos líquidos de ${formatMoney(view.credits)} fora das fatias. Fatias mostram ${noun} próprias positivas.`
    : `${title} próprias por setor. Sem duplicar superiores.`;
  renderPie(document.getElementById("expense-pie"), view, colors, noun, tooltip);
  renderRanking(document.getElementById("expense-ranking"), view, colors, tooltip);
  const tree = document.getElementById("sector-tree");
  const scale = key => Math.max(0, view[`${key}Total`]);
  tree.replaceChildren(renderBranch(null, view, colors, group, tooltip, { revenue: scale("revenue"), expense: scale("expense") }));
  tree.scrollLeft = (tree.scrollWidth - tree.clientWidth) / 2; // raiz centralizada em árvores largas
}

// views/organogram-search-view.js
// Organograma: busca de receitas e despesas e janela para editar ou remover seus vínculos.

const MAX_RESULTS = 50;

// commit(edit): aplica uma alteração no organograma, valida e registra no histórico.
function setupLinkSearch({ commit }) {
  // Um bloco por vínculo, com percentual editável e botão de remover.
  function linkItem(link) {
    const box = state.organogram.boxes.find(candidate => candidate.id === link.box);
    const label = createElement("div");
    label.append(createElement("strong", { textContent: box?.name ?? "Setor removido" }), createElement("span", { textContent: originLabel(link, state.model) }));
    if (link.type === "sector") label.append(createElement("span", { textContent: "Vínculo do setor da base inteiro: o percentual vale para todas as contas desse setor." }));
    const input = createElement("input", { type: "number", min: "0", step: "0.01", value: roundAllocationPercent(link.percent).toFixed(2) });
    input.setAttribute("aria-label", `Percentual vinculado a ${box?.name ?? "setor"}`);
    const inputLabel = createElement("label", { textContent: "Percentual (%)" });
    inputLabel.append(input);
    const save = createElement("button", { type: "button", className: "primary-button", textContent: "Salvar percentual" });
    save.addEventListener("click", () => {
      const value = Number(input.value);
      if (!input.value || !Number.isFinite(value) || value < 0) { input.focus(); return setStatus("Informe um percentual não negativo.", true); }
      const percent = roundAllocationPercent(value);
      commit(config => { config.links.find(candidate => candidate.id === link.id).percent = percent; });
      $("#link-dialog").close();
    });
    const remove = createElement("button", { type: "button", className: "secondary-button", textContent: "Remover vínculo" });
    remove.addEventListener("click", () => {
      commit(config => { config.links = config.links.filter(candidate => candidate.id !== link.id); });
      $("#link-dialog").close();
    });
    const actions = createElement("div", { className: "link-dialog-actions" });
    actions.append(save, remove);
    const item = createElement("div", { className: "link-dialog-item" });
    item.append(label, inputLabel, actions);
    return item;
  }

  function openDialog(title, links, returnFocus) {
    $("#link-dialog-title").textContent = title;
    $("#link-dialog-body").replaceChildren(...(links.length ? links.map(linkItem) : [createElement("p", { textContent: "Nenhum vínculo encontrado." })]));
    $("#link-dialog").showModal();
    $("#link-dialog").addEventListener("close", () => returnFocus?.focus(), { once: true });
  }

  // Vínculos que distribuem uma conta: diretos da conta e do setor da base dela.
  const accountLinks = account => allocationBreakdown(state.organogram, state.model, account);

  // Procura em todas as contas por grupo, código, descrição ou setor da base.
  function renderSearch() {
    const query = $("#link-search").value.trim();
    if (!query) return $("#link-search-results").replaceChildren();
    const matches = state.model.records.filter(record => matchesSearch(recordSearchText(record), query));
    const items = matches.slice(0, MAX_RESULTS).map(record => {
      const links = accountLinks(record.account);
      const percent = links.reduce((sum, link) => sum + link.percent, 0);
      const button = createElement("button", { type: "button", className: "secondary-button" });
      button.dataset.account = record.account;
      button.append(
        createElement("strong", { textContent: `${record.group} · ${record.account} · ${record.rubric}${record.isReconciliation ? " (ajuste)" : ""}` }),
        createElement("span", { textContent: `Setor da base ${record.sectorCode} · ${record.sector} — ${links.length} ${links.length === 1 ? "vínculo" : "vínculos"} · ${formatPercent(percent)}% distribuído` }),
      );
      const item = createElement("li");
      item.append(button);
      return item;
    });
    if (!matches.length) items.push(createElement("li", { textContent: "Nenhuma receita ou despesa encontrada." }));
    if (matches.length > MAX_RESULTS) items.push(createElement("li", { className: "form-note", textContent: `Mostrando ${MAX_RESULTS} de ${matches.length} contas. Refine a busca.` }));
    $("#link-search-results").replaceChildren(...items);
  }

  $("#link-search").addEventListener("input", renderSearch);
  $("#link-search-results").addEventListener("click", event => {
    const button = event.target.closest("button[data-account]");
    if (!button) return;
    const record = state.model.records.find(item => item.account === button.dataset.account);
    const ids = new Set(accountLinks(record.account).map(link => link.id));
    openDialog(`Vínculos de ${record.account} · ${record.rubric}`, state.organogram.links.filter(link => ids.has(link.id)), button);
  });
  $("#close-link-dialog").addEventListener("click", () => $("#link-dialog").close());
  return { openDialog, renderSearch, accountLinks };
}

// views/organogram-view.js
function createOrganogramView({ commit, search }) {
  let selected = "";
  let linkSelected = "";

  // Ano e período dos filtros; os valores exibidos usam somente o Realizado.
  function filterPeriods() {
    const year = Number($("#organogram-year").value) || state.model.targetYear;
    return { year, periods: $("#organogram-month").value ? [$("#organogram-month").value] : periodsForYear(state.model, year) };
  }

  // Lista de origens do formulário "Atribua os valores realizados", filtrada pela pesquisa.
  function renderOrigins() {
    if (!state.model) return;
    const previous = $("#link-origin").value;
    const query = $("#origin-search").value, type = $("#origin-type").value;
    const origins = type === "account"
      ? state.model.records.map(record => [record.account, `${record.group} · ${record.account} · ${record.rubric}${record.isReconciliation ? " (ajuste)" : ""}`, recordSearchText(record)])
      : [...state.model.sectors].map(([code, sector]) => [code, `${sector.group} · ${code} · ${sector.name}`, `${sector.group} ${code} ${sector.name}`]);
    fillSelect($("#link-origin"), origins.filter(([, , text]) => matchesSearch(text, query)));
    if ([...$("#link-origin").options].some(item => item.value === previous)) $("#link-origin").value = previous;
    renderOriginValue();
  }

  function renderOriginValue() {
    const type = $("#origin-type").value, origin = $("#link-origin").value;
    if (!origin) return $("#link-origin-value").textContent = "—";
    const records = state.model.records.filter(record => type === "account" ? record.account === origin : record.sectorCode === origin);
    const { periods } = filterPeriods();
    const total = records.reduce((sum, record) => sum + periods.reduce((periodSum, period) => periodSum + (periodValues(state.model, record, period).actual ?? 0), 0), 0);
    $("#link-origin-value").textContent = formatMoney(total);
  }

  // Vínculos diretos do setor administrativo escolhido em "Vincular ao setor".
  function renderBoxLinks() {
    const links = state.organogram.links.filter(link => link.box === $("#link-box").value);
    $("#link-empty").hidden = links.length > 0;
    $("#link-list").replaceChildren(...links.map(link => {
      const origin = link.type === "account" ? state.model.records.find(record => record.account === link.origin) : state.model.sectors.get(link.origin);
      const text = createElement("span", { textContent: `${link.type === "account" ? "Conta" : "Setor"} ${link.origin} — ${origin?.rubric ?? origin?.name ?? "Fora do recorte"} — ${formatPercent(link.percent)}%` });
      const edit = createElement("button", { type: "button", className: "secondary-button edit-link", textContent: "Editar" });
      edit.addEventListener("click", () => search.openDialog(`Editar ${originLabel(link, state.model)}`, [link], edit));
      const remove = createElement("button", { type: "button", className: "secondary-button remove-link", textContent: "Remover vínculo" });
      remove.dataset.id = link.id;
      const actions = createElement("div", { className: "link-list-actions" });
      actions.append(edit, remove);
      const item = createElement("li");
      item.append(text, actions);
      return item;
    }));
  }

  function syncSectorSelection() {
    const id = $("#link-box").value;
    const box = state.organogram.boxes.find(item => item.id === id);
    for (const node of document.querySelectorAll(".sector-node")) {
      const active = node.dataset.sectorId === id;
      node.classList.toggle("is-selected", active);
      node.setAttribute("aria-pressed", String(active));
    }
    $("#selected-sector-note").textContent = box
      ? `Setor selecionado: ${box.name}. Os vínculos abaixo mostram as origens atribuídas a ele.`
      : "Selecione um setor no organograma ou nesta lista.";
  }

  function selectSectorForLinks(id) {
    if (!state.organogram.boxes.some(item => item.id === id)) return;
    linkSelected = id;
    $("#link-box").value = id;
    renderBoxLinks();
    syncSectorSelection();
  }

  // Formulário "Defina o setor administrativo" e lista de setores para vínculo.
  function renderBoxForm() {
    const config = state.organogram, box = config.boxes.find(item => item.id === selected);
    if (!box) selected = "";
    fillSelect($("#box-selection"), [["", "Novo setor administrativo"], ...config.boxes.map(item => [item.id, item.name])], selected);
    $("#box-name").value = box?.name ?? "";
    fillSelect($("#box-parent"), [["", "Sem superior (raiz)"], ...config.boxes.filter(item => item.id !== selected).map(item => [item.id, item.name])]);
    const selectedParents = parentIds(box ?? {});
    for (const option of $("#box-parent").options) option.selected = option.value ? selectedParents.includes(option.value) : selectedParents.length === 0;
    $("#delete-box").disabled = !box;
    $("#create-superior").disabled = !box;
    $("#superior-name").disabled = !box;
    const previous = linkSelected || $("#link-box").value;
    fillSelect($("#link-box"), config.boxes.map(item => [item.id, item.name]));
    linkSelected = selected || (config.boxes.some(item => item.id === previous) ? previous : config.boxes[0]?.id ?? "");
    $("#link-box").value = linkSelected;
    $("#add-link").disabled = config.boxes.length === 0;
  }

  // Filtros Ano e Período, preservando a escolha anterior quando ela ainda existe.
  function renderFilters() {
    const years = modelYears(state.model);
    const year = years.includes(Number($("#organogram-year").value)) ? Number($("#organogram-year").value) : state.model.targetYear;
    fillSelect($("#organogram-year"), years.map(item => [item, item]), year);
    const previousMonth = $("#organogram-month").value;
    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`)
      .filter(period => !state.projection.historyStart || period >= state.projection.historyStart);
    fillSelect($("#organogram-month"), [["", "Ano inteiro"], ...months.map(period => [period, `${period.slice(5)}/${year}`])], months.includes(previousMonth) ? previousMonth : "");
    return year;
  }

  // Contas e ajustes que não somam exatamente 100% entre os setores.
  function renderAllocationIssues() {
    const issues = allocationIssues(state.organogram, state.model);
    $("#allocation-summary").textContent = issues.length
      ? `${issues.length} contas ou ajustes fora de 100%. Salve rascunho JSON; Excel exige distribuição completa.`
      : "Todas as contas e ajustes estão distribuídos em 100%.";
    $("#allocation-list").replaceChildren(...issues.map(issue => {
      const item = createElement("li");
      item.append(createElement("span", { textContent: `${issue.account} · ${issue.rubric}: ${formatPercent(issue.percent)}% distribuído; ${issue.difference > 0 ? "falta" : "excesso de"} ${formatPercent(Math.abs(issue.difference))}%.` }));
      if (issue.difference < 0) {
        const details = createElement("button", { type: "button", className: "secondary-button allocation-details", textContent: "Detalhes" });
        details.dataset.account = issue.account;
        item.append(details);
      }
      return item;
    }));
  }

  // Tabela "Detalhes mensais": para cada setor, valor próprio, vínculos diretos e consolidado.
  function renderMonthlyTable(year) {
    const data = organogramValues(state.organogram, state.model, year);
    const head = createElement("tr");
    for (const label of ["Setor administrativo / origem", "Subtotal", "Grupo", ...data.periods.map(period => `${period.slice(5)}/${period.slice(0, 4)}`), `Total ${year}`, "Ações"]) {
      head.append(createElement("th", { scope: "col", textContent: label }));
    }
    $("#organogram-head").replaceChildren(head);
    const rows = [];
    // Três linhas por item (Receita, Despesa, Resultado); vínculos editáveis na linha da Receita.
    const append = (label, part, values, depth, link) => {
      for (const group of ["Receita", "Despesa", "Resultado"]) {
        const row = createElement("tr");
        for (const [index, text] of [label, part, group].entries()) {
          const td = createElement("td", { textContent: text });
          if (index === 0) td.style.paddingLeft = `${.75 + depth * 1.25}rem`;
          row.append(td);
        }
        for (const value of [...data.periods.map(period => values[period][group]), data.periods.reduce((sum, period) => sum + values[period][group], 0)]) {
          row.append(createElement("td", { textContent: formatMoney(value) }));
        }
        const actions = createElement("td");
        if (link && group === "Receita") {
          const input = createElement("input", { type: "number", min: "0", step: "0.01", value: roundAllocationPercent(link.percent).toFixed(2) });
          input.setAttribute("aria-label", `Percentual de ${link.description}`);
          input.addEventListener("change", () => {
            const value = Number(input.value);
            const percent = value >= 0 ? roundAllocationPercent(value) : value;
            commit(config => { config.links.find(item => item.id === link.id).percent = percent; });
          });
          const remove = createElement("button", { type: "button", className: "text-button", textContent: "Remover vínculo" });
          remove.addEventListener("click", () => commit(config => { config.links = config.links.filter(item => item.id !== link.id); }));
          actions.append(input, remove);
        }
        row.append(actions);
        rows.push(row);
      }
    };
    for (const node of data.nodes) {
      const parent = parentIds(node).map(id => state.organogram.boxes.find(box => box.id === id)?.name).filter(Boolean).join(" · ") || "raiz";
      append(`${node.name} · nível ${node.depth} · superior: ${parent}`, "Próprio", node.own, node.depth);
      for (const link of node.links) append(`${node.name} · ${link.type === "account" ? "Conta" : "Setor"} ${link.origin} · ${link.description} · ${formatPercent(link.percent)}%`, "Vínculo direto", link.values, node.depth + 1, link);
      append(node.name, "Consolidado", node.consolidated, node.depth);
    }
    if (data.nodes.length) append("TOTAL GERAL (raízes)", "Consolidado", data.total, 0);
    $("#organogram-body").replaceChildren(...rows);
    $("#organogram-empty").hidden = data.nodes.length > 0;
  }

  function render() {
    if (!state.model) return;
    renderBoxForm();
    renderBoxLinks();
    search.renderSearch();
    const year = renderFilters();
    renderOrganogramVisual(state.organogram, state.model, year, $("#organogram-month").value, $("#organogram-group").value);
    syncSectorSelection();
    $("#capture-organogram").disabled = !state.organogram.boxes.length;
    if (!state.organogram.boxes.length) $("#organogram-editor").open = true;
    renderOrigins();
    renderAllocationIssues();
    renderMonthlyTable(year);
  }

  return { render, renderOrigins, renderOriginValue, renderBoxLinks, syncSectorSelection, selectSectorForLinks,
    get selected() { return selected; },
    set selected(value) { selected = value; },
    resetSelection() { selected = ""; linkSelected = ""; }
  };
}

// controllers/budget-controller.js

const SCOPES = ["all", "group", "sector", "account"];

// Aceita o formato atual e o formato em português (nome, taxa, ritmo, inicio, fim, alcance, alvo).
function normalizeImportedVariables(input) {
  const values = Array.isArray(input) ? input : input?.variables ?? input?.variaveis;
  if (!Array.isArray(values)) throw new Error("O arquivo não contém uma lista de índices econômicos.");
  return values.map((item, index) => {
    const cadence = item.cadence ?? (normalizeSearch(item.ritmo) === "anual" ? "annual" : "monthly");
    const scopeText = normalizeSearch(item.scope ?? item.alcance ?? "all");
    let scope = scopeText;
    if (scopeText === "receita" || scopeText === "despesa") {
      scope = "group";
    }
    const variable = {
      id: String(item.id || crypto.randomUUID()),
      name: String(item.name ?? item.nome ?? "").trim(),
      rate: Number(String(item.rate ?? item.taxa ?? "").replace(",", ".")),
      cadence,
      start: String(item.start ?? item.inicio ?? ""),
      end: String(item.end ?? item.fim ?? ""),
      scope,
      target: String(item.target ?? item.alvo ?? ""),
      active: item.active !== false,
    };
    const month = /^[0-9]{4}-[0-9]{2}$/;
    if (!variable.name || !Number.isFinite(variable.rate) || variable.rate <= -100 || !month.test(variable.start) || !month.test(variable.end)
      || variable.start > variable.end || !["monthly", "annual"].includes(variable.cadence) || !SCOPES.includes(variable.scope)) {
      throw new Error(`O índice ${index + 1} contém dados inválidos.`);
    }
    return variable;
  });
}

function setupBudgetTable({ rebuild, renderAnalysis }) {
  const { render } = createBudgetView();

  // Grava a edição ao sair do campo (evento change).
  function commitEdit(input) {
    if (input.dataset.kind === "projected" && projectionKind(state.model, input.dataset.period) !== "dynamic") return;
    let amount;
    try {
      amount = parseMoney(input.value);
    } catch (error) {
      setStatus(error.message, true);
      renderAnalysis();
      return;
    }
    const { account, period, kind } = input.dataset;
    const before = editorSnapshot();
    const overrides = kind === "actual" ? state.actualOverrides : state.overrides;
    if (amount === null) delete overrides[`${account}|${period}`];
    else overrides[`${account}|${period}`] = amount;
    try {
      rebuild(input);
      recordHistory(before);
    }
    catch (error) {
      applySnapshot(before);
      rebuild();
      return setStatus(error.message, true);
    }
    const value = periodValues(state.model, state.model.records.find(record => record.account === account), period)[kind];
    input.value = value === null ? "" : formatMoney(value);
    setStatus(`${kind === "actual" ? "Realizado" : "Projeção"} atualizado. Totais e cálculos foram refeitos.`);
  }

  // Durante a digitação, recalcula totais e variações num modelo temporário, sem gravar.
  function previewEdit(input) {
    if (input.readOnly) return;
    const committedModel = state.model;
    try {
      const { account, period, kind } = input.dataset;
      const amount = parseMoney(input.value);
      const overrides = { ...state.overrides }, actualOverrides = { ...state.actualOverrides };
      const target = kind === "actual" ? actualOverrides : overrides;
      if (amount === null) delete target[`${account}|${period}`];
      else target[`${account}|${period}`] = amount;
      state.model = buildBudget(state.source.rows, Number(state.endYear), state.variables, overrides, actualOverrides, state.projection);
      state.model.organogram = state.organogram;
      input.removeAttribute("aria-invalid");
    } catch {
      // Entradas incompletas não são gravadas nem substituem os últimos cálculos confirmados.
      input.setAttribute("aria-invalid", "true");
    }
    try {
      renderAnalysis(input);
    }
    finally {
      state.model = committedModel;
    }
  }

  $("#account-search").addEventListener("input", () => render(state.viewYear));
  $("#budget-body").addEventListener("input", event => { if (event.target.matches("input[data-account]")) previewEdit(event.target); });
  $("#budget-body").addEventListener("change", event => { if (event.target.matches("input[data-account]")) commitEdit(event.target); });
  return { render };
}

function setupHorizon({ rebuild }) {
  const render = renderHorizon;

  function changeEndYear(event) {
    const before = editorSnapshot();
    state.endYear = Number(event.target.value);
    if (state.projection.resumeAt > `${state.endYear}-12`) {
      state.endYear = before.endYear;
      render();
      return setStatus("O horizonte deve incluir Retomar em. Ajuste os meses antes de reduzir o horizonte.", true);
    }
    try {
      rebuild();
    }
    catch (error) {
      state.endYear = before.endYear
      rebuild();
      return setStatus(error.message, true);
    }
    recordHistory(before);
    setStatus(`Horizonte atualizado para dezembro de ${state.endYear}.`);
  }

  function changePeriods() {
    const before = editorSnapshot();
    const projection = { ...state.projection, copyThrough: $("#copy-through").value, resumeAt: $("#resume-at").value };
    const historyStart = $("#history-start").value;
    if (historyStart === state.model.availableActualPeriods[0]) delete projection.historyStart;
    else projection.historyStart = historyStart;
    // A primeira escolha de um intervalo fixo guarda suas entradas, sem salvar projeções derivadas.
    if (!projection.initial && monthRange(projection.copyThrough, projection.resumeAt).length > 2) {
      projection.initial = deepCopy({ variables: state.variables, actualOverrides: state.actualOverrides });
    }
    state.projection = projection;
    try {
      rebuild();
    } catch (error) {
      state.projection = before.projection;
      rebuild();
      return setStatus(error.message, true);
    }
    recordHistory(before);
    setStatus("Períodos atualizados.");
  }

  $("#end-year").addEventListener("change", changeEndYear);
  $("#history-start").addEventListener("change", changePeriods);
  $("#copy-through").addEventListener("change", changePeriods);
  $("#resume-at").addEventListener("change", changePeriods);
  return { render };
}

function setupIndices({ rebuild }) {
  const render = renderIndices;

  function addVariable(event) {
    event.preventDefault();
    const start = $("#variable-start").value, end = $("#variable-end").value, rate = Number($("#variable-rate").value);
    if (!start || !end || start > end) return setStatus("Informe uma vigência válida para o índice econômico.", true);
    if (start < `${state.model.targetYear}-01`) return setStatus("O índice deve começar no ano de referência ou depois.", true);
    if (!Number.isFinite(rate) || rate <= -100) return setStatus("A taxa deve ser um número maior que -100%.", true);
    const scope = $("#variable-scope").value;
    const before = editorSnapshot();
    state.variables.push({
      id: crypto.randomUUID(),
      name: $("#variable-name").value.trim(),
      rate,
      cadence: $("#variable-cadence").value,
      start,
      end,
      scope,
      target: scope === "all" ? "" : $("#variable-target").value,
      active: true,
    });
    try {
      buildBudget(state.source.rows, state.endYear, state.variables, state.overrides, state.actualOverrides, state.projection);
    }
    catch (error) {
      state.variables = before.variables;
      return setStatus(error.message, true);
    }
    event.currentTarget.reset();
    $("#variable-scope").value = "all";
    $("#variable-start").value = state.model.forecastPeriods[0];
    $("#variable-end").value = `${state.endYear}-12`;
    recordHistory(before);
    rebuild();
    setStatus("Índice econômico adicionado e projeção recalculada.");
  }

  function removeVariable(event) {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const before = editorSnapshot();
    state.variables = state.variables.filter(variable => variable.id !== button.dataset.id);
    recordHistory(before);
    rebuild();
    setStatus("Índice econômico removido e projeção recalculada.");
  }

  async function importVariables(file) {
    if (!file || !state.source) return;
    const before = editorSnapshot();
    const variables = normalizeImportedVariables(await readJsonFile(file));
    for (const variable of variables) {
      if (variable.scope === "group" && !["Receita", "Despesa"].includes(variable.target)) throw new Error(`O índice ${variable.name} precisa apontar para Receita ou Despesa.`);
      if (variable.scope === "sector" && !state.model.sectors.has(variable.target)) throw new Error(`O setor ${variable.target} do índice ${variable.name} não existe nesta planilha.`);
      if (variable.scope === "account" && !state.model.records.some(record => record.account === variable.target)) throw new Error(`A conta ${variable.target} do índice ${variable.name} não existe nesta planilha.`);
    }
    buildBudget(state.source.rows, state.endYear, variables, state.overrides, state.actualOverrides, state.projection);
    state.variables = variables;
    recordHistory(before);
    rebuild();
    setStatus(`${variables.length} ${variables.length === 1 ? "índice importado" : "índices importados"}. A projeção foi recalculada.`);
  }

  function exportVariables() {
    if (!state.source) return;
    const baseName = `indices_economicos_${state.model.targetYear}_${state.endYear}`;
    download(JSON.stringify({ format: "orca-indices", exportedAt: new Date().toISOString(), variables: state.variables }, null, 2), `${baseName}.json`, "application/json");
    setStatus("Índices econômicos exportados.");
  }

  $("#variable-scope").addEventListener("change", renderTargets);
  $("#variable-form").addEventListener("submit", addVariable);
  $("#variables-body").addEventListener("click", removeVariable);
  $("#import-variables").addEventListener("click", () => $("#variables-input").click());
  $("#variables-input").addEventListener("change", event => importVariables(event.target.files[0]).catch(error => setStatus(error.message, true)));
  $("#export-variables").addEventListener("click", exportVariables);
  return { render };
}

// controllers/files-controller.js
// Arquivos: importar a planilha base, abrir/salvar planejamento JSON e exportar o Excel.

function setupFiles({ rebuild }) {
  // Carrega um planejamento validado por restoreProject e abre a área de trabalho.
  function loadProject(project, sourceName, message) {
    Object.assign(state, {
      source: project.source,
      sourceName,
      endYear: Number(project.endYear),
      variables: project.variables,
      overrides: project.overrides,
      actualOverrides: project.actualOverrides,
      projection: project.projection,
      organogram: project.organogram,
      viewYear: Number(project.source.periods.at(-1).slice(0, 4)),
    });
    resetHistory();
    resetFileFields();
    rebuild();
    showLoadedProject(message);
  }

  // Planilha da empresa (.xlsx) ou Excel gerado pelo próprio POU, que traz o planejamento embutido.
  async function importWorkbook(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecione um arquivo com extensão .xlsx.");
    checkFileSize(file);
    setStatus("Lendo e validando a planilha…");
    const { planning, ...source } = await readBudgetWorkbook(file);
    const targetYear = Math.max(...source.periods.map(period => Number(period.slice(0, 4))));
    // Nova base: Projetar até começa no limite máximo (último ano da base + 20).
    const endYear = targetYear + HORIZON_YEARS;
    const { project } = restoreProject(planning ?? { format: "orca-planejamento", version: PROJECT_VERSION, source, endYear });
    loadProject(project, file.name, planning
      ? "Planejamento recuperado com índices, edições, períodos e organograma."
      : `Planilha importada: ${source.rows.length} contas válidas foram reconhecidas.`);
  }

  async function openProject(file) {
    if (!file) return;
    const { project } = restoreProject(await readJsonFile(file));
    loadProject(project, project.sourceName || "Planejamento salvo", "Planejamento restaurado com seus índices econômicos e edições.");
  }

  function saveProject() {
    download(JSON.stringify(createProject(state.model, state.sourceName)), `planejamento_${state.model.targetYear}_${state.endYear}.json`, "application/json");
    setStatus("Planejamento salvo. O arquivo pode ser aberto novamente nesta página.");
  }

  async function exportWorkbook() {
    const button = $("#export-xlsx");
    button.disabled = true;
    button.textContent = "Gerando Excel…";
    try {
      const bytes = await createBudgetWorkbook(state.model, { sourceName: state.sourceName });
      download(bytes, `planejamento_orcamentario_${state.model.targetYear}_${state.model.endYear}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setStatus("Excel exportado com despesas e percentuais por setor.");
    } catch (error) {
      setStatus(`Não foi possível gerar o Excel: ${error.message}`, true);
    } finally {
      button.disabled = allocationIssues(state.organogram, state.model).length > 0;
      button.textContent = "Exportar Excel ↓";
    }
  }

  const reportError = error => setStatus(error.message, true);
  $("#xlsx-input").addEventListener("change", event => importWorkbook(event.target.files[0]).catch(reportError));
  $("#project-input").addEventListener("change", event => openProject(event.target.files[0]).catch(reportError));
  $("#change-file").addEventListener("click", () => $("#xlsx-input").click());
  $("#save-project").addEventListener("click", saveProject);
  $("#export-xlsx").addEventListener("click", exportWorkbook);

  // Arrastar e soltar o Excel na área de importação.
  const dropZone = $("#drop-zone");
  for (const eventName of ["dragenter", "dragover"]) dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  for (const eventName of ["dragleave", "drop"]) dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
  dropZone.addEventListener("drop", event => importWorkbook(event.dataTransfer.files[0]).catch(reportError));
}

// controllers/organogram-controller.js
// Aba Organograma Orçamentário: setores administrativos, vínculos, filtros, alertas e tabela mensal.
// A busca de vínculos e a janela de edição ficam em organogram-search-view.js.

// changed(before): registra o estado anterior no histórico e recalcula a página.
function setupOrganogram({ changed }) {

  // Aplica uma alteração numa cópia, valida e só então substitui o organograma.
  function commit(edit) {
    const before = editorSnapshot(), candidate = structuredClone(state.organogram);
    const previousSelection = view.selected;
    try {
      edit(candidate);
      const validated = validateOrganogram(candidate, state.model);
      organogramValues(validated, state.model, state.viewYear);
      state.organogram = validated;
      changed(before);
      setStatus("Organograma atualizado.");
    } catch (error) {
      view.selected = previousSelection;
      setStatus(error.message, true);
    }
  }

  const search = setupLinkSearch({ commit });
  const view = createOrganogramView({ commit, search });
  const { render, renderOrigins, renderOriginValue, renderBoxLinks, syncSectorSelection, selectSectorForLinks } = view;

  function replaceOrganogram(config, message) {
    const before = editorSnapshot();
    state.organogram = config;
    view.resetSelection();
    changed(before);
    setStatus(message);
  }

  $("#box-selection").addEventListener("change", event => { view.selected = event.target.value; render(); });
  $("#box-form").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("#box-name").value.trim(), parents = [...$("#box-parent").selectedOptions].map(option => option.value).filter(Boolean);
    const id = view.selected || crypto.randomUUID();
    commit(config => {
      const box = config.boxes.find(item => item.id === view.selected);
      if (box) { box.name = name; setParentIds(box, parents); }
      else config.boxes.push({ id, name, parent: parents[0] ?? null, ...(parents.length > 1 ? { parents } : {}) });
      view.selected = id;
    });
  });
  $("#delete-box").addEventListener("click", () => {
    const box = state.organogram.boxes.find(item => item.id === view.selected);
    if (!box || !confirm(`Remover ${box.name} e seus vínculos diretos? Os setores subordinados ficarão ligados ao superior deste setor.`)) return;
    commit(config => {
      const removedParents = parentIds(box);
      config.boxes = config.boxes.filter(item => item.id !== view.selected).map(item => {
        const parents = parentIds(item);
        if (!parents.includes(view.selected)) return item;
        return setParentIds({ ...item }, [...parents.filter(parent => parent !== view.selected), ...removedParents]);
      });
      config.links = config.links.filter(link => link.box !== view.selected);
      view.selected = "";
    });
  });
  $("#create-superior").addEventListener("click", () => {
    const name = $("#superior-name").value.trim();
    commit(config => { view.selected = addSuperior(config, view.selected, crypto.randomUUID(), name).id; });
    $("#superior-name").value = "";
  });
  $("#link-percent").addEventListener("change", event => {
    const input = event.target;
    if (input.value && Number.isFinite(Number(input.value)) && Number(input.value) >= 0) {
      input.value = roundAllocationPercent(Number(input.value)).toFixed(2);
    }
  });
  $("#link-form").addEventListener("submit", event => {
    event.preventDefault();
    commit(config => config.links.push({ id: crypto.randomUUID(), box: $("#link-box").value, type: $("#origin-type").value, origin: $("#link-origin").value, percent: roundAllocationPercent(Number($("#link-percent").value)) }));
  });
  $("#origin-search").addEventListener("input", renderOrigins);
  $("#origin-type").addEventListener("change", renderOrigins);
  $("#link-origin").addEventListener("change", renderOriginValue);
  $("#link-box").addEventListener("change", event => { selectSectorForLinks(event.target.value); });
  $("#sector-tree").addEventListener("click", event => {
    const node = event.target.closest(".sector-node");
    if (node) selectSectorForLinks(node.dataset.sectorId);
  });
  $("#sector-tree").addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key)) return;
    const node = event.target.closest(".sector-node");
    if (node) selectSectorForLinks(node.dataset.sectorId);
  });
  $("#link-list").addEventListener("click", event => {
    const button = event.target.closest("button[data-id]");
    if (button) commit(config => { config.links = config.links.filter(link => link.id !== button.dataset.id); });
  });
  // "Detalhes" de uma conta acima de 100%: mostra todos os vínculos que a distribuem.
  $("#allocation-list").addEventListener("click", event => {
    const button = event.target.closest("button[data-account]");
    if (!button) return;
    const record = state.model.records.find(item => item.account === button.dataset.account);
    const ids = new Set(search.accountLinks(record.account).map(link => link.id));
    search.openDialog(`Distribuição de ${record.account} · ${record.rubric}`, state.organogram.links.filter(link => ids.has(link.id)), button);
  });
  for (const id of ["#organogram-year", "#organogram-month", "#organogram-group"]) $(id).addEventListener("change", render);
  $("#default-organogram").addEventListener("click", () => {
    const standard = defaultOrganogram(state.model);
    const sectorCount = standard.boxes.length;
    if (state.organogram.boxes.length && !confirm(`Substituir o organograma atual pelo padrão AGE com ${sectorCount} setores e divisão igualitária?`)) return;
    replaceOrganogram(validateOrganogram(standard, state.model), `Organograma padrão AGE carregado: ${sectorCount} setores, cada um com 100 ÷ ${sectorCount} de todas as receitas e despesas.`);
  });
  $("#export-organogram").addEventListener("click", () => download(JSON.stringify(state.organogram, null, 2), "organograma_orcamentario.json", "application/json"));
  $("#capture-organogram").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const blob = await captureOrganogramPng($("#sector-tree"));
      const year = $("#organogram-year").value || state.model.targetYear;
      const period = $("#organogram-month").value ? `_${$("#organogram-month").value.slice(5)}` : "";
      download(blob, `organograma_${year}${period}.png`, "image/png");
      setStatus("Imagem do organograma salva em PNG.");
    } catch (error) { setStatus(error.message, true); }
    finally {
      button.disabled = !state.organogram.boxes.length
      button.removeAttribute("aria-busy");
    }
  });
  $("#import-organogram").addEventListener("click", () => $("#organogram-input").click());
  $("#organogram-input").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      replaceOrganogram(validateOrganogram(await readJsonFile(file), state.model), "Organograma importado. Estrutura anterior substituída.");
    } catch (error) { setStatus(error.message, true); }
    event.target.value = "";
  });
  return { render };
}

// controllers/app-controller.js
// Ponto de entrada da página. Liga os módulos de interface e mantém o ciclo:
// alteração do usuário → rebuild() recalcula o modelo → renderAll() redesenha tudo.

// Recalcula o modelo a partir das entradas do estado e redesenha a página.
// activeInput: campo em digitação na tabela, preservado durante o redesenho.
function rebuild(activeInput = null) {
  if (!state.source) return;
  if (!state.projection) {
    const base = buildBudget(state.source.rows, Number(state.endYear));
    state.projection = { copyThrough: base.lastActual, resumeAt: base.forecastPeriods[0], initial: null };
  }
  state.model = buildBudget(state.source.rows, Number(state.endYear), state.variables, state.overrides, state.actualOverrides, state.projection);
  state.model.organogram = state.organogram;
  renderAll(activeInput);
}

// Toda alteração confirmada: registra o estado anterior no histórico e recalcula.
function changed(before) {
  recordHistory(before);
  rebuild();
}

function renderAll(activeInput = null) {
  renderSource();
  horizon.render();
  indices.render();
  renderYearSelector();
  renderAnalysis(activeInput);
  const issues = allocationIssues(state.organogram, state.model);
  $("#export-xlsx").disabled = issues.length > 0;
  $("#export-validation").textContent = issues.length
    ? `Excel bloqueado: ${issues.length} contas ou ajustes precisam fechar em 100%. Confira Organograma Orçamentário.`
    : "Distribuição completa. Excel disponível.";
  updateHistoryButtons(historyAvailability());
}

// Resumo da base importada, acima da configuração.
// Aba Orçamento (painel e tabela) e aba Organograma dependem do ano exibido.
function renderAnalysis(activeInput = null) {
  const year = Number(state.viewYear);
  renderAnalysisHeader(year);
  renderSummary(state.model, year, Number($("#view-month").value));
  budgetTable.render(year, activeInput);
  organogramEditor.render();
}

function undoChange() {
  const snapshot = stepHistory("undo");
  if (!snapshot) return;
  applySnapshot(snapshot);
  rebuild();
  setStatus("Alteração desfeita. Pressione Ctrl+Y para refazer.");
}

function redoChange() {
  const snapshot = stepHistory("redo");
  if (!snapshot) return;
  applySnapshot(snapshot);
  rebuild();
  setStatus("Alteração refeita.");
}

observeHistory(() => updateHistoryButtons(historyAvailability()));
setupHelpDialog();
setupTabs();
setupFiles({ rebuild });
const horizon = setupHorizon({ rebuild });
const indices = setupIndices({ rebuild });
const budgetTable = setupBudgetTable({ rebuild, renderAnalysis });
const organogramEditor = setupOrganogram({ changed });

$("#view-year").addEventListener("change", event => {
  state.viewYear = Number(event.target.value);
  renderAnalysis();
});
$("#view-month").addEventListener("change", () => renderAnalysis());
$("#undo-change").addEventListener("click", undoChange);
$("#redo-change").addEventListener("click", redoChange);
// Ctrl+Z desfaz; Ctrl+Y ou Ctrl+Shift+Z refaz.
document.addEventListener("keydown", event => {
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    event.shiftKey ? redoChange() : undoChange();
  } else if (key === "y") {
    event.preventDefault();
    redoChange();
  }
});

})();
