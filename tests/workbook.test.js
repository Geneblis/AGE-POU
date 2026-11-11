import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/vendor/jszip.min.js";
import { fixture, allocated } from "./fixtures.js";
import { buildBudget, periodValues } from "../scripts/models/budget.js";
import { createProject, restoreProject } from "../scripts/export/planning.js";
import { createBudgetWorkbook, readBudgetWorkbook } from "../scripts/export/xlsx.js";
import { readCells } from "../scripts/export/workbook-xml.js";
const Zip = globalThis.JSZip;
const projection = () => ({ copyThrough: "2026-05", resumeAt: "2026-09", initial: { variables: [], actualOverrides: {} } });
function model() {
  const result = buildBudget(fixture(), 2027, [], {}, {}, projection());
  result.organogram = allocated(result);
  return result;
}

test("Excel aceita arredondamento a 100% e preserva percentuais ao reabrir", async () => {
  for (const percent of [99.996, 100.004]) {
    const input = model();
    for (const link of input.organogram.links) link.percent = percent;
    const before = structuredClone(input.organogram);
    const workbook = await createBudgetWorkbook(input);
    const restored = await readBudgetWorkbook(workbook);
    assert.deepEqual(restored.planning.organogram, before);
    assert.deepEqual(input.organogram, before);
  }
  for (const percent of [99.99, 100.01]) {
    const input = model();
    for (const link of input.organogram.links) link.percent = percent;
    await assert.rejects(createBudgetWorkbook(input), /100%/);
  }
});

test("JSON salva somente entradas, restaura valores e permite rascunho incompleto", () => {
  const before = model(), project = createProject(before);
  for (const derived of ["forecast", "adjusted", "final", "records", "calculation", "consolidated"]) assert.equal(JSON.stringify(project).includes(`\"${derived}\"`), false);
  assert.deepEqual(periodValues(restoreProject(project).model, restoreProject(project).model.records[0], "2026-06"), periodValues(before, before.records[0], "2026-06"));
  project.organogram.links = [];
  assert.equal(restoreProject(project).project.organogram.links.length, 0);
  project.actualOverrides["inexistente|2026-01"] = 1;
  assert.throws(() => restoreProject(project), /Edição inválida/);
});

test("Excel usa o mesmo sinal de variação nas despesas mensais e anuais", async () => {
  const expense = "81830300010006";
  const projected = { [`${expense}|2026-08`]: 100, [`${expense}|2026-09`]: 100, [`${expense}|2026-10`]: 0 };
  const actual = { [`${expense}|2026-08`]: 80, [`${expense}|2026-09`]: 120, [`${expense}|2026-10`]: 10 };
  const input = buildBudget(fixture(), 2026, [], projected, actual);
  input.organogram = allocated(input);
  const zip = await Zip.loadAsync(await createBudgetWorkbook(input));
  const cells = readCells(await zip.file("xl/worksheets/sheet1.xml").async("string"));
  const [accountRef] = [...cells].find(([, cell]) => cell.value === expense);
  const row = accountRef.slice(1);
  const ref = label => [...cells].find(([, cell]) => cell.value === label)[0].replace(/3$/, row);
  assert.equal(cells.get(ref("08/2026 Variação")).value, -.2);
  assert.equal(cells.get(ref("09/2026 Variação")).value, .2);
  assert.equal(cells.get(ref("10/2026 Variação")).value, 0);
  const realized = ref("2026 Realizado"), forecast = ref("2026 Projetado");
  const total = cells.get(ref("2026 Variação"));
  assert.ok(total.formula.includes(`(${realized}-${forecast})/ABS(${forecast})`));
  assert.equal(total.value, (cells.get(realized).value - cells.get(forecast).value) / Math.abs(cells.get(forecast).value));
});

test("Excel bloqueia distribuição incompleta; mostra quatro abas e oculta abas técnicas", async () => {
  const input = model();
  input.organogram.links.pop();
  await assert.rejects(createBudgetWorkbook(input), /100%/);
  input.organogram = allocated(input);
  const bytes = await createBudgetWorkbook(input, { sourceName: "base-exemplo.xlsx" });
  const zip = await Zip.loadAsync(bytes, { checkCRC32: true });
  assert.deepEqual(Object.keys(zip.files).filter(path => path.endsWith("/")), []);
  const book = await zip.file("xl/workbook.xml").async("string");
  for (const name of ["Orçamento", "Índices", "Organograma Orçamentário", "Despesas por setor"]) assert.match(book, new RegExp(`name="${name}"[^>]+r:id="[^"]+"/>`));
  for (const name of ["Cálculo", "_Planejador"]) assert.match(book, new RegExp(`name="${name}"[^>]+state="veryHidden"`));
  assert.doesNotMatch(book, /Origem|Comparação|Premissas/);
  for (const sheet of ["sheet4.xml", "sheet5.xml"]) assert.doesNotMatch(await zip.file(`xl/worksheets/${sheet}`).async("string"), /<cols>/);
  const restored = await readBudgetWorkbook(bytes);
  assert.equal(restored.planning.sourceName, "base-exemplo.xlsx");
  const again = restoreProject(restored.planning).model;
  for (const record of input.records) for (const period of ["2026-01", "2026-06", "2026-07", "2026-09", "2027-12"]) {
    assert.deepEqual(periodValues(again, again.records.find(r => r.account === record.account), period), periodValues(input, record, period));
  }
  assert.deepEqual(again.organogram, input.organogram);
});

