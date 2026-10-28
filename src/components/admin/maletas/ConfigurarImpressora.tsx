import { useState } from "react";
import { Settings2, Save, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfigPedido } from "@/components/admin/config/PedidoEPreco";
import { TelefonesColaboradoras } from "./TelefonesColaboradoras";
import { lerImpressoras, salvarImpressoras, IMPRESSORAS_VAZIAS } from "@/lib/impressoras";

export function ConfigurarImpressora() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(IMPRESSORAS_VAZIAS);
  const master = useAdminRoles().includes("master" as never);
  return <>
    <Button variant="outline" onClick={() => { setConfig(lerImpressoras()); setOpen(true); }}><Settings2 />Configurar impressora</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="admin-scope z-[170] max-h-[88vh] max-w-3xl overflow-y-auto text-ledger-text">
        <DialogHeader><DialogTitle>Impressão de Remessas</DialogTitle><DialogDescription>Preferências da estação e dados oficiais do pedido.</DialogDescription></DialogHeader>
        <Tabs defaultValue="impressoras">
          <TabsList><TabsTrigger value="impressoras"><Settings2 className="mr-2 size-4" />Impressoras</TabsTrigger><TabsTrigger value="pedido"><FileText className="mr-2 size-4" />Textos e Pix</TabsTrigger><TabsTrigger value="colaboradoras">Por colaboradora</TabsTrigger></TabsList>
          <TabsContent value="impressoras" className="space-y-6 pt-4">
            <label className="grid gap-2 text-sm"><span className="font-semibold">Impressora A4 — pedido, romaneio e promissória</span><input className="admin-input" aria-label="Impressora A4" placeholder="Nome exato da impressora instalada" maxLength={160} value={config.a4} onChange={(e) => setConfig({ ...config, a4: e.target.value })} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold">Impressora de etiquetas</span><input className="admin-input" aria-label="Impressora de etiquetas" placeholder="Nome exato da Argox instalada" maxLength={160} value={config.etiquetas} onChange={(e) => setConfig({ ...config, etiquetas: e.target.value })} /></label>
            <p className="text-sm text-ledger-muted">Salvo somente neste navegador e computador. O navegador não permite listar ou selecionar impressoras pelo LARDAN: confira o nome indicado ao imprimir. A preferência do Windows não é alterada.</p>
            <p className="text-sm text-ledger-muted">A4: retrato, 100%, sem cabeçalhos e rodapés. Etiquetas: suporte 100 × 15 mm, 100%, sem margens. Calibração da Argox continua em Imprimir etiquetas → Ajustes desta estação. Não use impressão automática com dois destinos.</p>
            <Button onClick={() => { try { salvarImpressoras(config); toast.success("Preferências de impressão salvas nesta estação."); setOpen(false); } catch { toast.error("Este navegador não permitiu salvar as preferências."); } }}><Save />Salvar impressoras</Button>
          </TabsContent>
          <TabsContent value="pedido" className="pt-4"><ConfigPedido master={master} /></TabsContent>
          <TabsContent value="colaboradoras" className="pt-4"><TelefonesColaboradoras master={master} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  </>;
}