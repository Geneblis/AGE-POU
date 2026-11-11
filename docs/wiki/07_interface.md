# Interface

A apresentação fica em `scripts/views/`; eventos e alterações ficam em `scripts/controllers/`. Consulte o [mapa MVC](02_arquitetura.md) para localizar cada responsabilidade.

Apresenta a estrutura da tela e os módulos responsáveis pela interface.
<details>
<summary><img class="doc-icon" src="../../images/icons/book-open.svg" alt="" aria-hidden="true"> Arquivos de código usados nesta página</summary>

Esta página foi escrita a partir destes arquivos:

- [index.html](../../index.html)
- [styles.css](../../styles/styles.css)
- [app-controller.js](../../scripts/controllers/app-controller.js)
- [page-view.js](../../scripts/views/page-view.js)
- [files-controller.js](../../scripts/controllers/files-controller.js)
- [budget-controller.js](../../scripts/controllers/budget-controller.js)
- [summary-view.js](../../scripts/views/summary-view.js)

</details>


> **Páginas relacionadas**: [Arquitetura](02_arquitetura.md)

---

## Estrutura da página

O `index.html` define a estrutura fixa, os campos e os diálogos. As views criam ou atualizam linhas, cartões, gráficos SVG e controles com APIs nativas do navegador, sem mecanismo externo de templates.

| Elemento | Bloco | Responsável |
|----------|-------|-------------|
| `header`, `#help-dialog` | Topo e Central de ajuda | `views/page-view.js` |
| `#drop-zone`, `#xlsx-input`, `#project-input` | Importação | `controllers/files-controller.js` |
| `#status` | Mensagens com `aria-live` | `views/dom.js` |
| `#workspace` | Área liberada após carregar a base | `views/files-view.js` |
| `#end-year`, `#history-start`, `#copy-through`, `#resume-at` | Horizonte e recorte | `controllers/budget-controller.js`, `views/horizon-view.js` |
| `#undo-change`, `#redo-change` | Histórico | `controllers/app-controller.js`, `views/page-view.js` |
| `[role="tablist"]` | Abas de análise | `views/page-view.js` |
| `#summary-panel`, `#result-chart` | Totais e gráfico | `views/summary-view.js` |
| `#view-month` | Limite visual do mês | `controllers/app-controller.js`, views de orçamento e resumo |
| `#variable-form` | Índices | `controllers/budget-controller.js`, `views/indices-view.js` |
| `#sector-tree`, `#link-dialog` | Árvore e vínculos | Controller e views de organograma |
| `#save-project`, `#export-xlsx` | Saída de arquivos | `controllers/files-controller.js` |
| `footer` | Documentação técnica | `index.html` |
| Scripts ao final da página | JSZip local e bundle | `index.html` |

Sources: [index.html](../../index.html)

---

## Módulos de tela

| Módulo | Faz | Funções principais |
|--------|-----|--------------------|
| `controllers/app-controller.js` | Liga os módulos, recalcula e redesenha. Também cuida de Desfazer/Refazer e do ano exibido. | `rebuild`, `renderAll`, `renderAnalysis` ([app-controller.js](../../scripts/controllers/app-controller.js)) |
| `views/page-view.js` | Abre e fecha a Central de ajuda (clique fora fecha). Também controla as abas, com setas, Home e End. | [page-view.js](../../scripts/views/page-view.js) |
| `controllers/files-controller.js` | Importa `.xlsx` (planilha da empresa ou Excel do POU), abre e salva o JSON, exporta o Excel e trata arrastar e soltar | `loadProject` ([files-controller.js](../../scripts/controllers/files-controller.js)), `importWorkbook` ([files-controller.js](../../scripts/controllers/files-controller.js)), `exportWorkbook` ([files-controller.js](../../scripts/controllers/files-controller.js)) |
| `controllers/budget-controller.js` | Projetar até, Começar em, Ir até e Retomar em. Mostra o início da base histórica, o mês após o limite de cópia e o mês antes do início dinâmico. Guarda `projection.initial` na primeira faixa fixa. | `changeEndYear`, `changePeriods` ([budget-controller.js](../../scripts/controllers/budget-controller.js)) |
| `controllers/budget-controller.js` | Cadastra, remove, importa e exporta índices | `addVariable` ([budget-controller.js](../../scripts/controllers/budget-controller.js)), `importVariables` ([budget-controller.js](../../scripts/controllers/budget-controller.js)) |
| `views/summary-view.js` | Painel com Projetado e Realizado do ano, limitado ao mês exibido, e gráfico de barras do resultado | `renderSummary` ([summary-view.js](../../scripts/views/summary-view.js)) |
| `controllers/budget-controller.js` | Tabela mensal editável, busca de conta e prévia durante a digitação | `commitEdit`, `previewEdit`; renderização em `views/budget-view.js` ([budget-controller.js](../../scripts/controllers/budget-controller.js)) |
| `organogram-*.js` | Aba Organograma | Veja [Organograma](05_organograma.md) |

Uma base nova começa com **Começar em** no primeiro mês do Realizado e com **Projetar até** no ano de referência mais 20. Mudar **Começar em** atualiza os meses do Orçamento e do Organograma e registra a alteração no histórico de Desfazer e Refazer. [budget-controller.js](../../scripts/controllers/budget-controller.js) · [files-controller.js](../../scripts/controllers/files-controller.js)

