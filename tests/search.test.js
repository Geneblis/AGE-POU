import test from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, formatPercent } from "../scripts/views/dom.js";
import { recordSearchText } from "../scripts/models/organogram.js";
import { horizonYears } from "../scripts/models/budget.js";

test("busca por palavras ignora acentos, ordem e separadores", () => {
  const record = { group: "Despesa", account: "81706000020007", rubric: "DESPESAS DE ALUGUÉIS - VEÍCULOS", sectorCode: "817", sector: "Despesas Administrativas" };
  const text = recordSearchText(record);
  for (const query of ["aluguéis de veículos", "alugueis veiculos", "VEÍCULOS aluguéis", "81706000020007", "817", "administrativas", "despesa", ""]) assert.equal(matchesSearch(text, query), true, query);
  for (const query of ["aluguéis de imóveis", "receita"]) assert.equal(matchesSearch(text, query), false, query);
});

test("Projetar até lista o último ano da base e os 20 anos seguintes", () => {
  assert.deepEqual([horizonYears(2026)[0], horizonYears(2026).at(-1), horizonYears(2026).length], [2026, 2046, 21]);
  assert.deepEqual([horizonYears(2015)[0], horizonYears(2015).at(-1)], [2015, 2035]);
});

test("percentuais dos vínculos arredondam e exibem exatamente duas casas", () => {
  for (const [value, label] of [[4.333, "4,33"], [3.999, "4,00"], [4.167, "4,17"], [1.005, "1,01"], [99.996, "100,00"], [100.004, "100,00"], [100, "100,00"]]) {
    assert.equal(formatPercent(value), label);
  }
});
