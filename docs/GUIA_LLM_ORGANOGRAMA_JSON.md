# Guia LLM — Organograma JSON

Use este guia para gerar um arquivo importável em **Organograma Orçamentário > Importar organograma JSON**.

## Regra obrigatória: confiança de 100%

A LLM só pode gerar o organograma final depois que todos os dados abaixo estiverem claros e o usuário confirmar o resumo. “100% de confiança” significa: nenhuma origem, percentual, relação hierárquica, exceção ou código depende de suposição.

Fluxo obrigatório:

1. Leia todos os arquivos e dados fornecidos antes de perguntar.
2. Identifique de uma vez todas as informações ausentes, contraditórias ou ambíguas.
3. Envie **um único bloco de perguntas**, numerado e objetivo. Não faça perguntas espalhadas em várias mensagens.
4. Após as respostas, apresente um resumo completo: hierarquia, origens, destinos, percentuais, sobreposições e exceções.
5. Peça confirmação explícita do resumo. Gere o JSON somente depois da confirmação.

Se as respostas criarem uma contradição nova, apresente todas as inconsistências juntas em um único bloco de correção. Nunca complete lacunas por intuição e nunca entregue um organograma “provável”.

### Perguntas obrigatórias em um único bloco

Pergunte somente o que os arquivos ainda não responderam, cobrindo todos estes pontos:

1. A hierarquia será a padrão AGE deste guia ou uma estrutura personalizada?
2. Quais são os nomes exatos dos setores administrativos, suas IDs e seus superiores?
3. Haverá uma única raiz? Se houver mais de uma, isso é intencional?
4. Quais códigos exatos da planilha serão distribuídos: contas (`account`) ou setores da base (`sector`)?
5. Para quais setores administrativos cada origem será vinculada e com qual percentual?
6. Existe divisão entre vários setores, exceção por conta, ajuste contábil ou sobreposição intencional?
7. Todas as contas e ajustes devem fechar em 100%? Se alguma ficar fora, qual é a decisão explícita do usuário?
8. O usuário confirma que a hierarquia e a distribuição resumidas representam a organização real?

Mesmo quando os dados parecerem completos, apresente o resumo e aguarde a confirmação. Sem confirmação explícita, responda com as pendências; não produza o JSON final.

## Formato canônico

```json
{
  "format": "orca-organograma",
  "version": 1,
  "boxes": [],
  "links": []
}
```

Não inclua campos extras. Arquivo não leva valores monetários: POU calcula valores a partir da planilha aberta.

O arquivo aceita no máximo **500 setores administrativos** em `boxes` e **10.000 vínculos** em `links`. Confira esses limites antes de gerar o JSON; um arquivo acima deles é recusado mesmo que sua estrutura esteja correta.

Ao importar um arquivo validado, o POU substitui o organograma atual sem uma confirmação adicional. Oriente o usuário a salvar a estrutura atual antes de importar outra.

## Setores administrativos (`boxes`)

Cada item cria um setor administrativo.

```json
{
  "id": "diretoria-financeira",
  "name": "Diretoria Financeira",
  "parent": null
}
```

- `id`: texto não vazio e único. Use identificadores estáveis em minúsculas, com hífen.
- `name`: nome visível do setor, de 1 a 120 caracteres.
- `parent`: superior principal, ou `null` para setor raiz. É mantido para compatibilidade com arquivos antigos.
- `parents`: opcional; array com **todos** os superiores diretos. Se houver mais de um, o primeiro deve ser igual a `parent`. Para um único superior, omita `parents`.
- Todos os IDs de `parent` e `parents` precisam existir. Nunca crie ciclos, mesmo atravessando qualquer uma das relações múltiplas.
- Um setor alcançado por dois caminhos é consolidado uma única vez; a relação extra não duplica receita ou despesa.

## Hierarquia padrão AGE

Use esta hierarquia somente quando o usuário escolher explicitamente o padrão AGE. A tabela é a fonte canônica, de cima para baixo:

| `id` | Setor administrativo | `parent` principal | `parents` quando múltiplo |
| --- | --- | --- | --- |
| `conad` | CONAD (Conselho de Administração) | `null` | — |
| `confin` | CONFIN (Conselho Fiscal) | `null` | — |
| `auditoria` | Gerência de Auditoria Interna | `null` | — |
| `cpl` | CPL | `null` | — |
| `presidencia` | Presidência - PRESI | `null` | — |
| `juridica` | Superintendência Jurídica | `presidencia` | — |
| `comunicacao` | Gerência de Comunicação | `presidencia` | — |
| `compliance` | Gerência de Compliance e Controles Internos | `presidencia` | — |
| `governanca` | Secretaria de Governança | `presidencia` | — |
| `ouvidoria` | Ouvidoria | `presidencia` | — |
| `dpg` | Diretoria de Planejamento e Gestão - DIPLAG | `presidencia` | — |
| `administrativa` | Gerência Administrativa | `dpg` | — |
| `dados` | Gerência de Planejamento de Dados, Mercado e Orçamento | `dpg` | — |
| `ti` | Superintendência de Tecnologia da Informação | `dpg` | — |
| `ger-ti` | Gerência de Tecnologia da Informação | `ti` | — |
| `don` | Diretoria de Operações e Negócios - DIROP | `presidencia` | — |
| `sup-pn` | Superintendência de Pequenos Negócios | `don` | — |
| `ger-pn` | Gerência de Pequenos Negócios | `sup-pn` | — |
| `sup-oe` | Superintendência de Operações Especiais | `don` | — |
| `dfin` | Diretoria Financeira - DIRFI | `presidencia` | — |
| `sup-fin` | Superintendência Financeira | `dfin` | — |
| `contabil` | Gerência Contábil | `sup-fin` | — |
| `sup-cc` | Superintendência de Crédito e Cobrança | `dfin` | — |
| `ger-cc` | Gerência de Crédito e Cobrança | `sup-cc` | — |

