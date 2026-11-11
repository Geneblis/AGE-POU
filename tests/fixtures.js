import { monthRange } from "../scripts/models/budget.js";
import { emptyOrganogram } from "../scripts/models/organogram.js";

// Base mínima para testes: 2025-01 a 2026-07, uma receita e uma despesa, com totais, setores e contas.
// Em 2026 tudo vale 20% a mais.
export function fixture() {
  const periods = monthRange("2025-01", "2026-07");
  return [["7000000009", "Receitas", 100], ["7110000001", "Crédito", 100], ["71100000010001", "Renda", 100],
    ["8000000006", "Despesas", 60], ["8180000004", "Provisões", 60], ["81830300010006", "Provisão", 60]]
    .map(([account, rubric, amount], index) => ({ account, rubric, sourceRow: index + 2,
      values: Object.fromEntries(periods.map(period => [period, period.startsWith("2026") ? amount * 1.2 : amount])) }));
}

// Organograma de teste com 100% de cada setor da base na Gerência (filha da Diretoria).
export function allocated(model) {
  return { ...emptyOrganogram(), boxes: [{ id: "root", name: "Diretoria", parent: null }, { id: "child", name: "Gerência", parent: "root" }],
    links: [...model.sectors.keys()].map((origin, index) => ({ id: String(index), box: "child", type: "sector", origin, percent: 100 })) };
}
