# POU — Planejador Orçamentário Universal

Guia de uso e entrada da documentação do planejador.

Esta documentação abrange exclusivamente o site do **Planejador Orçamentário Universal**: uso, cálculos, índices, organograma, arquivos de planejamento, exportação Excel e manutenção técnica. Todas as páginas desta pasta devem tratar diretamente desse site.

## Índice da documentação

- [Preparação, comandos e geração offline](setup.md)
- Fundamentos: [visão geral](wiki/01_visao-geral.md), [arquitetura](wiki/02_arquitetura.md) e [modelo de dados](wiki/03_modelo-de-dados.md).
- Funcionalidades: [cálculo](wiki/04_calculo.md), [organograma](wiki/05_organograma.md), [Excel](wiki/06_excel.md) e [interface](wiki/07_interface.md).
- [Manutenção e verificação](wiki/08_manutencao.md)
- [Histórico de mudanças](backlog.md).
- Guias de IA: [índices JSON](GUIA_LLM_INDICES_JSON.md) e [organograma JSON](GUIA_LLM_ORGANOGRAMA_JSON.md).

## O que é

O POU é um site que ajuda a planejar o dinheiro da empresa.

Você coloca uma planilha com o que a empresa **já recebeu e já gastou**.
O site calcula quanto ela **deve receber e gastar** nos próximos meses.
No fim, você baixa tudo em uma planilha do Excel.

Tudo acontece no seu computador. Nenhum dado é enviado para a internet.

## Palavras que você vai ver

- **Receita:** dinheiro que entra.
- **Despesa:** dinheiro que sai.
- **Resultado:** receita menos despesa. Positivo = sobrou dinheiro. Negativo = faltou.
- **Realizado:** o que já aconteceu de verdade.
- **Projetado:** o que o site acha que vai acontecer.
- **Variação** é a diferença percentual entre o Realizado e o Projetado. É positiva quando o Realizado supera o Projetado e negativa quando fica abaixo, em receitas, despesas e resultado. Se o Projetado for zero ou faltar base, aparece 0%.
- **Índice:** um aumento ou uma redução que você quer aplicar, como a inflação.
- **Setor da base:** um grupo de contas que já vem na planilha importada.
- **Setor administrativo:** uma parte da empresa, como "Presidência" ou "Gerência Contábil".
- **Organograma:** o desenho de quem está acima de quem na empresa.

## Como abrir

Dê dois cliques no arquivo `index.html`. Ele abre no navegador.

## Passo a passo

### 1. Coloque a planilha

Arraste o arquivo Excel para a área "Arraste o Excel para cá".

A planilha precisa ter:

- uma aba chamada **Dados Analíticos**;
- uma coluna **Novo Cosif** (ou **Conta COSIF/Interna**);
- uma coluna **Descrição**;
- uma coluna para cada mês;
- o ano passado completo e, no ano atual, pelo menos de janeiro a junho.

Contas que começam com **7** são receitas. Contas que começam com **8** são despesas.

Para continuar um trabalho salvo antes, use **Abrir planejamento salvo**.

### 2. Escolha as datas

- **Projetar até:** escolha na lista. Ela vai do último ano da planilha até 20 anos depois (base 2026: 2026 a 2046). Novas importações começam no último ano da lista.
- **Começar em** define o primeiro mês da base histórica e inclui o mês escolhido. A lista começa no primeiro mês do Realizado e vai até a escolha de **Ir até**, dentro dos meses da base. Por padrão, o cenário usa todo o histórico.
- **Ir até** copia o Realizado até o mês anterior ao escolhido.
- **Retomar em:** a partir do mês seguinte ao escolhido, o site volta a calcular com tudo o que você mudou.

De "Ir até" até "Retomar em", inclusive, o Projetado fica **travado**: ele usa o primeiro cálculo e não muda mais.

Com **Começar em** em 03/2026, **Ir até** em 05/2026 e **Retomar em** em 09/2026, o cenário copia o Realizado de março a abril, mantém o cálculo fixo de maio a setembro e passa ao cálculo dinâmico em outubro.

Os meses anteriores a **Começar em** ficam fora da classificação das contas, da conciliação, das tabelas, dos totais e do cálculo. Escolha uma data anterior para voltar a incluí-los. O JSON e o Excel guardam a escolha e preservam a base para reabrir o planejamento.

Virada de ano: "Ir até" = 01/2026 aplica cópia até 12/2025. "Retomar em" = 09/2030 reinicia o cálculo dinâmico em 10/2030. Os resumos mostram os limites efetivos; os campos e os títulos do Excel mostram as escolhas. Projetos antigos mantêm seus limites de cálculo e exibem as escolhas equivalentes.