CONAD, CONFIN, Gerência de Auditoria Interna e CPL são raízes independentes, no mesmo nível da Presidência. Use `parent: null` e omita `parents` nas raízes. Apontar um setor para o próprio ID cria um ciclo inválido. A Gerência de Pequenos Negócios aparece uma única vez, sob a Superintendência de Pequenos Negócios.

### Organograma aplicado pelo botão padrão

Quando o usuário escolhe **Usar organograma padrão AGE**, o POU:

- cria exatamente os 24 `boxes` da tabela acima;
- mantém `conad`, `confin`, `auditoria`, `cpl` e `presidencia` como raízes no mesmo nível;
- faz `ouvidoria` filha direta apenas de `presidencia` e `dpg` filho direto de `presidencia`;
- cria um vínculo `type: "sector"` para cada setor financeiro existente na planilha, em cada um dos 24 setores administrativos;
- usa `percent: 100 / 24` em cada vínculo, sem arredondar a regra no cálculo.

O setor financeiro da planilha (`origin`, por exemplo `818`) não é setor administrativo. Não use o código financeiro como `box`, `id` ou `parent`. O organograma administrativo apenas recebe e consolida esses valores.

Árvore canônica:

```text
CONAD (Conselho de Administração)
CONFIN (Conselho Fiscal)
Gerência de Auditoria Interna
CPL

Presidência - PRESI
    ├── Superintendência Jurídica
    ├── Gerência de Comunicação
    ├── Gerência de Compliance e Controles Internos
    ├── Secretaria de Governança
    ├── Ouvidoria
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

## Vínculos financeiros (`links`)

Cada item distribui parte de uma conta ou de um setor da planilha para um setor administrativo.

```json
{
  "id": "fin-energia",
  "box": "diretoria-financeira",
  "type": "account",
  "origin": "81830300010006",
  "percent": 100
}
```

- `id`: texto não vazio e único entre todos os vínculos.
- `box`: `id` de setor administrativo existente.
- `type`: use somente `account` ou `sector`.
- `origin`: com `account`, use código exato da conta da planilha. Com `sector`, use código exato do setor da base.
- `percent`: número finito maior ou igual a `0`. Use ponto decimal em JSON, por exemplo `12.5`.

`sector` distribui todas as contas daquele setor da base. Não use simultaneamente vínculo `sector` e vínculos `account` das mesmas contas, exceto se soma planejada for intencional.

## Regra de distribuição

Para exportar Excel, cada conta ou ajuste precisa somar **100% após arredondamento para duas casas decimais** entre todos os vínculos que a alcançam, como na tela. Hierarquia entre setores administrativos não consome percentual: superior apenas consolida valores dos filhos.

Vínculos importados preservam sua precisão. A edição na tela arredonda o valor confirmado para duas casas. Somas de 99,996% e 100,004% são aceitas; 99,99% e 100,01% continuam bloqueadas.

Exemplo: conta pode ter 70% para uma gerência e 30% para outra. Se um setor da base recebe 100%, não adicione outra parcela para suas contas, a menos que ajuste soma total.

## Exemplo completo

Use somente códigos presentes na planilha que estará aberta no POU.

```json
{
  "format": "orca-organograma",
  "version": 1,
  "boxes": [
    { "id": "diretoria", "name": "Diretoria Financeira", "parent": null },
    { "id": "contabil", "name": "Gerência Contábil", "parent": "diretoria" },
    { "id": "tesouraria", "name": "Gerência de Tesouraria", "parent": "diretoria" }
  ],
  "links": [
    { "id": "contabil-despesas", "box": "contabil", "type": "sector", "origin": "818", "percent": 100 },
    { "id": "tesouraria-receitas", "box": "tesouraria", "type": "sector", "origin": "711", "percent": 100 }
  ]
}
```

## Checklist antes de responder

1. Todas as dúvidas foram reunidas em um único bloco e respondidas.
2. O usuário confirmou explicitamente o resumo final.
3. Use `format` igual a `orca-organograma` e `version` igual a `1`.
4. Garanta IDs únicos em `boxes` e `links`.
5. Confirme todos os `parent` e `box`, sem ciclos ou superiores ausentes.
6. Copie códigos `origin` exatamente da planilha fornecida.
7. Comprove que cada conta e ajuste fecha em 100% com arredondamento para duas casas, considerando vínculos por conta e por setor da base.
8. Confirme que não existe sobreposição involuntária entre `sector` e `account`.
9. Se padrão AGE foi escolhido, confirme 24 setores, raízes `conad`, `confin`, `auditoria`, `cpl` e `presidencia`, `ouvidoria` e `dpg` como filhos diretos de `presidencia` e uma única `ger-pn` sob `sup-pn`.
10. Depois da confirmação, retorne apenas JSON válido quando solicitado a gerar o arquivo.
