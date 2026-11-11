# Manutenção

Reúne verificações, orientações de mudança e manutenção da documentação.
<details>
<summary><img class="doc-icon" src="../../images/icons/book-open.svg" alt="" aria-hidden="true"> Arquivos de código usados nesta página</summary>

Esta página foi escrita a partir destes arquivos:

- [local-runtime.test.js](../../tests/local-runtime.test.js)
- [planning.test.js](../../tests/planning.test.js)
- [workbook.test.js](../../tests/workbook.test.js)
- [visual.test.js](../../tests/visual.test.js)
- [search.test.js](../../tests/search.test.js)
- [ui.browser.test.js](../../tests/ui.browser.test.js)
- [fixtures.js](../../tests/fixtures.js)
- [build.mjs](../../scripts/build.mjs)

</details>


> **Páginas relacionadas**: [Visão geral](01_visao-geral.md)

---

## Testes

`node --test` encontra todos os `*.test.js`, sem NPM nem instalação de pacotes. Não há framework: só `node:test` e `node:assert/strict`.

| Arquivo | Cobre |
|---------|-------|
| `planning.test.js` | Cálculo e organograma: hierarquia de baixo para cima, conta duplicada, três faixas, variação, 100% e consolidação, ciclos ([planning.test.js](../../tests/planning.test.js)) |
| `workbook.test.js` | JSON só com entradas, Excel bloqueado sem 100%, abas ocultas, totais anuais, reabertura, recusa de fórmula alterada e **base real** ([workbook.test.js](../../tests/workbook.test.js)) |
| `visual.test.js` | Rosca, ranking, estilos e gráficos do Excel, aspas do LibreOffice, precisão numérica e padrão AGE ([visual.test.js](../../tests/visual.test.js)) |
| `organogram.test.js` | Sete raízes independentes, nomes repetidos e paridade entre guia, botão padrão e Excel |
| `budget-validation.test.js` | Total único por grupo e rejeição de alcance de índice desconhecido |
| `search.test.js` | Busca por palavras e lista de anos de "Projetar até" ([search.test.js](../../tests/search.test.js)) |
| `local-runtime.test.js` | Regras do projeto: sem `type="module"`, sem recursos remotos no `index.html`, pastas, links dos `.md`, datas só no backlog, sem Python ([local-runtime.test.js](../../tests/local-runtime.test.js)) |
| `forecast-history.test.js` | Mediana histórica, ajuste recorrente, recorte e compatibilidade |
| `horizon-ui.test.js` | Limites de Ir até e Retomar em, incluindo virada de ano |
| `summary-ui.test.js` | Recorte visual por mês sem alterar o modelo |
| `mvc.test.js` | Imports, models sem DOM e histórico independente da interface |
| `ui.browser.test.js` | Fluxo completo num navegador real, com Playwright ([ui.browser.test.js](../../tests/ui.browser.test.js)) |

- **Base de teste:** `fixture()` cria uma receita e uma despesa de 2025-01 a 2026-07. `allocated(model)` cria um organograma com 100% ([fixtures.js](../../tests/fixtures.js)).
- **Base real:** um teste lê `documents/database/orcamento/Evolução Receitas e Despesas_Atualizado até Setembro 2026.xlsx`, na raiz do repositório ([workbook.test.js](../../tests/workbook.test.js)). Se a base não existir nessa cópia, o teste informa que foi ignorado. Defina `POU_BUDGET_FIXTURE` com o caminho do arquivo para executá-lo; um caminho configurado incorretamente continua falhando.
- **Navegador:** somente os testes opcionais de `ui.browser.test.js` dependem de ferramenta externa de manutenção e só rodam com `POU_PLAYWRIGHT` apontando para o módulo do Playwright. `POU_BROWSER_CHANNEL` escolhe o navegador (padrão `msedge`) ([ui.browser.test.js](../../tests/ui.browser.test.js)).

