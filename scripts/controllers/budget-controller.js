import { buildBudget, formatMoney, parseMoney, periodValues, projectionKind, monthRange } from "../models/budget.js";
import { $, setStatus, deepCopy, download, normalizeSearch, readJsonFile } from "../views/dom.js";
import { editorSnapshot, recordHistory, applySnapshot, state } from "../models/editor-state.js";
import { createBudgetView } from "../views/budget-view.js";
import { renderHorizon } from "../views/horizon-view.js";
import { renderIndices, renderTargets } from "../views/indices-view.js";

const SCOPES = ["all", "group", "sector", "account"];

// Aceita o formato atual e o formato em português (nome, taxa, ritmo, inicio, fim, alcance, alvo).
function normalizeImportedVariables(input) {
  const values = Array.isArray(input) ? input : input?.variables ?? input?.variaveis;
  if (!Array.isArray(values)) throw new Error("O arquivo não contém uma lista de índices econômicos.");
  return values.map((item, index) => {
    const cadence = item.cadence ?? (normalizeSearch(item.ritmo) === "anual" ? "annual" : "monthly");
    const scopeText = normalizeSearch(item.scope ?? item.alcance ?? "all");
    let scope = "all";
    if (SCOPES.includes(scopeText)) {
      scope = scopeText;
    } else if (scopeText === "receita" || scopeText === "despesa") {
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

export function setupBudgetTable({ rebuild, renderAnalysis }) {
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

export function setupHorizon({ rebuild }) {
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

export function setupIndices({ rebuild }) {
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
