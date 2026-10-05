# Clicksign — Termo de Recebimento e Conferência de Maleta

Situação: estrutura **ativa no banco em modo `desligado`** (aceite atual inalterado). Conta Clicksign ainda não existe.

## Fluxo (modo sandbox/produção)
expedição → entrega → confirmação de recebimento → conferência peça por peça →
`kit_assinatura_preparar` (snapshot imutável + SHA-256, saldo intocado) → PDF no servidor (pdf-lib) →
bucket privado `termos-maleta/<ciclo>/<termo>/termo.pdf` → Clicksign v3 (envelope, documento, signatária única,
requisitos `agree/receipt` + `provide_evidence` por e-mail ou WhatsApp, ativação, notificação) →
`kit_assinatura_registrar_envio` → aviso `POST /api/public/clicksign/webhook` (HMAC `Content-Hmac`, 256 KB,
dedupe por SHA-256 do corpo) → `kit_assinatura_evento` → download do assinado → `assinado.pdf` →
`kit_assinatura_finalizar` (atômico: chama o `kit_aceitar` oficial como a consultora que assinou) → `operacao`.

## Modos (`clicksign_settings.modo`, só master via `clicksign_modo_definir`)
- `desligado`: aceite direto como antes.
- `sandbox` / `producao`: gatilho em `kit_acceptances` recusa qualquer aceite fora da finalização.
- Produção recusada enquanto `termo_aprovado = false` (texto atual é rascunho `rascunho-v0`).

## Segredos (Lovable Cloud)
`CLICKSIGN_SANDBOX_TOKEN`, `CLICKSIGN_PRODUCAO_TOKEN`, `CLICKSIGN_WEBHOOK_SECRET`, `CLICKSIGN_EGRESS_ENABLED=true`.
Sem eles: "Clicksign não configurada", nada é enviado nem simulado.

## Modelo de dados
`kit_signature_requests` (um ativo por ciclo; leitura por `kit_cycle_in_scope`), `clicksign_events` (só servidor),
`clicksign_settings`. Histórico em `kit_events`: `termo.gerado|enviado|assinado|recusado|cancelado|expirado|falha|finalizado|evento`.

## Permissões
Só a consultora destinatária prepara (gestão, representante e outras consultoras recusados no banco).
Registrar envio, eventos e finalização: apenas `service_role`. Arquivos: link temporário de 5 min a quem enxerga a maleta.

## Falhas
Envio falho → `falha` (nova conferência permitida). Download falho → continua `assinado`, tentativa contada;
"Reprocessar termos assinados pendentes" em Integrações. Recusa/cancelamento/prazo → maleta segue `recebida`, novo termo permitido, antigo guardado.

## Provas
`tests/isolado/clicksign.test.ts` — 9/9; `tests/isolado/maletas.test.ts` — 28/28 (sem regressão).
Não verificado: chamadas reais à Clicksign (sem conta) — formatos da v3 e do aviso devem ser confirmados na homologação.

## Homologação → ativação → rollback
1. Criar conta, gerar token sandbox, cadastrar o aviso com a URL de Integrações e segredo.
2. Salvar segredos, ligar modo Testes, assinar com consultora fictícia.
3. Jurídico aprova o texto → atualizar `termo_versao`/`termo_aprovado` → modo Produção.
Rollback: voltar o modo para Desligado (aceite antigo volta na hora; termos ficam guardados).