Refatorações do domínio devem preservar a saída: compare, antes e depois, o modelo calculado, os arquivos do Excel gerado e o resultado da reabertura para o mesmo cenário.

Sources: [package.json](../../package.json), [fixtures.js](../../tests/fixtures.js)

---

## Receitas de mudança

### Mudar a regra da projeção

1. Altere `forecastAdjustment` ou `project` em `models/budget.js` ([budget.js](../../scripts/models/budget.js)).
2. Altere as **fórmulas equivalentes** da aba Cálculo em `calculationData` ([xlsx.js](../../scripts/export/xlsx.js)).
3. Atualize o texto explicativo da aba Índices ([xlsx.js](../../scripts/export/xlsx.js)), a Central de ajuda ([index.html](../../index.html)), `docs/README.md` e a página [Cálculo](04_calculo.md).
4. Registre a mudança em `docs/backlog.md`.

**Compatibilidade:** a leitura escolhe as regras históricas pela versão salva e confere as fórmulas antes de recalcular com a versão atual. Preserve os caminhos de compatibilidade de `readPlanningWorkbook` e `checkSheets` ao mudar fórmulas; uma mudança sem esse cuidado pode recusar arquivos anteriores como "Fórmula alterada". Atualize a versão e os testes de reabertura quando o contrato mudar ([xlsx.js](../../scripts/export/xlsx.js), [planning.js](../../scripts/export/planning.js)).

### Salvar um campo novo no planejamento

1. Acrescente o campo em `state` e em `editorSnapshot`, se ele puder ser desfeito ([editor-state.js](../../scripts/models/editor-state.js)).
2. Grave o campo em `createProject` e valide-o em `restoreProject` ([planning.js](../../scripts/export/planning.js)).
3. Carregue o campo em `loadProject` ([files-controller.js](../../scripts/controllers/files-controller.js)).
4. Se o campo afetar o cálculo, passe-o para `buildBudget`. O Excel embute o mesmo JSON (aba `_Planejador`), então o campo também é exportado sem alteração em `export/xlsx.js`.
5. Salve só **entradas**. Um teste garante que o JSON não contém campos derivados como `forecast` e `final` ([workbook.test.js](../../tests/workbook.test.js)).

### Alterar ou acrescentar uma tela

1. Coloque a renderização em `scripts/views/` e as ações no controller do assunto em `scripts/controllers/`.
2. Reutilize os models em `scripts/models/`; regras de cálculo não devem acessar a página.
3. Registre arquivos novos na lista `names` de `scripts/build.mjs`, antes de seus consumidores. O app controller é o último.
4. Conecte a tela em `controllers/app-controller.js`, preservando a ordem de recálculo, histórico e renderização.
5. Use nomes únicos no topo dos arquivos e imports em uma única linha, terminados em ponto e vírgula.
6. Rode os testes afetados e `node scripts/build.mjs`.

### Acrescentar uma aba ao Excel

Acrescente a aba **no fim** da lista de `workbookSheets` ([xlsx.js](../../scripts/export/xlsx.js)). Inserir no meio muda os números de `sheetN.xml`. Os gráficos estão presos à aba 3 (`sheets[2]` e `sheet3.xml.rels`) ([xlsx.js](../../scripts/export/xlsx.js), [workbook-visual.js](../../scripts/export/workbook-visual.js)), e os testes procuram `sheet1`, `sheet3`, `sheet4` e `sheet5`.

### Mudar o organograma padrão

Edite `ageSectors`: cada linha é `[id, nome, lista de superiores]`. Uma lista vazia representa uma raiz ([organogram.js](../../scripts/models/organogram.js)). Ao alterar a estrutura, atualize os testes, o texto do `index.html`, a documentação e o [guia JSON](../GUIA_LLM_ORGANOGRAMA_JSON.md). Rode `node scripts/build.mjs` para regenerar o bundle e `node scripts/build-docs.mjs` para atualizar a documentação offline.

