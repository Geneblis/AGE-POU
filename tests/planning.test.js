import test from "node:test";
import assert from "node:assert/strict";
import { buildBudget, periodValues, variance, periodsForYear } from "../scripts/models/budget.js";
import { emptyOrganogram, addSuperior, validateOrganogram, allocationIssues, allocationBreakdown, organogramValues } from "../scripts/models/organogram.js";

import { fixture, allocated } from "./fixtures.js";

test("distribuição aceita apenas somas exibidas como 100% com duas casas decimais", () => {
  const model = buildBudget(fixture(), 2027);
  const config = allocated(model);
  for (const percent of [99.996, 100, 100.004, 99.995, 100.00499999, 99.999, 100.001]) {
    for (const link of config.links) link.percent = percent;
    assert.deepEqual(allocationIssues(config, model), [], `${percent}% deve liberar a exportação`);
    assert.ok(config.links.every(link => link.percent === percent));
  }
  for (const percent of [0, 99.99499, 99.99, 100.005, 100.01, 101]) {
    for (const link of config.links) link.percent = percent;
    const issues = allocationIssues(config, model);
    assert.equal(issues.length, model.records.length, `${percent}% deve bloquear a exportação`);
    assert.equal(issues[0].percent, percent);
    assert.equal(issues[0].difference, 100 - percent);
  }
});

test("hierarquia pode começar pelo filho, criando superiores sem mover vínculos ou duplicar valores", () => {
  const model = buildBudget(fixture(), 2027);
  const config = { ...emptyOrganogram(), boxes: [{ id: "leaf", name: "Gerência", parent: null }],
    links: [{ id: "income", box: "leaf", type: "sector", origin: "711", percent: 100 }] };
  addSuperior(config, "leaf", "middle", "Superintendência");
  addSuperior(config, "middle", "root", "Diretoria");
  validateOrganogram(config, model);
  assert.equal(config.boxes.find(b => b.id === "leaf").parent, "middle");
  assert.equal(config.links[0].box, "leaf");
  assert.equal(organogramValues(config, model, 2026).total["2026-01"].Receita, 120);
  addSuperior(config, "leaf", "inserted", "Coordenação");
  assert.equal(config.boxes.find(b => b.id === "inserted").parent, "middle");
  assert.equal(config.boxes.find(b => b.id === "leaf").parent, "inserted");
  assert.throws(() => addSuperior(config, "leaf", "root", "Duplicado"), /nome válido/);
});

test("organograma aceita múltiplos superiores e consolida cada setor uma vez", () => {
  const model = buildBudget(fixture(), 2027);
  const config = { ...emptyOrganogram(), boxes: [
    { id: "auditoria", name: "Auditoria", parent: null },
    { id: "presidencia", name: "Presidência", parent: null },
    { id: "ouvidoria", name: "Ouvidoria", parent: "presidencia" },
    { id: "multi", name: "Setor compartilhado", parent: "presidencia", parents: ["presidencia", "ouvidoria"] },
  ], links: [{ id: "income", box: "multi", type: "sector", origin: "711", percent: 100 }] };
  const validated = validateOrganogram(config, model);
  assert.deepEqual(validated.boxes.find(box => box.id === "multi").parents, ["presidencia", "ouvidoria"]);
  const values = organogramValues(validated, model, 2026);
  assert.equal(values.nodes.filter(node => node.parent === null).length, 2);
  assert.equal(values.nodes.find(node => node.id === "ouvidoria").totals.consolidated.Receita, 120 * 7);
  assert.equal(values.nodes.find(node => node.id === "presidencia").totals.consolidated.Receita, 120 * 7);
  assert.equal(values.total["2026-01"].Receita, 120);
});

test("recusa conta analítica duplicada antes de calcular ou exportar linhas ambíguas", () => {
  const rows = fixture(); rows.push({ ...rows[2], sourceRow: 999 });
  assert.throws(() => buildBudget(rows, 2027), /Conta analítica duplicada/);
});

test("três períodos preservam referência inicial após edições e mudanças de datas", () => {
  const rows = fixture();
  const variable = { id: "v", name: "Índice inicial", active: true, rate: 10, cadence: "monthly", scope: "all", target: "", start: "2026-06", end: "2027-12" };
  const projection = { copyThrough: "2026-05", resumeAt: "2026-09", initial: { variables: [variable], actualOverrides: {} } };
  const first = buildBudget(rows, 2027, [variable], {}, {}, projection);
  const account = first.records[0].account;
  const edited = buildBudget(rows, 2027, [{ ...variable, rate: 50 }], { [`${account}|2026-06`]: 999 }, { [`${account}|2026-01`]: 999, [`${account}|2026-07`]: 0 }, projection);
  for (const period of ["2026-06", "2026-07", "2026-08"]) assert.equal(periodValues(edited, edited.records[0], period).projected, periodValues(first, first.records[0], period).projected);
  assert.equal(periodValues(edited, edited.records[0], "2026-07").actual, 0);
  assert.notEqual(periodValues(edited, edited.records[0], "2026-09").projected, periodValues(first, first.records[0], "2026-09").projected);
  assert.equal(periodValues(first, first.records[0], "2026-05").projected, 120);
  const moved = buildBudget(rows, 2027, [], {}, {}, { ...projection, copyThrough: "2026-01", resumeAt: "2026-12" });
  assert.equal(periodValues(moved, moved.records[0], "2026-06").projected, periodValues(first, first.records[0], "2026-06").projected);
  assert.equal(new Set(periodsForYear(first, 2026)).size, 12);
  assert.equal(periodsForYear(first, 2026).length, 12);
  assert.throws(() => buildBudget(rows, 2027, [], {}, {}, { copyThrough: "2026-07", resumeAt: "2026-07" }), /Ir até/);
});

