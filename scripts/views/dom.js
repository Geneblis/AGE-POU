// Utilitários de interface usados por todos os módulos da página.
import { roundAllocationPercent } from "../models/organogram.js";

export const $ = selector => document.querySelector(selector);

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export function setStatus(message, error = false) {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

export function checkFileSize(file) {
  if (file.size > MAX_FILE_SIZE) throw new Error("O arquivo ultrapassa o limite de 25 MB.");
}

export async function readJsonFile(file) {
  checkFileSize(file);
  return JSON.parse(await file.text());
}

export function download(content, filename, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export const deepCopy = value => JSON.parse(JSON.stringify(value));

// "2026-07" → "07/2026"
export function periodLabel(period) {
  const [year, month] = period.split("-");
  return `${month}/${year}`;
}

// Busca sem diferenciar acentos nem maiúsculas: "Aluguéis" encontra "alugueis".
export function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Cada palavra digitada precisa aparecer no texto, em qualquer ordem:
// "aluguéis de veículos" encontra "DESPESAS DE ALUGUÉIS - VEÍCULOS".
export function matchesSearch(text, query) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const target = normalizeSearch(text);
  return words.every(word => target.includes(word));
}

// createElement("button", { type: "button", textContent: "Salvar" })
export function createElement(tag, properties = {}) {
  return Object.assign(document.createElement(tag), properties);
}

export function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

export function fillSelect(select, options, selected) {
  select.replaceChildren(...options.map(([value, label]) => option(value, label)));
  if (selected !== undefined) select.value = String(selected);
}

// Percentual com duas casas: 4,333% vira 4,33%; 3,999% vira 4,00%.
export function formatPercent(value) {
  return roundAllocationPercent(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatVariance(value) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(value);
}
