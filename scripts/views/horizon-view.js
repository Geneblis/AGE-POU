import { horizonYears, monthRange, nextMonth, previousMonth } from "../models/budget.js";
import { $, fillSelect, periodLabel } from "./dom.js";
import { state } from "../models/editor-state.js";
export function renderHorizon() {
  fillSelect($("#end-year"), horizonYears(state.model.targetYear).map(year => [year, year]), state.endYear);
  const { historyStart, copyThrough, resumeAt } = state.projection;
  const available = state.model.availableActualPeriods;
  const fixedMonths = monthRange(copyThrough, resumeAt).slice(1, -1);
  const copyEnd = `até ${periodLabel(copyThrough)}, inclusive`;
  let copySummary = `Até ${periodLabel(copyThrough)}, inclusive`;
  if (historyStart) {
    copySummary = historyStart <= copyThrough
      ? `De ${periodLabel(historyStart)} ${copyEnd}`
      : "Sem cópia do Realizado neste cenário";
  }
  $("#projection-copy").textContent = copySummary;
  $("#projection-fixed").textContent = fixedMonths.length ? `${periodLabel(fixedMonths[0])} a ${periodLabel(fixedMonths.at(-1))}` : "Sem intervalo fixo neste cenário";
  $("#projection-dynamic").textContent = `A partir de ${periodLabel(resumeAt)}, inclusive`;
  // Os valores salvos continuam sendo os limites efetivos; os rótulos mostram as escolhas do usuário.
  const first = available[0], last = `${state.endYear}-12`;
  const startOptions = available.filter(period => period <= nextMonth(copyThrough));
  fillSelect($("#history-start"), startOptions.map(period => [period, periodLabel(period)]), historyStart ?? first);
  fillSelect($("#copy-through"), monthRange(previousMonth(first), last).map(period => [period, periodLabel(nextMonth(period))]), copyThrough);
  fillSelect($("#resume-at"), monthRange(first, last).map(period => [period, periodLabel(previousMonth(period))]), resumeAt);
}

