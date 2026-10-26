/**
 * Mapa real da cidade (ruas, bairros, zoom) com OpenStreetMap via Leaflet.
 * Uma bolinha por consultora: ativa verde e maior (sempre por cima), inativa cinza e menor,
 * borda tracejada quando a posição é aproximada. Módulo só do navegador: React.lazy + <ClientOnly>.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface PontoMapa {
  id: string;
  lat: number;
  lng: number;
  ativa: boolean;
  aproximado: boolean;
  dica: string; // HTML já escapado
}

export interface Voo {
  lat: number;
  lng: number;
  zoom: number;
  seq: number;
}

export default function MapaCidadeLeaflet({
  pontos,
  contorno,
  selecionado,
  onSelecionar,
  voo,
}: {
  pontos: PontoMapa[];
  contorno: GeoJSON.GeoJsonObject | null;
  selecionado: string | null;
  onSelecionar: (id: string) => void;
  voo: Voo | null;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);
  const contornoRef = useRef<L.GeoJSON | null>(null);
  const enquadradoRef = useRef(false);
  const cbRef = useRef(onSelecionar);
  cbRef.current = onSelecionar;

  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current, { scrollWheelZoom: true, zoomControl: true }).setView([-23.31, -51.16], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
    mapa.createPane("inativas").style.zIndex = "410";
    mapa.createPane("ativas").style.zIndex = "420";
    mapa.createPane("selecao").style.zIndex = "430";
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
    if (!enquadradoRef.current) {
      mapa.fitBounds(contornoRef.current.getBounds().pad(0.02));
    }
  }, [contorno]);

  useEffect(() => {
    const mapa = mapaRef.current;
    const camada = camadaRef.current;
    if (!mapa || !camada) return;
    camada.clearLayers();
    for (const p of pontos) {
      const sel = p.id === selecionado;
      const classe = [p.ativa ? "mapa-pt-ativa" : "mapa-pt-inativa", p.aproximado ? "mapa-pt-aprox" : "", sel ? "mapa-pt-sel" : ""].join(" ");
      const m = L.circleMarker([p.lat, p.lng], {
        radius: sel ? 12 : p.ativa ? 9 : 5,
        className: classe,
        pane: sel ? "selecao" : p.ativa ? "ativas" : "inativas",
        bubblingMouseEvents: false,
      }).bindTooltip(p.dica, { direction: "top", offset: [0, -6] });
      m.on("click", () => cbRef.current(p.id));
      camada.addLayer(m);
    }
    if (!enquadradoRef.current && pontos.length > 0) {
      const precisos = pontos.filter((p) => !p.aproximado);
      const base = precisos.length >= 3 ? precisos : pontos;
      const b = L.latLngBounds(base.map((p) => [p.lat, p.lng] as [number, number])).pad(0.08);
      enquadradoRef.current = true;
      mapa.invalidateSize();
      mapa.fitBounds(b, { maxZoom: 14 });
    }
  }, [pontos, selecionado]);

  useEffect(() => {
    if (voo && mapaRef.current) mapaRef.current.flyTo([voo.lat, voo.lng], voo.zoom, { duration: 0.8 });
  }, [voo]);

  return <div ref={divRef} className="h-[640px] w-full overflow-hidden rounded-[12px] border border-line" />;
}
