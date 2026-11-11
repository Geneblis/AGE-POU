import test from "node:test";
import assert from "node:assert/strict";
import { buildBudget, nextMonth, previousMonth, projectionKind } from "../scripts/models/budget.js";
import { fixture } from "./fixtures.js";
import { setupHorizon } from "../scripts/controllers/budget-controller.js";
import { state } from "../scripts/models/editor-state.js";

test("campos usam mês anterior para Ir até e seguinte para Retomar em, inclusive na virada do ano", () => {
  const elements = new Map();
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { value: "", classList: { toggle() {} }, addEventListener(event, handler) { this.change = handler; }, replaceChildren(...children) { this.options = children; } });
      return elements.get(selector);
    },
    createElement() { return {}; },
  };
  try {
    const rows = fixture();
    state.source = { rows }; state.endYear = 2030;
    state.variables = []; state.overrides = {}; state.actualOverrides = {};
    state.projection = { copyThrough: "2026-07", resumeAt: "2026-08", initial: null };
    const rebuild = () => { state.model = buildBudget(rows, state.endYear, [], {}, {}, state.projection); };
    rebuild();
    const ui = setupHorizon({ rebuild }); ui.render();
    const copy = elements.get("#copy-through"), resume = elements.get("#resume-at");
    const choose = (select, label) => { select.value = select.options.find(option => option.textContent === label).value; };
    choose(copy, "01/2026"); choose(resume, "09/2030"); copy.change(); ui.render();
    assert.equal(state.projection.copyThrough, "2025-12");
    assert.equal(state.projection.resumeAt, "2030-10");
    assert.equal(projectionKind(state.model, "2025-12"), "copy");
    assert.equal(projectionKind(state.model, "2026-01"), "fixed");
    assert.equal(projectionKind(state.model, "2030-09"), "fixed");
    assert.equal(projectionKind(state.model, "2030-10"), "dynamic");
    choose(copy, "01/2025"); copy.change();
    assert.equal(state.projection.copyThrough, "2024-12");
    assert.equal(state.model.forecastPeriods[0], "2025-01");
    assert.equal(nextMonth("2030-12"), "2031-01");
    assert.equal(previousMonth("2031-01"), "2030-12");

    choose(copy, "01/2026"); copy.change(); ui.render();
    const start = elements.get("#history-start");
    assert.equal(start.value, "2025-01");
    choose(start, "07/2025"); start.change(); ui.render();
    assert.equal(state.projection.historyStart, "2025-07");
    assert.equal(state.model.actualPeriods[0], "2025-07");
    assert.equal(state.projection.copyThrough, "2025-12");
    assert.equal(state.projection.resumeAt, "2030-10");
    choose(copy, "06/2025"); copy.change(); ui.render();
    assert.equal(state.projection.copyThrough, "2025-12");
    assert.equal(copy.value, "2025-12");
    assert.match(elements.get("#status").textContent, /Começar em/);
    choose(start, "01/2025"); start.change();
    assert.equal(state.model.actualPeriods[0], "2025-01");
  } finally { globalThis.document = originalDocument; }
});
