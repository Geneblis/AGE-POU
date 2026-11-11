import test from "node:test";
import assert from "node:assert/strict";
import { fixture, allocated } from "./fixtures.js";
import { buildBudget } from "../scripts/models/budget.js";
import { expenseView, defaultOrganogram, allocationIssues } from "../scripts/models/organogram.js";
import "../scripts/vendor/jszip.min.js";
import { createBudgetWorkbook, readBudgetWorkbook } from "../scripts/export/xlsx.js";

test("gráficos comparam despesas próprias sem duplicar a hierarquia e filtram mês", () => {
  const model = buildBudget(fixture(), 2027);
  const config = allocated(model);
  const annual = expenseView(config, model, 2026);
  assert.equal(annual.total, 72 * 7);
  assert.equal(annual.nodes.find(n => n.id === "root").expense, annual.total);
  assert.equal(annual.nodes.find(n => n.id === "root").ownExpense, 0);
  assert.equal(annual.slices.length, 1);
  assert.equal(annual.slices[0].share, 1);
  assert.equal(expenseView(config, model, 2026, "2026-01").total, 72);
  assert.equal(expenseView(config, model, 2027).slices.length, 0);
  assert.throws(() => expenseView(config, model, 2026, "2025-01"), /período/i);
});

test("despesas negativas não viram fatias positivas nem somem dos totais", () => {
  const model = buildBudget(fixture(), 2027, [], {}, {"81830300010006|2026-01": -20});
  const view = expenseView(allocated(model), model, 2026, "2026-01");
  assert.equal(view.total, -20);
  assert.equal(view.slices.length, 0);
  assert.equal(view.credits, -20);
});

test("Excel visual usa estilos legíveis, gráfico nativo e mantém reimportação", async () => {
  const model = buildBudget(fixture(), 2027);
  model.organogram = allocated(model);
  const bytes = await createBudgetWorkbook(model);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const budget = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const org = await zip.file("xl/worksheets/sheet3.xml").async("string");
  assert.match(budget, /wrapText="1"|ht="42"/);
  assert.match(budget, /mergeCell ref="A1:E1"/);
  assert.match(budget, /showGridLines="0"/);
  assert.match(org, /drawing r:id="drawing"/);
  assert.match(org, /dataValidation/);
  assert.match(await zip.file("xl/charts/chart1.xml").async("string"), /doughnutChart/);
  const restored = await readBudgetWorkbook(bytes);
  assert.deepEqual(restored.planning.organogram, model.organogram);
});

test("reimportação aceita aspas de nomes de abas normalizadas pelo LibreOffice, sem liberar fórmulas diferentes", async () => {
  const model = buildBudget(fixture(), 2027); model.organogram = allocated(model);
  const zip = await JSZip.loadAsync(await createBudgetWorkbook(model));
  for (let i=1;i<=5;i++) {
    const path = `xl/worksheets/sheet${i}.xml`, xml = await zip.file(path).async("string");
    zip.file(path, xml.replace(/<f>([\s\S]*?)<\/f>/g, (_, formula) => `<f>${formula.replaceAll("&apos;Orçamento&apos;!", "Orçamento!").replaceAll("&apos;Cálculo&apos;!", "Cálculo!").replaceAll("&apos;Índices&apos;!", "Índices!")}</f>`));
  }
  const restored = await readBudgetWorkbook(await zip.generateAsync({type:"uint8array"}));
  assert.deepEqual(restored.planning.organogram, model.organogram);
});

test("referência fixa tolera precisão numérica de 15 dígitos do Excel, mas rejeita alteração de centavos", async () => {
  const projection = {copyThrough:"2026-05",resumeAt:"2026-09",initial:{variables:[],actualOverrides:{"71100000010001|2026-01":0.1}}};
  const model = buildBudget(fixture(),2027,[],{},{},projection); model.organogram=allocated(model);
  const zip = await JSZip.loadAsync(await createBudgetWorkbook(model));
  const path="xl/worksheets/sheet4.xml", original=await zip.file(path).async("string");
  const match=[...original.matchAll(/<c r="([A-Z]+\d+)"[^>]*><v>([\d.-]+)<\/v><\/c>/g)].find(m=>Number(m[2])!==Number(Number(m[2]).toPrecision(15)));
  assert.ok(match,"Há referência fixa com fração não exata em binário");
  zip.file(path,original.replace(match[0],match[0].replace(`<v>${match[2]}</v>`,`<v>${Number(match[2]).toPrecision(15)}</v>`)));
  await readBudgetWorkbook(await zip.generateAsync({type:"uint8array"}));
  zip.file(path,original.replace(match[0],match[0].replace(`<v>${match[2]}</v>`,`<v>${Number(match[2])+.01}</v>`)));
  await assert.rejects(readBudgetWorkbook(await zip.generateAsync({type:"uint8array"})),/referência inicial alterada/);
});