test("exporta despesas com percentuais somados por setor, incluindo vínculos de conta e de setor da base", async () => {
  const input = model(), expense = input.records.find(record => record.group === "Despesa");
  input.organogram.links = input.organogram.links.filter(link => link.origin !== expense.sectorCode);
  input.organogram.links.push(
    { id: "expense-sector", box: "child", type: "sector", origin: expense.sectorCode, percent: 25 },
    { id: "expense-account", box: "child", type: "account", origin: expense.account, percent: 35 },
    { id: "expense-root", box: "root", type: "account", origin: expense.account, percent: 40 },
  );
  const bytes = await createBudgetWorkbook(input), zip = await Zip.loadAsync(bytes);
  const rows = [...readCells(await zip.file("xl/worksheets/sheet6.xml").async("string"))];
  const value = ref => rows.find(([key]) => key === ref)?.[1].value;
  assert.deepEqual(["A1", "B1", "C1", "D1", "E1"].map(value), ["Conta", "Despesa", "Setor da base", "Setor administrativo", "Percentual"]);
  assert.equal(rows.filter(([ref]) => /^A[2-9]\d*$/.test(ref)).length, 2);
  assert.deepEqual([value("A2"), value("B2"), value("C2"), value("D2"), value("E2")], [expense.account, expense.rubric, expense.sector, "Diretoria", 0.4]);
  assert.equal(value("D3"), "Gerência");
  assert.equal(value("E3"), 0.6);
  assert.deepEqual((await readBudgetWorkbook(bytes)).planning.organogram, input.organogram);
});

test("reabre exportação anterior sem a aba Despesas por setor", async () => {
  const input = model(), zip = await Zip.loadAsync(await createBudgetWorkbook(input));
  zip.file("xl/workbook.xml", (await zip.file("xl/workbook.xml").async("string")).replace(/<sheet name="Despesas por setor"[^>]*\/>/, ""));
  zip.remove("xl/worksheets/sheet6.xml");
  assert.deepEqual((await readBudgetWorkbook(await zip.generateAsync({ type: "uint8array" }))).planning.organogram, input.organogram);
});

test("Excel coloca totais anuais logo depois de dezembro", async () => {
  const zip = await Zip.loadAsync(await createBudgetWorkbook(model()));
  const headers = [...readCells(await zip.file("xl/worksheets/sheet1.xml").async("string"))]
    .filter(([ref]) => ref.endsWith("3"))
    .map(([, cell]) => cell.value);
  const december = headers.indexOf("12/2025 Variação");
  assert.deepEqual(headers.slice(december + 1, december + 5), ["2025 Realizado", "2025 Projetado", "2025 Variação", "01/2026 Realizado"]);
});

test("reabre Excel com totais anuais no fim", async () => {
  const input = model();
  const bytes = await createBudgetWorkbook(input, { annualPlacement: "legacy" });
  const zip = await Zip.loadAsync(bytes);
  const headers = [...readCells(await zip.file("xl/worksheets/sheet1.xml").async("string"))]
    .filter(([ref]) => ref.endsWith("3"))
    .map(([, cell]) => cell.value);
  assert.ok(headers.indexOf("2025 Realizado") > headers.indexOf("12/2027 Variação"));
  const restored = restoreProject((await readBudgetWorkbook(bytes)).planning).model;
  for (const record of input.records) for (const period of ["2025-01", "2026-09", "2027-12"]) {
    assert.deepEqual(periodValues(restored, restored.records.find(item => item.account === record.account), period), periodValues(input, record, period));
  }
});

