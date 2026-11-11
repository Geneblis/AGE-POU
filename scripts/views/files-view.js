import { state } from "../models/editor-state.js";
import { periodLabel } from "./dom.js";
import { $, setStatus } from "./dom.js";

export function resetFileFields() {
  $("#variable-start").value = "";
  $("#variable-end").value = "";
}

export function showLoadedProject(message) {
  $("#workspace").hidden = false;
  document.querySelectorAll(".steps li").forEach(item => item.classList.add("active"));
  setStatus(message);
  $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

export function renderSource() {
  $("#source-name").textContent = state.sourceName;
  $("#source-period").textContent = `${periodLabel(state.source.periods[0])} — ${periodLabel(state.source.periods.at(-1))}`;
  $("#source-accounts").textContent = String(state.source.rows.length);
  $("#source-actual").textContent = periodLabel(state.model.lastActual);
}

