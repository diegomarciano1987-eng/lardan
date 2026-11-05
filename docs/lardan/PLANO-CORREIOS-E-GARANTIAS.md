# Plano: maleta pelos Correios + trocas e garantias (05/11/2026)

Os dois projetos usam a mesma base: a conexão com a API dos Correios (etapa 1, pacote 0228). A volta da maleta e a peça de garantia a caminho da empresa saem pela **logística reversa por pré-postagem**, com o código mandado por WhatsApp.

## A. Maleta pelos Correios (regras do Diego, 05/11)

| Etapa | O que o sistema faz |
| --- | --- |
| 1. Envio | Botão "Enviar pelos Correios" na maleta conferida: pré-postagem **PAC**, caixa 40×30×10 cm e 1 kg, **valor declarado = custo das peças**, etiqueta A4. Grava rastreio, frete e data de postagem. |
| 2. Entregue | O rastreio (consultado sozinho) registra a entrega. Se falhar, vale o "recebi" no app. **Os 30 dias de venda contam da entrega**, e o app recalcula as datas. |
| 3. Em venda | Ela lança as vendas no app (já existe). |
| 4. Pré-acerto | No dia 30, ela faz o pré-acerto no app e pode pagar (já existe: pré-baixa + Pix Asaas, com conciliação). |
| 5. Acerto fechado | A equipe fecha o acerto, e só então o botão **"Liberar volta"** fica disponível. |
| 6. Volta | "Liberar volta" cria a **pré-postagem reversa PAC** pela API e manda o código por WhatsApp. Os 5 dias contam do envio do código. **Sem postagem no 5º dia → alerta para a cobrança.** |
| 7. Conferida | Na chegada, a conferência compara as peças devolvidas com as esperadas (já existe). A diferença vira débito (pendência). |

Situação da maleta: enviada → entregue → em venda → pré-acerto feito → acerto fechado → volta liberada → em trânsito de volta → conferida.

**Pedido impresso (maleta pelo correio):** "Enviada em [data]. Seus 30 dias de venda começam no recebimento. No dia 30, você faz o pré-acerto no app (já pode pagar). Nós entramos em contato para o acerto e enviamos o código da volta no WhatsApp. Você tem 5 dias para postar a maleta." Sem data de acerto impressa.

**Regra:** bloquear o envio de nova maleta enquanto houver débito aberto na consultora. Exemplo de hoje: a Amanda tem R$ 181,25 vencidos e recebeu a MAL-00326. Com a regra, essa maleta não teria saído.

**Indicadores:** frete por maleta (ida + volta), prazo médio de entrega, % de extravio e avaria, maletas em trânsito, dias entre o fim dos 30 dias e o envio do código, % postadas em até 5 dias, % do valor pago no pré-acerto, inadimplência do consignado (vencido e não pago ÷ valor das maletas em venda) e divergência na conferência ((esperadas − devolvidas) ÷ esperadas).

**Pacotes:** 0229 envio + rastreio + datas dos 30 dias. 0230 liberar volta + reversa + WhatsApp + alerta do 5º dia + bloqueio por débito. 0231 indicadores. Tudo em homologação primeiro.

**Perguntas para o gerente dos Correios:** validade do código da reversa (precisa ser de pelo menos 5 dias); se a reversa sai pela API de pré-postagem; limite de crédito e faturamento mínimo do contrato.

## B. Trocas e garantias (PDF do Daniel, 29/10)

**Decisões adotadas** (as sugestões do próprio PDF; mudar é só avisar):
1. Análise em duas etapas: pela foto na abertura e conferência final quando a peça chega. Os 10 dias contam da abertura para a análise pela foto.
2. Os 60 dias para mandar a troca contam do recebimento da peça.
3. Defeito visto na entrega é tratado no aceite da maleta. Depois disso, vale a garantia.
4. A consultora tem 15 dias para mandar a peça depois da aprovação. Passou disso, o chamado é cancelado.
5. Motivo "não coberto" é bloqueado na abertura, com mensagem clara. "Outro" fica aberto.
6. Frete até a empresa: **etiqueta pré-paga gerada no app** (reversa dos Correios, a mesma da maleta).
7. A peça reposta segue a garantia da venda original.
8. Sem estoque: conserto primeiro, depois peça equivalente. Crédito só com o aval do Diego.
9. O representante pode abrir o chamado em nome da consultora, e fica registrado quem abriu.
10. O certificado vai para a cliente por WhatsApp, com e-mail como reserva.

**Fases:**
1. **Base:** chamados com histórico e fotos, motivos no admin (coberto, não coberto ou Qualidade decide) e checagem automática (venda no app, até 24 meses, peça do pedido, foto, nenhum outro chamado aberto para a peça).
2. **Telas:** abertura e acompanhamento no app da consultora, fila da Qualidade por prazo (vencido em vermelho no topo), ações (aprovar, recusar com motivo, pedir fotos, receber, trocar ou consertar, enviar), avisos e etiqueta pré-paga.
3. **Certificado:** gerado em toda venda lançada, com página de verificação por QR e envio por WhatsApp. Vale também para a maleta pelo correio.
4. **Representante e gestão:** chamados da rota, indicadores e piloto com 2 ou 3 consultoras.

**O que já existe e é reaproveitado:** vendas no app com o telefone da cliente (`sales_orders`), fotos (storage), `kit_balances.qty_warranty`, WhatsApp, a reversa dos Correios (projeto A) e a fila da Qualidade no admin.
