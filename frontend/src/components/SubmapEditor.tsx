import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Save, Grid, Plus, Minus, X } from "lucide-react";
import { Producto } from "@/services/api";

interface SubmapEditorProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  productosAsignados: string[];
  productosCatalogo: Producto[];
  initialGridData: any;
  onSave: (gridData: any) => void;
}

interface CellData {
  id: string;
  coordenadas: [number, number];
  sku_asignado: string | null;
}

export function SubmapEditor({ isOpen, onClose, imageUrl, productosAsignados, productosCatalogo, initialGridData, onSave }: SubmapEditorProps) {
  const [filas, setFilas] = useState(4);
  const [columnas, setColumnas] = useState(5);
  const [celdas, setCeldas] = useState<CellData[]>([]);

  useEffect(() => {
    if (initialGridData && initialGridData.filas && initialGridData.columnas) {
      setFilas(initialGridData.filas);
      setColumnas(initialGridData.columnas);
      setCeldas(initialGridData.celdas || []);
    } else {
      const initialCeldas: CellData[] = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) {
          initialCeldas.push({ id: `f${r}_c${c}`, coordenadas: [r, c], sku_asignado: null });
        }
      }
      setCeldas(initialCeldas);
    }
  }, [initialGridData, isOpen]);

  useEffect(() => {
    setCeldas((prev) => {
      const newCeldas: CellData[] = [];
      for (let r = 0; r < filas; r++) {
        for (let c = 0; c < columnas; c++) {
          const existing = prev.find((cell) => cell.coordenadas[0] === r && cell.coordenadas[1] === c);
          if (existing) {
            newCeldas.push(existing);
          } else {
            newCeldas.push({ id: `f${r}_c${c}`, coordenadas: [r, c], sku_asignado: null });
          }
        }
      }
      return newCeldas;
    });
  }, [filas, columnas]);

  const handleCellSkuChange = (r: number, c: number, sku: string) => {
    setCeldas((prev) =>
      prev.map((cell) =>
        cell.coordenadas[0] === r && cell.coordenadas[1] === c ? { ...cell, sku_asignado: sku || null } : cell
      )
    );
  };

  const handleSave = () => {
    const payload = {
      filas,
      columnas,
      celdas: celdas.filter((c) => c.sku_asignado),
    };
    onSave(payload);
  };

  const getSkuName = (sku: string) => {
    const prod = productosCatalogo.find((p) => p.sku === sku);
    return prod ? prod.nombre : sku;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-4 bg-slate-50 overflow-hidden">
        
        {/* Cabecera Responsiva */}
        <DialogHeader className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-4 border-b border-slate-200">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <DialogTitle className="text-emerald-800 flex items-center gap-2 text-lg sm:text-xl">
              <Grid size={20} /> Editor de Submapeo
            </DialogTitle>
            <button onClick={onClose} className="sm:hidden p-1 text-slate-400 hover:bg-slate-200 rounded-md">
              <X size={20} />
            </button>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border shadow-sm">
              <Label className="font-bold text-slate-700 text-xs sm:text-sm">Filas:</Label>
              <button onClick={() => setFilas(Math.max(1, filas - 1))} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Minus size={14}/></button>
              <span className="w-5 text-center font-mono text-sm">{filas}</span>
              <button onClick={() => setFilas(Math.min(20, filas + 1))} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Plus size={14}/></button>
            </div>
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border shadow-sm">
              <Label className="font-bold text-slate-700 text-xs sm:text-sm">Cols:</Label>
              <button onClick={() => setColumnas(Math.max(1, columnas - 1))} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Minus size={14}/></button>
              <span className="w-5 text-center font-mono text-sm">{columnas}</span>
              <button onClick={() => setColumnas(Math.min(20, columnas + 1))} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Plus size={14}/></button>
            </div>
          </div>
        </DialogHeader>

        {/* Zona de Dibujo */}
        <div className="flex-1 min-h-0 relative bg-slate-200/50 rounded-xl border border-slate-300 overflow-auto flex items-center justify-center p-2 sm:p-4">
          <div className="relative shadow-2xl rounded-sm flex bg-white max-w-full">
            <img 
              src={imageUrl} 
              alt="Planograma" 
              className="block max-w-full max-h-[70vh] object-contain pointer-events-none"
              draggable={false}
            />
            <div 
              className="absolute inset-0 grid"
              style={{
                gridTemplateRows: `repeat(${filas}, minmax(0, 1fr))`,
                gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`
              }}
            >
              {celdas.map((cell) => {
                const r = cell.coordenadas[0];
                const c = cell.coordenadas[1];
                return (
                  <div 
                    key={cell.id} 
                    className="border border-emerald-400/50 hover:bg-emerald-500/20 transition-colors relative group flex items-center justify-center"
                    style={{ gridRow: r + 1, gridColumn: c + 1 }}
                  >
                    {/* Visualizer when has SKU */}
                    {cell.sku_asignado ? (
                      <div className="absolute inset-[2px] bg-emerald-600/90 rounded-[3px] flex items-center justify-center p-1 pointer-events-none shadow-md border border-emerald-400 backdrop-blur-sm z-0">
                        <span className="text-white text-[8px] sm:text-[10px] md:text-xs font-bold text-center leading-tight line-clamp-2 md:line-clamp-3 drop-shadow-md">
                          {getSkuName(cell.sku_asignado)}
                        </span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-30 group-hover:opacity-100 transition-opacity pointer-events-none z-0">
                        <Plus size={16} className="text-emerald-700 drop-shadow-sm bg-white/50 rounded-full" />
                      </div>
                    )}
                    
                    {/* Selector Overlay ALWAYS ACTIVE, completely transparent so native select opens */}
                    <select
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      value={cell.sku_asignado || ""}
                      onChange={(e) => handleCellSkuChange(r, c, e.target.value)}
                      title="Seleccionar Producto"
                    >
                      <option value="" disabled={!cell.sku_asignado}>-- Asignar SKU --</option>
                      {cell.sku_asignado && <option value="">(Remover de esta celda)</option>}
                      {productosAsignados.map(sku => (
                        <option key={sku} value={sku}>{getSkuName(sku)}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Pie de modal */}
        <DialogFooter className="shrink-0 pt-4 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button onClick={onClose} className="w-full sm:w-auto px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex justify-center items-center gap-2 shadow-lg hover:shadow-xl transition-all">
            <Save size={18} /> Guardar Submapeo
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
