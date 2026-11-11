// Visual da aba Organograma: rosca com a parte de cada setor, ranking e árvore da hierarquia.
// Todos mostram a mesma dica (tooltip) com os valores do setor ao passar o mouse, tocar ou focar.
import { formatMoney } from "../models/budget.js";
import { expenseView, sectorColors } from "../models/organogram.js";

const SVG = "http://www.w3.org/2000/svg";
const percentage = value => value.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgElement(tag, attributes) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function escapeSvg(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
}

function boxWithin(node, container) {
  const box = node.getBoundingClientRect(), parent = container.getBoundingClientRect();
  return { left: box.left - parent.left + container.scrollLeft, top: box.top - parent.top + container.scrollTop, width: box.width, height: box.height, right: box.right - parent.left + container.scrollLeft, bottom: box.bottom - parent.top + container.scrollTop };
}

function cssPixels(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function svgLine(parts, x1, y1, x2, y2, color) {
  parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeSvg(color)}" stroke-width="1"/>`);
}

function svgText(parts, text, x, baseline, style, anchor = "start") {
  parts.push(`<text x="${x}" y="${baseline}" text-anchor="${anchor}" fill="${escapeSvg(style.color)}" font-family="${escapeSvg(style.fontFamily)}" font-size="${cssPixels(style.fontSize, 12)}px" font-weight="${escapeSvg(style.fontWeight)}">${escapeSvg(text)}</text>`);
}

function wrapText(text, maxWidth, style, measure) {
  const words = String(text).trim().split(/\s+/).filter(Boolean), lines = [];
  measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawConnectors(parts, tree, lineColor) {
  for (const branch of tree.querySelectorAll(".sector-branch")) {
    const parent = branch.querySelector(":scope > .sector-node"), childrenList = branch.querySelector(":scope > .sector-branches");
    if (!parent || !childrenList) continue;
    const childNodes = [...childrenList.querySelectorAll(":scope > .sector-branch > .sector-node")];
    if (!childNodes.length) continue;
    const parentBox = boxWithin(parent, tree), listBox = boxWithin(childrenList, tree);
    const parentCenter = parentBox.left + parentBox.width / 2, childCenters = childNodes.map(node => { const box = boxWithin(node, tree); return { center: box.left + box.width / 2, top: box.top }; });
    svgLine(parts, parentCenter, parentBox.bottom, parentCenter, listBox.top, lineColor);
    svgLine(parts, childCenters[0].center, listBox.top, childCenters.at(-1).center, listBox.top, lineColor);
    for (const child of childCenters) svgLine(parts, child.center, listBox.top, child.center, child.top, lineColor);
  }
}

function drawNode(parts, node, tree, measure) {
  const box = boxWithin(node, tree), nodeStyle = getComputedStyle(node), line = nodeStyle.getPropertyValue("--line").trim() || "#d6e0eb";
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
  const background = node.classList.contains("is-selected") ? surface : nodeStyle.backgroundColor || surface, borderColor = node.style.borderTopColor || line;
  parts.push(`<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="4" fill="${escapeSvg(background)}" stroke="${escapeSvg(line)}" stroke-width="1"/>`);
  parts.push(`<line x1="${box.left}" y1="${box.top + 2}" x2="${box.right}" y2="${box.top + 2}" stroke="${escapeSvg(borderColor)}" stroke-width="4"/>`);
  const name = node.querySelector(":scope > .sector-node-name"), value = node.querySelector(":scope > strong"), bars = node.querySelectorAll(":scope > .sector-bars");
  if (name) {
    const nameBox = boxWithin(name, tree), style = getComputedStyle(name), fontSize = cssPixels(style.fontSize, 12), lineHeight = cssPixels(style.lineHeight, fontSize * 1.3), maxLines = Math.max(1, Math.floor(nameBox.height / lineHeight + .1));
    let lines = wrapText(name.textContent, nameBox.width, style, measure);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, "")}…`; }
    lines.forEach((line, index) => svgText(parts, line, nameBox.left, nameBox.top + fontSize + index * lineHeight, style));
  }
  if (value) {
    const valueBox = boxWithin(value, tree);
    svgText(parts, value.textContent, valueBox.left, valueBox.top + valueBox.height * .8, getComputedStyle(value));
  }
  for (const bar of bars[0]?.querySelectorAll(":scope > .sector-bar") ?? []) {
    const heading = bar.querySelector(":scope > .sector-bar-heading"), track = bar.querySelector(":scope > .sector-bar-track");
    if (heading) {
      const label = heading.querySelector(":scope > span"), total = heading.querySelector(":scope > strong");
      if (label) { const box = boxWithin(label, tree); svgText(parts, label.textContent, box.left, box.top + box.height * .8, getComputedStyle(label)); }
      if (total) { const box = boxWithin(total, tree); svgText(parts, total.textContent, box.left, box.top + box.height * .8, getComputedStyle(total)); }
    }
    if (track) {
      const trackBox = boxWithin(track, tree), trackStyle = getComputedStyle(track);
      parts.push(`<rect x="${trackBox.left}" y="${trackBox.top}" width="${trackBox.width}" height="${trackBox.height}" rx="${trackBox.height / 2}" fill="${escapeSvg(trackStyle.backgroundColor)}"/>`);
      for (const fill of track.querySelectorAll(":scope > .sector-bar-fill")) {
        const fillBox = boxWithin(fill, tree);
        if (!fillBox.width) continue;
        parts.push(`<rect x="${fillBox.left}" y="${fillBox.top}" width="${fillBox.width}" height="${fillBox.height}" fill="${escapeSvg(getComputedStyle(fill).backgroundColor)}"/>`);
      }
    }
  }
}

// Captura a árvore inteira, inclusive a parte fora do scroll horizontal, sem biblioteca externa.
export async function captureOrganogramPng(tree) {
  if (!tree?.querySelector(".sector-node")) throw new Error("Crie pelo menos um setor antes de salvar a imagem.");
  const width = Math.ceil(Math.max(tree.scrollWidth, tree.clientWidth));
  const height = Math.ceil(Math.max(tree.scrollHeight, tree.clientHeight));
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("O navegador não disponibilizou um canvas para a captura.");
  const treeStyle = getComputedStyle(tree), lineColor = treeStyle.getPropertyValue("--line").trim() || "#d6e0eb";
  const parts = [`<rect width="100%" height="100%" fill="#fff"/>`];
  drawConnectors(parts, tree, lineColor);
  for (const node of tree.querySelectorAll(".sector-node")) drawNode(parts, node, tree, measure);
  const svg = `<svg xmlns="${SVG}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
  const imageUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise((resolve, reject) => {
      const item = new Image();
      item.onload = () => resolve(item);
      item.onerror = () => reject(new Error("Não foi possível preparar a imagem do organograma."));
      item.src = imageUrl;
    });
    const scale = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não disponibilizou um canvas para a captura.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG.")), "image/png"));
  } finally { URL.revokeObjectURL(imageUrl); }
}

