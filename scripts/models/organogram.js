// Organograma Orçamentário: setores administrativos (boxes) e vínculos (links) que repartem
// o Realizado das contas entre eles. Formato salvo:
//   { format: "orca-organograma", version: 1,
//     boxes: [{ id, name, parent, parents? }],       parent = superior principal; parents = todos
//     links: [{ id, box, type, origin, percent }] }   type "account" (uma conta) ou "sector" (setor da base inteiro)
// Exportação: a soma dos vínculos de cada conta deve arredondar a 100% na precisão da tela.
// O superior soma os subordinados (consolidado) sem gastar percentual de novo.
import { hasBudgetOrigin, periodValues, periodsForYear } from "./budget.js";

export const emptyOrganogram = () => ({ format: "orca-organograma", version: 1, boxes: [], links: [] });
export const sectorColors = ["#123a5a", "#e47734", "#0c7c75", "#497fa7", "#a65c32", "#6865a5", "#64913e", "#ad4d69", "#419b9a", "#926b22", "#66534e", "#385793"];

// Organograma da AGE, com as raízes primeiro. Cada linha: [id, nome, superiores].
const ageSectors = [
  ["conad", "CONAD (Conselho de Administração)", []],
  ["confin", "CONFI (Conselho Fiscal)", []],
  ["auditoria", "Gerência de Auditoria Interna", []],
  ["pad", "Comissão PAD", []],
  ["presidencia", "Presidência - PRESI", []],
  ["cpl", "CPL", ["presidencia"]],
  ["ouvidoria", "Ouvidoria", ["presidencia"]],
  ["juridica", "Superintendência Jurídica", ["presidencia"]],
  ["comunicacao", "Gerência de Comunicação", ["presidencia"]],
  ["compliance", "Gerência de Compliance e Controles Internos", ["presidencia"]],
  ["governanca", "Secretaria de Governança", ["presidencia"]],
  ["dpg", "Diretoria de Planejamento e Gestão - DIPLAG", ["presidencia"]],
  ["administrativa", "Gerência Administrativa", ["dpg"]],
  ["dados", "Gerência de Planejamento de Dados, Mercado e Orçamento", ["dpg"]],
  ["ti", "Superintendência de Tecnologia da Informação", ["dpg"]],
  ["ger-ti", "Gerência de Tecnologia da Informação", ["ti"]],
  ["don", "Diretoria de Operações e Negócios - DIROP", ["presidencia"]],
  ["sup-pn", "Superintendência de Pequenos Negócios", ["don"]],
  ["ger-pn", "Gerência de Pequenos Negócios", ["sup-pn"]],
  ["sup-oe", "Superintendência de Operações Especiais", ["don"]],
  ["dfin", "Diretoria Financeira - DIRFI", ["presidencia"]],
  ["sup-fin", "Superintendência Financeira", ["dfin"]],
  ["contabil", "Gerência Contábil", ["sup-fin"]],
  ["sup-cc", "Superintendência de Crédito e Cobrança", ["dfin"]],
  ["ger-cc", "Gerência de Crédito e Cobrança", ["sup-cc"]],
];

// Divide todos os setores da base igualmente entre os setores administrativos.
export function defaultOrganogram(model) {
  const percent = 100 / ageSectors.length;
  return { ...emptyOrganogram(),
    boxes: ageSectors.map(([id, name, parents]) => boxWithParents({ id, name }, parents)),
    links: ageSectors.flatMap(([box]) => [...model.sectors.keys()].map(origin => ({ id: `${box}:${origin}`, box, type: "sector", origin, percent }))) };
}

// parent identifica o superior principal; parents reúne os superiores quando há mais de um.
export function parentIds(box) {
  if (Array.isArray(box.parents)) return [...new Set(box.parents)];
  return box.parent === null || box.parent === undefined ? [] : [box.parent];
}

function boxWithParents(box, parents) {
  const all = [...new Set(parents)];
  const result = { ...box, parent: all[0] ?? null };
  if (all.length > 1) result.parents = all;
  return result;
}

