# Excel: exportar e reabrir

Explica como exportar e reabrir planilhas com fórmulas verificadas.

## Histórico parcial e arquivos anteriores

A exportação usa os meses a partir de **Começar em** nas abas de análise e nos totais. A aba oculta **Histórico anterior** guarda os valores anteriores para consulta e pode ser reexibida no Excel. Essa aba fica fora das fórmulas. Ao reabrir o arquivo, o POU recupera a base e o recorte do JSON de `_Planejador`.

A aba oculta `Cálculo` agrupa o Realizado por mês do calendário para reproduzir a mediana inicial de cada conta. A coluna **Variação com movimento** alimenta a mediana do setor e é recalculada ao editar o Realizado. As fórmulas dos anos seguintes referenciam a previsão-base do mesmo mês no ano anterior e somam o ajuste mensal.

Na reabertura, o POU confere as fórmulas das versões 3 a 7 com as regras usadas na exportação e recalcula o cenário com a versão 8. O recorte e a seleção de contas com movimento podem mudar os valores recalculados, inclusive na faixa fixa reconstruída a partir das entradas iniciais. [Cálculo do orçamento](04_calculo.md)
<details>
<summary><img class="doc-icon" src="../../images/icons/book-open.svg" alt="" aria-hidden="true"> Arquivos de código usados nesta página</summary>

Esta página foi escrita a partir destes arquivos:

- [xlsx.js](../../scripts/export/xlsx.js)
- [workbook-xml.js](../../scripts/export/workbook-xml.js)
- [workbook-visual.js](../../scripts/export/workbook-visual.js)

</details>


> **Páginas relacionadas**: [Cálculo do orçamento](04_calculo.md), [Organograma Orçamentário](05_organograma.md)

---

## Como o .xlsx é montado

Um `.xlsx` é um ZIP de arquivos XML. O POU escreve esses XMLs como texto e usa o JSZip só para compactar. Não existe biblioteca de planilha. Isso dá controle total sobre fórmulas, estilos, abas ocultas, gráficos e validação de dados.

| Arquivo no ZIP | Gerado por |
|----------------|------------|
| `[Content_Types].xml`, `_rels/.rels` | `contentTypesXml` e constante em `createBudgetWorkbook` ([xlsx.js](../../scripts/export/xlsx.js)) |
| `xl/workbook.xml`, `xl/_rels/workbook.xml.rels` | `workbookXml`, `workbookRelationsXml` ([xlsx.js](../../scripts/export/xlsx.js)) |
| `xl/styles.xml` | `styles` ([workbook-xml.js](../../scripts/export/workbook-xml.js)) |
| `xl/worksheets/sheetN.xml` | `sheetXml` ([workbook-xml.js](../../scripts/export/workbook-xml.js)) |
| `xl/charts/chart1.xml`, `chart2.xml`, `xl/drawings/…` | `addCharts` ([workbook-visual.js](../../scripts/export/workbook-visual.js)) |

Cada célula é um `entry(valor, estilo, fórmula)` ([workbook-xml.js](../../scripts/export/workbook-xml.js)). O **valor já calculado vai junto da fórmula**. Assim, o arquivo mostra números mesmo antes de o Excel recalcular, e `fullCalcOnLoad` força o recálculo ao abrir ([xlsx.js](../../scripts/export/xlsx.js)).

Estilo é um índice de 0 a 14 numa tabela fixa. O comentário em [workbook-xml.js](../../scripts/export/workbook-xml.js) diz o que cada número significa (1 = R$, 2 = percentual, 3 = cabeçalho…).

Antes de gerar, `createBudgetWorkbook` passa o modelo por `createProject` → `restoreProject`. Assim, o Excel nasce do mesmo caminho de salvar e reabrir. Em seguida, ele exige que a soma dos vínculos de cada conta arredonde para 100% com até duas casas decimais, como na tela. Os percentuais originais permanecem no arquivo e nos cálculos ([xlsx.js](../../scripts/export/xlsx.js)).

Sources: [xlsx.js](../../scripts/export/xlsx.js), [workbook-xml.js](../../scripts/export/workbook-xml.js)

---

## Abas geradas