Dica: cadastre os índices **antes** de criar um período travado.

### 3. Confira a aba Orçamento

Use **Exibir até o mês** para limitar a visualização de janeiro até o mês escolhido. O padrão é dezembro. Setembro, por exemplo, mostra janeiro a setembro no ano selecionado; ao trocar de ano, o mês limite permanece. Os totais de Realizado e Projetado, o gráfico e a tabela acompanham esse recorte. O Realizado também respeita os meses disponíveis na base.

Esse filtro é apenas visual: não altera o cálculo, os dados salvos nem a exportação Excel, que continua até dezembro do ano definido em **Projetar até**. A Média padrão continua sendo a referência anual do cenário.

A tabela mostra, para cada conta e cada mês:

- Realizado;
- Projetado;
- Variação.

Também mostra os totais de Receita, Despesa e Resultado.

Você pode **digitar** um valor novo no Realizado em qualquer mês.
Você pode digitar um Projetado só nos meses do cálculo normal.
Para voltar ao valor original, apague o que digitou.

Corrigir o Realizado de um mês da planilha importada pode mudar as previsões. Preencher o Realizado de um mês futuro não alimenta o cálculo normal das previsões seguintes: o valor aparece no Realizado e pode ser copiado pelo "Ir até". Para mudar uma previsão futura diretamente, edite o Projetado desse mês.

A **Média padrão** ignora os índices e as edições do Projetado, mas considera as correções feitas no Realizado dos meses da base. Por isso, ela pode mudar depois dessas correções.

Use **Buscar conta** para achar uma conta pelo código ou pelo nome.
Durante a busca, os subtotais de Receita e Despesa e o Resultado da tabela somam apenas as contas encontradas. Os cartões e o gráfico acima continuam mostrando o orçamento completo; essa diferença é esperada. Apague a busca para voltar aos totais de todas as contas.
Use **Desfazer** (Ctrl+Z) e **Refazer** (Ctrl+Y) se errar.

### 4. Adicione índices (opcional)

Na aba **Índices**, cadastre um aumento ou uma redução:

- nome (ex.: IPCA);
- taxa em %;
- se vale todo mês ou uma vez por ano;
- mês de início e de fim;
- onde vale: no orçamento todo, só em receitas ou despesas, em um setor ou em uma conta.

Dois índices de 10% juntos dão 21%, não 20%, porque um aumenta em cima do outro.
O índice nunca muda o Realizado.

Um índice mensal acumula a taxa a cada mês: 10% por três meses dá 33,1% de aumento. O anual aplica a taxa no início e novamente a cada 12 meses, enquanto estiver na vigência. Depois do mês final, o aumento acumulado permanece; ele não é retirado. Para um novo reajuste no ano seguinte, a vigência precisa alcançar esse mês.

Você pode salvar e abrir os índices em um arquivo separado (JSON).

### 5. Monte o organograma

Na aba **Organograma Orçamentário**, você diz qual parte da empresa fica com cada receita e despesa.

**Jeito rápido:** clique em **Usar organograma padrão AGE**.
O site cria os 25 setores da empresa e divide tudo igualmente: cada setor fica com 100 ÷ 25 = 4% de cada receita e despesa.

CONAD, CONFI, Gerência de Auditoria Interna, CPL, Comissão PAD e Ouvidoria são raízes independentes, no mesmo nível da Presidência. A Ouvidoria e a Comissão PAD não têm superior. A Gerência de Pequenos Negócios aparece uma vez, sob sua superintendência.

```text
CONAD (Conselho de Administração)
CONFI (Conselho Fiscal)
Gerência de Auditoria Interna
CPL
Comissão PAD
Ouvidoria

Presidência - PRESI
    ├── Superintendência Jurídica
    ├── Gerência de Comunicação
    ├── Gerência de Compliance e Controles Internos
    ├── Secretaria de Governança
    ├── Diretoria de Planejamento e Gestão - DIPLAG
    │   ├── Gerência Administrativa
    │   ├── Gerência de Planejamento de Dados, Mercado e Orçamento
    │   └── Superintendência de Tecnologia da Informação
    │       └── Gerência de Tecnologia da Informação
    ├── Diretoria de Operações e Negócios - DIROP
    │   ├── Superintendência de Pequenos Negócios
    │   │   └── Gerência de Pequenos Negócios
    │   └── Superintendência de Operações Especiais
    └── Diretoria Financeira - DIRFI
        ├── Superintendência Financeira
        │   └── Gerência Contábil
        └── Superintendência de Crédito e Cobrança
            └── Gerência de Crédito e Cobrança
```

