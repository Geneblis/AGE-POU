// Organograma: busca de receitas e despesas e janela para editar ou remover seus vínculos.
import { roundAllocationPercent, allocationBreakdown, originLabel, recordSearchText } from "../models/organogram.js";
import { $, createElement, formatPercent, matchesSearch, setStatus } from "./dom.js";
import { state } from "../models/editor-state.js";

const MAX_RESULTS = 50;

// commit(edit): aplica uma alteração no organograma, valida e registra no histórico.
export function setupLinkSearch({ commit }) {
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
