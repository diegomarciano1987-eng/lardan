/**
 * LARDAN — atalho para enviar a candidatura a um representante.
 *
 * O sistema monta o dossiê em PDF no servidor, guarda o arquivo com link
 * temporário e abre a conversa do WhatsApp já com o texto pronto. Não existe
 * integração: quem envia a mensagem é a pessoa, no aparelho dela.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Send } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { Button } from "@/components/ui/button";
import { linkWhatsapp } from "@/lib/crm/api";
import { gerarDossieCandidatura, listarRepresentantes } from "@/lib/crm/dossie.functions";

export function EnvioRepresentante({ leadId }: { leadId: string }) {
  const buscar = useServerFn(listarRepresentantes);
  const gerar = useServerFn(gerarDossieCandidatura);
  const [escolhido, setEscolhido] = useState("");
  const [ultimo, setUltimo] = useState<{ url: string; nome: string } | null>(null);

  const representantes = useQuery({
    queryKey: ["crm", "representantes"],
    queryFn: () => buscar(),
    staleTime: 300_000,
  });

  const envio = useMutation({
    mutationFn: async () => {
      const rep = (representantes.data ?? []).find((r) => r.id === escolhido);
      if (!rep) throw new Error("Escolha um representante.");
      const dossie = await gerar({
        data: { leadId, representanteId: rep.id, representanteNome: rep.nome },
      });
      return { rep, dossie };
    },
    onSuccess: ({ rep, dossie }) => {
      setUltimo({ url: dossie.url, nome: dossie.nome });
      const texto = [
        `Olá, ${rep.nome}! Segue uma candidatura Lardan para seu acompanhamento.`,
        "",
        `Candidata: ${dossie.nome}`,
        `Cidade: ${dossie.cidade}/${dossie.uf}`,
        `WhatsApp: ${dossie.whatsapp}`,
        `Protocolo: ${dossie.protocolo}`,
        "",
        `Dossiê completo em PDF: ${dossie.url}`,
        "(link interno, válido por 30 dias)",
      ].join("\n");
      window.open(linkWhatsapp(rep.whatsapp, texto), "_blank", "noopener,noreferrer");
      toast.success("PDF pronto. O WhatsApp abriu com a mensagem.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Panel title="Enviar informações para representante">
      <div className="space-y-3">
        <SmartSelect
          value={escolhido}
          onChange={setEscolhido}
          placeholder={
            representantes.isLoading ? "Carregando representantes..." : "Escolha o representante"
          }
          options={(representantes.data ?? []).map((r) => ({ value: r.id, label: r.nome }))}
        />
        <Button
          type="button"
          className="w-full"
          disabled={!escolhido || envio.isPending}
          onClick={() => envio.mutate()}
        >
          <Send aria-hidden className="size-4" />
          {envio.isPending ? "Montando o PDF..." : "Gerar PDF e abrir WhatsApp"}
        </Button>
        {representantes.data?.length === 0 && !representantes.isLoading && (
          <p className="text-xs text-ledger-muted">
            Nenhum representante com WhatsApp cadastrado. Cadastre o contato na ficha da pessoa.
          </p>
        )}
        {ultimo && (
          <a
            href={ultimo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-bronze"
          >
            <FileText aria-hidden className="size-3.5" />
            Abrir o PDF gerado
          </a>
        )}
        <p className="text-xs text-ledger-muted">
          O PDF contém dados pessoais da candidata e o link vale por 30 dias. Nada é enviado
          automaticamente: o WhatsApp abre com a mensagem pronta para você conferir e enviar.
        </p>
      </div>
    </Panel>
  );
}