O arquivo abre na aba **Orçamento**, com as colunas mensais de **Realizado**, **Projetado** e **Variação**. As outras abas visíveis são **Índices**, **Organograma Orçamentário** e **Despesas por setor**. As abas técnicas e o histórico anterior ficam ocultos.

A lista e a ordem são definidas em `workbookSheets` e `createBudgetWorkbook`. [xlsx.js](../../scripts/export/xlsx.js)

| # | Aba | Conteúdo | Código |
|---|-----|----------|--------|
| 1 | **Orçamento** | A–E: Tipo, Grupo, Setor, Conta, Rubrica. Depois, 3 colunas por mês (Realizado, Projetado, Variação) e o total anual logo após dezembro. Última linha: RESULTADO. | `budgetData` ([xlsx.js](../../scripts/export/xlsx.js)) |
| 2 | **Índices** | Linhas 1–8: explicação e "Média padrão". Linha 9: cabeçalho. Da linha 10 em diante, um índice por linha (editável). | `indicesData` ([xlsx.js](../../scripts/export/xlsx.js)) |
| 3 | **Organograma Orçamentário** | Painel no topo (ano em B3, destaques, 2 roscas, ranking). Abaixo, detalhes recolhidos por ano. | `organogramData` ([xlsx.js](../../scripts/export/xlsx.js)), `fillOrganogramDashboard` ([workbook-visual.js](../../scripts/export/workbook-visual.js)) |
| 4 | `Cálculo` (oculta) | Uma linha por conta: parcelas do ajuste (B–G), blocos Dinâmico e Fixo e referências ao Realizado | `calculationData` ([xlsx.js](../../scripts/export/xlsx.js)) |
| 5 | `_Planejador` (oculta) | JSON do planejamento em pedaços de 30.000 caracteres (uma célula aceita até 32.767) | [xlsx.js](../../scripts/export/xlsx.js) |
| 6 | **Despesas por setor** | Percentuais diretos das contas de despesa por setor administrativo. | `expenseAllocationData` |
| 7 | **Histórico anterior** (oculta, quando há recorte) | Valores dos meses anteriores a **Começar em**, com as correções de Realizado dessas linhas. | `historicalSheet` ([xlsx.js](../../scripts/export/xlsx.js)) |

`Cálculo` e `_Planejador` usam `veryHidden`. **Histórico anterior** usa `hidden` e aparece no menu **Reexibir**. [xlsx.js](../../scripts/export/xlsx.js)

`annualPlacement: "legacy"` gera os totais anuais todos no fim, como nas exportações antigas. Isso só existe para os testes e para reconhecer arquivos antigos na leitura ([xlsx.js](../../scripts/export/xlsx.js)).

No painel do organograma, as colunas W em diante são auxiliares e ficam ocultas ([workbook-xml.js](../../scripts/export/workbook-xml.js)). A tabela Z:AF tem uma linha por setor e ano. As fórmulas `SUMIFS` do painel filtram essa tabela pelo ano em B3 ([workbook-visual.js](../../scripts/export/workbook-visual.js)).

Sources: [xlsx.js](../../scripts/export/xlsx.js), [workbook-visual.js](../../scripts/export/workbook-visual.js)

---

## Fórmulas

As fórmulas do Excel **espelham** o JavaScript. Mudou a regra num lado? Mude no outro também.

| No Excel | Espelha | Fórmula gerada por |
|----------|---------|--------------------|
| Projetado na faixa de cópia | `projectionKind = "copy"` | `IF(COUNT(real)=0,"",real)` em `projectedFormula` ([xlsx.js](../../scripts/export/xlsx.js)) |
| Projetado na faixa fixa | `frozenReference` | Referência ao bloco "Fixo" da aba Cálculo ([xlsx.js](../../scripts/export/xlsx.js)) |
| Projetado dinâmico | `adjusted` = `forecast` × índices | `'Cálculo'!<Dinâmico> * fator1 * fator2 …` ([xlsx.js](../../scripts/export/xlsx.js)) |
| Fator de um índice | `variableFactor` | `variableFormula` lê a linha do índice na aba Índices ([xlsx.js](../../scripts/export/xlsx.js)) |
| Projeção padrão (Cálculo) | `projectWithTrend` | Mediana inicial por mês, ajuste mensal e referência ao Projetado nos anos seguintes. [xlsx.js](../../scripts/export/xlsx.js) |
| Variação | `variance` | (Realizado − Projetado) ÷ valor absoluto do Projetado. A mesma regra vale nas linhas de receita, despesa e resultado, nos meses e nos totais anuais. Sem base ou com Projetado zero, retorna 0%. [xlsx.js](../../scripts/export/xlsx.js) |
| Subtotais e totais | soma das contas | `sumOrBlank`: fica vazio se nenhuma conta tem valor ([xlsx.js](../../scripts/export/xlsx.js)) |
| Vínculo do organograma | `organogramValues` | `SUM(Realizado das contas) * $G` (percentual) ([xlsx.js](../../scripts/export/xlsx.js)) |

