"use client";

import React, { useEffect, useState } from "react";
import {
  getPatentesBodega,
  getStockBodegaZona,
  BodegaPatente,
  BodegaStockSato
} from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackageOpen, Snowflake, Map as MapIcon, Loader2, AlertTriangle, Layers } from "lucide-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/es";

dayjs.extend(relativeTime);
dayjs.locale("es");

export default function PlanoBodegaPage() {
  const [zonas, setZonas] = useState<BodegaPatente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado Modal
  const [selectedPatente, setSelectedPatente] = useState<BodegaPatente | null>(null);
  const [stockZone, setStockZone] = useState<BodegaStockSato[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);

  useEffect(() => {
    fetchZonas();
  }, []);

  const fetchZonas = async () => {
    setLoading(true);
    try {
      const data = await getPatentesBodega();
      setZonas(data);
    } catch (err: any) {
      setError(err.message || "Error al cargar el mapa de bodega");
    } finally {
      setLoading(false);
    }
  };

  const handleZoneClick = async (zona: BodegaPatente) => {
    setSelectedPatente(zona);
    setLoadingStock(true);
    try {
      const data = await getStockBodegaZona(zona.id_patente);
      setStockZone(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStock(false);
    }
  };

  const getZoneColor = (tipo: string) => {
    switch (tipo) {
      case "CAMARA_FRIO":
      case "CAMARA_CONGELADOS":
        return "bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20";
      case "BODEGA_SECOS":
      default:
        return "bg-[#121212] border border-[#1f1f1f] text-gray-200 hover:bg-[#1a1a1a]";
    }
  };

  const getZoneIcon = (tipo: string) => {
    switch (tipo) {
      case "CAMARA_FRIO":
      case "CAMARA_CONGELADOS":
        return <Snowflake className="w-6 h-6 text-cyan-400" />;
      case "BODEGA_SECOS":
      default:
        return <PackageOpen className="w-6 h-6 text-gray-500" />;
    }
  };

  // Determinar tamaño de la grilla (mínimo 10x10)
  const maxCols = Math.max(10, ...zonas.map(z => z.coordenada_x + z.ancho - 1));
  const maxRows = Math.max(10, ...zonas.map(z => z.coordenada_y + z.largo - 1));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto pb-10 animate-in fade-in zoom-in-95 duration-300">
      {/* Cabecera */}
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-white mb-1">Mapa virtual de Bodega</h1>
        <p className="text-gray-500 text-sm tracking-wide mb-8">Gestión de espacio y capacidades por zonas. (Secos, Frío, etc.)</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl ">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Renderizado de la Grilla 2D */}
      <div className="bg-[#121212] p-6 border border-[#1f1f1f] rounded-2xl  overflow-x-auto">
        {loading ? (
          <div className="h-[500px] flex items-center justify-center text-gray-600">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <div
            className="grid gap-4 bg-[#0a0a0a] p-6 rounded-xl border border-[#1f1f1f]/50 min-w-[800px] min-h-[500px]"
            style={{
              gridTemplateColumns: `repeat(${maxCols}, minmax(80px, 1fr))`,
              gridTemplateRows: `repeat(${maxRows}, minmax(80px, 1fr))`,
            }}
          >
            {zonas.map((zona) => (
              <div
                key={zona.id_patente}
                onClick={() => handleZoneClick(zona)}
                className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer  flex flex-col justify-between ${getZoneColor(zona.tipo_ubicacion)}`}
                style={{
                  gridColumn: `${zona.coordenada_x} / span ${zona.ancho}`,
                  gridRow: `${zona.coordenada_y} / span ${zona.largo}`,
                }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg leading-tight">{zona.area_pasillo}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wider opacity-70">
                      {zona.tipo_ubicacion.replace("_", " ")}
                    </span>
                  </div>
                  {getZoneIcon(zona.tipo_ubicacion)}
                </div>

                <div className="mt-4 flex gap-2">
                  <div className="bg-[#121212]/60 px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1">
                    <Layers size={14} /> {zona.pallets} Pallets
                  </div>
                  <div className="bg-[#121212]/60 px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1">
                    <PackageOpen size={14} /> {zona.unidades} u.
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drill-Down Modal para Ver Stock */}
      <Dialog open={!!selectedPatente} onOpenChange={(open) => !open && setSelectedPatente(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0 bg-[#0a0a0a] border-[#1f1f1f] text-white">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl flex items-center justify-between">
              <div className="">
                {selectedPatente && getZoneIcon(selectedPatente.tipo_ubicacion)}
                Stock en Zona: {selectedPatente?.area_pasillo}
              </div>
              <span className="text-sm font-normal text-gray-500 bg-[#1a1a1a] px-3 py-1 rounded-full border border-[#1f1f1f]">
                {selectedPatente?.id_patente}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-6 pt-2">
            {loadingStock ? (
              <div className="py-20 flex justify-center text-gray-600">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : stockZone.length === 0 ? (
              <div className="py-12 text-center text-gray-500 bg-[#0a0a0a] rounded-xl border border-dashed border-[#1f1f1f]">
                <PackageOpen className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p>La zona está vacía.</p>
              </div>
            ) : (
              <div className="border border-[#1f1f1f] rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#0a0a0a] text-gray-400 font-semibold border-b border-[#1f1f1f]">
                    <tr>
                      <th className="px-4 py-3">Prioridad FEFO</th>
                      <th className="px-4 py-3">LPN (Contenedor)</th>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Producto</th>
                      <th className="px-4 py-3 text-right">Cantidad</th>
                      <th className="px-4 py-3 text-right">Vencimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/30">
                    {stockZone.map((sato, index) => {
                      const isVencido = sato.fecha_vencimiento && dayjs(sato.fecha_vencimiento).isBefore(dayjs(), 'day');
                      const isProximo = sato.fecha_vencimiento && dayjs(sato.fecha_vencimiento).isBefore(dayjs().add(7, 'day'), 'day');

                      return (
                        <tr key={sato.sato_id} className={`hover:bg-[#0a0a0a] transition-colors ${isVencido ? 'bg-red-500/10' : isProximo ? 'bg-amber-500/10' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-500">
                            #{index + 1}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-300 bg-[#1a1a1a] px-1 rounded inline-block mt-2">
                            {sato.lpn}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 text-xs">
                            {sato.sku}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-200">
                            {sato.nombre}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-gray-300">
                            {sato.cantidad} u.
                          </td>
                          <td className="px-4 py-3 text-right">
                            {sato.fecha_vencimiento ? (
                              <div className="flex flex-col items-end">
                                <span className={`font-semibold ${isVencido ? 'text-red-400' : isProximo ? 'text-amber-400' : 'text-gray-400'}`}>
                                  {dayjs(sato.fecha_vencimiento).format("DD/MM/YYYY")}
                                </span>
                                <span className="text-xs text-gray-600 capitalize">
                                  {dayjs(sato.fecha_vencimiento).fromNow()}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-600">Sin fecha</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
