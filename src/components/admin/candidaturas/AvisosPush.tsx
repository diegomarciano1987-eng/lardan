/**
 * LARDAN — botão "Avisos no aparelho" do módulo Candidaturas do Site.
 *
 * Liga o aviso do navegador (computador e celular) para quem está logado. O
 * navegador só mostra o pedido de permissão com um clique e fora do quadro de
 * pré-visualização — os dois casos têm aviso próprio na tela.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ativarAviso,
  desativarAviso,
  dentroDeIframe,
  estadoAtual,
  type EstadoAviso,
} from "@/lib/push/cliente";
import {
  removerInscricaoPush,
  salvarInscricaoPush,
  testarAvisoPush,
} from "@/lib/push/push.functions";
import { cn } from "@/lib/utils";

export function AvisosPush() {
  const [estado, setEstado] = useState<EstadoAviso | "carregando">("carregando");
  const [ocupado, setOcupado] = useState(false);
  const [ajudaIOS, setAjudaIOS] = useState(false);
  const salvar = useServerFn(salvarInscricaoPush);
  const remover = useServerFn(removerInscricaoPush);
  const testar = useServerFn(testarAvisoPush);

  useEffect(() => {
    void estadoAtual().then(setEstado);
  }, []);

  const ligar = useCallback(async () => {
    if (estado === "ios_instalar") {
      setAjudaIOS((v) => !v);
      return;
    }
    setOcupado(true);
    try {
      const r = await ativarAviso();
      if (!r.ok) {
        setEstado(r.estado);
        if (r.estado === "ios_instalar") {
          setAjudaIOS(true);
        } else if (r.estado === "abrir_em_nova_aba") {
          toast.error("Abra o painel em uma aba do navegador para autorizar o aviso.");
        } else if (r.estado === "negado") {
          toast.error("O navegador bloqueou os avisos. Libere nas configurações do site.");
        } else {
          toast.error("Este navegador não mostra avisos.");
        }
        return;
      }
      await salvar({ data: r.inscricao });
      setEstado("ativo");
      toast.success("Avisos ligados neste aparelho.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível ligar os avisos.");
    } finally {
      setOcupado(false);
    }
  }, [salvar, estado]);

  const desligar = useCallback(async () => {
    setOcupado(true);
    try {
      const endereco = await desativarAviso();
      if (endereco) await remover({ data: { endpoint: endereco } });
      setEstado("inativo");
      toast.success("Avisos desligados neste aparelho.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível desligar.");
    } finally {
      setOcupado(false);
    }
  }, [remover]);

  const enviarTeste = useCallback(async () => {
    setOcupado(true);
    try {
      const r = await testar();
      if (r.enviados > 0) toast.success(`Aviso de teste enviado para ${r.enviados} aparelho(s).`);
      else toast.error("Nenhum aparelho recebeu. Ligue o aviso novamente.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao enviar o teste.");
    } finally {
      setOcupado(false);
    }
  }, [testar]);

  if (estado === "sem_suporte") return null;

  const ativo = estado === "ativo";
  const Icone = ocupado ? Loader2 : ativo ? BellRing : estado === "negado" ? BellOff : Bell;

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        disabled={ocupado || estado === "carregando"}
        onClick={() => void (ativo ? desligar() : ligar())}
        title={
          estado === "ios_instalar"
            ? "Ver como ligar os avisos no iPhone"
            : dentroDeIframe()
            ? "Abra o painel em uma aba do navegador para autorizar o aviso."
            : ativo
              ? "Desligar avisos neste aparelho"
              : "Receber aviso de nova candidatura neste aparelho"
        }
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[0.8125rem] font-semibold transition",
          ativo
            ? "border-bronze/40 bg-champagne-soft text-bronze"
            : "border-line bg-surface text-ledger-muted hover:text-ledger-text",
          ocupado && "opacity-60",
        )}
      >
        <Icone aria-hidden className={cn("size-4", ocupado && "animate-spin")} />
        {ativo ? "Avisos ligados" : estado === "negado" ? "Avisos bloqueados" : "Ativar avisos"}
      </button>

      {ativo ? (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void enviarTeste()}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-[0.8125rem] font-semibold text-ledger-muted transition hover:text-ledger-text"
        >
          Testar
        </button>
      ) : null}

      {ajudaIOS && createPortal(
        <div
          role="dialog"
          aria-label="Como ligar os avisos no iPhone"
          className="fixed inset-x-4 top-24 z-50 mx-auto max-w-sm rounded-xl border border-line bg-surface p-4 text-left text-[0.8125rem] leading-relaxed text-ledger-text shadow-xl"
        >
          <p className="font-semibold">No iPhone, o aviso só funciona pelo ícone do painel</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-ledger-muted">
            <li>No Safari, toque em <strong>Compartilhar</strong> (quadrado com seta).</li>
            <li>Escolha <strong>Adicionar à Tela de Início</strong> e confirme.</li>
            <li>Abra a LARDAN pelo novo ícone, entre no painel e vá em Candidaturas.</li>
            <li>Toque em <strong>Ativar avisos</strong> e permita.</li>
          </ol>
          <p className="mt-2 text-xs text-ledger-muted">Exige iOS 16.4 ou mais novo. É uma regra da Apple.</p>
          <button type="button" className="mt-3 text-xs font-semibold underline" onClick={() => setAjudaIOS(false)}>
            Entendi
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