**Jeito manual:** abra **Configurar setores e distribuição**.

1. Crie um setor (ex.: "Gerência de Pequenos Negócios").
2. Ligue a ele uma conta ou um setor da base, com uma porcentagem (ex.: 30% da conta de Energia).
3. Crie o setor de cima com **Criar superior deste setor**.
4. Repita até montar a empresa.

Se o setor já tem um único superior, o novo setor é colocado entre os dois. Se ele tem vários superiores, o novo é acrescentado e as ligações anteriores são preservadas.

No campo de superiores, selecione um ou mais setores quando a estrutura personalizada tiver relações múltiplas; a consolidação conta cada setor uma única vez.

Regras importantes:

- A soma dos vínculos de cada conta precisa arredondar para **100% com até duas casas decimais**, como na tela. Por exemplo, 99,996% e 100,004% são aceitos; 99,99% e 100,01% continuam bloqueados. Os percentuais informados são preservados nos cálculos.
- O site mostra a lista das contas que ainda não fecharam 100%. Quando passam de 100%, o botão **Detalhes** mostra os setores envolvidos.
- Use **Buscar receita ou despesa vinculada** para localizar uma origem e editar ou remover seus vínculos.
- Um setor de cima **soma** os valores dos setores de baixo. Isso não gasta porcentagem de novo.
- O organograma usa só o **Realizado**. Nunca o Projetado.
- Cada organograma aceita até **500 setores administrativos e 10.000 vínculos**.

**Ao importar um organograma JSON, a estrutura atual é substituída assim que o arquivo é validado, sem outra confirmação.** Salve o organograma atual antes de importar outro. O botão do padrão AGE pede confirmação quando já existem setores. Enquanto a mesma base permanecer aberta, você também pode usar **Desfazer** para voltar à estrutura anterior.

Para ver os números, use os filtros **Ano**, **Período** e **Visualizar** (Despesas ou Receitas).
Passe o mouse ou toque em um setor para ver os valores dele. Ao clicar no cartão de um setor, o campo **Vincular ao setor administrativo** e a lista de vínculos passam a mostrar esse setor; a seleção também funciona com Tab, Enter ou Espaço.

### 6. Salve ou baixe

- **Salvar planejamento:** guarda tudo em um arquivo JSON. Funciona mesmo se o organograma estiver incompleto.
- **Exportar Excel:** baixa a planilha final. Só funciona quando **todas** as contas estão 100% distribuídas.
- **Salvar organograma JSON:** guarda só o organograma, para usar em outro planejamento.
- **Tirar foto PNG:** baixa a árvore completa do organograma, com conectores, valores e barras do ano/período exibido.
- **Vínculos deste setor:** a lista de vínculos na atribuição permanece recolhida por padrão e pode ser aberta pelo resumo para consultar ou editar os itens.

## O Excel que o site gera

O arquivo abre no Microsoft Excel (foco principal) e no LibreOffice.
As contas continuam como fórmulas: se você mudar um número, o resto recalcula.

São 4 abas visíveis:

1. **Orçamento:** Realizado, Projetado e Variação de cada conta e mês, com os totais de receita, despesa e resultado.
2. **Índices:** os índices usados no cálculo. Você pode mudar as taxas aqui (linha 10 em diante).
3. **Organograma Orçamentário:** um painel que mostra:
   - o ano (mude na célula **B3** para ver outro ano);
   - quem mais gasta, quem menos gasta, quem mais recebe e quem menos recebe;
   - um gráfico de despesas e um de receitas por setor;
   - a lista dos setores, com posição no ranking e duas barras por setor: Receita e Despesa. Em cada barra, a parte clara é direta (do próprio setor) e a parte escura é indireta (dos setores subordinados): verde claro/escuro para receita e laranja claro/escuro para despesa.

4. **Despesas por setor:** conta, descrição da despesa, setor da base, setor administrativo e percentual direto. Vínculos de conta e de setor da base para o mesmo destino são somados. A hierarquia não redistribui esse percentual. Esta aba é para consulta; altere os vínculos no site e exporte novamente.

Os detalhes mês a mês ficam escondidos embaixo do painel do organograma. Clique no botão **+** à esquerda para abrir.

As abas técnicas `Cálculo` e `_Planejador` ficam ocultas e dão suporte às fórmulas e à reabertura. Quando há um recorte, a aba oculta **Histórico anterior** guarda os meses anteriores para consulta. Você pode reexibi-la no Excel. Os valores dessa aba ficam fora das fórmulas e dos totais.

