import { formatMoney, modelYears, periodValues, periodsForYear } from "../models/budget.js";
import { roundAllocationPercent, allocationIssues, organogramValues, originLabel, parentIds, recordSearchText } from "../models/organogram.js";
import { renderOrganogramVisual } from "./organogram-visual.js";
import { $, createElement, fillSelect, formatPercent, matchesSearch } from "./dom.js";
import { state } from "../models/editor-state.js";
export function createOrganogramView({ commit, search }) {
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
