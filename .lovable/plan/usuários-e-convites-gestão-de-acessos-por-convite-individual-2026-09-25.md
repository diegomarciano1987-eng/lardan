# Usuários e convites — gestão de acessos por convite individual

Já aplicado nesta rodada: uma pessoa por conta de acesso (restrição no banco, sem duplicidades existentes) e leitor de entrada recusando peças expedidas/em trânsito sem aceite.

## O que será entregue

1. **Permissões separadas de convidar**
   - `access.invite.consultora` (candidaturas: só consultoras aprovadas), `access.invite.representante`, `access.invite.colaborador` (RH, apenas papéis liberados pelo Master).
   - Master, financeiro e administração privilegiada: só o Master concede.
   - Consultora/representante nunca convidam. Tudo conferido no banco.

2. **Convite ligado à pessoa certa**
   - Seleciona cadastro existente (busca no servidor), confere e-mail, marca só os papéis permitidos.
   - Guarda pessoa, e-mail, papéis, autor, validade (48 h), histórico. Token guardado só como hash.
   - Conflitos (pessoa já com conta, e-mail de outra conta) aparecem e nada é sobrescrito.

3. **Aceite**
   - Página pública `/convite/:token` (celular e computador): mensagens para vencido, usado, revogado, e-mail diferente.
   - Pessoa nova: cria conta com o e-mail do convite e confirma pelo e-mail do sistema de autenticação; já tem conta: faz login e aceita.
   - Aceite atômico no banco: confere e-mail verificado pelo Auth, vincula pessoa, concede papéis, consome convite — repetir não duplica; dois aceites simultâneos, só um vale.
   - Criação automática de pessoa no aceite desligada (usa a pessoa do convite).
   - Login com Google sem convite válido não ganha acesso operacional.

4. **Tela "Usuários e convites"** (substitui a atual Usuários)
   - Busca, paginação, situações: pendente, aceito, expirado, revogado, falha de envio.
   - Convidar, reenviar (invalida o anterior, limite de reenvios), revogar, bloquear/desbloquear.
   - Botão "Compartilhar no WhatsApp" com o link do convite (não confirma e-mail).

5. **Proteção**
   - Bloqueio vale na hora: toda rotina protegida confere usuário ativo, mesmo com sessão aberta.
   - Recuperação de senha (`/redefinir-senha`).
   - Autenticador por aplicativo: primeiro tela para os administradores atuais cadastrarem; depois obrigatório para quem administra acessos ou financeiro (checado no banco pelo nível da sessão). Opcional para consultoras.
   - Auditoria de convites, aceites, bloqueios, papéis e vínculos.

6. **Envio de e-mail**
   - Verifico o domínio de envio do projeto; se não houver, configuro o domínio lardan.com.br (exige registros DNS que você precisa adicionar). Falha de envio fica marcada como "falha", nunca como "enviado".

## Validação
Ambiente isolado: aceite correto, expirado, revogado, repetido, e-mail errado, troca de pessoa/papel, sem permissão, aceites simultâneos, bloqueado com sessão aberta, isolamento entre duas consultoras, remessa sem aceite no leitor. Navegador em celular e computador sem convidar pessoas reais.

## Pontos de atenção
- O autenticador obrigatório só liga depois que você e os demais administradores cadastrarem, para ninguém ficar trancado.
- Envio real de e-mail depende da configuração de DNS do domínio.
- É uma entrega grande: cerca de 2 rodadas de trabalho.
