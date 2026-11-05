# Ligar a nota fiscal do Lardan: o que falta, quem faz e como (atualizado em 05/11/2026, 15h)

## Já feito

- **Erro 974 resolvido.** A SEFAZ autoriza as notas de teste desde 05/11, 9h.
- **Notas de teste de todas as operações autorizadas** em Integrações (série 1, homologação): remessa nº 5000, venda nº 5001, perda nº 5002 (cancelada, o que testou o cancelamento) e devolução nº 5003.
- **Botão da maleta testado em produção-teste:** remessa nº 5004 da maleta da Eliane Ravazi (remessa 923), autorizada.
- **Escritório (ON4):** confirmou o roteiro e a série 3. Cópia dos XMLs para fiscal2@on4.com.br.
- **Base de 1/3 do varejo:** definida pela Lardan. O responsável é o Daniel.
- **Focus:** produção na série 3, com próximo número 1. Token de produção salvo no Lovable.
- **Pacotes prontos:** 0214 (publicado), 0215 (notas do acerto) e 0216 (emissão real).

## Passo 1: mandar as notas de teste ao escritório

- **Quem faz:** Diego.
- **Como:** depois de subir o 0216, em **Integrações › Focus NFe — notas de teste**, clique em **"Enviar ao escritório"** nas notas 5000, 5001, 5002, 5003 e 5004. A Focus manda o XML e o DANFE para fiscal2@on4.com.br. Avise o escritório por WhatsApp ou e-mail que as notas chegaram.
- **Terminou quando:** o escritório responder "ok".

## Passo 2: completar três cadastros

Das 87 consultoras com maleta ativa, só estas travam a nota:

| Consultora | O que falta |
| --- | --- |
| Kelly Cristina Mila Gonçalves (Garça/SP) | CEP do endereço |
| Larissa Persinato (Londrina/PR) | CPF |
| Franciele Aparecida de Oliveira (PR, CEP 86320-000) | Cidade (o CEP não identificou a cidade) |

- **Quem faz:** a equipe do cadastro, na ficha de cada pessoa.
- Outras três consultoras estão sem número da casa. A nota delas sai com "S/N", o que a SEFAZ aceita.
- A tela de prontidão diz "16 consultoras com cadastro incompleto" porque conta todas as consultoras ativas, inclusive as que não têm maleta. Os avisos "cadeia fiscal" e "acerto da maleta ainda não aplicado" são de um desenho antigo e **não impedem** a emissão pela maleta.

## Passo 3: subir o pacote 0215 + 0216

- **Quem faz:** Diego, no Lovable.
- **Como:** subir os arquivos do zip e colar `docs/lardan/PROMPT-LOVABLE-0216.md`. **Peça ao Lovable para agendar `/api/public/fiscal/processar` a cada minuto** (item 3 do prompt).
- Depois, em Integrações, clique de novo em **"Registrar aviso na Focus"**, para o aviso valer também na produção.
- **Terminou quando:** o painel **"Emissão real da NF-e (produção)"** aparece em Integrações, "Desligada — tudo em teste", sem aviso de token faltando.

## Passo 4: primeira nota real (piloto)

- **Quem faz:** Diego, como Master, com o escritório avisado.
- **Como:**
  1. Escolha uma maleta **conferida** que ainda não saiu, de uma consultora com cadastro completo, e anote o código dela (MAL-xxxxx).
  2. Em Integrações › Emissão real, digite o código em "Maleta piloto", confira o e-mail fiscal2@on4.com.br e deixe **desmarcados** "Liberar todas" e "Automático".
  3. Digite `LIGAR PRODUCAO` e clique em **"Ligar emissão real"**.
  4. Na tela da remessa dessa maleta, clique em **"Nota fiscal"**. A nota sai **real**, na série 3, nº 1.
  5. O escritório recebe a cópia sozinho. Peça a conferência.
- **Se algo der errado:** clique em **"Desligar emissão real"**. Se a SEFAZ autorizar fora da série 3, o sistema desliga sozinho e mostra o aviso vermelho no painel.

## Passo 5: liberar todas e ligar o automático

- **Quem faz:** Diego, depois do "ok" do escritório na nota piloto.
- **Como:** no painel, marque **"Liberar todas as maletas"** e, se quiser, **"Automático"**. Clique em **"Salvar regras"**.
- **Com o automático ligado:**
  - a **remessa sai sozinha** quando a maleta é conferida;
  - as **notas do acerto saem sozinhas** quando a maleta é encerrada;
  - se der erro, o sistema tenta de novo e mostra o erro no painel (Fila automática). Corrigido o motivo, use o botão da maleta.
- **Sem o automático:** a equipe usa os botões "Nota fiscal" e "Notas do acerto" na tela da remessa.

## Passo 6: virada com o SmallData

- **Quem faz:** Diego, com o escritório.
- **Maletas novas** (conferidas depois da virada): nota pelo Lardan, série 3.
- **Maletas que já saíram com nota do SmallData (série 2):** a devolução e a venda precisam citar aquela nota, então o **acerto delas continua no SmallData** até a última voltar. Se o Lardan tentar, o botão recusa com a mensagem "Maleta remetida pelo SmallData fecha o acerto pelas notas do SmallData".
- O SmallData **para de emitir remessa** no dia da virada e segue só com os acertos antigos.

## Quem faz o quê

| Quem | O quê |
| --- | --- |
| Diego | Subir 0215 + 0216; enviar as notas de teste ao escritório; nota piloto; liberar todas; virada |
| Lovable | Aplicar as migrações e agendar `/api/public/fiscal/processar` a cada minuto |
| Equipe de cadastro | Kelly (CEP), Larissa (CPF), Franciele (cidade) |
| Escritório ON4 | Conferir as notas de teste e a nota piloto |