test("Excel importa Realizado e Projetado dinâmico numéricos, mantém referência inicial e rejeita fórmula adulterada", async () => {
  const input = model(), zip = await Zip.loadAsync(await createBudgetWorkbook(input));
  let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const cells = readCells(xml), column = [...cells].find(([, c]) => c.value === "05/2026 Realizado")[0].replace(/\d+$/, "");
  const actual = [`${column}6`, cells.get(`${column}6`)];
  assert.equal(actual[1].value, 120);
  xml = xml.replace(new RegExp(`<c r="${actual[0]}"[^>]*>[\\s\\S]*?</c>`), `<c r="${actual[0]}"><v>200</v></c>`);
  const dynamicColumn = [...cells].find(([, c]) => c.value === "09/2026 Projetado")[0].replace(/\d+$/, "");
  xml = xml.replace(new RegExp(`<c r="${dynamicColumn}6"[^>]*>[\\s\\S]*?</c>`), `<c r="${dynamicColumn}6"><v>333</v></c>`);
  zip.file("xl/worksheets/sheet1.xml", xml);
  const restored = restoreProject((await readBudgetWorkbook(await zip.generateAsync({ type: "uint8array" }))).planning).model;
  assert.equal(periodValues(restored, restored.records[0], "2026-05").actual, 200);
  assert.equal(periodValues(restored, restored.records[0], "2026-09").projected, 333);
  assert.equal(periodValues(restored, restored.records[0], "2026-06").projected, periodValues(input, input.records[0], "2026-06").projected);
  xml = xml.replace(/<f>[^<]+<\/f>/, "<f>1+999</f>");
  zip.file("xl/worksheets/sheet1.xml", xml);
  await assert.rejects(readBudgetWorkbook(await zip.generateAsync({ type: "uint8array" })), /Fórmula alterada/);
});

test("Excel rejeita mudança no Projetado fixo e na referência técnica", async () => {
  const input = model(), bytes = await createBudgetWorkbook(input);
  for (const sheet of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet4.xml"]) {
    const zip = await Zip.loadAsync(bytes), xml = await zip.file(sheet).async("string");
    const cells = readCells(xml);
    const ref = sheet.endsWith("sheet1.xml")
      ? [...cells].find(([, c]) => c.value === "06/2026 Projetado")[0].replace(/3$/, "6")
      : [...cells].find(([, cell]) => cell.value === "Fixo 06/2026")[0].replace(/3$/, "4");
    zip.file(sheet, xml.replace(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`), `<c r="${ref}"><v>999</v></c>`));
    await assert.rejects(readBudgetWorkbook(await zip.generateAsync({ type: "uint8array" })), /fixo foi alterado|referência inicial alterada/);
  }
});

test("reabre Excel anterior com o antigo cabeçalho do organograma sem perder setores ou vínculos", async () => {
  const input = model(), zip = await Zip.loadAsync(await createBudgetWorkbook(input));
  const path = "xl/worksheets/sheet3.xml", xml = await zip.file(path).async("string");
  zip.file(path, xml.replaceAll(">Setor administrativo</t>", ">Caixinha</t>"));
  const restored = (await readBudgetWorkbook(await zip.generateAsync({ type: "uint8array" }))).planning;
  assert.deepEqual(restored.organogram, input.organogram);
});

test("Excel arquiva os meses recortados e reabre o cenário sem usá-los nas fórmulas", async () => {
  const historyStart = "2026-03";
  const actualOverrides = { "71100000010001|2026-02": 999 };
  const input = buildBudget(fixture(), 2027, [], {}, actualOverrides, { ...projection(), historyStart });
  input.organogram = allocated(input);
  const bytes = await createBudgetWorkbook(input);
  const zip = await Zip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml").async("string");
  assert.match(workbook, /name="Histórico anterior"[^>]* state="hidden"/);
  const archive = readCells(await zip.file("xl/worksheets/sheet7.xml").async("string"));
  assert.ok([...archive.values()].some(cell => cell.value === "02/2026"));
  assert.ok([...archive.values()].some(cell => cell.value === 999));

  const budget = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(budget, /topLeftCell="F4"/);
  assert.doesNotMatch(budget, /02\/2026 Realizado|2025 Realizado/);
  assert.match(budget, /03\/2026 Realizado/);
  const calculation = await zip.file("xl/worksheets/sheet4.xml").async("string");
  assert.doesNotMatch(calculation, /Histórico anterior|Orçamento(?:&apos;|')!\d/);
  assert.match(calculation, /MAX\(0,SUM\(/);

  const reopened = restoreProject((await readBudgetWorkbook(bytes)).planning);
  assert.equal(reopened.project.projection.historyStart, historyStart);
  assert.deepEqual(reopened.project.actualOverrides, actualOverrides);
  assert.equal(reopened.model.records[0].final["2026-06"], 120);
  assert.equal(reopened.project.source.rows[2].values["2026-02"], 120);
});

test("base real importa e exporta mantendo contas, ajustes e totais", async () => {
  const source = await readBudgetWorkbook(await readFile(new URL("../../documents/database/orcamento/Evolução Receitas e Despesas_Atualizado até Setembro 2026.xlsx", import.meta.url)));
  const input = buildBudget(source.rows, 2030);
  input.organogram = allocated(input);
  const output = restoreProject((await readBudgetWorkbook(await createBudgetWorkbook(input))).planning).model;
  assert.equal(output.records.length, input.records.length);
  assert.ok(input.records.some(r => r.isReconciliation));
  for (const record of input.records) for (const period of ["2026-01", "2026-07", "2026-08", "2030-12"]) assert.deepEqual(periodValues(output, output.records.find(r => r.account === record.account), period), periodValues(input, record, period));
});