export function setParentIds(box, parents) {
  const all = [...new Set(parents)];
  box.parent = all[0] ?? null;
  if (all.length > 1) box.parents = all; else delete box.parents;
  return box;
}

// Cria um setor acima de childId: o novo setor herda o superior antigo e vira o superior do filho.
export function addSuperior(config, childId, id, name) {
  const child = config.boxes.find(sector => sector.id === childId);
  if (!child) throw new Error("Selecione o setor administrativo que receberá uma superior.");
  const childParents = parentIds(child);
  const superior = boxWithParents({ id, name: String(name).trim() }, childParents);
  if (!superior.name || superior.name.length > 120 || !id || config.boxes.some(sector => sector.id === id)) throw new Error("Informe um nome válido para o novo setor superior.");
  config.boxes.push(superior);
  setParentIds(child, childParents.length > 1 ? [id, ...childParents] : [id]);
  return superior;
}

// Confere formato, ids únicos, superiores existentes, ausência de ciclos e origens existentes no modelo.
// Não exige 100%: rascunho incompleto é válido. Devolve uma cópia só com os campos salvos.
export function validateOrganogram(input, model) {
  if (!input || input.format !== "orca-organograma" || input.version !== 1 || !Array.isArray(input.boxes) || !Array.isArray(input.links)) {
    throw new Error("JSON de organograma incompatível.");
  }
  if (input.boxes.length > 500) throw new Error("O organograma aceita no máximo 500 setores.");
  if (input.links.length > 10000) throw new Error("O organograma aceita no máximo 10000 vínculos.");
  const ids = new Set();
  const names = new Set();
  for (const box of input.boxes) {
    if (!box || typeof box.id !== "string" || !box.id || ids.has(box.id) || typeof box.name !== "string"
      || !box.name.trim() || box.name.length > 120 || (box.parent !== undefined && box.parent !== null && typeof box.parent !== "string")
      || (box.parents !== undefined && !Array.isArray(box.parents))) throw new Error("Setor administrativo inválido ou identificador duplicado.");
    // Acentos, espaços e maiúsculas não criam um setor diferente.
    const name = box.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
    if (names.has(name)) throw new Error(`Nome de setor administrativo duplicado: ${box.name.trim()}.`);
    names.add(name);
    const parents = parentIds(box);
    if ((box.parents !== undefined && parents.length !== box.parents.length)
      || (box.parents !== undefined && box.parent !== undefined && box.parent !== null && box.parent !== parents[0])
      || parents.some(parent => typeof parent !== "string" || !parent)) throw new Error("Setor administrativo inválido ou identificador duplicado.");
    ids.add(box.id);
  }
  const boxes = new Map(input.boxes.map(box => [box.id, box]));
  // Sobe por todos os superiores; passar duas vezes pelo mesmo setor é ciclo.
  function visitParents(box, visited) {
    for (const parent of parentIds(box)) {
      if (!boxes.has(parent)) throw new Error(`Superior inexistente em ${box.name}.`);
      if (visited.has(parent)) throw new Error("A hierarquia não pode conter ciclos.");
      visitParents(boxes.get(parent), new Set([...visited, parent]));
    }
  }
  for (const box of input.boxes) visitParents(box, new Set([box.id]));
  const links = new Set();
  for (const link of input.links) {
    if (!link || typeof link.id !== "string" || !link.id || links.has(link.id) || !ids.has(link.box)
      || !["account", "sector"].includes(link.type) || typeof link.origin !== "string"
      || typeof link.percent !== "number" || !Number.isFinite(link.percent) || link.percent < 0) {
      throw new Error("Vínculo inválido: selecione setor administrativo, origem e percentual não negativo.");
    }
    if (!hasBudgetOrigin(model, link.type, link.origin)) throw new Error(`Origem inexistente: ${link.origin}.`);
    links.add(link.id);
  }
  // Somente a configuração participa da persistência; valores derivados são descartados.
  return { format: "orca-organograma", version: 1,
    boxes: input.boxes.map(({ id, name, parent, parents }) => boxWithParents({ id, name: name.trim() }, parents ?? (parent === null || parent === undefined ? [] : [parent]))),
    links: input.links.map(({ id, box, type, origin, percent }) => ({ id, box, type, origin, percent })) };
}

