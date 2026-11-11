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
export const HORIZON_YEARS = 20;

export function horizonYears(targetYear) {
  return Array.from({ length: HORIZON_YEARS + 1 }, (_, index) => targetYear + index);
}

// ---------------------------------------------------------------------------
// Utilitários de números e meses
// ---------------------------------------------------------------------------

export function median(values) {
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
export function monthRange(start, end) {
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
export function addYears(period, years) {
  const [year, month] = period.split("-").map(Number);
  return monthKey(year + years, month);
}

// nextMonth("2026-12") → "2027-01"
export function nextMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
}

export function previousMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
}

// Quantos meses de start até end: monthDistance("2026-01", "2026-03") → 2.
function monthDistance(start, end) {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  return (endYear - startYear) * 12 + endMonth - startMonth;
}

export function validMonth(period) {
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

export function hasSemesterActivity(record, year) {
  return [year - 1, year].some(item => FIRST_HALF.some(month => value(record.actuals[monthKey(item, month)]) !== 0));
}

export function usesHistoricalMedian(forecastMethod) {
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
export function variableFactor(variable, period) {
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
export function applyVariables(base, record, period, variables) {
  return variables.filter(variable => matchesScope(variable, record)).reduce((result, variable) => result * variableFactor(variable, period), base);
}

// Vínculos com ajustes fora do recorte ficam guardados sem gerar linhas de cálculo.
export function hasBudgetOrigin(model, type, id) {
  if (type === "sector") return model.sectors.has(id) || ["R-SEM-SETOR", "D-SEM-SETOR"].includes(id);
  if (model.records.some(record => record.account === id)) return true;
  if (typeof id !== "string" || !id.startsWith("AJUSTE-")) return false;
  const code = id.slice("AJUSTE-".length);
  return ["RECEITA", "DESPESA"].includes(code)
    || (/^\d{3}$/.test(code) && model.sectors.has(code))
    || model.rows.some(row => row.account === code && isExpenseSubtotal(row, model.sectors));
}

export function validateVariables(variables, model) {
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
export function buildBudget(rows, endYear, variables = [], overrides = {}, actualOverrides = {}, projection = null, forecastMethod = "trend", legacyCutoff = false) {
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
export function projectionKind(model, period) {
  if (period <= (model.projection?.copyThrough ?? model.lastActual)) return "copy";
  return model.projection && period < model.projection.resumeAt ? "fixed" : "dynamic";
}

// A variação tem o sinal da diferença entre Realizado e Projetado.
export function variance(actual, projected) {
  if (actual === null || actual === undefined || !Number.isFinite(projected) || projected === 0) return 0;
  return (actual - projected) / Math.abs(projected);
}

export const formatMoney = amount => amount === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);

// "R$ 1.234,56" → 1234.56; vazio → null (apaga a edição).
export function parseMoney(text) {
  const clean = String(text).replace(/R\$/g, "").replace(/\s/g, "");
  if (!clean) return null;
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(clean)) throw new Error("Informe um valor em reais, como R$ 1.234,56.");
  const amount = Number(clean.replaceAll(".", "").replace(",", "."));
  if (!Number.isFinite(amount)) throw new Error("O valor excede o limite numérico.");
  return amount;
}

// Realizado e Projetado que a tela mostra para uma conta num mês. null = sem valor.
export function periodValues(model, record, period) {
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
export function budgetLayout(model) {
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
export function totalsForPeriod(model, period) {
  const totals = { Receita: 0, Despesa: 0 };
  for (const record of model.records) {
    const amount = periodValues(model, record, period).projected ?? 0;
    totals[record.group] += amount;
  }
  return { ...totals, Resultado: totals.Receita - totals.Despesa };
}

// Média mensal do resultado da projeção padrão (sem índices nem edições) no ano.
export function standardAverage(model, year) {
  const periods = model.forecastPeriods.filter(period => Number(period.slice(0, 4)) === Number(year));
  if (!periods.length) return null;
  return periods.reduce((total, period) => total + model.records.reduce((result, record) => {
    const amount = record.forecast[period] ?? 0;
    return result + (record.group === "Receita" ? amount : -amount);
  }, 0), 0) / periods.length;
}

// Meses exibidos do ano: realizados, projetados e, com faixas definidas, todo o horizonte.
export function periodsForYear(model, year) {
  const periods = new Set([...model.actualPeriods, ...model.forecastPeriods, ...(model.projection ? monthRange(`${model.targetYear}-01`, `${model.endYear}-12`) : [])]);
  return [...periods].sort().filter(period => Number(period.slice(0, 4)) === Number(year)
    && (!model.projection?.historyStart || period >= model.projection.historyStart));
}

// Anos disponíveis para exibição: do primeiro mês realizado até o fim do horizonte.
export function modelYears(model) {
  const first = Number(model.actualPeriods[0].slice(0, 4));
  return Array.from({ length: model.endYear - first + 1 }, (_, index) => first + index);
}

export function resultSeries(model, year) {
  return periodsForYear(model, year).map(period => ({
    period,
    result: totalsForPeriod(model, period).Resultado,
  }));
}

export function summarizeYear(model, year) {
  return periodsForYear(model, year).reduce((totals, period) => {
    const month = totalsForPeriod(model, period);
    totals.Receita += month.Receita;
    totals.Despesa += month.Despesa;
    totals.Resultado += month.Resultado;
    return totals;
  }, { Receita: 0, Despesa: 0, Resultado: 0 });
}
