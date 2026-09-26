# Separar o login da loja do login do sistema LARDAN

## Objetivo
Duas portas que nunca se misturam:
- **Loja (clientes):** "Minha conta" continua com o botão **Entrar com Google**, mas serve só para quem compra no site. Nunca leva ao sistema.
- **Sistema LARDAN (equipe):** uma tela nova, com a identidade da marca, em que a pessoa escolhe entre 3 portas: **Operação**, **Consultora** e **Representante**.

## 1. Minha conta (loja)
- Nova página "Minha conta" no ícone do topo da loja.
- Entrada com Google ou e-mail, e cadastro para clientes.
- Depois de entrar, a pessoa vê só a própria conta de cliente: nome, e-mail e o botão de sair. Hoje não existe histórico de pedidos online (o pagamento online não está ativo), então a página mostra "sem pedidos" em vez de inventar dados.
- Se alguém da equipe entrar por aqui, continua na área de cliente. Não existe atalho daqui para o sistema.

## 2. Tela de acesso da equipe
- Endereço próprio (por exemplo `/equipe`), fora do topo da loja, com um link discreto no rodapé.
- Visual premium no estilo da marca: logo LARDAN, fundo creme e 3 cartões grandes:
  - **Operação**: colaboradores (painel administrativo)
  - **Consultora**: portal da consultora
  - **Representante**: portal do representante
- Ao escolher uma porta, aparece o login (e-mail e senha, verificação em duas etapas quando exigida e "esqueci minha senha").
- Depois do login, o sistema confere se a pessoa tem permissão para aquela porta:
  - Tem permissão: entra na área correspondente.
  - Não tem: "Seu acesso não está liberado para esta área", sem mostrar nada interno. A tentativa fica registrada na auditoria.
- Nesta tela não há botão do Google. A equipe entra só com e-mail e senha, pelo convite.

## 3. Representante
- Hoje ainda não existe uma área do representante no sistema. A porta aparece, mas quem entrar vê "Área em preparação" até essa área ser construída, em outra etapa.

## Detalhes técnicos
- Nova rota pública `/minha-conta` (cliente). O link "Minha conta" do HeaderAcoes passa a apontar para ela. O login com Google volta para `/minha-conta`.
- Nova rota pública `/equipe` com a escolha da porta via parâmetro (`?area=operacao|consultora|representante`). Depois do login, a permissão é verificada no servidor (papéis existentes via has_role), e só então a pessoa é redirecionada para `/admin`, `/consultora` ou a página de representante.
- A rota `/acesso` atual redireciona para `/equipe`. Os links de convite e de redefinição de senha passam a apontar para `/equipe`.
- O portão das rotas protegidas continua o mesmo. Um cliente logado que tentar abrir `/admin` diretamente cai em "acesso não liberado", nunca no painel.
- Nada muda em permissões, convites, financeiro ou catálogo.
