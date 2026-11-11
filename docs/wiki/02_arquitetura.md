# Arquitetura MVC

Organiza o POU em models, views e controllers, com conversão de arquivos em export.

<details>
<summary><img class="doc-icon" src="../../images/icons/book-open.svg" alt="" aria-hidden="true"> Arquivos de referência</summary>

- [Orçamento](../../scripts/models/budget.js)
- [Estado e histórico](../../scripts/models/editor-state.js)
- [Coordenação da aplicação](../../scripts/controllers/app-controller.js)
- [Geração do bundle](../../scripts/build.mjs)

</details>

## Onde procurar

| Pasta | Responsabilidade | Arquivos principais |
|-------|------------------|---------------------|
| `scripts/models/` | Dados, validações, cálculos e histórico; sem acesso à página | `budget.js`, `organogram.js`, `editor-state.js` |
| `scripts/views/` | Apresentação, campos, tabelas, gráficos e diálogos | `budget-view.js`, `horizon-view.js`, `indices-view.js`, `summary-view.js`, `organogram-view.js`, `files-view.js` |
| `scripts/controllers/` | Eventos do usuário, aplicação das alterações e coordenação das telas | `app-controller.js`, `budget-controller.js`, `organogram-controller.js`, `files-controller.js` |
| `scripts/export/` | Conversão, validação, leitura e gravação de JSON e Excel | `planning.js`, `xlsx.js`, `workbook-xml.js`, `workbook-visual.js` |
| `scripts/vendor/` | Somente JSZip local e sua licença | `jszip.min.js` |
| `tests/` | Testes automatizados e dados de exemplo | `planning.test.js`, `workbook.test.js`, `ui.browser.test.js`, `fixtures.js` |

O orçamento reúne tabela, períodos e índices em um controller. O organograma reúne setores, vínculos e importação de sua estrutura em outro. Não existe um controller por campo.

## Fluxo de uma alteração

1. A view disponibiliza o campo e o controller registra a ação do usuário.
2. O controller guarda as entradas anteriores e aplica a alteração.
3. O model valida os dados e calcula o orçamento ou organograma.
4. O controller solicita a atualização das views e registra o histórico na mesma ordem usada pelo fluxo correspondente.
5. Uma falha conserva a mensagem e o tratamento próprios daquela ação, incluindo a restauração do estado quando prevista.

As views podem ler o estado para apresentar informações. Controles criados durante a renderização encaminham alterações à função `commit` recebida do controller; a view não decide como validar ou confirmar o organograma.

## Estado e histórico

[editor-state.js](../../scripts/models/editor-state.js) guarda as entradas do usuário e o modelo calculado. O histórico copia somente entradas editáveis: horizonte, índices, edições, períodos e organograma. A base importada não faz parte do histórico.

`recordHistory` registra uma alteração confirmada, limita o histórico a 100 entradas e limpa o refazer. `stepHistory` devolve o estado a restaurar. `observeHistory` notifica o controller, que solicita à view a atualização dos botões; o model não consulta elementos da página.

O [app-controller.js](../../scripts/controllers/app-controller.js) mantém `rebuild`, que recalcula o orçamento inteiro e atualiza as telas. A troca do ano ou mês exibido atualiza a apresentação sem registrar uma edição no histórico. Durante a digitação, a prévia usa um modelo temporário e preserva o foco e o cursor.

## Funcionamento offline e geração do bundle

A aplicação usa apenas HTML, CSS, JavaScript puro e JSZip local. Não exige instalação de pacotes. Node.js executa ferramentas de manutenção; o navegador abre o site pronto sem Node.js ou NPM.

Os fontes usam módulos ES, importados diretamente pelos testes. O [build.mjs](../../scripts/build.mjs) reúne esses arquivos em `scripts/app.bundle.js`, usado pelo `index.html` para permitir abertura por `file://`.

- A lista `names` contém caminhos relativos a `scripts/`, com models e export antes das views e controllers; `controllers/app-controller.js` fica por último.
- Todos os arquivos compartilham o escopo do bundle. Nomes declarados no topo precisam ser únicos; o build detecta colisões.
- Cada import deve ocupar uma linha e terminar com ponto e vírgula, pois o build remove essas linhas.
- O bundle é gerado: altere os fontes e execute `node scripts/build.mjs`.
- JSON, versão dos planejamentos, fórmulas e estrutura do Excel continuam com os mesmos contratos.

## Exemplos de manutenção

- Cálculos e projeções: [budget.js](../../scripts/models/budget.js). Fórmulas equivalentes no Excel ficam em [xlsx.js](../../scripts/export/xlsx.js).
- Edição de valores, períodos e índices: [budget-controller.js](../../scripts/controllers/budget-controller.js); apresentação nas views correspondentes.
- Setores e regras de distribuição: [organogram.js](../../scripts/models/organogram.js); ações em [organogram-controller.js](../../scripts/controllers/organogram-controller.js).
- Abrir ou salvar arquivos: [files-controller.js](../../scripts/controllers/files-controller.js), com conversão em `export/`.

Veja também [Manutenção e testes](08_manutencao.md) e [Interface](07_interface.md).
