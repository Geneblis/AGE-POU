import { createOrganogramView } from "../views/organogram-view.js";
// Aba Organograma Orçamentário: setores administrativos, vínculos, filtros, alertas e tabela mensal.
// A busca de vínculos e a janela de edição ficam em organogram-search-view.js.
import { roundAllocationPercent, addSuperior, defaultOrganogram, validateOrganogram, organogramValues, parentIds, setParentIds } from "../models/organogram.js";
import { captureOrganogramPng } from "../views/organogram-visual.js";
import { setupLinkSearch } from "../views/organogram-search-view.js";
import { $, download, readJsonFile, setStatus } from "../views/dom.js";
import { editorSnapshot, state } from "../models/editor-state.js";

// changed(before): registra o estado anterior no histórico e recalcula a página.
export function setupOrganogram({ changed }) {

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
