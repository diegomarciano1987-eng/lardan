import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { EMPRESA, ENDERECO_UMA_LINHA } from "@/lib/institucional";
import { PRIVACY_VERSION } from "@/lib/privacy";
import { breadcrumbLd, canonical, jsonLdScript, organizationLd, pageMeta, webPageLd } from "@/lib/seo";

/**
 * Aviso de privacidade citado nos formulários do site ("versão
 * PRIVACY_VERSION"). Descreve exatamente o que os formulários coletam hoje.
 * Qualquer mudança de texto aprovada pela marca exige nova versão em
 * src/lib/privacy.ts e nova data de publicação abaixo.
 */
const PUBLICADO_EM = "2026-10-05";
const PUBLICADO_EXTENSO = "5 de outubro de 2026";

const TITULO = "Aviso de Privacidade | Lardan Semijoias";
const DESCRICAO =
  "Como a Lardan trata os dados enviados pelos formulários de contato e de candidatura a consultora, com que finalidade e como exercer seus direitos pela LGPD.";

export const Route = createFileRoute("/privacidade")({
  component: PrivacidadePage,
  head: () => ({
    meta: pageMeta({ title: TITULO, description: DESCRICAO, path: "/privacidade" }),
    links: canonical("/privacidade"),
    scripts: [
      jsonLdScript([
        organizationLd(),
        { ...webPageLd({ path: "/privacidade", name: TITULO, description: DESCRICAO }), dateModified: PUBLICADO_EM },
        breadcrumbLd([
          { name: "Lardan", path: "/" },
          { name: "Aviso de privacidade", path: "/privacidade" },
        ]),
      ]),
    ],
  }),
});

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="font-display text-2xl text-foreground md:text-3xl">
        {titulo}
      </h2>
      <div className="mt-4 space-y-4 text-[0.98rem] leading-[1.75] text-foreground/85">{children}</div>
    </section>
  );
}

function PrivacidadePage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Privacidade e LGPD" title="Aviso de privacidade">
        Versão {PRIVACY_VERSION}, publicada em{" "}
        <time dateTime={PUBLICADO_EM}>{PUBLICADO_EXTENSO}</time>.
      </PageHero>

      <article className="mx-auto max-w-3xl px-6 pb-24">
        <p className="text-[1.02rem] leading-relaxed text-foreground/85">
          Este aviso explica quais dados pessoais o site lardan.com.br recebe, para que eles são
          usados, com quem podem ser compartilhados e como você exerce os direitos previstos na Lei
          Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>

        <Secao id="controlador" titulo="Quem é o responsável pelos dados">
          <p>
            O controlador dos dados é {EMPRESA.razaoSocial}, CNPJ {EMPRESA.cnpj}, titular da marca
            Lardan, com endereço em {ENDERECO_UMA_LINHA}.
          </p>
        </Secao>

        <Secao id="dados" titulo="Quais dados coletamos">
          <p>
            <strong>Formulário de contato:</strong> nome, canal e dado de contato escolhidos por você
            (por exemplo WhatsApp ou e-mail), assunto e mensagem.
          </p>
          <p>
            <strong>Candidatura a Consultora Lardan (/seja-lardan):</strong> nome e sobrenome, CPF,
            WhatsApp, e-mail, endereço com CEP, cidade e estado, e as respostas sobre objetivo
            financeiro, disponibilidade, experiência com vendas, público, motivação e sonho.
          </p>
          <p>
            <strong>Origem da visita:</strong> junto com os formulários registramos a página de
            entrada, os parâmetros de campanha do link (como utm_source) e, quando houver, o código
            de indicação de uma consultora. Para lembrar essa origem durante a navegação, o site
            guarda essa informação no armazenamento local do seu navegador, que também guarda os
            itens do carrinho.
          </p>
          <p>
            <strong>Medição de audiência:</strong> o site usa o Google Analytics para medir visitas
            de forma agregada.
          </p>
        </Secao>

        <Secao id="finalidades" titulo="Para que usamos os dados">
          <ul className="list-disc space-y-2 pl-6">
            <li>responder a mensagens enviadas pelo formulário de contato;</li>
            <li>
              analisar a candidatura a consultora, conversar com você sobre a entrada na rede e, se
              aprovada, formalizar a parceria comercial;
            </li>
            <li>
              enviar novidades e oportunidades da Lardan, somente quando você marcar essa opção no
              formulário;
            </li>
            <li>entender quais canais e páginas trazem os contatos, para melhorar o site e as campanhas.</li>
          </ul>
          <p>
            As bases legais são a execução de procedimentos preliminares a contrato feitos a seu
            pedido (candidatura), o consentimento (comunicações de marketing), o cumprimento de
            obrigações legais e o legítimo interesse na medição e na segurança do site (LGPD, art.
            7º, incisos I, II, V e IX).
          </p>
        </Secao>

        <Secao id="compartilhamento" titulo="Com quem os dados podem ser compartilhados">
          <p>
            Não vendemos dados pessoais. Eles podem ser tratados pelos fornecedores que operam o
            site e o sistema da Lardan: infraestrutura e banco de dados em nuvem, Google (Analytics),
            WhatsApp, quando você escolhe conversar por lá, e a plataforma de cobrança usada com
            consultoras aprovadas. Também podem ser informados a autoridades quando a lei exigir.
          </p>
        </Secao>

        <Secao id="retencao" titulo="Por quanto tempo guardamos">
          <p>
            Pelo tempo necessário para as finalidades acima ou pelo prazo exigido por obrigação
            legal ou regulatória. Depois disso, os dados são excluídos ou anonimizados.
          </p>
        </Secao>

        <Secao id="direitos" titulo="Seus direitos">
          <p>Pela LGPD (art. 18), você pode pedir a qualquer momento:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>confirmação de que tratamos seus dados e acesso a eles;</li>
            <li>correção de dados incompletos, inexatos ou desatualizados;</li>
            <li>anonimização, bloqueio ou eliminação de dados desnecessários;</li>
            <li>portabilidade e informação sobre com quem os dados foram compartilhados;</li>
            <li>revogação do consentimento, inclusive para comunicações de marketing.</li>
          </ul>
          <p>
            Para exercer qualquer direito, use o{" "}
            <Link to="/contato" className="text-foreground underline underline-offset-4">
              formulário de contato
            </Link>{" "}
            com o assunto "Privacidade". Você também pode apresentar reclamação à Autoridade
            Nacional de Proteção de Dados (ANPD).
          </p>
        </Secao>

        <Secao id="seguranca" titulo="Segurança">
          <p>
            A conexão com o site é criptografada (HTTPS) e o acesso aos dados recebidos é restrito à
            equipe autorizada, por login protegido.
          </p>
        </Secao>

        <Secao id="alteracoes" titulo="Alterações deste aviso">
          <p>
            Este aviso pode ser atualizado. A versão e a data no topo da página indicam o texto em
            vigor, e cada formulário registra a versão vigente no momento do envio.
          </p>
        </Secao>
      </article>
    </SiteLayout>
  );
}
