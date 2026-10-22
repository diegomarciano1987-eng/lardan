# Focus NFe — passo a passo até a primeira nota de teste

Nunca mande token, senha de certificado ou segredo por chat (nem para o Claude, nem para o Lovable em texto). Tudo vai no cofre de segredos do Lovable.

## 1. No painel da Focus (empresa Lardan)

1. Entre no painel da Focus NFe e abra **Empresas**. Escolha a empresa de CNPJ 43.319.208/0001-80 (TSM COMERCIO DE SEMIJOIAS LTDA).
2. Confira os dados:
   - inscrição estadual 9090830101;
   - regime **Simples Nacional**;
   - endereço completo de Ibiporã/PR;
   - certificado A1 enviado e dentro da validade (você já subiu).
3. Em **Documentos fiscais**, habilite a **NF-e** no ambiente de **homologação**.
   - Em homologação, série e próximo número podem ser quaisquer. Use série 2 e próximo número 1.
   - Produção fica para depois, com a série decidida junto do contador (passo 6).
4. Abra **Painel API > Tokens** e copie o **Token de Homologação**. É ele que vai no cofre. O Token Master e o de Produção não entram agora.

## 2. No Lovable (cofre de segredos)

Peça no chat do Lovable: "adicione os segredos abaixo". Ele abre um campo seguro para cada um; cole o valor lá, nunca no texto da conversa.

| Segredo | Valor |
| --- | --- |
| `FOCUS_TOKEN_HOMOLOGACAO` | o token de homologação copiado da Focus |
| `FOCUS_EGRESS_ENABLED` | `true` |
| `FOCUS_CNPJ_EMITENTE` | `43319208000180` |
| `FOCUS_UF_EMITENTE` | `PR` |
| `FOCUS_WEBHOOK_SECRET` | uma senha longa e aleatória (40+ caracteres); o Lovable pode gerar |
| `FOCUS_WEBHOOK_URL` | `https://<domínio publicado do Lardan>/api/public/focus/webhook` |

O aviso automático (webhook) só funciona com o site publicado. Sem ele a tela consulta a Focus sozinha a cada 6 segundos, então dá para testar no preview.

## 3. Primeira nota de teste (Integrações > "Focus NFe — notas de teste")

1. O quadro "Homologação" precisa mostrar **Pronta**. Se mostrar "Falta configurar", o nome que aparece é o segredo que faltou.
2. Se o site já estiver publicado: clique em **Registrar aviso na Focus**.
3. Em **Nova remessa de teste**:
   - escolha uma consultora com CPF válido e endereço completo (rua, bairro, CEP e cidade com código IBGE);
   - escolha 2 ou 3 peças com preço;
   - clique em **Emitir remessa de teste**.
   A nota sai com o nome "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL", como a SEFAZ exige.
4. Espere ficar **Autorizada**. Abra o **DANFE** e o **XML** e confira:
   - natureza "- REM/CONSIG.";
   - CFOP 5917 (6917 se a consultora for de fora do PR);
   - CSOSN 102;
   - valor = 1/3 do varejo;
   - texto "----- REMESSA: TESTE KIT: 1 -----".
5. Na remessa autorizada, teste as outras notas:
   - **Devolução de teste**: devolva parte das peças. Ela sai como entrada 1918, finalidade devolução, referenciando a remessa.
   - **Venda de teste** (5114) e **Perda de teste** (5927).
   - **Cancelar nota**: em uma delas, com justificativa.
6. Faça também uma remessa para uma consultora de São Paulo (6917). É o caso que mais pode pedir ajuste: diferencial de alíquota para consumidor final de outro estado.

## 4. Se a SEFAZ rejeitar

A mensagem aparece em vermelho no cartão da nota, com o código da SEFAZ. Me mande o print. As causas mais comuns:
- IE ou regime da empresa diferente no painel da Focus;
- certificado de outro CNPJ;
- cidade da consultora sem código IBGE;
- CEP inválido.

## 5. Depois da homologação

1. O contador confere 3 a 5 DANFEs e XMLs de teste (roteiro, 1/3 do varejo, perda fora do PR, devolução).
2. Os pacotes fiscais (db/pendentes 01, 02, 04, 06, 11) são promovidos para a produção, e a nota passa a nascer da remessa e do acerto de verdade.
3. Série de produção decidida:
   - série nova; ou
   - série 2 continuando a numeração do SmallData (veja a "última NF por série" em Configurações > Histórico).
   - Em qualquer caso, o SmallData para de emitir no dia da virada.
4. Token de produção no cofre (`FOCUS_TOKEN_PRODUCAO`), aviso registrado em produção e a primeira remessa real com o DANFE junto da maleta.
