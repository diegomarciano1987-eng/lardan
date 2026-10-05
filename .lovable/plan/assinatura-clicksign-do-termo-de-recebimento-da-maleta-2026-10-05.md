# Assinatura Clicksign do Termo de Recebimento da Maleta

## Situação de partida
- Ainda não existe conta Clicksign. Tudo nasce **desligado** e é construído e provado no banco de testes isolado, com respostas da Clicksign simuladas **apenas nos testes**. Nada simula assinatura no sistema de verdade.
- Texto do termo: rascunho marcado "pendente de revisão jurídica", que não pode ser usado em produção.
- Confirmação de identidade da consultora: código por e-mail e código por WhatsApp (o que estiver contratado).

## Decisão importante: como as maletas funcionam enquanto a Clicksign está desligada
Se o aceite atual for bloqueado agora, nenhuma consultora consegue receber maleta até a conta existir. Por isso:
- Uma chave **"Exigir assinatura no aceite"** (desligado / sandbox / produção) fica em Integrações.
- **Desligado** (padrão de hoje): o aceite continua como está, sem mudar nada para as consultoras.
- **Sandbox/Produção**: o aceite direto é recusado pelo próprio banco. A maleta só passa a valer para operação depois que o termo estiver assinado e o arquivo assinado estiver guardado.
- Sandbox nunca vira produção sozinho.

## O que vai ser construído
1. **Conferência guardada sem liberar a maleta:** a conferência peça por peça (aceitas, faltantes, defeitos, motivos) fica gravada e não muda mais. Ela leva uma impressão digital (SHA-256) e a versão do termo. As peças ainda não entram no saldo da consultora.
2. **Termo em PDF gerado no servidor:** logo Lardan, dados da maleta e do ciclo, consultora (CPF mascarado na tela e completo só no PDF), tabela de itens, divergências, versão e impressão digital. O PDF fica em armazenamento privado.
3. **Envio para a Clicksign:** o documento vai para a Clicksign com a consultora destinatária como **única** signatária. Representante e gestão não podem assinar no lugar dela. Antes do envio, o sistema confere se o cadastro tem e-mail, celular e CPF. Se faltar algo, aparece a mensagem "Precisamos completar alguns dados do seu cadastro…".
4. **Endereço de aviso da Clicksign** (`/api/public/clicksign/webhook`): segue o mesmo padrão já usado com o Asaas. Confere a assinatura de segurança, limita o tamanho, ignora avisos repetidos e guarda o registro. Quando o documento é assinado, o sistema baixa o arquivo assinado, guarda em local privado e só então libera a maleta, numa única operação. Recusa, cancelamento ou prazo vencido deixam a maleta parada, com motivo, e permitem gerar o termo de novo.
5. **App da consultora:** Conferência → "Revise as informações abaixo…" → **Gerar termo e assinar** → assinatura → "Aguardando confirmação" → "Seu termo foi assinado…" + **Ver termo assinado**.
6. **Ficha da maleta (gestão):** situação da assinatura, linha do tempo (gerado, enviado, visto, assinado, recusado), botões para baixar o termo original e o assinado, e "reenviar" quando couber. A gestão não pode aceitar no lugar da consultora.
7. **Integrações:** cartão da Clicksign com modo, situação ("Clicksign não configurada" enquanto faltar a chave) e o endereço de aviso para copiar.
8. **Histórico:** cada passo fica registrado no histórico permanente da maleta, sem segredos e sem dados pessoais completos.

## Provas (banco isolado, dados fictícios)
- Com modo desligado, o aceite atual segue igual. Todas as provas de maletas que já existem continuam passando.
- Com modo sandbox, o aceite direto é recusado e a conferência fica guardada sem mexer no saldo.
- Só a consultora destinatária consegue iniciar o termo. Representante, outra consultora e gestão são recusados.
- Aviso com assinatura de segurança errada é recusado. Aviso repetido não gera efeito duplo.
- A maleta só é liberada depois de assinado e com o arquivo guardado. Se o download falhar, a maleta continua parada e o sistema tenta de novo.
- Uma recusa permite gerar um novo termo. O termo antigo continua guardado.
- O PDF tem a mesma impressão digital registrada no banco.

## O que vai ficar dependendo de vocês
- Criar a conta Clicksign e me passar o token de sandbox e o segredo do aviso (pelo formulário seguro).
- Revisão jurídica do texto do termo.
- Homologação no sandbox e só depois ativação em produção.

## Detalhes técnicos
- Migração aditiva:
  - Tabelas `kit_signature_requests` (snapshot jsonb, sha256, versão, estado, ids externos, caminhos dos arquivos) e `clicksign_events` (dedup por id do evento).
  - Configuração `clicksign_settings` com o modo.
  - RPCs `kit_assinatura_preparar`, `kit_assinatura_registrar_envio`, `kit_assinatura_evento`, `kit_assinatura_finalizar` (reaproveita a lógica interna de `kit_aceitar`) e `kit_assinatura_situacao`.
  - Guarda em `kit_aceitar` para quando o modo for diferente de desligado.
  - Cópia em supabase/migrations.
- API Clicksign v3 (envelopes, documents, signers, requirements, notify) num transporte server-only `src/lib/clicksign/*.server.ts`. A saída de rede fica bloqueada por padrão (`CLICKSIGN_EGRESS_ENABLED`). Segredos: `CLICKSIGN_ACCESS_TOKEN`, `CLICKSIGN_WEBHOOK_SECRET` e ambiente via configuração. Antes de codificar, confiro a documentação oficial.
- Server functions com `requireSupabaseAuth` em `src/lib/clicksign.functions.ts`. O `supabaseAdmin` só entra dentro do handler, para o storage privado (bucket `termos-maleta`).
- PDF com `pdf-lib`, igual ao padrão do projeto.
- Documentação em `docs/lardan/CLICKSIGN-MALETAS.md` e relatório final no formato pedido na seção 32.
