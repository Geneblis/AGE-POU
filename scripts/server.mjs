// Servidor local de desenvolvimento (npm start): entrega os arquivos da pasta do planejador
// em http://127.0.0.1:4173. Só escuta no próprio computador e recusa caminhos fora da pasta.
// O site também abre direto pelo index.html; o servidor é opcional.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const requested = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
    if (requested !== root && !requested.startsWith(`${root}${sep}`)) throw new Error("Caminho inválido");
    const info = await stat(requested);
    if (!info.isFile()) throw new Error("Arquivo inválido");
    response.writeHead(200, { "Content-Type": types[extname(requested)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(await readFile(requested));
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo não encontrado");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Planejador disponível em http://127.0.0.1:${port}`);
});
