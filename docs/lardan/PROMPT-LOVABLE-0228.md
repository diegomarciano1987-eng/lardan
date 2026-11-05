# Para o Lovable — 0228: Correios, etapa 1 (conexão e diagnóstico)

**Sem migração.** Só código novo. Nada é postado nem cobrado: a etapa 1 só confere a conexão com o contrato e mostra os serviços, o preço e o prazo.

## Arquivos
- `src/lib/correios/api.server.ts` (novo): token do contrato (cartão de postagem), serviços do contrato, preço, prazo e rastreio. Homologação por padrão.
- `src/lib/correios/correios.functions.ts` (novo): `correiosDiagnostico` e `correiosRastro`, só Master.
- `src/components/admin/correios/CorreiosDiagnostico.tsx` (novo): painel "Correios — conexão com o contrato" em Integrações.
- `src/routes/_authenticated/admin/integracoes.tsx`: mostra o painel.
- `src/lib/correios/AGENTS.md` e `docs/lardan/PLANO-CORREIOS-E-GARANTIAS.md`.

## Segredos (Lovable › Secrets)
| Nome | Valor |
| --- | --- |
| `CORREIOS_USUARIO` | 43319208000180 |
| `CORREIOS_CODIGO_ACESSO` | código de acesso às APIs (o Diego cola direto aqui) |
| `CORREIOS_CARTAO` | 0080387403 |
| `CORREIOS_CONTRATO` | 9912767579 |
| `CORREIOS_DR` | 36 |
| `CORREIOS_AMBIENTE` | homologacao |
| `CORREIOS_CEP_ORIGEM` | 86200055 |

## Depois de publicar
Em Integrações › Correios, como Master, clique em **Testar conexão** (CEP 15520011) e mande o print do resultado (lista de serviços + preço e prazo do PAC).
