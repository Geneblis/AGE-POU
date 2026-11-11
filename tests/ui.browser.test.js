import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import "../scripts/vendor/jszip.min.js";
import { fixture, allocated } from "./fixtures.js";
import { buildBudget } from "../scripts/models/budget.js";
import { createProject } from "../scripts/export/planning.js";

test("offline: abre pelo disco, exporta Excel com fórmulas e reabre os cálculos sem rede", {
  skip: !process.env.POU_PLAYWRIGHT ? "Defina POU_PLAYWRIGHT com o caminho do Playwright instalado." : false,
  timeout: 60000,
}, async () => {
  const { chromium } = await import(pathToFileURL(process.env.POU_PLAYWRIGHT));
  const browser = await chromium.launch({ channel: process.env.POU_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext({ offline: true, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], networkRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (/^https?:/.test(request.url())) networkRequests.push(request.url());
    });
    await page.goto(new URL("../index.html", import.meta.url).href);
    const model = buildBudget(fixture(), 2027);
    model.organogram = allocated(model);
    for (const link of model.organogram.links) link.percent = 99.996;
    const project = createProject(model);
    await page.locator("#project-input").setInputFiles({ name: "offline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => !document.querySelector("#workspace").hidden);
    assert.equal(await page.locator("#export-xlsx").isEnabled(), true);
    assert.equal(await page.locator("#allocation-list li").count(), 0);
    const totalBefore = await page.locator("#total-revenue").textContent();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-xlsx").click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const excel = Buffer.concat(chunks);
    const workbook = await globalThis.JSZip.loadAsync(excel);
    assert.match(await workbook.file("xl/worksheets/sheet1.xml").async("string"), /<f>/);
    await page.locator("#xlsx-input").setInputFiles({ name: "offline.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: excel });
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("recuperado com"));
    assert.equal(await page.locator("#total-revenue").textContent(), totalBefore);
    model.organogram.links[0].percent = 4.333;
    model.organogram.links[1].percent = 3.999;
    await page.locator("#project-input").setInputFiles({ name: "decimais.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createProject(model))) });
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Planejamento restaurado"));
    await page.locator("#organogram-tab").click();
    await page.locator("#organogram-editor > summary").click();
    await page.locator("#link-box").selectOption("child");
    assert.match(await page.locator("#link-list").textContent(), /4,33%/);
    assert.match(await page.locator("#link-list").textContent(), /4,00%/);
    await page.locator("details.link-list > summary").click();
    await page.locator(".edit-link").first().click();
    const percentInput = page.locator("#link-dialog input[type=number]").first();
    assert.equal(await percentInput.inputValue(), "4.33");
    assert.equal(await percentInput.getAttribute("step"), "0.01");
    await percentInput.fill("4.167");
    await page.getByRole("button", { name: "Salvar percentual", exact: true }).first().click();
    assert.match(await page.locator("#link-list").textContent(), /4,17%/);
    const newPercent = page.locator("#link-percent");
    await newPercent.fill("3.999");
    await newPercent.press("Tab");
    assert.equal(await newPercent.inputValue(), "4.00");
    assert.deepEqual(networkRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("variação acompanha digitação de Realizado e Projetado sem perder foco ou duplicar histórico", {
  skip: !process.env.POU_PLAYWRIGHT ? "Defina POU_PLAYWRIGHT com o caminho do Playwright instalado." : false,
  timeout: 60000,
}, async () => {
  const { chromium } = await import(pathToFileURL(process.env.POU_PLAYWRIGHT));
  const browser = await chromium.launch({ channel: process.env.POU_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(new URL("../index.html", import.meta.url).href);
    const project = createProject(buildBudget(fixture(), 2027));
    await page.locator("#project-input").setInputFiles({ name: "variacao.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => !document.querySelector("#workspace").hidden);
    const field = (account, kind) => page.locator(`input[data-account="${account}"][data-period="2026-08"][data-kind="${kind}"]`);
    const actual = field("71100000010001", "actual"), projected = field("71100000010001", "projected");
    const row = projected.locator("xpath=ancestor::tr");
    await actual.fill("100,00");
    assert.equal(await row.locator(".variance-cell").nth(7).textContent(), "-16,67%");
    assert.equal(await actual.evaluate(e => e === document.activeElement), true);
    await projected.fill("12"); await projected.press("End"); await projected.pressSequentially("5,00");
    assert.equal(await projected.inputValue(), "125,00");
    assert.equal(await projected.evaluate(e => e === document.activeElement && e.selectionStart === 6), true);
    assert.equal(await row.locator(".variance-cell").nth(7).textContent(), "-20%");
    assert.equal(await page.locator(".revenue-row.group-row .variance-cell").nth(7).textContent(), "-20%");
    assert.equal(await page.locator(".revenue-row.sector-row .variance-cell").nth(7).textContent(), "-20%");
    const annual = new Intl.NumberFormat("pt-BR", {style:"percent",maximumFractionDigits:2,signDisplay:"exceptZero"}).format((940-1445)/1445);
    assert.equal(await row.locator("td").last().textContent(), annual);
    await projected.press("Tab");
    await page.locator("#undo-change").click(); assert.match(await projected.inputValue(), /120,00/);
    await page.locator("#redo-change").click(); assert.match(await projected.inputValue(), /125,00/);
    await projected.fill("inválido"); await projected.press("Tab");
    assert.match(await projected.inputValue(), /125,00/);
    assert.match(await page.locator("#status").textContent(), /Informe um valor em reais/);
    await projected.fill("0"); assert.equal(await row.locator(".variance-cell").nth(7).textContent(), "0%");
    await projected.fill(""); assert.equal(await row.locator(".variance-cell").nth(7).textContent(), "-16,67%");
    const expenseActual = field("81830300010006", "actual"), expenseProjected = field("81830300010006", "projected");
    await expenseActual.fill("80"); await expenseProjected.fill("100");
    assert.equal(await expenseProjected.locator("xpath=ancestor::tr").locator(".variance-cell").nth(7).textContent(), "-20%");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("navegador: períodos, índices, edição, organograma, rascunho, Excel, teclado e responsividade", {
  skip: !process.env.POU_PLAYWRIGHT ? "Defina POU_PLAYWRIGHT com o caminho do Playwright instalado." : false,
  timeout: 120000,
}, async () => {
  const { chromium } = await import(pathToFileURL(process.env.POU_PLAYWRIGHT));
  const server = spawn(process.execPath, ["scripts/server.mjs"], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, env: { ...process.env, PORT: "4176" }, stdio: "pipe" });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch("http://127.0.0.1:4176/")).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: process.env.POU_BROWSER_CHANNEL || "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [], external = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol)) return route.continue();
      external.push(url.href); return route.abort();
    });
    await page.goto("http://127.0.0.1:4176/");
    const favicon = page.locator('link[rel="icon"]');
    assert.equal(await favicon.getAttribute("href"), "images/age-fav-icon.svg");
    const iconResponse = await page.request.get(await favicon.evaluate(e => e.href));
    assert.equal(iconResponse.status(), 200);
    assert.match(iconResponse.headers()["content-type"], /image\/svg\+xml/);
    const iconDimensions = await favicon.evaluate(e => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = () => reject(new Error("Falha ao carregar favicon local")); image.src = e.href;
    }));
    assert.ok(iconDimensions[0] > 0 && iconDimensions[1] > 0);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator(".age-logo").evaluate(e => e.complete && e.naturalWidth > 0), true);
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === "Manrope" && font.status === "loaded")), true);
    await mkdir(new URL("tmp/", import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL("tmp/inicio-1440.png", import.meta.url)), fullPage: true });
    const project = createProject(buildBudget(fixture(), 2027));
    await page.locator("#project-input").setInputFiles({ name: "rascunho.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => !document.querySelector("#workspace").hidden);
    assert.equal(await page.locator("#copy-through").inputValue(), "2026-07");
    assert.equal(await page.locator("#copy-through option").first().textContent(), "01/2025");
    assert.equal(await page.locator("#resume-at").inputValue(), "2026-08");
    assert.equal(await page.locator("#copy-through option:checked").textContent(), "08/2026");
    assert.match(await page.locator("#projection-fixed").textContent(), /Sem intervalo fixo/);
    assert.equal(await page.locator("#export-xlsx").isDisabled(), true);
    assert.equal(await page.getByRole("tab", { name: "Comparar planejamentos" }).count(), 0);
    assert.equal(await page.locator("#budget-head").getByText("Variação", { exact: true }).count(), 13);
    assert.match(await page.locator("#actual-revenue").textContent(), /840,00/);
    assert.match(await page.locator("#actual-expense").textContent(), /504,00/);
    assert.equal(await page.locator("#actual-summary-note").textContent(), "Dados referentes até JULHO, 2026.");
    await page.locator("#indices-tab").click();
    await page.locator("#variable-name").fill("Reajuste"); await page.locator("#variable-rate").fill("10");
    await page.locator("#variable-start").fill("2026-06"); await page.locator("#variable-end").fill("2027-12");
    await page.locator("#variable-form button[type=submit]").click();
    await page.locator("#copy-through").selectOption("2026-05");
    await page.locator("#resume-at").selectOption("2026-09");
    assert.equal(await page.locator("#projection-copy").textContent(), "Até 05/2026, inclusive");
    assert.equal(await page.locator("#projection-fixed").textContent(), "06/2026 a 08/2026");
    assert.equal(await page.locator("#projection-dynamic").textContent(), "A partir de 09/2026, inclusive");
    await page.locator("#planning-tab").click();
    const projected = page.locator('input[data-account="71100000010001"][data-period="2026-06"][data-kind="projected"]');
    const initial = await projected.inputValue();
    assert.equal(await projected.getAttribute("readonly"), "");
    const actual = page.locator('input[data-account="71100000010001"][data-period="2026-01"][data-kind="actual"]');
    await actual.fill("200,00"); await actual.press("Tab");
    assert.equal(await projected.inputValue(), initial);
    assert.equal(await page.locator("#copy-through").inputValue(), "2026-05");
    await page.locator("#indices-tab").click(); await page.locator(".delete-variable").click();
    await page.locator("#planning-tab").click(); assert.equal(await projected.inputValue(), initial);
    await page.locator("#organogram-tab").click();
    await page.locator("#box-name").fill("Gerência");
    await page.locator("#box-form button[type=submit]").click();
    const childId = await page.locator("#box-selection").inputValue();
    await page.locator("#superior-name").fill("Diretoria");
    await page.locator("#create-superior").click();
    const rootId = await page.locator("#box-selection").inputValue();
    assert.notEqual(rootId, childId);
    assert.match(await page.locator("#organogram-body").textContent(), /Gerência · nível 1/);
    await page.locator("#box-selection").selectOption(childId);
    await page.locator("#box-name").fill("Gerência revisada"); await page.locator("#box-parent").selectOption("");
    await page.locator("#box-form button[type=submit]").click();
    assert.match(await page.locator("#organogram-body").textContent(), /Gerência revisada · nível 0/);
    await page.locator("#box-parent").selectOption(rootId); await page.locator("#box-form button[type=submit]").click();
    await page.locator("#link-box").selectOption(childId);
    await page.locator("#origin-type").selectOption("sector");
    for (const code of ["711", "818"]) {
      await page.locator("#link-origin").selectOption(code); await page.locator("#link-form button[type=submit]").click();
    }
    const linksDisclosure = page.locator(".link-list");
    assert.equal(await linksDisclosure.getAttribute("open"), null);
    await linksDisclosure.locator("summary").click();
    assert.equal(await linksDisclosure.getAttribute("open"), "");
    await linksDisclosure.locator("summary").click();
    assert.equal(await linksDisclosure.getAttribute("open"), null);
    await page.locator("#link-search").fill("711");
    await page.locator("#link-search-results button").click();
    assert.equal(await page.locator("#link-dialog").isVisible(), true);
    assert.match(await page.locator("#link-dialog-body").textContent(), /Gerência revisada/);
    await page.locator("#link-dialog-body input").fill("99");
    await page.getByRole("button", { name: "Salvar percentual" }).click();
    assert.match(await page.locator("#allocation-list").textContent(), /99,00% distribuído/);
    assert.equal(await page.locator('#allocation-list button[data-account="71100000010001"]').count(), 0);
    await page.locator("#link-search-results button").click();
    await page.locator("#link-dialog-body input").fill("100");
    await page.getByRole("button", { name: "Salvar percentual" }).click();
    assert.equal(await page.locator("#link-list .remove-link").count(), 2);
    await page.locator(".link-list summary").click();
    await page.locator("#link-list .remove-link").last().click();
    assert.equal(await page.locator("#link-list .remove-link").count(), 1);
    assert.equal(await page.locator("#export-xlsx").isDisabled(), true);
    await page.locator("#link-origin").selectOption("818"); await page.locator("#link-form button[type=submit]").click();
    assert.equal(await page.locator("#export-xlsx").isDisabled(), false);
    assert.match(await page.locator("#organogram-body").textContent(), /Consolidado/);
    assert.match(await page.locator("#organogram-body").textContent(), /Gerência revisada · nível 1/);
    assert.equal(await page.locator("#expense-pie path").count(), 1);
    await page.locator("#expense-pie path").first().hover();
    assert.equal(await page.locator("#sector-tooltip").isVisible(), true);
    assert.match(await page.locator("#sector-tooltip").textContent(), /Gerência revisada/);
    await page.locator(".sector-node").first().focus();
    assert.match(await page.locator("#sector-tooltip").textContent(), /Diretoria/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#sector-tooltip").isVisible(), false);
    await page.locator("#organogram-month").selectOption("2026-01");
    assert.match(await page.locator("#expense-total").textContent(), /72,00/);
    await page.locator("#organogram-year").selectOption("2027");
    assert.equal(await page.locator("#expense-pie path").count(), 0);
    await page.locator("#organogram-year").selectOption("2026");
    await page.locator("#organogram-detail > summary").click();
    const percent = page.locator('#organogram-body input[type="number"]').first();
    await percent.fill("150"); await percent.press("Tab");
    assert.equal(await page.locator("#export-xlsx").isDisabled(), true);
    assert.match(await page.locator("#allocation-list").textContent(), /150,00% distribuído/);
    await page.locator(".allocation-alert > summary").click();
    await page.locator('#allocation-list button[data-account="71100000010001"]').click();
    assert.match(await page.locator("#link-dialog-body").textContent(), /Gerência revisada/);
    await page.locator("#close-link-dialog").click();
    await percent.fill("100"); await percent.press("Tab");
    assert.equal(await page.locator("#export-xlsx").isDisabled(), false);
    const buttonColor = await page.locator("#export-organogram").evaluate(e => getComputedStyle(e).color);
    assert.notEqual(buttonColor, "rgb(255, 255, 255)");
    const downloadBytes = async button => {
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator(button).click()]);
      const stream = await download.createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    };
    const json = JSON.parse((await downloadBytes("#save-project")).toString());
    assert.equal(json.projection.initial.variables[0].name, "Reajuste");
    assert.equal(json.variables.length, 0);
    assert.equal(json.organogram.links.length, 2);
    assert.equal(json.organogram.boxes.length, 2);
    assert.equal(json.organogram.boxes.find(s => s.id === childId).parent, rootId);
    const org = await downloadBytes("#export-organogram");
    await page.locator("#organogram-input").setInputFiles({ name: "organograma.json", mimeType: "application/json", buffer: org });
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Estrutura anterior substituída"));
    const invalid = JSON.parse(org.toString()); invalid.links[0].origin = "não existe";
    await page.locator("#organogram-input").setInputFiles({ name: "invalido.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Origem inexistente"));
    assert.match(await page.locator("#organogram-body").textContent(), /Gerência revisada/);
    const excel = await downloadBytes("#export-xlsx");
    await page.locator("#xlsx-input").setInputFiles({ name: "planejamento.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: excel });
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("recuperado com"));
    await page.locator("#planning-tab").click(); assert.equal(await projected.inputValue(), initial);
    await page.locator("#planning-tab").focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#indices-tab").getAttribute("aria-selected"), "true");
    await page.locator("#help-button").click(); assert.equal(await page.locator("#help-dialog").isVisible(), true);
    await page.keyboard.press("Escape"); assert.equal(await page.locator("#help-button").evaluate(e => e === document.activeElement), true);
    await page.locator("#organogram-tab").click();
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#default-organogram").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Organograma padrão AGE carregado"));
    assert.equal(await page.locator(".sector-node").count(), 24);
    assert.equal(await page.locator(".sector-bar").count(), 48);
    assert.equal(await page.locator('.sector-bar[data-group="Receita"]').count(), 24);
    assert.equal(await page.locator('.sector-bar[data-group="Despesa"]').count(), 24);
    assert.equal(await page.locator(".sector-bar-fill-direct").count(), 48);
    assert.equal(await page.locator(".sector-bar-fill-indirect").count(), 48);
    assert.equal(await page.locator(".sector-bar-legend").count(), 1);
    const standardHierarchy = await page.locator("#sector-tree").textContent();
    for (const name of ["CONAD", "CONFIN", "Gerência de Auditoria Interna", "Presidência - PRESI", "CPL", "DIPLAG", "DIROP", "DIRFI"]) assert.match(standardHierarchy, new RegExp(name));
    const diplagNode = page.locator('.sector-node[data-sector-id="dpg"]');
    assert.equal(await diplagNode.count(), 1);
    await diplagNode.click();
    assert.equal(await page.locator("#link-box").inputValue(), "dpg");
    assert.match(await diplagNode.getAttribute("class"), /is-selected/);
    assert.match(await page.locator("#selected-sector-note").textContent(), /DIPLAG/);
    await diplagNode.focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator("#link-box").inputValue(), "dpg");
    assert.equal(await page.locator(".hierarchy-heading #capture-organogram").count(), 1);
    assert.equal(await page.locator(".section-heading #capture-organogram").count(), 0);
    const png = await downloadBytes("#capture-organogram");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(png.length > 1000);
    assert.match(await page.locator("#status").textContent(), /salva em PNG/);
    await mkdir(new URL("tmp/", import.meta.url), { recursive: true });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Sem overflow global em ${width}px`);
      if ([320, 1440].includes(width)) await page.screenshot({ path: fileURLToPath(new URL(`tmp/organograma-${width}.png`, import.meta.url)), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const local = await context.newPage();
    local.on("pageerror", error => errors.push(error.message));
    await local.goto(pathToFileURL(fileURLToPath(new URL("../index.html", import.meta.url))).href);
    assert.equal(await local.locator('link[rel="icon"]').evaluate(e => e.href), new URL("../images/age-fav-icon.svg", import.meta.url).href);
    await local.locator("#project-input").setInputFiles({ name: "local.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await local.waitForFunction(() => !document.querySelector("#workspace").hidden);
    assert.equal(await local.locator("#budget-head").getByText("Variação", { exact: true }).count(), 13);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser?.close(); server.kill(); }
});
