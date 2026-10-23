# Pacote 0136-2 — resultados de 23/10/2026

## Aplicação
- Rotinas aplicadas como `drizzle/migrations/0137_primeira_montagem_ligacoes.sql` pela ferramenta oficial.
- Conteúdo SQL preservado; única diferença textual: ausência da quebra de linha final no arquivo gerado.
- Os onze arquivos de código/teste são byte a byte idênticos aos enviados. Não sobrescrito o AGENTS completo: substituída somente a regra Operation-door e acrescentada First montagem, preservando regras anteriores.
- Objetos confirmados na base compartilhada: consultoras_vinculo_log, colab_login_reservar(text), variantes_tipo_peca(uuid[]).
- Não executados vínculos manuais nem aplicação da carteira; nenhuma publicação.

## Provas
- Bancada local recriada com `bash tests/isolado/subir.sh`; aplicada a 0137 nela e executado `bun test tests/isolado`.
- Resultado: **424 pass, 0 fail**, 1.977 asserções, 37 arquivos (27,16 segundos). Todos os 17 testes novos passaram.
- Inclui montagem, saída oficial de estoque, aceite, reativação, bloqueio de nova maleta para bloqueada, carteira, sigilo de custo/financeiro e 8 tentativas simultâneas com somente 5 reservas liberadas.
- Prévia executada pelo cliente oficial com sessão autenticada Master em `/admin/maletas`. A ferramenta de consulta administrativa recusou executar a função; não foram ampliadas permissões para contornar isso.
- Tela Master e erro uniforme de código inexistente conferidos em navegador. Prints: `/tmp/browser/0136/maletas.png` e `/tmp/browser/0136/login-invalid.png`.
- Login válido de colaboradora real **não verificado**: não alteradas senhas nem criadas contas reais. O caminho banco/montagem foi exercitado integralmente em dados sintéticos isolados.
- Sinal automático disponível: build OK. Não medida novamente a carga de 4.017 consultoras; os tempos do prompt são medições do autor, não desta validação.

## 1. Representantes do histórico
Todos estão ativos no histórico. “Vinculado” descreve somente o vínculo já existente, não a validade atual do papel de representante.

| Código | Nome | Praças | Cadastro vinculado |
|---|---|---|---|
| 16 | DANIEL DE FREITAS MACIEL (LOJA) | 72, 73 | Sim |
| 1515 | TATIANE SIMONELLI DE OLIVEIRA | 54 | Sim |
| 3002 | MARCOS SALES | Sem dados | Não |
| 3003 | LOANNA GONÇALVES QUINA AZEVEDO | 2, 4, 5, 6, 7, 8 | Não |
| 3004 | SUELI APARECIDA DE ALMEIDA | 11 | Sim |
| 3008 | CLEVERSON FRANCK | 46, 20, 21, 22, 23, 24, 25 | Sim |
| 3009 | MARCELO MARLOS DE OLIVEIRA | 70, 1, 2, 3, 6, 9, 10, 13, 14, 15, 18, 27, 28, 29, 30, 31, 32, 40 | Sim |
| 3010 | GUILHERME AUGUSTO PELEGRINI DA SILVA | 49, 70, 18, 34, 35, 36, 37, 42, 43 | Sim |
| 5000 | TSM COMERCIO DE SEMIJOIAS LTDA | 54 | Não |
| 5673 | DANIEL DE FREITAS MACIEL | 73, 2, 26, 60, 61, 22, 64, 67, 54, 70, 57 | Sim |
| 5674 | LARISSA REGINALDA DOS SANTOS | 54 | Sim |
| 6512 | KETLLIN DE SOUZA SILVA | 54 | Não |
| 6941 | MYKAELI VITORIA DE LIMA BENTO | Sem dados | Sim |

Ketllin permanece somente como registro do histórico: não atribuído papel Representante nem criado vínculo.

## 2. Prévia da carteira — sem gravação
```json
{
  "praca": 3617,
  "aplicado": false,
  "perfil_novo": 0,
  "representante": 45,
  "por_representante": [
    { "consultoras": 45, "representante": "Daniel de Freitas Maciel" }
  ],
  "reps_sem_cadastro": [],
  "mais_de_um_representante": 0
}
```

A prévia propõe preencher representante de 45 consultoras e praça vazia de 3.617 consultoras; não representa 3.617 praças distintas. Nenhuma ficha nova ou troca de vínculo existente prevista. A lista `reps_sem_cadastro` vazia é o resultado da função, não significa que todos os registros históricos estejam vinculados.

## Ponto de parada
Aguardar Diego identificar quais representantes históricos ligar e aprovar a aplicação da carteira. Uma eventual mudança de representantes históricos exige refazer a prévia antes de aplicar. Não executar `consultoras_vinculo_smalldata(true)` nesta etapa.