// Dica com os valores do setor, abaixo do elemento e sempre dentro da janela.
function showTooltip(tooltip, node, event) {
  tooltip.replaceChildren(
    element("strong", "", node.name),
    element("span", "", `Despesa própria: ${formatMoney(node.ownExpense)}`),
    element("span", "", `Despesa com subordinados: ${formatMoney(node.expense)}`),
    element("span", "", `Receita própria: ${formatMoney(node.ownRevenue)}`),
    element("span", "", `Receita com subordinados: ${formatMoney(node.revenue)}`),
    element("span", "", `Resultado: ${formatMoney(node.result)}`),
  );
  tooltip.hidden = false;
  const bounds = event.currentTarget.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(innerWidth - 288, bounds.left))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(innerHeight - 180, bounds.bottom + 8))}px`;
}

// Mouse, toque, foco, Enter e Espaço mostram a dica; sair, perder o foco ou Esc escondem.
function bindTooltip(target, node, tooltip) {
  const show = event => showTooltip(tooltip, node, event);
  const hide = () => { tooltip.hidden = true; };
  target.addEventListener("pointerenter", show);
  target.addEventListener("focus", show);
  target.addEventListener("click", show);
  target.addEventListener("pointerleave", hide);
  target.addEventListener("blur", hide);
  target.addEventListener("keydown", event => {
    if (event.key === "Escape") hide();
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      show(event);
    }
  });
}

// Rosca (raio 120, centro 160,160): uma fatia por setor com valor próprio positivo.
function renderPie(chart, view, colors, noun, tooltip) {
  chart.replaceChildren();
  const point = angle => [160 + 120 * Math.sin(angle), 160 - 120 * Math.cos(angle)];
  let start = 0;
  for (const node of view.slices) {
    const end = start + node.share * Math.PI * 2;
    // Fatia de 100% não fecha o arco: termina um fio antes da volta completa.
    const finish = point(Math.min(end, Math.PI * 2 - 0.000001));
    const largeArc = end - start > Math.PI ? 1 : 0;
    const path = svgElement("path", {
      d: `M160,160 L${point(start).join(",")} A120,120 0 ${largeArc},1 ${finish.join(",")} Z`,
      fill: colors.get(node.id), stroke: "white", "stroke-width": "2", tabindex: "0", role: "button",
      "aria-label": `${node.name}: ${formatMoney(node.own)}, ${percentage(node.share)} das ${noun} positivas`,
    });
    bindTooltip(path, node, tooltip);
    chart.append(path);
    start = end;
  }
  if (!view.slices.length) {
    const text = svgElement("text", { x: "160", y: "160", "text-anchor": "middle" });
    text.textContent = `Sem ${noun} positivas`;
    chart.append(text);
  }
}

// Ranking dos setores pelo valor próprio, do maior para o menor.
function renderRanking(ranking, view, colors, tooltip) {
  ranking.replaceChildren();
  for (const node of [...view.nodes].sort((a, b) => b.own - a.own)) {
    const button = element("button", "expense-rank");
    button.type = "button";
    const dot = element("i", "sector-dot");
    dot.style.backgroundColor = colors.get(node.id);
    button.append(dot, element("span", "", node.name), element("strong", "", formatMoney(node.own)), element("small", "", node.own > 0 ? percentage(node.own / view.positive) : "—"));
    bindTooltip(button, node, tooltip);
    const item = element("li", "");
    item.append(button);
    ranking.append(item);
  }
}

function barShare(value, scale) {
  return scale > 0 ? Math.max(0, Math.min(100, value / scale * 100)) : 0;
}

// Cada setor mostra receitas e despesas; cada barra separa o valor próprio do valor dos filhos.
function renderValueBar(label, group, direct, indirect, scale, directClass, indirectClass) {
  const row = element("div", "sector-bar");
  row.dataset.group = group;
  const heading = element("span", "sector-bar-heading");
  heading.append(element("span", "", label), element("strong", "", formatMoney(direct + indirect)));
  const track = element("span", "sector-bar-track");
  const directFill = element("span", `sector-bar-fill sector-bar-fill-direct ${directClass}`);
  directFill.style.width = `${barShare(direct, scale)}%`;
  directFill.title = `${label} direta: ${formatMoney(direct)}`;
  const indirectFill = element("span", `sector-bar-fill sector-bar-fill-indirect ${indirectClass}`);
  indirectFill.style.width = `${barShare(indirect, scale)}%`;
  indirectFill.title = `${label} indireta: ${formatMoney(indirect)}`;
  track.append(directFill, indirectFill);
  row.append(heading, track);
  row.setAttribute("aria-label", `${label}: direta ${formatMoney(direct)}, indireta ${formatMoney(indirect)}, total ${formatMoney(direct + indirect)}`);
  return row;
}

// Árvore da hierarquia: cada setor mostra o consolidado e duas barras na mesma escala.
function renderBranch(parent, view, colors, group, tooltip, scales) {
  const list = element("ul", "sector-branches");
  for (const node of view.nodes.filter(node => parent === null ? node.parents.length === 0 : node.parents.includes(parent))) {
    const button = element("button", "sector-node");
    button.type = "button";
    button.dataset.sectorId = node.id;
    button.style.borderTopColor = colors.get(node.id);
    const bars = element("div", "sector-bars");
    bars.append(
      renderValueBar("Receita", "Receita", node.ownRevenue, node.revenue - node.ownRevenue, scales.revenue, "sector-bar-fill-revenue-direct", "sector-bar-fill-revenue-indirect"),
      renderValueBar("Despesa", "Despesa", node.ownExpense, node.expense - node.ownExpense, scales.expense, "sector-bar-fill-expense-direct", "sector-bar-fill-expense-indirect"),
    );
    button.append(element("span", "sector-node-name", node.name), element("strong", "", formatMoney(node.consolidated)), bars);
    button.setAttribute("aria-label", `${node.name}. ${group} própria ${formatMoney(node.own)}. Com subordinados ${formatMoney(node.consolidated)}. Receita direta ${formatMoney(node.ownRevenue)}, indireta ${formatMoney(node.revenue - node.ownRevenue)}. Despesa direta ${formatMoney(node.ownExpense)}, indireta ${formatMoney(node.expense - node.ownExpense)}.`);
    bindTooltip(button, node, tooltip);
    const item = element("li", "sector-branch");
    item.append(button);
    if (view.nodes.some(child => child.parents.includes(node.id))) item.append(renderBranch(node.id, view, colors, group, tooltip, scales));
    list.append(item);
  }
  return list;
}

// group: "Despesa" ou "Receita". period: "" para o ano inteiro ou "AAAA-MM".
export function renderOrganogramVisual(config, model, year, period, group = "Despesa") {
  const view = expenseView(config, model, year, period, group);
  const noun = group === "Despesa" ? "despesas" : "receitas", title = group === "Despesa" ? "Despesas" : "Receitas";
  const tooltip = document.getElementById("sector-tooltip");
  // Cor fixa por setor (ordem de cadastro), igual no gráfico, no ranking e na árvore.
  const colors = new Map(config.boxes.map((node, index) => [node.id, sectorColors[index % sectorColors.length]]));
  tooltip.hidden = true;
  document.getElementById("expense-total").textContent = formatMoney(view.total);
  document.getElementById("expense-title").textContent = `${title} por setor`;
  document.getElementById("expense-credit").textContent = view.credits < 0
    ? `Estornos líquidos de ${formatMoney(view.credits)} fora das fatias. Fatias mostram ${noun} próprias positivas.`
    : `${title} próprias por setor. Sem duplicar superiores.`;
  renderPie(document.getElementById("expense-pie"), view, colors, noun, tooltip);
  renderRanking(document.getElementById("expense-ranking"), view, colors, tooltip);
  const tree = document.getElementById("sector-tree");
  const scale = key => Math.max(0, view[`${key}Total`]);
  tree.replaceChildren(renderBranch(null, view, colors, group, tooltip, { revenue: scale("revenue"), expense: scale("expense") }));
  tree.scrollLeft = (tree.scrollWidth - tree.clientWidth) / 2; // raiz centralizada em árvores largas
}
