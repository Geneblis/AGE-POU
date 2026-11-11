// Gera app.bundle.js: junta os módulos num único script para abrir index.html sem servidor (file://).
// Ordem: domínio (cálculo e Excel) primeiro, depois interface, e controllers/app-controller.js por último.
import { readFile, writeFile } from "node:fs/promises";

const names = [
  "models/budget.js",
  "models/organogram.js",
  "export/planning.js",
  "export/workbook-xml.js",
  "export/workbook-visual.js",
  "export/xlsx.js",
  "views/dom.js",
  "models/editor-state.js",
  "views/page-view.js",
  "views/summary-view.js",
  "views/budget-view.js",
  "views/horizon-view.js",
  "views/indices-view.js",
  "views/files-view.js",
  "views/organogram-visual.js",
  "views/organogram-search-view.js",
  "views/organogram-view.js",
  "controllers/budget-controller.js",
  "controllers/files-controller.js",
  "controllers/organogram-controller.js",
  "controllers/app-controller.js",
];

const modules = await Promise.all(names.map(async name => ({ name, source: await readFile(new URL(name, import.meta.url), "utf8") })));

// No bundle todos os módulos dividem o mesmo escopo; um nome repetido no topo quebraria a página.
const declared = new Map();
for (const { name, source } of modules) {
  for (const [, id] of source.matchAll(/^(?:export )?(?:async )?(?:function\*? |const |let |class )([\w$]+)/gm)) {
    if (declared.has(id)) throw new Error(`"${id}" declarado em ${declared.get(id)} e em ${name}. Renomeie um deles.`);
    declared.set(id, name);
  }
}

const body = modules.map(({ name, source }) => `// ${name}\n${source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")}`);
await writeFile(new URL("app.bundle.js", import.meta.url), `/* Gerado por npm run build. Execução local sem servidor. */\n(() => {\n${body.join("\n")}\n})();\n`);