test("organograma padrão AGE fecha 100% com 24 setores iguais e exporta ranking de despesa e receita", async () => {
  const model = buildBudget(fixture(), 2027);
  model.organogram = defaultOrganogram(model);
  assert.deepEqual(model.organogram.boxes, [
    { id: "conad", name: "CONAD (Conselho de Administração)", parent: null },
    { id: "confin", name: "CONFIN (Conselho Fiscal)", parent: null },
    { id: "auditoria", name: "Gerência de Auditoria Interna", parent: null },
    { id: "cpl", name: "CPL", parent: null },
    { id: "presidencia", name: "Presidência - PRESI", parent: null },
    { id: "juridica", name: "Superintendência Jurídica", parent: "presidencia" },
    { id: "comunicacao", name: "Gerência de Comunicação", parent: "presidencia" },
    { id: "compliance", name: "Gerência de Compliance e Controles Internos", parent: "presidencia" },
    { id: "governanca", name: "Secretaria de Governança", parent: "presidencia" },
    { id: "ouvidoria", name: "Ouvidoria", parent: "presidencia" },
    { id: "dpg", name: "Diretoria de Planejamento e Gestão - DIPLAG", parent: "presidencia" },
    { id: "administrativa", name: "Gerência Administrativa", parent: "dpg" },
    { id: "dados", name: "Gerência de Planejamento de Dados, Mercado e Orçamento", parent: "dpg" },
    { id: "ti", name: "Superintendência de Tecnologia da Informação", parent: "dpg" },
    { id: "ger-ti", name: "Gerência de Tecnologia da Informação", parent: "ti" },
    { id: "don", name: "Diretoria de Operações e Negócios - DIROP", parent: "presidencia" },
    { id: "sup-pn", name: "Superintendência de Pequenos Negócios", parent: "don" },
    { id: "ger-pn", name: "Gerência de Pequenos Negócios", parent: "sup-pn" },
    { id: "sup-oe", name: "Superintendência de Operações Especiais", parent: "don" },
    { id: "dfin", name: "Diretoria Financeira - DIRFI", parent: "presidencia" },
    { id: "sup-fin", name: "Superintendência Financeira", parent: "dfin" },
    { id: "contabil", name: "Gerência Contábil", parent: "sup-fin" },
    { id: "sup-cc", name: "Superintendência de Crédito e Cobrança", parent: "dfin" },
    { id: "ger-cc", name: "Gerência de Crédito e Cobrança", parent: "sup-cc" },
  ]);
  assert.equal(model.organogram.boxes.length, 24);
  assert.deepEqual(allocationIssues(model.organogram, model), []);
  assert.equal(model.organogram.boxes.find(b => b.id === "presidencia").parent, null);
  assert.equal(model.organogram.boxes.find(b => b.id === "dpg").parent, "presidencia");
  assert.equal(model.organogram.boxes.find(b => b.id === "dpg").parents, undefined);
  assert.equal(model.organogram.boxes.filter(b => b.parent === null).length, 5);
  const view = expenseView(model.organogram, model, 2026, "", "Receita");
  assert.ok(view.slices.length === 24 && view.slices.every(s => Math.abs(s.share - 1 / 24) < 1e-12));
  for (const group of ["Receita", "Despesa"]) {
    const { nodes, total } = expenseView(model.organogram, model, 2026, "", group);
    const independents = nodes.filter(node => ["conad", "confin", "auditoria", "cpl"].includes(node.id));
    assert.ok(independents.every(node => node.parents.length === 0 && node.consolidated === node.own));
    const presidency = nodes.find(node => node.id === "presidencia");
    const independentTotal = independents.reduce((sum, node) => sum + node.own, 0);
    assert.ok(Math.abs(presidency.consolidated + independentTotal - total) < 1e-6);
  }
  const zip = await JSZip.loadAsync(await createBudgetWorkbook(model));
  const org = await zip.file("xl/worksheets/sheet3.xml").async("string");
  assert.match(org, /Ranking receita/);
  assert.match(org, /<f>RANK\(G26,/);
  assert.match(org, /cfRule type="dataBar"/);
  assert.match(await zip.file("xl/charts/chart2.xml").async("string"), /Receitas próprias/);
  const restored = await readBudgetWorkbook(await zip.generateAsync({ type: "uint8array" }));
  assert.deepEqual(restored.planning.organogram, model.organogram);
});
