# Guia LLM — Índices JSON

Use este guia para gerar um arquivo importável em **Índices > Importar índices JSON**.

## Regra obrigatória: confiança de 100%

A LLM só pode gerar os índices finais quando taxa, periodicidade, vigência, alcance, alvo e estado de cada índice estiverem confirmados. “100% de confiança” significa que nenhum dado depende de estimativa ou interpretação não aprovada pelo usuário.

Fluxo obrigatório:

1. Leia todos os arquivos e dados fornecidos antes de perguntar.
2. Identifique de uma vez todas as informações ausentes, contraditórias ou ambíguas.
3. Envie **um único bloco de perguntas**, numerado e objetivo. Não distribua dúvidas em várias mensagens.
4. Após as respostas, apresente uma tabela-resumo com cada índice, taxa, ritmo, vigência, alcance, alvo e estado.
5. Explique sobreposições: índices que atingem o mesmo valor são multiplicados, não somados.
6. Peça confirmação explícita do resumo. Gere o JSON somente depois da confirmação.

Se as respostas criarem uma contradição nova, reúna todas as inconsistências em um único bloco de correção. Nunca invente taxa, período ou código e nunca trate uma previsão econômica como fato confirmado.

### Perguntas obrigatórias em um único bloco

Pergunte somente o que os arquivos ainda não responderam, cobrindo todos estes pontos:

1. Qual cenário ou finalidade cada índice representa?
2. Qual é o nome exato, a taxa percentual e se ela aumenta ou reduz a projeção?
3. A aplicação é mensal (`monthly`) ou anual (`annual`)?
4. Qual é a vigência exata, em `AAAA-MM`, incluindo início e fim?
5. O alcance é todo o orçamento, Receita/Despesa, setor da base ou conta específica?
6. Quando houver alvo, qual é o código exato existente na planilha?
7. O índice começa ativo? Existem índices que não devem ser aplicados simultaneamente?
8. O usuário confirma o efeito multiplicativo quando dois ou mais índices atingem o mesmo valor?

Mesmo quando os dados parecerem completos, apresente o resumo e aguarde a confirmação. Sem confirmação explícita, responda com as pendências; não produza o JSON final.

## Formato canônico

```json
{
  "format": "orca-indices",
  "exportedAt": "2026-10-21T12:00:00.000Z",
  "variables": []
}
```

`format` e `exportedAt` são recomendados. POU importa também array puro, mas use sempre objeto acima para arquivos novos.

## Estrutura de um índice

```json
{
  "id": "ipca-2027",
  "name": "IPCA projetado",
  "rate": 4.5,
  "cadence": "annual",
  "start": "2027-01",
  "end": "2027-12",
  "scope": "all",
  "target": "",
  "active": true
}
```

- `id`: texto único. Se ausente, POU gera identificador, mas prefira definir um.
- `name`: texto não vazio.
- `rate`: número percentual maior que `-100`. Ex.: `4.5` aumenta 4,5%; `-2` reduz 2%.
- `cadence`: somente `monthly` ou `annual`.
- `start` e `end`: datas no formato `AAAA-MM`. `start` deve ser menor ou igual a `end`.
- `scope`: somente `all`, `group`, `sector` ou `account`.
- `target`: depende de `scope`.
- `active`: `true` aplica índice. `false` mantém salvo, mas sem efeito.

### Como a taxa se acumula

- **Mensal:** a taxa é aplicada uma vez por mês durante a vigência. Um aumento de 10% por três meses resulta em 33,1%, e não 30%.
- **Anual:** a taxa é aplicada no mês inicial e novamente a cada 12 meses, desde que a vigência alcance a nova aplicação.
- **Depois do fim:** o fator acumulado permanece; o aumento não é retirado. Um índice anual de 10% com início em agosto de 2026 e fim em outubro de 2026 mantém o fator 1,10 depois do fim. Para acumular outro reajuste em agosto de 2027, a vigência precisa alcançar esse mês.
- **Sobreposição:** índices que atingem a mesma conta são multiplicados entre si. Dois aumentos de 10% resultam em 21%.