Você pode abrir no site um Excel que o próprio site gerou. Valores digitados no Excel voltam para o site.
Se alguém alterar uma fórmula, o site recusa o arquivo para não trazer erro.

## Como o site calcula o Projetado

Para a primeira projeção de um mês, o POU usa a mediana do Realizado daquele mês em todos os anos do recorte, de **Começar em** até o mês anterior a **Ir até**. Se os janeiros anteriores registraram R$ 100, R$ 120 e R$ 140, a referência de janeiro é R$ 120. Valores em branco ficam fora da mediana e zeros registrados contam.

A fórmula soma o ajuste mensal da conta, calculado com o Realizado. O ajuste do setor usa a mediana das contas com movimento nos meses comparados. Uma conta com movimento e variação zero participa normalmente. Para os anos seguintes, o mesmo mês parte do valor-base já projetado e recebe outro ajuste. Os índices do cenário são aplicados sobre os valores calculados.

Quando falta Realizado daquele mês em todos os anos do recorte, a primeira previsão usa a média dos até 12 meses anteriores a **Ir até**. [Cálculo do orçamento](wiki/04_calculo.md)

## Problemas comuns

- **"Faltam os meses obrigatórios":** a planilha precisa do ano passado inteiro e de janeiro a junho deste ano.
- **"Aba obrigatória Dados Analíticos não foi encontrada":** renomeie a aba da planilha.
- **Botão Exportar Excel não funciona:** ainda há conta fora de 100%. Veja a lista no Organograma ou use o organograma padrão.
- **"Fórmula alterada":** o Excel foi mexido em uma fórmula. Use o arquivo original ou o JSON salvo.
- **Arquivo muito grande:** o limite é 25 MB.

## Desenvolvimento

Para usar o site, basta abrir seu `index.html`; a única biblioteca externa é o JSZip local. Não é necessário NPM nem instalar pacotes.

Para manter os fontes e executar testes, use Node.js 20.11 ou posterior. Na pasta `planejador_orcamentario`:

```powershell
node scripts/server.mjs   # servidor opcional em http://127.0.0.1:4173
node scripts/build.mjs    # junta os fontes em scripts/app.bundle.js após mudar JavaScript
node scripts/build-docs.mjs # gera só docs/index.html; ferramentas externas de manutenção
node --test               # testes com módulos nativos do Node.js
```

A documentação técnica (arquitetura, cálculo, Excel, manutenção) fica em [index.html](index.html). Abra o arquivo no navegador ou use o link “Documentação técnica” no rodapé do site. O texto de cada página está em [wiki/01_visao-geral.md](wiki/01_visao-geral.md) e nos arquivos vizinhos.

| Arquivo | Para que serve |
| --- | --- |
| `index.html`, `styles/styles.css` | A tela do site. |
| `scripts/models/budget.js` | Lê as contas e faz o cálculo do Projetado. |
| `scripts/models/organogram.js` | Organograma: padrão AGE, 100% e somas. |
| `scripts/controllers/organogram-controller.js`, `scripts/views/organogram-visual.js` | Tela e gráficos do organograma. |
| `scripts/views/organogram-search-view.js` | Busca de receitas e despesas e janela de vínculos. |
| `scripts/export/planning.js` | Salvar e abrir o JSON. |
| `scripts/export/xlsx.js`, `scripts/export/workbook-xml.js`, `scripts/export/workbook-visual.js` | Ler e gerar o Excel. |
| `scripts/views/dom.js`, `scripts/models/editor-state.js` | Utilitários da tela; estado e Desfazer/Refazer. |
| `scripts/controllers/files-controller.js` | Importar Excel, abrir/salvar JSON e exportar Excel. |
| `scripts/build.mjs`, `scripts/build-docs.mjs` | Geram `app.bundle.js` e `docs/index.html`. |
| `scripts/controllers/budget-controller.js` | Projetar até, Começar em, Ir até e Retomar em. |
| `scripts/views/summary-view.js`, `scripts/controllers/budget-controller.js` | Painel de totais e tabela do Orçamento. |
| `scripts/controllers/budget-controller.js` | Aba Índices. |
| `scripts/views/page-view.js` | Central de ajuda e abas. |
| `scripts/controllers/app-controller.js` | Liga os módulos e recalcula a tela a cada alteração. |
| `scripts/vendor/jszip.min.js` | Biblioteca que monta o arquivo Excel. |

O histórico de mudanças está em [backlog.md](backlog.md).