Duas consequências:

- Mudar uma taxa na aba Índices do Excel recalcula o Projetado dinâmico no próprio Excel.
- Edição manual de Projetado vira **valor**, sem fórmula (`projectedFormula` devolve `null`). Ao reabrir, esse valor volta como `overrides`.

`sum` não divide listas longas. O Excel aceita até 255 argumentos por função, e a base real usa no máximo 84. O comentário `ponytail:` em [xlsx.js](../../scripts/export/xlsx.js) registra esse limite.

Sources: [xlsx.js](../../scripts/export/xlsx.js)

---

## Leitura e verificação

`readBudgetWorkbook(file)` abre o ZIP e escolhe o caminho pelo conteúdo ([xlsx.js](../../scripts/export/xlsx.js)):

Ao identificar um planejamento embutido, o leitor usa o JSON para reconstruir a base. Para arquivos das versões 3 a 8, ele também recupera as edições do Excel e confere as fórmulas.

**Planilha da empresa** ([xlsx.js](../../scripts/export/xlsx.js)):

- A aba precisa se chamar "Dados Analíticos", sem diferenciar acentos nem maiúsculas.
- Precisa das colunas "Novo Cosif" (ou "Conta COSIF/Interna") e "Descrição".
- Cabeçalhos de mês são reconhecidos por `parseMonth`: data do Excel, `2026-07`, `2026/7` ou `07/2026` ([workbook-xml.js](../../scripts/export/workbook-xml.js)).

**Excel gerado pelo POU** ([xlsx.js](../../scripts/export/xlsx.js)):

- O JSON de `_Planejador` guarda a base e o recorte. **Histórico anterior** serve para consulta no Excel. Edições feitas nessa aba ficam no arquivo de consulta e não são importadas para o POU.
- As abas visíveis só trazem de volta **números digitados**:
  - Realizado e Projetado dinâmico sem fórmula viram edições ([xlsx.js](../../scripts/export/xlsx.js)).
  - Os índices são relidos da aba Índices ([xlsx.js](../../scripts/export/xlsx.js)).
- `checkSheets` regenera cada aba a partir do JSON e compara ([xlsx.js](../../scripts/export/xlsx.js)):
  - O leitor compara cada fórmula com a versão gerada. A comparação normaliza o prefixo `_xlfn.`, os cifrões e as aspas nos nomes de aba. Um editor também pode simplificar a fórmula, por exemplo trocar um intervalo de uma célula como `BG4:BG4` por `BG4`. Nesse caso, o Excel abre normalmente no LibreOffice Calc, mas o POU pode recusar a reimportação da cópia salva pelo Calc com a mensagem **Fórmula alterada**. [xlsx.js](../../scripts/export/xlsx.js)
  - Nas abas Cálculo e Organograma, os valores fixos também são comparados. As exceções são o ano em B3 e o cabeçalho antigo "Caixinha".
- Diferença de precisão entre Excel e LibreOffice é tolerada (`sameWorkbookValue`). Diferença de centavos não é ([xlsx.js](../../scripts/export/xlsx.js)).

Mensagens que o usuário vê: "Fórmula alterada: aba!célula", "Projetado de cópia ou período fixo foi alterado" e "A estrutura de contas foi alterada". Elas protegem contra importar um cálculo inconsistente.

Sources: [xlsx.js](../../scripts/export/xlsx.js), [workbook-xml.js](../../scripts/export/workbook-xml.js)

---
