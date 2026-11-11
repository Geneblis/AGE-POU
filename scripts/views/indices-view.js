import { $, fillSelect, periodLabel } from "./dom.js";
import { state } from "../models/editor-state.js";
function scopeLabel(variable) {
  if (variable.scope === "all") return "Todo o orçamento";
  if (variable.scope === "group") return variable.target;
  if (variable.scope === "sector") return state.model.sectors.get(variable.target)?.name ?? variable.target;
  const account = state.model.records.find(item => item.account === variable.target);
  return account ? `${account.account} · ${account.rubric}` : variable.target;
}

// Opções do campo "Alvo" conforme o alcance escolhido.
export function renderTargets() {
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

export function renderIndices() {
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

