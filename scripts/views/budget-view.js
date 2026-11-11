import { modelYears } from "../models/budget.js";
import { fillSelect } from "./dom.js";
import { budgetLayout, formatMoney, periodValues, periodsForYear, projectionKind, variance } from "../models/budget.js";
import { $, formatVariance, matchesSearch, periodLabel } from "./dom.js";
import { state } from "../models/editor-state.js";
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

export function createBudgetView() {
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

export function renderYearSelector() {
  const years = modelYears(state.model);
  if (!years.includes(Number(state.viewYear))) state.viewYear = state.model.targetYear;
  fillSelect($("#view-year"), years.map(year => [year, year]), state.viewYear);
}

