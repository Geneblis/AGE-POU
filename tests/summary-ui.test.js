import test from "node:test";
import assert from "node:assert/strict";
import { buildBudget, formatMoney } from "../scripts/models/budget.js";
import { fixture } from "./fixtures.js";
import { renderSummary } from "../scripts/views/summary-view.js";

test("resumo limita totais e gráfico ao mês sem alterar o modelo", () => {
  const nodes = new Map();
  const node = () => ({ dataset: {}, classList: { toggle() {} }, setAttribute() {}, append() {}, replaceChildren(...children) { this.children = children; } });
  globalThis.document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }, querySelectorAll() { return []; }, createElementNS: node };
  try {
    const model = buildBudget(fixture(), 2026);
    const before = JSON.stringify(model);
    renderSummary(model, 2026, 9);
    assert.equal(nodes.get("#total-revenue").textContent, formatMoney(1080));
    assert.equal(nodes.get("#result-chart").children.length, 10);
    assert.match(nodes.get("#projected-band-period").textContent, /setembro/);
    renderSummary(model, 2026);
    assert.equal(nodes.get("#total-revenue").textContent, formatMoney(1440));
    assert.equal(nodes.get("#result-chart").children.length, 13);
    assert.equal(JSON.stringify(model), before);
    const cut = buildBudget(fixture(), 2026, [], {}, {}, {
      historyStart: "2026-03", copyThrough: "2026-07", resumeAt: "2026-08",
    });
    renderSummary(cut, 2026, 9);
    assert.equal(nodes.get("#actual-revenue").textContent, formatMoney(600));
    assert.equal(nodes.get("#total-revenue").textContent, formatMoney(840));
    assert.equal(nodes.get("#actual-band-period").textContent, "Março a julho de 2026");
    assert.equal(nodes.get("#projected-band-period").textContent, "Março a setembro de 2026");
  } finally { delete globalThis.document; }
});
