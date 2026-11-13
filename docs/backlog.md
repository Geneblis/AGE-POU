# Backlog

Registro de mudanças, da mais nova para a mais antiga.

## 13/11/2026 — CPL e Ouvidoria sob a Presidência

- Corrigido o padrão AGE: CPL e Ouvidoria são filhos diretos da Presidência. CONAD, CONFI, Auditoria e Comissão PAD continuam independentes, no mesmo nível da Presidência.
- Documentação, árvores, guias de LLM e Central de ajuda alinhados à correção, preservando os 25 setores, seus IDs e a distribuição de 4% por setor.

## 11/11/2026 — Organograma unificado

- Padrão AGE com 25 setores: CONAD, CONFI, Auditoria, CPL, PAD, Ouvidoria e Presidência sem superior; Assembleia Geral excluída e uma única Gerência de Pequenos Negócios.
- Distribuição igualitária de 4% por setor; guia, ajuda e modelo alinhados. O ID existente `confin` continua identificando o CONFI.
- Edição e importação recusam setores com nomes repetidos, ignorando acentos, espaços e maiúsculas.
- Testes conferem a hierarquia do guia, a consolidação das raízes e a reabertura do Excel.
- Importação rejeita índices com alcance desconhecido e bases sem um total único de Receita e Despesa.
- Teste com base real aceita POU_BUDGET_FIXTURE; a cópia independente informa quando essa base opcional está ausente.

## 11/11/2026 — Revisão da documentação

- Estrutura de pastas e responsabilidades MVC conferidas; comandos diretos e requisitos de uso separados das ferramentas externas de manutenção.
- Hierarquia AGE do guia JSON corrigida a partir de `ageSectors`; arredondamento alinhado à tela.
- Atualizados referências, testes documentados, filtro mensal e compatibilidade da reabertura do Excel.
- Fluxo do cálculo redesenhado em três fases com oito etapas e SVG local.

## 11/11/2026 — Vínculos com duas casas decimais

- Percentuais exibidos com duas casas decimais na lista, busca e campos de edição dos vínculos.
- Novos valores e edições confirmadas são arredondados para duas casas; valores antigos mantêm a precisão original até serem editados.
- Exportação aceita somas que arredondam para 100,00% com a mesma precisão da tela. Substitui a tolerância anterior de três casas.

## 11/11/2026 — Arredondamento da distribuição

- Exportação Excel e lista de pendências passam a aceitar somas que arredondam para 100% na precisão da tela (até três casas decimais).
- Eliminado o bloqueio de contas exibidas como “100% distribuído; falta 0%”, sem alterar percentuais, vínculos ou cálculos.
- Testes cobrem os limites do arredondamento, bloqueios fora da tolerância e exportação/reabertura offline.

## 06/11/2026

- A versão 8 usa Realizado menos Projetado na variação percentual de receitas, despesas e resultado, tanto no site quanto no Excel. Com Projetado zero, a variação continua em 0%.

- A versão 7 usa apenas contas com movimento nos meses comparados na mediana do setor. A mesma seleção vale nas fórmulas do Excel.

- A versão 6 aplica **Começar em** antes da classificação e da conciliação das contas. A base original fica guardada, e os meses anteriores ficam fora do cenário.

- A versão 5 restaura o ajuste mensal e a sequência do Projetado. Na primeira previsão de cada mês, usa a mediana do Realizado daquele mês em todos os anos do recorte.
- Ao reabrir o Excel de uma versão anterior, o planejador confere a fórmula exportada e recalcula com a versão atual.


- A previsão passou a usar a média do Realizado do mesmo mês em todos os anos do recorte. Quando falta o mês, usa a média geral da conta antes do início da projeção.
- O planejamento versão 4 grava e exporta a nova regra. A importação de planilhas versão 3 confere as fórmulas antigas antes de recalcular.


- O campo **Começar em** define o início da base histórica. O cenário considera os meses a partir da escolha, inclusive.
- A exportação coloca os meses anteriores na aba oculta **Histórico anterior**, fora das fórmulas. O JSON e o Excel guardam a base completa e a data do recorte.

## 29/10/2026

- Projeção com histórico parcial: quando falta o mesmo mês do ano anterior, receitas e despesas usam a média dos até 12 meses disponíveis anteriores ao início da projeção, incluindo zeros e sem somar o ajuste anual.
- Exportação Excel reproduz a regra em fórmulas. A leitura de arquivos antigos confere o cálculo anterior antes de restaurar o planejamento com a regra atual.
- Documentação explica a janela histórica, o exemplo de setembro a setembro, os zeros que permanecem válidos e os efeitos da reabertura de arquivos anteriores.

## 28/10/2026

- Documentação alinhada ao comportamento atual: corrigidos o exemplo do índice anual, o efeito de edições do Realizado e a descrição da Média padrão. Explicados os totais durante a busca, a criação de superiores, a substituição na importação e os limites do organograma. Os guias de IA passam a esclarecer esses limites e o acúmulo dos índices.
- Documentação offline gerada pela skill global `offline-docs` em `docs/index.html`, com busca, temas e diagramas SVG incorporados. O rodapé abre a nova documentação.
- Índice por assunto no README, orientações em `setup.md` e propósito explícito nas páginas técnicas.
- Atualmente, `node scripts/build-docs.mjs` gera só a documentação e `node scripts/build.mjs` gera só o bundle. Python, Pandoc e Mermaid CLI são requisitos da geração.
- Fluxo de documentação unificado em `offline-docs`: removidos gerador, validador, índice e bibliotecas do fluxo anterior.

