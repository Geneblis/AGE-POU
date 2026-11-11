// Estado da página e histórico de Desfazer/Refazer.
// O estado guarda somente as entradas do usuário; app-controller.js recalcula state.model a partir delas.
import { emptyOrganogram } from "./organogram.js";
const copyEditorData = value => JSON.parse(JSON.stringify(value));
let historyChanged = () => {};

export function observeHistory(listener) {
  historyChanged = listener;
}

export function historyAvailability() {
  return { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 };
}

export const state = {
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
export function editorSnapshot() {
  const { endYear, variables, overrides, actualOverrides, projection, organogram } = state;
  return copyEditorData({ endYear, variables, overrides, actualOverrides, projection, organogram });
}

export function applySnapshot(snapshot) {
  Object.assign(state, copyEditorData(snapshot));
}

const HISTORY_LIMIT = 100;
const history = { undo: [], redo: [] };

// Registra o estado anterior a uma alteração confirmada.
export function recordHistory(before) {
  history.undo.push(before);
  if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
  history.redo = [];
  historyChanged();
}

export function resetHistory() {
  history.undo = [];
  history.redo = [];
  historyChanged();
}

// Guarda o estado atual na pilha oposta e devolve o estado a restaurar (ou null).
export function stepHistory(direction) {
  const [from, to] = direction === "undo" ? [history.undo, history.redo] : [history.redo, history.undo];
  if (!from.length) return null;
  to.push(editorSnapshot());
  return from.pop();
}
