import * as React from "react";
import { Button } from "@/components/ui/button";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { MANUAL_CUIDADOS_URL } from "@/lib/consultora-regras";
const modelos = [
  { id: "abordagem", nome: "Abordagem", texto: "Olá! Tudo bem? Posso mostrar algumas semijoias da minha maleta Lardan? O que você mais gosta de usar?" },
  { id: "preco", nome: "Está caro", texto: "Entendo. Podemos olhar outras peças dentro do valor que você quer investir. Você prefere brincos, colares ou pulseiras?" },
  { id: "pensar", nome: "Vou pensar", texto: "Claro, fique à vontade! Se quiser, posso enviar a foto e os detalhes para você olhar com calma. Quando posso falar com você de novo?" },
  { id: "pos", nome: "Pós-venda", texto: `Olá! Como ficou sua semijoia? Segue o manual de cuidados da Lardan, com garantia de dois anos seguindo as orientações de uso: ${MANUAL_CUIDADOS_URL}` },
  { id: "cobranca", nome: "Cobrança gentil", texto: "Olá! Tudo bem? Passando para lembrar do pagamento que combinamos. Quer que eu envie o link novamente?" },
];
export function MensagensProntas() {
  const [tipo, setTipo] = React.useState("abordagem");
  const [texto, setTexto] = React.useState(modelos[0]?.texto ?? "");
  return <section className="border-t border-border py-5"><h2 className="mb-4 text-xl font-semibold">Mensagens prontas</h2><SmartSelect value={tipo} options={modelos.map((m) => ({ value: m.id, label: m.nome }))} onChange={(v) => { setTipo(v); setTexto(modelos.find((m) => m.id === v)?.texto ?? ""); }} /><label className="mt-4 block" htmlFor="mensagem-pronta">Sua mensagem</label><textarea id="mensagem-pronta" className="admin-input mt-2 min-h-40" value={texto} onChange={(e) => setTexto(e.target.value)} /><Button asChild variant="outline" className="mt-3 min-h-12"><a target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(texto)}`}>Enviar pelo WhatsApp</a></Button></section>;
}