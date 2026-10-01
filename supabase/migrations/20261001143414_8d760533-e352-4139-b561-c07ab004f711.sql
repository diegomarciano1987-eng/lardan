CREATE TABLE public.help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  titulo text NOT NULL,
  categoria text NOT NULL,
  tela text,
  publico text NOT NULL DEFAULT 'consultora' CHECK (publico IN ('publico','consultora')),
  resumo text NOT NULL DEFAULT '',
  corpo text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicado')),
  ordem integer NOT NULL DEFAULT 100,
  revisado_em date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.help_articles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.help_articles TO authenticated;
GRANT ALL ON public.help_articles TO service_role;
ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ajuda pública publicada" ON public.help_articles FOR SELECT TO anon
  USING (status = 'publicado' AND publico = 'publico');
CREATE POLICY "Ajuda para quem entrou" ON public.help_articles FOR SELECT TO authenticated
  USING ((status = 'publicado' AND (publico = 'publico' OR public.has_role(auth.uid(),'consultora') OR public.is_staff(auth.uid())))
         OR public.can_manage_content(auth.uid()));
CREATE POLICY "Equipe de conteúdo mantém a ajuda" ON public.help_articles FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));
CREATE TRIGGER help_articles_updated BEFORE UPDATE ON public.help_articles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER help_articles_audit AFTER INSERT OR UPDATE OR DELETE ON public.help_articles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

INSERT INTO public.help_articles (slug, titulo, categoria, tela, publico, resumo, corpo, status, ordem) VALUES
('aceitar-convite','Como aceitar o convite da Lardan','Acesso','convite','publico',
 'Use o link do e-mail para criar sua senha e entrar.',
 E'1. Abra o e-mail do convite da Lardan no celular.\n2. Toque no botão do convite. O link vale por 48 horas.\n3. Confira se o e-mail mostrado é o seu e crie uma senha.\n4. Confirme o e-mail, se o sistema pedir.\n\nSe o link venceu ou não abre, peça um novo convite para quem convidou você. Não encaminhe o link para outra pessoa: ele é individual.', 'publicado', 10),
('entrar','Como entrar no sistema','Acesso','login','publico',
 'Entre pelo cartão certo: Operação, Consultora ou Representante.',
 E'1. Abra a tela de acesso da equipe.\n2. Toque no cartão "Consultora".\n3. Digite seu e-mail e sua senha. Toque no olhinho para ver o que digitou.\n4. Toque em "Entrar".\n\nSe aparecer "Seu acesso não está liberado para esta área", você escolheu um cartão que não é o seu ou seu acesso ainda não foi liberado. Volte e escolha o cartão certo.', 'publicado', 20),
('recuperar-senha','Esqueci minha senha','Acesso','login','publico',
 'Receba um e-mail para criar uma nova senha.',
 E'1. Na tela de entrada, toque em "Esqueci minha senha".\n2. Digite o e-mail da sua conta e confirme.\n3. Abra o e-mail da Lardan para redefinir a senha e toque no botão.\n4. Crie a nova senha.\n\nNão chegou? Olhe as pastas Spam e Promoções e espere 2 minutos antes de pedir de novo.', 'publicado', 30),
('receber-maleta','Receber e conferir a maleta','Maleta','maleta','consultora',
 'Confirme o recebimento e confira peça por peça.',
 E'1. Em "Minha maleta", confirme o recebimento quando a maleta chegar às suas mãos.\n2. Confira cada peça da lista com o que veio.\n3. Se faltar peça ou vier com defeito, informe antes de aceitar.\n4. Registre o aceite.\n\nO que acontece: as peças aceitas ficam sob sua responsabilidade e podem aparecer na sua vitrine. Se errar, fale com a Matriz.\n\nOnde ver depois: a maleta continua em "Minha maleta" e o histórico fica em "Entregas".', 'publicado', 40),