// Texto de uma origem de vínculo (conta ou setor da base inteiro): "Despesa · código · descrição".
export function originLabel(link, model) {
  const origin = link.type === "account" ? model.records.find(record => record.account === link.origin) : model.sectors.get(link.origin);
  if (!origin) return `Fora do recorte · ${link.origin}`;
  return `${origin.group} · ${link.origin} · ${origin.rubric ?? origin.name}`;
}

// Tudo o que pode ser pesquisado numa conta: grupo, código, descrição e setor da base.
export function recordSearchText(record) {
  return `${record.group} ${record.account} ${record.rubric} ${record.sectorCode} ${record.sector}${record.isReconciliation ? " ajuste" : ""}`;
}

// Contas alcançadas por um vínculo: a própria conta ou todas as contas do setor da base.
export function linkedRecords(link, model) {
  return model.records.filter(record => link.type === "account" ? record.account === link.origin : record.sectorCode === link.origin);
}

// Mesma precisão na apresentação, edição e validação, sem alterar os valores salvos.
export function roundAllocationPercent(value) {
  const cleanValue = Number(value.toFixed(8));
  return Math.round((cleanValue + Number.EPSILON) * 100) / 100;
}

// A tela exibe duas casas; a validação usa o mesmo arredondamento.
// difference > 0: falta; < 0: excesso.
export function allocationIssues(config, model) {
  validateOrganogram(config, model);
  const percentages = new Map(model.records.map(record => [record.account, 0]));
  for (const link of config.links) for (const record of linkedRecords(link, model)) percentages.set(record.account, percentages.get(record.account) + link.percent);
  return model.records.flatMap(record => {
    const percent = percentages.get(record.account);
    const roundedPercent = roundAllocationPercent(percent);
    if (roundedPercent === 100) return [];
    return [{ account: record.account, rubric: record.rubric, percent, difference: 100 - percent }];
  });
}

// Vínculos que distribuem uma conta (diretos e do setor da base dela), com o nome do setor administrativo.
export function allocationBreakdown(config, model, account) {
  validateOrganogram(config, model);
  const record = model.records.find(item => item.account === account);
  if (!record) return [];
  const boxes = new Map(config.boxes.map(box => [box.id, box.name]));
  return config.links
    .filter(link => link.type === "account" ? link.origin === account : link.origin === record.sectorCode)
    .map(link => ({ ...link, boxName: boxes.get(link.box), group: record.group }));
}

