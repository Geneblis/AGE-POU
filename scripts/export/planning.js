// Planejamento salvo em JSON (versão 8). Guarda só entradas; o resto é recalculado ao abrir:
//   { format: "orca-planejamento", version: 8, sourceName,
//     source: { rows, periods, sheetName }, endYear, variables, overrides, actualOverrides,
//     projection, organogram }
import { buildBudget, hasBudgetOrigin, HORIZON_YEARS, validMonth } from "../models/budget.js";
import { emptyOrganogram, validateOrganogram } from "../models/organogram.js";

export const PROJECT_VERSION = 8;

// Modelo → JSON salvável. "group" sai das linhas porque budget.js o deduz pelo código da conta.
export function createProject(model, sourceName = "") {
  return { format: "orca-planejamento", version: PROJECT_VERSION, sourceName,
    source: { rows: model.rows.map(({ group, ...row }) => row), periods: model.periods, sheetName: "Dados Analíticos" },
    endYear: model.endYear, variables: model.variables, overrides: model.overrides,
    actualOverrides: model.actualOverrides, projection: model.projection, organogram: model.organogram ?? emptyOrganogram() };
}

// JSON → { project, model }. Valida o que veio de fora antes de calcular: formato e versão,
// meses e números da base, chaves "conta|mês" das edições e o organograma.
// Sem projection (arquivos antigos): Ir até = último realizado e Retomar em = mês seguinte.
export function restoreProject(input, forecastMethod, legacyCutoff = false) {
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
