import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("a página local usa somente recursos executáveis sem servidor", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.doesNotMatch(html, /<script[^>]+type=["']module["']/i);
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)=["']https?:\/\//i);
  assert.match(html, /scripts\/app\.bundle\.js/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="images\/age-fav-icon\.svg" sizes="any">/);
  const icon = await readFile(new URL("images/age-fav-icon.svg", root), "utf8");
  assert.match(icon, /viewBox="0 0 96 96"/);
  assert.equal((icon.match(/<path\b/g) ?? []).length, 6);
});

test("scripts, CSS e documentação ficam nas pastas definidas e os recursos locais existem", async () => {
  const entries = await readdir(root, { withFileTypes: true });
  assert.deepEqual(entries.filter(e => e.isFile() && /\.(?:js|mjs|css)$/.test(e.name)).map(e => e.name), []);
  assert.ok(entries.some(e => e.isDirectory() && e.name === "docs"));
  assert.equal(entries.some(e => e.name === "Documentação"), false);
  const html = await readFile(new URL("index.html", root), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|svg|png))"/g)) await readFile(new URL(ref, root));
  const css = await readFile(new URL("styles/styles.css", root), "utf8");
  for (const [, ref] of css.matchAll(/url\("([^"]+)"\)/g)) await readFile(new URL(ref, new URL("styles/", root)));
  assert.doesNotMatch(css, /InitializeDefaultDrives/);
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(manifest.scripts.start, "node scripts/server.mjs");
});

test("rótulos usam mês/ano, mantêm a estrutura visual original e permitem criar a superior depois do filho", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /Ir até \(mês\/ano\)/);
  assert.match(html, /Retomar em \(mês\/ano\)/);
  assert.doesNotMatch(html, /ANO\/MÊS|[Cc]aixinha/);
  assert.match(html, /Planejamento com visão/);
  assert.match(html, /class="steps"/);
  assert.match(html, /class="upload-panel"/);
  assert.match(html, /Criar superior deste setor/);
  assert.match(html, /<select id="end-year"/);
  assert.match(html, /id="actual-revenue"/);
  assert.match(html, /Dados referentes até/);
  assert.match(html, /id="link-search"/);
  assert.match(html, /id="link-dialog"/);
});

test("documentação fica só em docs/, com links válidos e datas apenas no backlog", async () => {
  const directory = new URL("docs/", root);
  // Inclui docs/wiki/; licenças de bibliotecas em vendor/ ficam de fora.
  const names = (await readdir(directory, { recursive: true })).map(n => n.replaceAll("\\", "/")).filter(n => n.endsWith(".md") && !n.includes("vendor/"));
  const stray = (await readdir(root, { recursive: true })).map(n => n.replaceAll("\\", "/")).filter(n => n.endsWith(".md") && !n.startsWith("docs/") && !n.startsWith("scripts/vendor/"));
  assert.deepEqual(stray, []);
  for (const name of names.filter(n => n !== "backlog.md")) assert.doesNotMatch(await readFile(new URL(name, directory), "utf8"), /\d{2}\/\d{2}\/\d{4}/, name);
  for (const file of names.map(n => new URL(n, directory))) {
    const markdown = await readFile(file, "utf8");
    assert.doesNotMatch(markdown, /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/u, file.pathname);
    // Âncoras (#L10-L20) não fazem parte do caminho do arquivo.
    for (const [, ref] of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) if (!/^(?:https?:|#)/.test(ref)) await readFile(new URL(ref.split("#")[0], file));
  }
  for (const name of names.filter(name => /^wiki\/\d\d_.*\.md$/.test(name))) assert.match(await readFile(new URL(name, directory), "utf8"), /class="doc-icon"/, name);
  const docsIndex = await readFile(new URL("docs/index.html", root), "utf8");
  assert.match(docsIndex, /name="offline-docs-signature"/);
  assert.match(docsIndex, /id="search-input"/);
  assert.match(docsIndex, /<a id="back-to-planner"[^>]+href="\.\.\/index\.html"/);
  assert.match(docsIndex, /src="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(docsIndex, /<(?:script|link|img)[^>]+(?:src|href)=["']https?:\/\//i);
});

test("o planejador não mantém scripts Python na pasta web", async () => {
  const entries = await readdir(root, { recursive: true });
  assert.equal(entries.some(name => name.toLowerCase().endsWith(".py")), false);
});

test("a interface expõe importação, exportação e histórico de índices", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /id="import-variables"/);
  assert.match(html, /id="export-variables"/);
  assert.doesNotMatch(html, /id="export-variables-csv"/);
  assert.match(html, /id="undo-change"/);
  assert.match(html, /id="redo-change"/);
  const bundle = await readFile(new URL("scripts/app.bundle.js", root), "utf8");
  assert.match(bundle, /function undoChange/);
});

test("o JSON de índices não inclui versão e mantém apenas o envelope combinado", async () => {
  const indices = await readFile(new URL("../scripts/controllers/budget-controller.js", import.meta.url), "utf8");
  const exportFunction = indices.slice(indices.indexOf("function exportVariables"), indices.indexOf('$("#variable-scope").addEventListener'));
  assert.match(exportFunction, /format: "orca-indices"/);
  assert.match(exportFunction, /exportedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(exportFunction, /variables: state\.variables/);
  assert.doesNotMatch(exportFunction, /version\s*:/);
});
