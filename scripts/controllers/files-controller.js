import { resetFileFields, showLoadedProject } from "../views/files-view.js";
// Arquivos: importar a planilha base, abrir/salvar planejamento JSON e exportar o Excel.
import { HORIZON_YEARS } from "../models/budget.js";
import { allocationIssues } from "../models/organogram.js";
import { createProject, PROJECT_VERSION, restoreProject } from "../export/planning.js";
import { createBudgetWorkbook, readBudgetWorkbook } from "../export/xlsx.js";
import { $, checkFileSize, download, readJsonFile, setStatus } from "../views/dom.js";
import { resetHistory, state } from "../models/editor-state.js";

export function setupFiles({ rebuild }) {
  // Carrega um planejamento validado por restoreProject e abre a área de trabalho.
  function loadProject(project, sourceName, message) {
    Object.assign(state, {
      source: project.source,
      sourceName,
      endYear: Number(project.endYear),
      variables: project.variables,
      overrides: project.overrides,
      actualOverrides: project.actualOverrides,
      projection: project.projection,
      organogram: project.organogram,
      viewYear: Number(project.source.periods.at(-1).slice(0, 4)),
    });
    resetHistory();
    resetFileFields();
    rebuild();
    showLoadedProject(message);
  }

  // Planilha da empresa (.xlsx) ou Excel gerado pelo próprio POU, que traz o planejamento embutido.
  async function importWorkbook(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecione um arquivo com extensão .xlsx.");
    checkFileSize(file);
    setStatus("Lendo e validando a planilha…");
    const { planning, ...source } = await readBudgetWorkbook(file);
    const targetYear = Math.max(...source.periods.map(period => Number(period.slice(0, 4))));
    // Nova base: Projetar até começa no limite máximo (último ano da base + 20).
    const endYear = targetYear + HORIZON_YEARS;
    const { project } = restoreProject(planning ?? { format: "orca-planejamento", version: PROJECT_VERSION, source, endYear });
    loadProject(project, file.name, planning
      ? "Planejamento recuperado com índices, edições, períodos e organograma."
      : `Planilha importada: ${source.rows.length} contas válidas foram reconhecidas.`);
  }

  async function openProject(file) {
    if (!file) return;
    const { project } = restoreProject(await readJsonFile(file));
    loadProject(project, project.sourceName || "Planejamento salvo", "Planejamento restaurado com seus índices econômicos e edições.");
  }

  function saveProject() {
    download(JSON.stringify(createProject(state.model, state.sourceName)), `planejamento_${state.model.targetYear}_${state.endYear}.json`, "application/json");
    setStatus("Planejamento salvo. O arquivo pode ser aberto novamente nesta página.");
  }

  async function exportWorkbook() {
    const button = $("#export-xlsx");
    button.disabled = true;
    button.textContent = "Gerando Excel…";
    try {
      const bytes = await createBudgetWorkbook(state.model, { sourceName: state.sourceName });
      download(bytes, `planejamento_orcamentario_${state.model.targetYear}_${state.model.endYear}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setStatus("Excel exportado com despesas e percentuais por setor.");
    } catch (error) {
      setStatus(`Não foi possível gerar o Excel: ${error.message}`, true);
    } finally {
      button.disabled = allocationIssues(state.organogram, state.model).length > 0;
      button.textContent = "Exportar Excel ↓";
    }
  }

  const reportError = error => setStatus(error.message, true);
  $("#xlsx-input").addEventListener("change", event => importWorkbook(event.target.files[0]).catch(reportError));
  $("#project-input").addEventListener("change", event => openProject(event.target.files[0]).catch(reportError));
  $("#change-file").addEventListener("click", () => $("#xlsx-input").click());
  $("#save-project").addEventListener("click", saveProject);
  $("#export-xlsx").addEventListener("click", exportWorkbook);

  // Arrastar e soltar o Excel na área de importação.
  const dropZone = $("#drop-zone");
  for (const eventName of ["dragenter", "dragover"]) dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  for (const eventName of ["dragleave", "drop"]) dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
  dropZone.addEventListener("drop", event => importWorkbook(event.dataTransfer.files[0]).catch(reportError));
}
