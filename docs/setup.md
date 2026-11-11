# Preparação e geração da documentação

Distingue a abertura do site das ferramentas usadas para manter os fontes e gerar a documentação.

## Usar o site

Abra o `index.html` da raiz de `planejador_orcamentario/` com dois cliques. Para ler a documentação, abra `docs/index.html`. Os dois funcionam offline. O site usa HTML, CSS e JavaScript puro, com JSZip local como única biblioteca externa. Não exige NPM, Node.js, Python ou instalação de pacotes para usar.

## Executar e verificar o planejador

Somente para manutenção, use Node.js 20.11 ou posterior. Não é necessário NPM nem instalar pacotes. Dentro de `planejador_orcamentario/`:

```powershell
node scripts/server.mjs
node scripts/build.mjs
node --test
```

O teste opcional com base real usa o arquivo de `documents/database/orcamento/` quando ele existir no repositório maior. Para conferir a cópia independente com a mesma base, defina `POU_BUDGET_FIXTURE` com o caminho absoluto do arquivo antes de executar `node --test`. A ausência da base é informada como teste ignorado; não equivale a validação dos dados reais.

O servidor local abre em `http://127.0.0.1:4173`. O planejador também funciona ao abrir seu `index.html` diretamente.

## Gerar a documentação offline

A skill global `offline-docs` usa Python 3.9 ou posterior, Pandoc e Mermaid CLI para compilar os diagramas em SVG. Confira as ferramentas:

```powershell
python --version
pandoc --version
mmdc --version
```

Com essas ferramentas já disponíveis no ambiente de manutenção, rode `node scripts/build-docs.mjs` dentro de `planejador_orcamentario/`. Elas não são bibliotecas da aplicação e não são necessárias para ler o HTML pronto. `node scripts/build.mjs` gera apenas o bundle da aplicação. O comando direto para gerar a documentação é:

```powershell
python "$env:USERPROFILE/.codex/skills/offline-docs/scripts/build.py" --docs docs --title "POU — Documentação"
```

Se o Codex usar uma pasta personalizada, substitua o caminho pelo diretório da skill em `CODEX_HOME/skills/offline-docs`.

O gerador descobre os arquivos Markdown recursivamente e produz apenas `docs/index.html`, com busca, navegação, temas e recursos incorporados. Abra esse arquivo com dois cliques. Entradas inalteradas fazem o gerador informar `No changes:`; uma geração concluída informa `Built:`. A abertura do HTML não precisa de internet ou servidor.

## Organização e manutenção

O escopo desta pasta é exclusivamente o site do Planejador Orçamentário. Inclua apenas páginas sobre seu funcionamento, uso, formatos de arquivo, preparação, testes e manutenção. Documentos de outros projetos devem permanecer fora desta pasta e do site técnico gerado.

- [README.md](README.md): entrada, guia de uso e índice por assunto.
- `wiki/`: páginas técnicas existentes, com nomes estáveis e referências à implementação.
- [Guia de índices](GUIA_LLM_INDICES_JSON.md) e [guia de organograma](GUIA_LLM_ORGANOGRAMA_JSON.md): formatos de intercâmbio com IA.
- [Backlog](backlog.md): histórico de mudanças.

Mantenha os textos em português e UTF-8. Cada página tem um único título principal e uma descrição de propósito. Use links relativos, confira seus destinos e preserve os nomes existentes ao atualizar um assunto. As imagens da documentação ficam em `docs/images/` para serem incorporadas e detectadas pelo gerador.

Atualize a página afetada junto com mudanças de comportamento, interfaces, configuração ou estrutura. Preserve a distinção entre comportamento implementado e proposta. Depois de editar Markdown ou recursos, gere novamente o HTML; mudanças de código sozinhas não atualizam a documentação. Edite os textos de origem e trate o HTML como saída gerada.

A navegação do Offline Docs vem dos títulos Markdown, e os agrupamentos por assunto vêm dos links no README. As fontes são arquivos Markdown comuns, descobertos recursivamente pelo gerador.

## Limitações e verificação

O gerador verifica a conversão, mas não confirma a exatidão dos textos contra a implementação. Execute `node --test` para conferir os links relativos e as regras locais.

A saída da documentação é `docs/index.html`, gerada por `node scripts/build-docs.mjs`. No Windows, o comando do projeto também procura Pandoc e Mermaid CLI nas pastas do usuário; não é necessário instalar como administrador. Só considere o HTML atualizado quando o gerador terminar com sucesso.
