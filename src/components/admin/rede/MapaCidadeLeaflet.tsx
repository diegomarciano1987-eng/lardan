/**
 * Mapa real da cidade (ruas, bairros, zoom) com OpenStreetMap/CARTO via Leaflet.
 * Um ponto por CEP; clicar seleciona o CEP e o painel lateral mostra as consultoras.
 * Módulo só do navegador: carregar com React.lazy dentro de <ClientOnly>.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface GrupoCep {
  chave: string;
  lat: number;
  lng: number;
  cep: string | null;
  total: number;
  ativas: number;
  aproximado: boolean;
}

function icone(g: GrupoCep, selecionado: boolean): L.DivIcon {
  const t = selecionado ? 38 : g.total > 9 ? 32 : g.total > 1 ? 27 : 20;
  const fundo = g.ativas > 0 ? "var(--rose)" : "color-mix(in oklab, var(--foreground) 78%, transparent)";
  const borda = selecionado ? "3px solid var(--bronze)" : g.aproximado ? "2px dashed var(--background)" : "2px solid var(--background)";
  return L.divIcon({
    className: "",
    html: `<div style="width:${t}px;height:${t}px;border-radius:9999px;background:${fundo};color:var(--background);
      font:600 11px/1 system-ui;display:flex;align-items:center;justify-content:center;border:${borda};
      box-shadow:0 3px 10px color-mix(in oklab, var(--foreground) 35%, transparent);opacity:${g.aproximado ? 0.8 : 1}">${g.total > 1 ? g.total : ""}</div>`,
    iconSize: [t, t],
    iconAnchor: [t / 2, t / 2],
  });
}

export default function MapaCidadeLeaflet({
  grupos,
  contorno,
  selecionado,
  onSelecionar,
}: {
  grupos: GrupoCep[];
  contorno: GeoJSON.GeoJsonObject | null;
  selecionado: string | null;
  onSelecionar: (chave: string) => void;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);
  const contornoRef = useRef<L.GeoJSON | null>(null);
  const enquadrado = useRef(false);
  const cbRef = useRef(onSelecionar);
  cbRef.current = onSelecionar;

  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current, { scrollWheelZoom: true, zoomControl: true }).setView([-23.31, -51.16], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(mapa);
    camadaRef.current = L.layerGroup().addTo(mapa);
    mapaRef.current = mapa;
    const t = setTimeout(() => mapa.invalidateSize(), 250);
    const ro = new ResizeObserver(() => mapa.invalidateSize());
    ro.observe(divRef.current);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !contorno) return;
    contornoRef.current?.remove();
    contornoRef.current = L.geoJSON(contorno, {
      style: { className: "contorno-cidade", weight: 2, fill: false, dashArray: "6 4", interactive: false },
    }).addTo(mapa);
  }, [contorno]);

  useEffect(() => {
    const mapa = mapaRef.current;
    const camada = camadaRef.current;
    if (!mapa || !camada) return;
    camada.clearLayers();
    for (const g of grupos) {
      const m = L.marker([g.lat, g.lng], {
        icon: icone(g, g.chave === selecionado),
        zIndexOffset: g.chave === selecionado ? 1000 : g.total,
        title: g.cep ? `CEP ${g.cep}` : "Sem CEP",
      }).bindTooltip(
        `<strong>${g.cep ? `CEP ${g.cep}` : "Local"}</strong><br/>${g.total} consultora(s)${g.aproximado ? "<br/><em>posição aproximada</em>" : ""}`,
        { direction: "top", offset: [0, -8] },
      );
      m.on("click", () => cbRef.current(g.chave));
      camada.addLayer(m);
    }
    if (!enquadrado.current && grupos.length > 0) {
      const precisos = grupos.filter((g) => !g.aproximado);
      const base = precisos.length >= 3 ? precisos : grupos;
      mapa.fitBounds(L.latLngBounds(base.map((g) => [g.lat, g.lng] as [number, number])).pad(0.08), { maxZoom: 15 });
      enquadrado.current = true;
    }
  }, [grupos, selecionado]);

  useEffect(() => {
    const g = grupos.find((x) => x.chave === selecionado);
    if (g && mapaRef.current) mapaRef.current.panTo([g.lat, g.lng], { animate: true });
  }, [selecionado]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={divRef} className="h-[640px] w-full overflow-hidden rounded-[12px] border border-line" />;
}
