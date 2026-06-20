import React, { useRef, useEffect } from "react";
import { Group, Rect, Text, Transformer, Line } from "react-konva";

interface GondolaNodeProps {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotacion: number;
  fill: string;
  stroke: string;
  tipo: string;
  isSelected: boolean;
  isEditable: boolean;
  onSelect: () => void;
  onChange: (newAttrs: any) => boolean; // Returns true if valid, false if collision
  onDoubleClick: () => void;
  compliance?: number;
}

export const GondolaNode: React.FC<GondolaNodeProps> = ({
  id, x, y, w, h, rotacion, fill, stroke, tipo, isSelected, isEditable, onSelect, onChange, onDoubleClick, compliance
}) => {
  const shapeRef = useRef<any>(null);

  const barHeight = 8;
  const fillWidth = (compliance !== undefined && compliance !== null) ? (compliance / 100) * w : 0;
  let barColor = "transparent";
  if (compliance !== undefined && compliance !== null) {
    if (compliance >= 80) barColor = "#10b981"; 
    else if (compliance >= 50) barColor = "#f59e0b";
    else barColor = "#ef4444"; 
  }

  // Draw shelf lines for realism
  const isVertical = h >= w;
  const numShelves = Math.max(1, Math.floor((isVertical ? h : w) / 25));
  const shelves = [];
  for (let i = 1; i < numShelves; i++) {
    const pos = i * ((isVertical ? h : w) / numShelves);
    shelves.push(
      <Line
        key={i}
        points={isVertical ? [0, pos, w, pos] : [pos, 0, pos, h]}
        stroke={stroke}
        strokeWidth={1}
        opacity={0.3}
      />
    );
  }

  return (
    <React.Fragment>
      <Group
        id={id}
        x={x}
        y={y}
        width={w}
        height={h}
        rotation={rotacion}
        draggable={isEditable}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        ref={shapeRef}
        dragBoundFunc={(pos) => {
          const stage = shapeRef.current?.getStage();
          if (!stage) return pos;
          const transform = stage.getAbsoluteTransform().copy();
          transform.invert();
          const localPos = transform.point(pos);
          return stage.getAbsoluteTransform().point({
            x: Math.round(localPos.x / 40) * 40,
            y: Math.round(localPos.y / 40) * 40,
          });
        }}
        onDragEnd={(e) => {
          const node = shapeRef.current;
          const snapX = Math.round(node.x() / 40) * 40;
          const snapY = Math.round(node.y() / 40) * 40;
          const success = onChange({
            x: snapX,
            y: snapY,
            w, h, rotacion
          });
          if (!success) {
            // Revert position on collision
            node.x(x);
            node.y(y);
            node.getLayer().batchDraw();
          }
        }}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          
          node.scaleX(1);
          node.scaleY(1);
          
          const newW = Math.max(40, Math.round((node.width() * scaleX) / 40) * 40);
          const newH = Math.max(40, Math.round((node.height() * scaleY) / 40) * 40);
          const newX = Math.round(node.x() / 40) * 40;
          const newY = Math.round(node.y() / 40) * 40;
          const newRot = Math.round(node.rotation() / 90) * 90; // Snap rotation to 90 deg for grid

          const success = onChange({
            x: newX,
            y: newY,
            w: newW,
            h: newH,
            rotacion: newRot,
          });

          if (!success) {
            // Revert on collision
            node.x(x);
            node.y(y);
            node.width(w);
            node.height(h);
            node.rotation(rotacion);
            node.getLayer().batchDraw();
          } else {
            node.x(newX);
            node.y(newY);
            node.width(newW);
            node.height(newH);
            node.rotation(newRot);
          }
        }}
      >
        <Rect
          width={w}
          height={h}
          fill={fill}
          stroke={isSelected ? "#2563eb" : stroke} 
          strokeWidth={isSelected ? 3 : 2}
          cornerRadius={6}
          shadowColor={isSelected ? "#3b82f6" : "#0f172a"}
          shadowBlur={isSelected ? 10 : 8}
          shadowOffset={{ x: 0, y: isSelected ? 4 : 4 }}
          shadowOpacity={isSelected ? 0.5 : 0.2}
        />
        
        {/* Render Shelves */}
        {shelves}

        {/* Compliance Bar */}
        {(compliance !== undefined && compliance !== null) && (
          <Rect
            x={0}
            y={h - barHeight}
            width={fillWidth}
            height={barHeight}
            fill={barColor}
            cornerRadius={[0, 0, 6, 6]}
          />
        )}

        <Text
          text={id.startsWith("temp_") ? "NUEVO" : id}
          fontSize={11}
          fontFamily="Inter, sans-serif"
          fontStyle="bold"
          fill={isSelected ? "#1e3a8a" : "#334155"} 
          width={w}
          align="center"
          verticalAlign="middle"
          y={h / 2 - 12}
          listening={false}
          wrap="none"
          ellipsis={true}
          padding={4}
        />
        <Text
          text={tipo.toUpperCase()}
          fontSize={7}
          fontFamily="Inter, sans-serif"
          fontWeight={600}
          fill="#64748b" 
          width={w}
          align="center"
          y={h / 2 + 4}
          listening={false}
          wrap="none"
          ellipsis={true}
          padding={2}
        />
      </Group>
    </React.Fragment>
  );
};