## 24/10/2026

- Nova **documentação técnica** em `docs/wiki/` (8 páginas, do geral ao detalhe, com diagramas). A navegação atual fica em `docs/index.html`, acessível pelo rodapé do site. Hoje, `node scripts/build-docs.mjs` gera esse arquivo.
- Pasta `documentacao/` renomeada para `docs/`.
- Código refeito para leitura mais direta, sem mudar o comportamento (conferido com a base real: modelo, Excel gerado e reabertura idênticos): `core.js` (leitura da base, conciliação e projeção em funções pequenas), `xlsx.js` (gerar e ler o Excel por etapas), `workbook-xml.js` e `organogram-visual.js`. Comentários explicam regras, formatos e fórmulas.
- O botão **Exportar Excel** agora usa o mesmo `download` dos outros arquivos (`downloadBudgetWorkbook` foi removida).

## 23/10/2026 (revisão)

- **Projetar até** volta a ser lista: do último ano da planilha até +20 anos. Novas importações começam no último ano (ex.: 2046).
- Painel do Orçamento em duas faixas alinhadas, no visual do site: Projetado do ano exibido (Receita, Despesa, Resultado e gráfico) e Realizado do mesmo ano até o último mês importado. Ano sem realizado esconde a faixa do Realizado.
- Busca do organograma procura em todas as contas por grupo, código, descrição ou setor da base, por palavras (“aluguéis de veículos”). Mostra vínculos diretos e do setor da base, com % distribuído.
- Correção: reduzir Projetar até deixava a vigência do índice fora do limite e bloqueava o cadastro.
- Código reorganizado: `app.js` dividido em módulos por tela; CSS limpo e organizado por seções em `styles.css`. Visual conferido sem mudanças nas outras partes.
- Excel com horizonte de 20 anos fica maior (base real: cerca de 7 MB).

## 23/10/2026

- Excel mostra cada total anual de Realizado, Projetado e Variação logo depois de dezembro do mesmo ano.
- **Projetar até** aceita 4 dígitos e usa 2030 como padrão para novas importações.
- **Ir até** oferece todos os meses da entrada, desde o primeiro.
- Painel mostra Receita e Despesa realizadas no ano do último mês importado, com nota da data de referência.
- Organograma permite buscar uma receita ou despesa, consultar setores vinculados e editar ou remover cada percentual em uma janela.
- Atribuição mostra primeiro a origem financeira, seu valor realizado e depois o setor administrativo.
- Distribuições acima de 100% oferecem detalhes dos setores envolvidos. Percentuais quebrados usam até 3 casas decimais.

## 21/10/2026

- Botão **Usar organograma padrão AGE**: 22 setores, cada um com 100 ÷ 22 de todas as receitas e despesas. Auditoria Interna e Presidência ficam no mesmo nível; Ouvidoria e DIPLAG são filhos diretos apenas da Presidência. Assembleia, CONFI, CONAD e CRO ficam fora.
- Organograma no site mostra Despesas ou Receitas (filtro **Visualizar**). Árvore abre centralizada e exibe barras separadas de Receita e Despesa, com direto claro e indireto escuro.
- Excel, aba Organograma: painel com ano em B3, maior e menor despesa e receita, gráficos de despesas e de receitas, ranking e barras coloridas.
- Excel, aba Índices: textos em português (Mensal/Anual, Todos/Grupo/Setor/Conta). Arquivos antigos com textos em inglês continuam abrindo.
- Correção: nomes calculados por fórmula apareciam como 0 no LibreOffice.
- Foco do Excel: Microsoft Excel atual; LibreOffice com a mesma leitura. Conferido no LibreOffice: 96.924 fórmulas recalculadas, sem erro. Não testado no Microsoft Excel (não instalado na máquina).
- Pasta do planejador antigo (`original_planejador_orcamentario`) apagada.
- Documentação reunida em `documentacao/` (hoje `docs/`): um guia simples (`README.md`) e este backlog.

## 20/10/2026

- Comparador de planejamentos removido. No lugar entrou o **Organograma Orçamentário**: setores administrativos, vínculos por porcentagem, soma dos setores de baixo e regra dos 100% para exportar o Excel.
- Novos campos **Ir até** e **Retomar em**, com período travado entre eles.
- Coluna **Variação** na aba Orçamento (positivo = bom).
- Aba **Premissas** renomeada para **Índices**.
- Excel com 3 abas visíveis (Orçamento, Índices, Organograma Orçamentário). `Cálculo` e `_Planejador` escondidas; `Origem` removida.
- JSON de planejamento passa a guardar só as entradas (versão 3); os valores são recalculados ao abrir.
- Organograma visual no site (gráfico, ranking e árvore) e visual novo no Excel.

## 16/10/2026

- Exportar e importar índices em JSON.

## 15/10/2026

- Primeira versão do site (POU): importação do Excel, cálculo do Projetado, índices, edição de valores, desfazer/refazer e exportação para Excel com fórmulas.
- Comparação entre dois planejamentos (removida depois, em 20/10/2026).

## Reorganização MVC e legibilidade

- Código organizado em models, views, controllers e export, com quatro controllers por assunto.
- `core.js` substituído por `models/budget.js`; testes reunidos em `tests/`.
- Apresentação separada das ações, histórico sem dependência da página e condições escritas de forma explícita.
- Mantidos cálculos, mensagens, formatos JSON/Excel, validações, histórico e abertura offline.
- Teste do organograma padrão atualizado para 48 barras (24 receitas e 24 despesas), contagem também confirmada na versão anterior.
