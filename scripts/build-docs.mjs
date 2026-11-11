// A skill global gera a documentação; este projeto acrescenta o retorno ao planejador.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const builder = join(codexHome, "skills", "offline-docs", "scripts", "build.py");
const docs = fileURLToPath(new URL("../docs/", import.meta.url));
const env = { ...process.env };
if (process.platform === "win32") {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = [
    join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Pandoc"),
    join(homedir(), "AppData", "Local", "Pandoc"),
    join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "npm"),
    env[pathKey],
  ].join(delimiter);
}
const result = spawnSync("python", [builder, "--docs", docs, "--title", "POU — Documentação"], { stdio: "inherit", env });
if (result.error) console.error(`Não foi possível executar Python: ${result.error.message}`);
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const output = join(docs, "index.html");
  let html = await readFile(output, "utf8");
  if (!html.includes('id="back-to-planner"')) {
    const actions = '<div class="head-actions">';
    if (!html.includes(actions)) throw new Error("Barra superior da documentação não encontrada.");
    const back = '<a id="back-to-planner" href="../index.html" aria-label="Voltar ao POU" title="Voltar ao POU">← <span>Voltar ao POU</span></a>';
    const styles = `<style>
#back-to-planner{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;color:var(--heading);background:var(--raised);font-size:13px;white-space:nowrap;text-decoration:none}
#back-to-planner:hover{border-color:var(--accent)}
#back-to-planner:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:740px){.brand{min-width:0;overflow:hidden}.brand span{overflow:hidden;text-overflow:ellipsis}.head-actions{flex-shrink:0}#back-to-planner{padding:8px}#back-to-planner span{display:none}}
</style>`;
    html = html.replace(actions, `${actions}\n${back}`).replace("</head>", `${styles}\n</head>`);
  }
  // O retorno fica à direita; os guias ficam após todas as páginas técnicas.
  const back = html.match(/<a id="back-to-planner"[^>]*>[\s\S]*?<\/a>/)?.[0];
  if (!back) throw new Error("Botão de retorno não encontrado.");
  html = html.replace(back, "").replace(/(<div class="head-actions">)([\s\S]*?)(<\/div>)/, (_, start, content, end) => start + content + back + end);
  if (!html.includes('id="pou-docs-layout"')) html = html.replace('</head>', '<style id="pou-docs-layout">.topinner{gap:16px}.topinner .head-actions{margin-left:auto}.topinner .brand{margin-right:auto;min-width:0}.topinner .brand span{overflow:hidden;text-overflow:ellipsis}@media(max-width:740px){.topinner .brand{display:none}#back-to-planner span{display:inline}}</style></head>');
  const guidesLast = items => [...items.filter(item => !item.slice(0, item.indexOf(">") + 1).includes("doc-guia-llm-")), ...items.filter(item => item.slice(0, item.indexOf(">") + 1).includes("doc-guia-llm-"))].join("\n");
  html = html.replace(/(<nav class="page-nav">)([\s\S]*?)(<\/nav>)/, (_, start, content, end) => start + guidesLast(content.match(/<a\b[\s\S]*?<\/a>/g) ?? []) + end);
  html = html.replace(/(<main class="main-content" id="main-content">)([\s\S]*?)(<\/main>)/, (_, start, content, end) => start + guidesLast(content.match(/<article\b[\s\S]*?<\/article>/g) ?? []) + end);
  await writeFile(output, html);
}