// Valores do organograma em cada mês do ano, só com Realizado. Para cada setor:
// own = soma dos vínculos diretos (Realizado × percentual); consolidated = cada setor alcançado
// uma única vez, mesmo quando o setor tem mais de um superior. Devolve os setores em ordem de
// hierarquia (pai antes dos filhos, com depth), os membros alcançados e o total das raízes.
export function organogramValues(config, model, year) {
  validateOrganogram(config, model);
  const periods = periodsForYear(model, year);
  const blank = () => Object.fromEntries(periods.map(period => [period, { Receita: 0, Despesa: 0, Resultado: 0 }]));
  const add = (target, source) => {
    for (const period of periods) for (const group of ["Receita", "Despesa", "Resultado"]) {
      target[period][group] += source[period][group];
      if (!Number.isFinite(target[period][group])) throw new Error("Total do setor excede o limite numérico. Revise os valores e percentuais.");
    }
  };
  const nodes = new Map(config.boxes.map(box => [box.id, { ...box, own: blank(), consolidated: blank(), links: [], children: [] }]));
  for (const link of config.links) {
    const records = linkedRecords(link, model);
    if (link.type === "account" ? !records.length : !model.sectors.has(link.origin)) continue;
    const values = blank();
    for (const record of records) for (const period of periods) values[period][record.group] += (periodValues(model, record, period).actual ?? 0) * link.percent / 100;
    for (const period of periods) {
      values[period].Resultado = values[period].Receita - values[period].Despesa;
      if (Object.values(values[period]).some(value => !Number.isFinite(value))) throw new Error("Valor atribuído excede o limite numérico. Revise os percentuais.");
    }
    const node = nodes.get(link.box);
    node.links.push({ ...link, values, description: link.type === "account" ? records[0].rubric : model.sectors.get(link.origin).name });
    add(node.own, values);
  }
  for (const node of nodes.values()) for (const parent of parentIds(node)) nodes.get(parent).children.push(node);
  const roots = [...nodes.values()].filter(node => parentIds(node).length === 0);
  // A profundidade mínima mantém um setor com dois superiores no mesmo nível visual.
  const depth = new Map(roots.map(root => [root.id, 0])), queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index], nextDepth = depth.get(node.id) + 1;
    for (const child of node.children) if (!depth.has(child.id) || nextDepth < depth.get(child.id)) {
      depth.set(child.id, nextDepth);
      queue.push(child);
    }
  }
  const ordered = [], visited = new Set();
  function order(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    node.depth = depth.get(node.id) ?? 0;
    ordered.push(node);
    for (const child of node.children) order(child);
  }
  for (const root of roots) order(root);
  for (const node of nodes.values()) order(node); // configuração sem raiz não passa pela validação, mas mantém a saída total.

  function membersOf(node) {
    const members = [], seen = new Set();
    function collect(current) {
      if (seen.has(current.id)) return;
      seen.add(current.id);
      members.push(current.id);
      for (const child of current.children) collect(child);
    }
    collect(node);
    return members;
  }
  for (const node of ordered) {
    node.members = membersOf(node);
    node.consolidated = blank();
    for (const id of node.members) add(node.consolidated, nodes.get(id).own);
    // Totais do ano: node.totals.own.Despesa, node.totals.consolidated.Receita etc.
    const yearTotal = (kind, group) => periods.reduce((sum, period) => sum + node[kind][period][group], 0);
    node.totals = Object.fromEntries(["own", "consolidated"].map(kind => [kind, Object.fromEntries(["Receita", "Despesa", "Resultado"].map(group => [group, yearTotal(kind, group)]))]));
  }
  const total = blank(), totalMembers = new Set(roots.flatMap(root => membersOf(root)));
  for (const id of totalMembers) add(total, nodes.get(id).own);
  return { periods, nodes: ordered, total };
}

// Dados do visual da página (rosca, ranking e árvore) para um grupo, no ano inteiro ou num mês.
// slices: setores com valor próprio positivo e sua parte (share). credits: soma dos valores próprios negativos.
export function expenseView(config, model, year, period = "", group = "Despesa") {
  const data = organogramValues(config, model, year);
  if (period && !data.periods.includes(period)) throw new Error("Período inválido para o ano selecionado.");
  const periods = period ? [period] : data.periods;
  const total = (values, key) => periods.reduce((sum, p) => sum + values[p][key], 0);
  const nodes = data.nodes.map(node => ({ id: node.id, name: node.name, parent: node.parent, parents: parentIds(node), depth: node.depth,
    ownExpense: total(node.own, "Despesa"), expense: total(node.consolidated, "Despesa"),
    ownRevenue: total(node.own, "Receita"), revenue: total(node.consolidated, "Receita"), result: total(node.consolidated, "Resultado"),
    own: total(node.own, group), consolidated: total(node.consolidated, group) }));
  const positive = nodes.reduce((sum, node) => sum + Math.max(0, node.own), 0);
  const slices = nodes.filter(node => node.own > 0).map(node => ({ ...node, share: node.own / positive })).sort((a, b) => b.own - a.own);
  return { group, nodes, slices, positive, total: total(data.total, group), revenueTotal: total(data.total, "Receita"), expenseTotal: total(data.total, "Despesa"), credits: nodes.reduce((sum, node) => sum + Math.min(0, node.own), 0), periods };
}