('divergencia','Peça faltando ou com defeito','Maleta','maleta','consultora',
 'O que fazer quando algo não confere.',
 E'Peças com divergência aparecem no quadro "Divergências" de "Minha maleta" e não entram no seu saldo disponível.\n\nSe encontrar peça faltando ou com defeito, avise a Matriz informando o código da maleta, a peça e o que aconteceu, por exemplo: "veio sem o fecho".', 'publicado', 50),
('vitrine-configurar','Montar sua vitrine: foto, capa e tema','Vitrine','vitrine','consultora',
 'Use o Estúdio para deixar sua página com a sua cara.',
 E'1. Em "Minha vitrine", abra "Meu perfil" e escreva seu nome público e uma frase sobre você.\n2. Em "Foto e capa", tire uma foto ou escolha da galeria, ajuste o rosto dentro da linha e confirme. Use os botões de zoom e girar se preferir não arrastar.\n3. Escolha uma capa oficial ou use a sua. Toque no ponto mais importante da imagem e confira os cortes de celular e computador.\n4. Em "Aparência", escolha tema, cores e letras.\n5. Em "Contato", informe seu WhatsApp com DDD.\n6. Toque em "Publicar alterações".\n\nTudo é salvo sozinho como rascunho. As clientes só veem depois de publicar. No celular, use "Visualizar" para ver o resultado.', 'publicado', 60),
('vitrine-organizar','Organizar as peças da vitrine','Vitrine','vitrine','consultora',
 'Destaque, esconda, ordene e crie seleções.',
 E'Em "Minha vitrine" > "Organização":\n\n• Estrela: coloca a peça nos destaques.\n• Olho: esconde a peça da vitrine. Isso não mexe no seu estoque.\n• Setas: sobem ou descem a peça na ordem (não é preciso arrastar).\n• Seleções: listas como "Para presentear".\n\nSó aparecem peças disponíveis na sua maleta. Peça vendida ou devolvida sai da vitrine sozinha.', 'publicado', 70),
('vitrine-compartilhar','Compartilhar o link e usar o WhatsApp','Vitrine','vitrine','consultora',
 'Copie o link, baixe o QR Code e receba o interesse das clientes.',
 E'1. Em "Minha vitrine" > "Compartilhar", confira o endereço da sua vitrine.\n2. Gere a imagem de apresentação no modelo Lardan.\n3. Use "Copiar link", compartilhar ou baixar o QR Code.\n\nComo a cliente faz: escolhe as peças e envia o interesse. O WhatsApp abre com a lista pronta para você.\n\nImportante: o interesse não reserva peça e não é uma compra. Você confirma disponibilidade e combina tudo no atendimento.\n\nO WhatsApp pode demorar algumas horas para mostrar a nova imagem do link.', 'publicado', 80),
('pedidos','Pedidos e entregas','Pedidos','pedidos','consultora',
 'Acompanhe os pedidos existentes e as entregas da maleta.',
 E'Em "Pedidos" você acompanha os pedidos já registrados.\n\nUm pedido só pode ser concluído quando houver venda registrada. O cadastro de clientes, o registro de venda e de pagamento pelo celular ainda estão em construção e serão explicados aqui quando estiverem disponíveis.\n\nEm "Entregas" fica o histórico de movimentações da sua maleta.', 'publicado', 90),
('recebimentos','Recebimentos de clientes e valores devidos à Lardan','Financeiro','pedidos','consultora',
 'São dois controles diferentes.',
 E'• Recebimento de cliente: o valor que a cliente paga pela peça.\n• Valor devido à Lardan: o acerto das peças vendidas da sua maleta com a Matriz.\n\nA tela de financeiro da consultora ainda não está disponível. Até lá, o acerto é feito com a Matriz.', 'publicado', 100),
('suporte','Como pedir ajuda à Lardan','Suporte',NULL,'consultora',
 'Fale com quem acompanha você na Lardan.',
 E'Se a sua dúvida não estiver aqui, fale com a pessoa da Lardan que acompanha você, pelo canal que ela passou.\n\nAo pedir ajuda, diga em qual tela estava e o que apareceu escrito. Se possível, envie uma captura da tela.', 'publicado', 110);