Confirme esse efeito com o usuário antes de gerar o arquivo. Não use um índice mensal quando a intenção for aplicar um único reajuste. A fórmula e os exemplos estão em [Cálculo do orçamento](wiki/04_calculo.md).

## Alvo por alcance

| `scope` | `target` obrigatório | Exemplo |
| --- | --- | --- |
| `all` | texto vazio | `""` |
| `group` | `Receita` ou `Despesa` | `"Despesa"` |
| `sector` | código exato do setor da base | `"818"` |
| `account` | código exato da conta da base | `"81830300010006"` |

POU valida `sector` e `account` contra planilha aberta. Não invente códigos. Use somente códigos enviados pelo usuário ou extraídos da base.

O alcance `sector` usa o **setor financeiro da planilha**, não a hierarquia administrativa do Organograma. Índices não possuem relação `parent` nem herdam alcance de setores superiores do Organograma.

## Relação com a nova hierarquia da empresa

O Organograma padrão AGE possui 25 setores administrativos. CONAD, CONFI, Gerência de Auditoria Interna e Comissão PAD são raízes independentes, no mesmo nível da Presidência. CPL e Ouvidoria são filhos diretos da Presidência. **DIPLAG** é filha direta da Presidência. Ele inclui DIROP, DIRFI e suas gerências e superintendências conforme a hierarquia canônica do [guia de Organograma](GUIA_LLM_ORGANOGRAMA_JSON.md).

Resumo hierárquico para conferência (os índices não recebem estes IDs):

```text
CONAD (raiz)
CONFI (raiz)
Gerência de Auditoria Interna (raiz)
Comissão PAD (raiz)
Presidência - PRESI (raiz)
├── CPL
├── Ouvidoria
└── DIPLAG
    ├── Gerência Administrativa
    ├── Gerência de Planejamento de Dados, Mercado e Orçamento
    └── Superintendência de Tecnologia da Informação
        └── Gerência de Tecnologia da Informação
Presidência também possui Jurídica, Comunicação, Compliance e Controles Internos,
Secretaria de Governança, DIROP e DIRFI; consulte o guia de Organograma para a lista completa.
```

Essa hierarquia não altera o formato dos índices:

- `scope: "sector"` recebe código financeiro da planilha, como `818`, nunca `auditoria`, `presidencia`, `dpg` ou outro `box` administrativo;
- `scope: "account"` recebe código exato de conta da planilha;
- índice não recebe `parent`, não é distribuído entre setores administrativos e não substitui vínculo de organograma;

Se o usuário informar nome de setor administrativo ao pedir um índice, pare e pergunte se ele quer o código financeiro da planilha ou uma alteração no Organograma. Não converta nome administrativo em código por inferência.

## Exemplo completo

```json
{
  "format": "orca-indices",
  "exportedAt": "2026-10-21T12:00:00.000Z",
  "variables": [
    {
      "id": "ipca-2027",
      "name": "IPCA projetado",
      "rate": 4.5,
      "cadence": "annual",
      "start": "2027-01",
      "end": "2027-12",
      "scope": "all",
      "target": "",
      "active": true
    },
    {
      "id": "energia-mensal",
      "name": "Reajuste de energia",
      "rate": 1.2,
      "cadence": "monthly",
      "start": "2027-01",
      "end": "2027-06",
      "scope": "account",
      "target": "81830300010006",
      "active": true
    }
  ]
}
```

## Checklist antes de responder

1. Todas as dúvidas foram reunidas em um único bloco e respondidas.
2. O usuário confirmou explicitamente a tabela-resumo.
3. Use números JSON, sem `%`, vírgula decimal ou aspas em `rate`.
4. Use `AAAA-MM` em `start` e `end`.
5. Use somente valores permitidos para `cadence` e `scope`.
6. Para `group`, use exatamente `Receita` ou `Despesa`.
7. Para `sector` e `account`, copie o código exato da planilha fornecida.
8. Confira sobreposições e descreva o efeito multiplicativo antes da confirmação.
9. Confirme que nenhum alvo usa `id` ou `parent` do Organograma administrativo.
10. Depois da confirmação, retorne apenas JSON válido quando solicitado a gerar o arquivo.