test("Ir até aceita o primeiro mês disponível na planilha", () => {
  const model = buildBudget(fixture(), 2027, [], {}, {}, { copyThrough: "2025-01", resumeAt: "2025-02", initial: null });
  assert.equal(model.actualPeriods[0], "2025-01");
  assert.equal(periodValues(model, model.records[0], "2025-01").projected, 100);
});

test("variação usa Realizado menos Projetado e mantém 0% sem base", () => {
  assert.equal(variance(120, 100), .2);
  assert.equal(variance(80, 100), -.2);
  assert.equal(variance(100, 100), 0);
  assert.equal(variance(0, 100), -1);
  assert.equal(variance(null, 100), 0);
  assert.equal(variance(10, 0), 0);
  assert.equal(variance(10, null), 0);
  assert.equal(variance(-80, -100), .2);
  assert.equal(variance(-120, -100), -.2);
  const rows = fixture(); rows[2].values["2026-07"] = null;
  const model = buildBudget(rows, 2027);
  assert.equal(periodValues(model, model.records[0], "2026-07").actual, null);
});

test("vínculos somam reais de bases diferentes; excesso continua salvável como rascunho", () => {
  const rows = fixture();
  for (const row of rows.filter(r => r.account.startsWith("7"))) {
    for (const period of Object.keys(row.values)) row.values[period] = row.account.length === 14 ? 100 : 400;
  }
  rows.push({ ...rows[2], account: "71100000010002", sourceRow: 100, rubric: "Outra receita", values: Object.fromEntries(Object.keys(rows[2].values).map(p => [p, 300])) });
  const model = buildBudget(rows, 2027);
  const config = { ...emptyOrganogram(), boxes: [{ id: "b", name: "Unidade", parent: null }], links: [
    { id: "a", box: "b", type: "account", origin: "71100000010001", percent: 10 },
    { id: "b", box: "b", type: "account", origin: "71100000010002", percent: 30 },
  ] };
  assert.equal(organogramValues(config, model, 2026).nodes[0].own["2026-01"].Receita, 100);
  config.links[0].percent = 150;
  assert.equal(validateOrganogram(config, model).links[0].percent, 150);
  assert.equal(allocationIssues(config, model).find(i => i.account === "71100000010001").difference, -50);
  assert.deepEqual(allocationBreakdown(config, model, "71100000010001").map(item => [item.boxName, item.percent]), [["Unidade", 150]]);
});

test("organograma expande setores, acumula sobreposição e consolida sem duplicar", () => {
  const model = buildBudget(fixture(), 2027);
  const config = allocated(model);
  assert.deepEqual(allocationIssues(config, model), []);
  const values = organogramValues(config, model, 2026);
  assert.equal(values.nodes[0].totals.own.Receita, 0);
  assert.equal(values.nodes[0].totals.consolidated.Receita, 120 * 7);
  assert.equal(values.total["2026-01"].Receita, 120);
  config.links.push({ id: "extra", box: "root", type: "account", origin: model.records[0].account, percent: 30 });
  assert.equal(allocationIssues(config, model)[0].percent, 130);
  assert.equal(organogramValues(config, model, 2026).nodes[0].own["2026-01"].Receita, 36);
  const changed = buildBudget(fixture(), 2027, [], {}, { [`${model.records[0].account}|2026-01`]: 200 });
  assert.equal(organogramValues(config, changed, 2026).nodes[0].own["2026-01"].Receita, 60);
});

test("importação rejeita ciclos, superiores ausentes e origens inexistentes sem exigir 100% no rascunho", () => {
  const model = buildBudget(fixture(), 2027);
  const config = allocated(model);
  config.boxes[0].parent = "child";
  assert.throws(() => validateOrganogram(config, model), /ciclos/);
  config.boxes[0].parent = "ausente";
  assert.throws(() => validateOrganogram(config, model), /Superior inexistente/);
  config.boxes[0].parent = null;
  config.links[0].origin = "ausente";
  assert.throws(() => validateOrganogram(config, model), /Origem inexistente/);
  assert.deepEqual(validateOrganogram(emptyOrganogram(), model), emptyOrganogram());
  assert.equal(allocationIssues(emptyOrganogram(), model).length, model.records.length);
});

test("importação limita tamanho do organograma antes de processar a hierarquia", () => {
  const model = buildBudget(fixture(), 2027);
  const boxes = Array.from({ length: 501 }, (_, index) => ({ id: `box-${index}`, name: `Setor ${index}`, parent: index ? `box-${index - 1}` : null }));
  assert.equal(organogramValues({ ...emptyOrganogram(), boxes: boxes.slice(0, 500) }, model, 2026).nodes.length, 500);
  assert.throws(() => organogramValues({ ...emptyOrganogram(), boxes }, model, 2026), /máximo 500 setores/);
  const links = Array.from({ length: 10001 }, (_, index) => ({ id: `link-${index}`, box: "box", type: "sector", origin: "711", percent: 0 }));
  assert.throws(() => validateOrganogram({ ...emptyOrganogram(), boxes: [{ id: "box", name: "Setor", parent: null }], links }, model), /máximo 10000 vínculos/);
});
