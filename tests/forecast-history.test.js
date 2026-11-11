import test from "node:test";
import assert from "node:assert/strict";
import { buildBudget, modelYears, periodsForYear, periodValues } from "../scripts/models/budget.js";
import { fixture } from "./fixtures.js";

test("a projeção carrega o ajuste mensal para os anos seguintes", () => {
  const model = buildBudget(fixture(), 2028);
  const { forecast } = model.records[0];
  assert.equal(forecast["2026-08"], 120);
  assert.equal(forecast["2027-08"], 140);
  assert.equal(forecast["2028-08"], 160);
});

test("a referência inicial usa a mediana do mesmo mês de todos os anos do recorte", () => {
  const rows = fixture();
  for (const row of rows) {
    row.values["2022-08"] = null;
    row.values["2023-08"] = row.values["2025-08"] * 9;
    row.values["2024-08"] = row.values["2025-08"] * 2;
  }
  const model = buildBudget(rows, 2027);
  assert.equal(model.records[0].forecast["2026-08"], 220);
  assert.equal(model.records[0].forecast["2027-08"], 240);
  const cut = buildBudget(rows, 2026, [], {}, {}, {
    historyStart: "2024-08", copyThrough: "2026-07", resumeAt: "2026-08",
  });
  assert.equal(cut.records[0].forecast["2026-08"], 170);
});

test("mês sem Realizado correspondente usa a média do histórico anterior à projeção", () => {
  const model = buildBudget(fixture(), 2026, [], {}, {}, { copyThrough: "2025-08", resumeAt: "2025-09" });
  assert.equal(model.records[0].forecast["2025-09"], 100);
  assert.equal(model.records[0].forecast["2026-09"], 120);
  assert.equal(model.records[1].forecast["2025-09"], 60);
});

test("o recorte exclui meses antigos dos cálculos fixo e dinâmico e das consultas", () => {
  const rows = fixture();
  for (const row of rows) {
    row.values["2025-03"] *= 100;
    row.values["2025-07"] *= 100;
  }
  const account = "71100000010001";
  const priorEdit = { [`${account}|2026-02`]: 9000 };
  const projection = {
    historyStart: "2026-03", copyThrough: "2026-06", resumeAt: "2026-08",
    initial: { variables: [], actualOverrides: priorEdit },
  };
  const model = buildBudget(rows, 2027, [], {}, { ...priorEdit, [`${account}|2026-03`]: 160 }, projection);
  const record = model.records.find(item => item.account === account);
  assert.equal(model.actualPeriods[0], "2026-03");
  assert.equal(periodsForYear(model, 2026)[0], "2026-03");
  assert.deepEqual(modelYears(model), [2026, 2027]);
  assert.deepEqual(periodValues(model, record, "2026-02"), { actual: null, projected: null });
  assert.deepEqual(periodValues(model, record, "2026-03"), { actual: 160, projected: 160 });
  assert.equal(record.final["2026-07"], 120);
  assert.equal(record.final["2026-08"], 130);
  assert.equal(model.rows[2].values["2025-07"], 10000);
});

test("a leitura da versão 4 reproduz a média sazonal incluindo zeros", () => {
  const rows = fixture();
  for (const row of rows) {
    row.values["2023-08"] = row.values["2025-08"] * 3;
    row.values["2024-08"] = 0;
  }
  const limits = { copyThrough: "2026-07", resumeAt: "2026-08" };
  const model = buildBudget(rows, 2028, [], { "71100000010001|2026-08": 999 }, {}, limits, "seasonal");
  assert.equal(model.records[0].forecast["2026-08"], 400 / 3);
  assert.equal(model.records[0].final["2027-08"], 400 / 3);
  assert.equal(model.records[0].final["2028-08"], 400 / 3);
  const cut = buildBudget(rows, 2026, [], {}, {}, { ...limits, historyStart: "2024-08" }, "seasonal");
  assert.equal(cut.records[0].forecast["2026-08"], 50);
});

test("Começar em equivale a retirar as colunas antigas antes de conciliar a base", () => {
  const rows = fixture();
  rows[0].values["2024-12"] = 900;
  rows[1].values["2024-12"] = 100;
  rows[2].values["2024-12"] = 100;
  const limits = {
    copyThrough: "2026-05", resumeAt: "2026-09",
    initial: { variables: [], actualOverrides: {} },
  };
  const full = buildBudget(rows, 2027);
  assert.ok(full.records.some(record => record.account === "AJUSTE-RECEITA"));
  const trimmed = rows.map(row => ({
    ...row, values: Object.fromEntries(Object.entries(row.values).filter(([period]) => period >= "2025-01")),
  }));
  const actual = buildBudget(rows, 2027, [], {}, {}, { ...limits, historyStart: "2025-01" });
  const expected = buildBudget(trimmed, 2027, [], {}, {}, limits);
  assert.deepEqual(actual.records, expected.records);
  assert.deepEqual(actual.sectors, expected.sectors);
  assert.equal(actual.rows[0].values["2024-12"], 900);
});

test("a mediana setorial ignora conta sem movimento e inclui conta ativa com variação zero", () => {
  const rows = fixture();
  for (const row of rows.slice(0, 3)) {
    for (const month of ["04", "05", "06"]) row.values[`2026-${month}`] = 160;
    for (const month of ["01", "02", "03"]) row.values[`2026-${month}`] = 100;
  }
  const zero = { ...rows[2], sourceRow: 100, account: "71100000010002",
    values: Object.fromEntries(Object.keys(rows[2].values).map(period => [period, 0])) };
  rows.push(zero);
  const [account] = buildBudget(rows, 2026).records;
  assert.equal(account.calculation.sectorChange, 30);
  assert.equal(account.forecast["2026-08"], 160);

  const stable = { ...zero, sourceRow: 101, account: "71100000010003",
    values: Object.fromEntries(Object.keys(zero.values).map(period => [period, 40])) };
  rows.push(stable);
  for (const row of rows.slice(0, 2)) {
    for (const period of Object.keys(row.values)) row.values[period] += 40;
  }
  const [after] = buildBudget(rows, 2026).records;
  assert.equal(after.calculation.sectorChange, 15);
  assert.equal(after.forecast["2026-08"], 145);
});

test("Começar em aceita o mês de Ir até, mas exige um mês disponível da base", () => {
  const rows = fixture();
  const limits = { copyThrough: "2026-06", resumeAt: "2026-07" };
  const calculate = historyStart => buildBudget(rows, 2026, [], {}, {}, { ...limits, historyStart });
  const model = calculate("2026-07");
  assert.equal(model.records[0].final["2026-07"], 0);
  assert.throws(() => calculate("2026-08"), /Começar em/);
  assert.throws(() => calculate("2024-12"), /Começar em/);
  assert.throws(() => calculate("2026-13"), /Começar em/);
});