### Filtro de mês

**Exibir até o mês** limita cartões, gráfico e tabela ao mês selecionado. Não altera o modelo salvo nem a exportação. A Média padrão continua anual. O mês permanece ao trocar de ano; se ficar antes de **Começar em**, a interface ajusta a escolha ao primeiro mês disponível.

### Busca e totais do orçamento

Ao preencher **Buscar conta**, a tabela mostra apenas as contas encontradas. Seus subtotais de Receita e Despesa e a linha Resultado também somam apenas essas contas ([budget-view.js](../../scripts/views/budget-view.js)).

Os cartões e o gráfico do painel continuam mostrando o orçamento completo: o painel soma todas as contas do modelo ([summary-view.js](../../scripts/views/summary-view.js)). Assim, durante uma busca, os números da tabela podem ser diferentes dos números acima dela. Apagar a busca devolve à tabela os totais de todas as contas.

Sources: [app-controller.js](../../scripts/controllers/app-controller.js), [files-controller.js](../../scripts/controllers/files-controller.js), [budget-controller.js](../../scripts/controllers/budget-controller.js)

---

## Padrões de edição

**1. Guardar o antes, validar e só depois confirmar.** O exemplo resume a edição do orçamento; a ordem do histórico e da renderização segue o fluxo de cada ação:

```js
const before = editorSnapshot();          // 1. guarda o estado
state.variables.push(novo);               // 2. altera
try { buildBudget(/* entradas */); }      // 3. valida calculando
catch (error) { state.variables = before.variables; return setStatus(error.message, true); }
recordHistory(before);                    // 4. histórico
rebuild();                                // 5. recalcula e redesenha
```

Exemplo real: [budget-controller.js](../../scripts/controllers/budget-controller.js). O organograma usa a variante `commit(edit)` sobre uma cópia ([organogram-controller.js](../../scripts/controllers/organogram-controller.js)).

**2. Prévia sem gravar.** Enquanto o usuário digita uma célula, `previewEdit` calcula um modelo **temporário** e redesenha totais e variações. Depois devolve o modelo confirmado no `finally` ([budget-controller.js](../../scripts/controllers/budget-controller.js)). A gravação só acontece no `change`, quando o foco sai do campo ([budget-controller.js](../../scripts/controllers/budget-controller.js)).

**3. Redesenhar sem perder o foco.** Com um campo em digitação, a tabela não é recriada. `patchRows` copia valores e classes da tabela nova para a atual e pula o campo ativo ([budget-controller.js](../../scripts/controllers/budget-controller.js)).

**4. Eventos delegados.** A tabela registra `input` e `change` uma vez só, no `<tbody>`, e filtra por `input[data-account]` ([budget-controller.js](../../scripts/controllers/budget-controller.js)). Cada campo carrega `data-account`, `data-period` e `data-kind` ([budget-controller.js](../../scripts/controllers/budget-controller.js)).

**5. Projetado protegido.** Fora da faixa dinâmica, o campo de Projetado fica `readOnly` e explica o motivo no `title` ([budget-controller.js](../../scripts/controllers/budget-controller.js)).

**6. Utilitários de `views/dom.js`.** Use `$`, `createElement`, `fillSelect`, `setStatus`, `download`, `matchesSearch` e `formatPercent`. Não crie versões locais deles ([dom.js](../../scripts/views/dom.js)).

Sources: [budget-controller.js](../../scripts/controllers/budget-controller.js), [dom.js](../../scripts/views/dom.js)

---

## CSS e acessibilidade

`styles/styles.css` é um arquivo só, na ordem em que as seções aparecem na página. O cabeçalho explica a organização. Cores e raio de borda são variáveis em `:root` (`--brand`, `--ink`, `--navy`, `--revenue`, `--expense`, `--radius` etc.); novas regras devem usá-las em vez de valores fixos. Os pontos de quebra são `68rem`, `46rem` e `600px`.

O CSS tem cinco seções identificadas por comentários: **Base**, **Estrutura**, **Orçamento e Índices**, **Organograma** e **Central de ajuda**. Procure esses nomes e os seletores do componente; números de linha mudam conforme o arquivo evolui.

Acessibilidade que já existe e precisa continuar funcionando:

- link para pular ao conteúdo ([index.html](../../index.html));
- `#status` com `role="status"` e `aria-live`, para leitores de tela ouvirem cada mensagem ([index.html](../../index.html));
- abas com `role="tablist"`, `aria-selected`, `tabindex` móvel e teclado ([page-view.js](../../scripts/views/page-view.js));
- janelas `<dialog>` abertas com `showModal()`, que devolvem o foco ao botão de origem ao fechar ([page-view.js](../../scripts/views/page-view.js), [organogram-search-view.js](../../scripts/views/organogram-search-view.js));
- cada campo da tabela com `aria-label` próprio, como "Realizado de X em 08/2026";
- itens do gráfico e da árvore acessíveis por Tab, com Enter, Espaço e Esc; o cartão ativo usa `aria-pressed` e seleciona o setor no formulário de vínculos ([organogram-visual.js](../../scripts/views/organogram-visual.js), [organogram-controller.js](../../scripts/controllers/organogram-controller.js));
- `prefers-reduced-motion` desliga a rolagem suave.

Sources: [index.html](../../index.html), [page-view.js](../../scripts/views/page-view.js), [styles.css](../../styles/styles.css)

---
