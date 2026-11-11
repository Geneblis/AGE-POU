// Comportamentos gerais da página: Central de ajuda e abas das ferramentas.
import { $ } from "./dom.js";

export function setupHelpDialog() {
  const button = $("#help-button"), dialog = $("#help-dialog");
  button.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => button.focus());
  // Clique fora da janela fecha a ajuda.
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
}

// Abas acessíveis: clique ou setas, Home e End no teclado.
export function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function select(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      $(`#${item.getAttribute("aria-controls")}`).hidden = !active;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

export function updateHistoryButtons({ canUndo, canRedo }) {
  $("#undo-change").disabled = !canUndo;
  $("#redo-change").disabled = !canRedo;
}
