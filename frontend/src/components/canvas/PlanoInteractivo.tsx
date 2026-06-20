import React, { useRef, useState, useEffect } from "react";
import { Stage, Layer, Rect, Transformer, Line } from "react-konva";
import { GondolaNode } from "./GondolaNode";
import { TextNode } from "./TextNode";

interface PlanoInteractivoProps {
  layout: any[];
  decoraciones: any[];
  editMode: boolean;
  complianceData: Record<string, any>;
  onLayoutChange: (id: string, attrs: any) => boolean;
  onDecoracionChange: (id: string, attrs: any) => void;
  onItemDoubleClick: (id: string) => void;
  getAreaColor: (area: string) => { bg: string, border: string, text: string };
}

export const PlanoInteractivo: React.FC<PlanoInteractivoProps> = ({
  layout, decoraciones, editMode, complianceData, onLayoutChange, onDecoracionChange, onItemDoubleClick, getAreaColor
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fitStageIntoView = () => {
    if (!containerRef.current) return;
    if (layout.length === 0 && decoraciones.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    layout.forEach(item => {
      const isSwapped = Math.abs(item.rotacion || 0) % 180 !== 0;
      const w = isSwapped ? item.h : item.w;
      const h = isSwapped ? item.w : item.h;
      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.x + w > maxX) maxX = item.x + w;
      if (item.y + h > maxY) maxY = item.y + h;
    });

    decoraciones.forEach(dec => {
      const w = dec.w || 200;
      const h = dec.h || 50;
      if (dec.x < minX) minX = dec.x;
      if (dec.y < minY) minY = dec.y;
      if (dec.x + w > maxX) maxX = dec.x + w;
      if (dec.y + h > maxY) maxY = dec.y + h;
    });

    if (minX === Infinity) return;

    const padding = 100;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const containerW = containerRef.current.offsetWidth;
    const containerH = containerRef.current.offsetHeight;

    const scaleX = containerW / contentW;
    const scaleY = containerH / contentH;
    let newScale = Math.min(scaleX, scaleY);
    
    if (newScale > 2) newScale = 2;
    if (newScale < 0.1) newScale = 0.1;

    setScale(newScale);
    setPosition({
      x: (containerW - contentW * newScale) / 2 - minX * newScale,
      y: (containerH - contentH * newScale) / 2 - minY * newScale,
    });
  };

  useEffect(() => {
    if (!editMode && (layout.length > 0 || decoraciones.length > 0)) {
      const t = setTimeout(fitStageIntoView, 50);
      return () => clearTimeout(t);
    }
  }, [editMode, layout.length, decoraciones.length, dimensions]);

  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.offsetWidth,
        height: containerRef.current.offsetHeight,
      });
    }
  }, []);

  // Efecto para enlazar el Transformer global al nodo seleccionado
  useEffect(() => {
    if (selectedId && editMode && trRef.current && stageRef.current) {
      const node = stageRef.current.findOne('#' + selectedId);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer().batchDraw();
      } else {
        trRef.current.nodes([]);
      }
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [selectedId, editMode, layout, decoraciones]);

  const checkDeselect = (e: any) => {
    // deselect when clicked on empty area
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setSelectedId(null);
    }
  };

  const handleWheel = (e: any) => {
    if (!editMode) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let direction = e.evt.deltaY > 0 ? -1 : 1;
    if (e.evt.ctrlKey) {
      direction = e.evt.deltaY > 0 ? -1 : 1;
    }

    const scaleBy = 1.1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    // Limitar zoom
    if (newScale < 0.1 || newScale > 5) return;

    setScale(newScale);
    setPosition({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  // Generar cuadrícula de 40x40 para fondo
  const gridSize = 40;
  const mapSize = 4000;
  const gridLines = [];
  for (let i = 0; i <= mapSize / gridSize; i++) {
    gridLines.push(
      <Line
        key={`h-${i}`}
        points={[0, i * gridSize, mapSize, i * gridSize]}
        stroke="#e2e8f0"
        strokeWidth={1}
      />
    );
    gridLines.push(
      <Line
        key={`v-${i}`}
        points={[i * gridSize, 0, i * gridSize, mapSize]}
        stroke="#e2e8f0"
        strokeWidth={1}
      />
    );
  }

  // Deseleccionar al salir del modo edición y ajustar cámara
  useEffect(() => {
    if (!editMode) {
      setSelectedId(null);
    } else {
      // Opcional: si entramos a edición, tal vez restablecemos a escala 1 o lo dejamos como está
    }
  }, [editMode]);

  return (
    <div ref={containerRef} className="w-full h-[700px] bg-slate-50 overflow-hidden cursor-grab active:cursor-grabbing relative">
      <Stage
        ref={stageRef}
        width={dimensions.width || 1200}
        height={dimensions.height || 700}
        onWheel={handleWheel}
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        draggable={editMode && !selectedId} // Permitir arrastre de cámara solo en edición si no hay elemento seleccionado
        onClick={checkDeselect}
        onTap={checkDeselect}
        onDragMove={(e) => {
          if (e.target === e.target.getStage()) {
            setPosition({ x: e.target.x(), y: e.target.y() });
          }
        }}
      >
        <Layer>
          {/* Fondo cuadriculado interactivo */}
          <Rect x={0} y={0} width={mapSize} height={mapSize} fill="#f8fafc" />
          {gridLines}
          
          {decoraciones.map((dec) => (
            dec.tipo === "TEXTO" ? (
              <TextNode
                key={dec.id}
                id={dec.id}
                x={dec.x}
                y={dec.y}
                text={dec.config?.text !== undefined ? dec.config.text : "Doble clic..."}
                fontSize={dec.config?.fontSize || 24}
                rotacion={dec.rotacion || 0}
                fill={dec.config?.fill || "#334155"}
                isSelected={selectedId === dec.id}
                isEditable={editMode}
                onSelect={() => editMode && setSelectedId(dec.id)}
                onChange={(newAttrs) => onDecoracionChange(dec.id, newAttrs)}
              />
            ) : null
          ))}

          {layout.map((item) => {
            const colors = getAreaColor(item.area);
            const isSelected = selectedId === item.i;
            const compliance = complianceData[item.i]?.cumplimiento_porcentaje;

            let fillHex = "#cbd5e1";
            if (colors.bg.includes("teal")) fillHex = "#2dd4bf";
            else if (colors.bg.includes("emerald")) fillHex = "#34d399";
            else if (colors.bg.includes("red")) fillHex = "#f87171";
            else if (colors.bg.includes("amber")) fillHex = "#fbbf24";
            else if (item.isNew) fillHex = "#a7f3d0";

            let strokeHex = colors.border.includes("teal") ? "#0d9488" :
                           colors.border.includes("emerald") ? "#059669" :
                           colors.border.includes("red") ? "#dc2626" :
                           colors.border.includes("amber") ? "#d97706" : "#64748b";

            return (
              <GondolaNode
                key={item.i}
                id={item.i}
                x={item.x}
                y={item.y}
                w={item.w}
                h={item.h}
                rotacion={item.rotacion || 0}
                fill={fillHex}
                stroke={strokeHex}
                tipo={item.tipo}
                isSelected={isSelected}
                isEditable={editMode}
                compliance={compliance}
                onSelect={() => {
                  if (editMode) setSelectedId(item.i);
                }}
                onChange={(newAttrs) => {
                  return onLayoutChange(item.i, newAttrs);
                }}
                onDoubleClick={() => onItemDoubleClick(item.i)}
              />
            );
          })}

          {/* Transformer Global (Siempre al frente) */}
          {editMode && selectedId && (
            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Permitir escalar textos (que suelen tener h < 40) pero evitar cajas nulas
                if (newBox.width < 10 || newBox.height < 10) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>
      
      {/* Controles de Zoom Flotantes */}
      <div className="absolute bottom-4 right-4 flex gap-2 bg-white/80 p-2 rounded-lg shadow-sm border border-slate-200 backdrop-blur-sm z-10">
        <button 
          onClick={() => { setScale(s => s * 1.2); }}
          className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 font-bold"
        >+</button>
        <button 
          onClick={() => { setScale(s => s / 1.2); }}
          className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 font-bold"
        >-</button>
      </div>
    </div>
  );
};