Sources: [budget.js](../../scripts/models/budget.js), [xlsx.js](../../scripts/export/xlsx.js), [planning.js](../../scripts/export/planning.js), [build.mjs](../../scripts/build.mjs)

---

## Armadilhas conhecidas

| Armadilha | Sintoma | Como evitar |
|-----------|---------|-------------|
| Esquecer o build | A página ignora a mudança | `node scripts/build.mjs` sempre depois de mexer em `scripts/` |
| Mesmo nome no topo de dois módulos | `node scripts/build.mjs` falha com "declarado em … e em …" | Renomeie um deles ([build.mjs](../../scripts/build.mjs)) |
| `import` em várias linhas | O bundle fica com `import` solto e quebra | Um `import` por linha, terminado em `;` ([build.mjs](../../scripts/build.mjs)) |
| Tratar mês como `Date` | Erro de fuso e de mês 0/1 | Use texto `AAAA-MM` e as funções de `models/budget.js` ([budget.js](../../scripts/models/budget.js)) |
| Ler `record.final` direto | Valor errado na faixa de cópia ou com edição | Use `periodValues` ([budget.js](../../scripts/models/budget.js)) |
| Mudar fórmula do Excel | Excels antigos recusados ao reabrir | Veja a receita acima |
| Mais de 255 refs num `SUM` | Excel recusa a fórmula | Hoje o máximo é 84. Se crescer, agrupe em `SUM(SUM(…),…)` ([xlsx.js](../../scripts/export/xlsx.js)) |
| Recurso remoto no `index.html` | Teste falha, e o site deixa de funcionar offline | Guarde tudo em `images/`, `styles/` ou `scripts/vendor/` ([local-runtime.test.js](../../tests/local-runtime.test.js)) |
| Data `dd/mm/aaaa` num `.md` fora do backlog | Teste falha | Datas só em `docs/backlog.md` ([local-runtime.test.js](../../tests/local-runtime.test.js)) |
| Link quebrado num `.md` de `docs/` | Teste falha | Links relativos precisam apontar para arquivos existentes |
| Código de setor em fórmula sem escape | XML inválido | `escapeXml` ([xlsx.js](../../scripts/export/xlsx.js)) |

Sources: [build.mjs](../../scripts/build.mjs), [local-runtime.test.js](../../tests/local-runtime.test.js)

---

## Manutenção desta documentação

Os arquivos Markdown em `docs/` são as fontes da documentação. A skill global **offline-docs** gera `docs/index.html`, com navegação baseada nos títulos e links internos entre os assuntos. Os requisitos e comandos estão em [Preparação e geração](../setup.md).

Ao mudar o código:

1. Atualize as páginas afetadas para descrever o comportamento resultante. Preserve referências aos arquivos e funções atuais, sem depender de números de linha desatualizados.
2. Confira os destinos dos links relativos, as âncoras e as imagens locais. Atualize o índice no [README](../README.md) ao incluir ou remover assuntos.
3. Rode `node --test` dentro de `planejador_orcamentario/`. Os testes conferem os links dos arquivos Markdown e as regras locais da documentação.
4. Rode `node scripts/build-docs.mjs` para gerar a documentação. Separadamente, use `node scripts/build.mjs` após mudar fontes JavaScript da aplicação.
5. Confirme a mensagem `Built:` ou `No changes:` do gerador. Abra `docs/index.html` para consultar o resultado.

Escreva em português e UTF-8, com um único título principal por página. Mantenha propostas separadas de funcionalidades implementadas. A escrita e a revisão dos textos precedem a renderização: a skill converte as fontes e não verifica sua exatidão contra o código. Edite os arquivos Markdown e regenere o HTML após alterações.

Sources: [Preparação e geração](../setup.md), [README](../README.md), [build-docs.mjs](../../scripts/build-docs.mjs), [package.json](../../package.json)
