import { state } from "../models/editor-state.js";
import { standardAverage } from "../models/budget.js";
// Painel de totais da aba Orçamento, em duas faixas alinhadas:
// Projetado do ano exibido (Receita, Despesa, Resultado e gráfico) e, abaixo, o Realizado do mesmo ano
// até o último mês importado. Ano sem realizado (futuro) esconde a faixa do Realizado.
import { formatMoney, periodValues, periodsForYear, resultSeries } from "../models/budget.js";
import { $, periodLabel } from "./dom.js";

const fullMonthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

// Soma Realizado e Projetado de cada grupo nos meses informados.
function groupTotals(model, periods) {
  const totals = { actual: { Receita: 0, Despesa: 0 }, projected: { Receita: 0, Despesa: 0 } };
  for (const record of model.records) for (const period of periods) {
    const values = periodValues(model, record, period);
    for (const kind of ["actual", "projected"]) totals[kind][record.group] += values[kind] ?? 0;
  }
  for (const kind of ["actual", "projected"]) totals[kind].Resultado = totals[kind].Receita - totals[kind].Despesa;
  return totals;
}

export function renderSummary(model, year, endMonth = 12) {
  const projected = groupTotals(model, periodsForYear(model, year).filter(period => Number(period.slice(5)) <= endMonth)).projected;
  const actualPeriods = model.actualPeriods.filter(period => Number(period.slice(0, 4)) === year && period <= model.lastActual && Number(period.slice(5)) <= endMonth);
  const actual = groupTotals(model, actualPeriods).actual;
  const historyStart = model.projection?.historyStart;
  const firstMonth = historyStart?.startsWith(`${year}-`)
    ? fullMonthName.format(new Date(`${historyStart}-01T00:00:00Z`))
    : "janeiro";
  const firstLabel = firstMonth[0].toLocaleUpperCase("pt-BR") + firstMonth.slice(1);
  const endLabel = fullMonthName.format(new Date(Date.UTC(year, endMonth - 1, 1)));
  $("#projected-band-period").textContent = `${firstLabel} a ${endLabel} de ${year}`;
  const hasActual = actualPeriods.length > 0;

  $("#projected-band-title").textContent = `PROJETADO · ${year}`;
  $("#summary-panel").classList.toggle("no-actual", !hasActual);
  for (const element of document.querySelectorAll(".actual-band, .actual-card")) element.hidden = !hasActual;
  if (hasActual) {
    const lastMonth = fullMonthName.format(new Date(`${actualPeriods.at(-1)}-01T00:00:00Z`));
    $("#actual-band-title").textContent = `REALIZADO · ${year}`;
    $("#actual-band-period").textContent = `${firstLabel} a ${lastMonth} de ${year}`;
  }
  for (const [id, group] of [["revenue", "Receita"], ["expense", "Despesa"], ["result", "Resultado"]]) {
    $(`#total-${id}`).textContent = formatMoney(projected[group]);
    $(`#actual-${id}`).textContent = hasActual ? formatMoney(actual[group]) : "—";
  }
  $("#total-result").dataset.sign = projected.Resultado < 0 ? "negative" : "positive";
  $("#actual-result").dataset.sign = actual.Resultado < 0 ? "negative" : "positive";

  const lastActualDate = new Date(`${model.lastActual}-01T00:00:00Z`);
  $("#actual-summary-note").textContent = `Dados referentes até ${fullMonthName.format(lastActualDate).toLocaleUpperCase("pt-BR")}, ${model.lastActual.slice(0, 4)}.`
    + (hasActual ? "" : ` ${year} ainda não tem valores realizados.`);
  renderResultChart(model, year, endMonth);
}

// Barras do resultado projetado de cada mês: acima do eixo = sobra, abaixo = falta.
function renderResultChart(model, year, endMonth) {
  const svg = $("#result-chart");
  const series = resultSeries(model, year).filter(item => Number(item.period.slice(5)) <= endMonth);
  const maximum = Math.max(1, ...series.map(item => Math.abs(item.result)));
  const svgElement = (tag, attributes) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  };
  const bars = series.map(({ period, result }, index) => {
    const height = Math.max(1, Math.abs(result) / maximum * 40);
    const bar = svgElement("rect", { x: index * 30 + 5, y: result >= 0 ? 48 - height : 48, width: 20, height, rx: 1, class: result >= 0 ? "positive" : "negative" });
    const title = svgElement("title", {});
    title.textContent = `${periodLabel(period)}: ${formatMoney(result)}`;
    bar.append(title);
    return bar;
  });
  svg.replaceChildren(svgElement("line", { x1: 0, x2: 360, y1: 48, y2: 48 }), ...bars);
  svg.setAttribute("aria-label", `Resultado projetado mensal de ${year}: ${series.map((item, index) => `${index + 1}, ${formatMoney(item.result)}`).join("; ")}`);
}

export function renderAnalysisHeader(year) {
  const average = standardAverage(state.model, year);
  $("#standard-average-label").textContent = `MÉDIA PADRÃO ${year}`;
  $("#standard-average").textContent = average === null ? "—" : formatMoney(average);
  const monthSelect = $("#view-month");
  const historyStart = state.projection.historyStart;
  const firstMonth = historyStart?.startsWith(`${year}-`) ? Number(historyStart.slice(5)) : 1;
  for (const option of monthSelect.options) {
    option.hidden = option.disabled = Number(option.value) < firstMonth;
  }
  if (Number(monthSelect.value) < firstMonth) monthSelect.value = String(firstMonth);
}
