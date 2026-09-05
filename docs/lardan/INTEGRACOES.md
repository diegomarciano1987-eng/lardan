# LARDAN — Integrações e Dependências

Status geral: NENHUMA integração externa configurada nesta fase. Ausência não impede persistência de leads nem operação do site/admin.

| Integração | Finalidade pretendida | Estado | Origem |
| --- | --- | --- | --- |
| Backend gerenciado (Lovable Cloud) | Banco, autenticação administrativa, storage, RLS | PENDENTE — habilitar no Lote 2 | V/6,12 |
| Asaas | PIX, boleto, cartão, link, cobrança, split | NÃO CONFIGURADO — sandbox/produção separados, segredos no servidor, homologação prévia | C/Anexo A/9; A/12–13 |
| Fiscal (NF-e/NFC-e) | Documentos fiscais de venda | FUTURO — depende de definição contábil | P/37; EST-08 |
| Bancos/adquirentes | Conciliação, recebimentos | FUTURO — Asaas não equivale a integração bancária ampla | V/ASA |
| Bureaus (Serasa/Assertiva) | Análise de perfil de consultora | CONDICIONADO — fornecedor e credenciais pendentes; revisão humana obrigatória | CON-02 |
| Logística (Sedex, carta registrada, transportadora) | Maletas e expedição | FUTURO — rastreio, seguro, custo, prazo | MAL-07 |
| Assinatura digital | Contratos e aceites de consultoras | FUTURO — provedor a definir | REC-05 |
| Analytics (GA4 ou similar) | Medição de navegação/conversão | NÃO CONFIGURADO — eventos com IDs estáveis, sem dados pessoais; ausência não impede gravação de lead | V/13 |
| WhatsApp/e-mail transacional | Notificações de formulários | NÃO CONFIGURADO — formulários salvam no banco independentemente; nunca dizer "e-mail enviado" se só gravou | V/5.3 |

## Regras

- Segredos somente no servidor; nunca no frontend, variável pública, código versionado ou log.
- Webhooks externos: verificação de autenticidade, idempotência, reconciliação.
- Nenhuma integração é declarada "funcionando" sem homologação registrada.
- Endpoints públicos de webhook/cron futuros vivem sob /api/public/* com verificação própria.
