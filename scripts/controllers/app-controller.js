import { renderSource } from "../views/files-view.js";
import { renderYearSelector } from "../views/budget-view.js";
import { renderAnalysisHeader } from "../views/summary-view.js";
// Ponto de entrada da página. Liga os módulos de interface e mantém o ciclo:
// alteração do usuário → rebuild() recalcula o modelo → renderAll() redesenha tudo.
import { buildBudget } from "../models/budget.js";
import { allocationIssues } from "../models/organogram.js";
import { $, setStatus } from "../views/dom.js";
import { state, applySnapshot, recordHistory, stepHistory, observeHistory, historyAvailability } from "../models/editor-state.js";
import { setupHelpDialog, setupTabs, updateHistoryButtons } from "../views/page-view.js";
import { setupFiles } from "./files-controller.js";
import { setupHorizon } from "./budget-controller.js";
import { setupIndices } from "./budget-controller.js";
import { renderSummary } from "../views/summary-view.js";
import { setupBudgetTable } from "./budget-controller.js";
import { setupOrganogram } from "./organogram-controller.js";

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
