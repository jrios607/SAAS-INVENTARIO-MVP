import React, { useRef, useEffect, useState } from "react";
import { Group, Text, Transformer, Rect } from "react-konva";
import { Html } from "react-konva-utils";

interface TextNodeProps {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  rotacion: number;
  fill: string;
  isSelected: boolean;
  isEditable: boolean;
  onSelect: () => void;
  onChange: (newAttrs: any) => void;
}

export const TextNode: React.FC<TextNodeProps> = ({
  id, x, y, text, fontSize, rotacion, fill, isSelected, isEditable, onSelect, onChange
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localText, setLocalText] = useState(text);

  const handleDoubleClick = () => {
    if (isEditable) {
      setLocalText(text);
      setIsEditing(true);
    }
  };

  return (
    <React.Fragment>
      <Group
        id={id}
        x={x}
        y={y}
        rotation={rotacion}
        draggable={isEditable && !isEditing}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDoubleClick}
        onDblTap={handleDoubleClick}
        dragBoundFunc={function (this: any, pos) {
          const stage = this.getStage();
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
          const node = e.target;
          const snapX = Math.round(node.x() / 40) * 40;
          const snapY = Math.round(node.y() / 40) * 40;
          onChange({ x: snapX, y: snapY });
        }}
        onTransformEnd={(e) => {
          const node = e.target;
          const scaleX = node.scaleX();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            x: node.x(),
            y: node.y(),
            rotacion: node.rotation(),
            fontSize: Math.max(10, fontSize * scaleX),
          });
        }}
      >
        {!isEditing ? (
          <Text
            text={text || "Doble clic para editar"}
            fontSize={fontSize}
            fill={fill}
            fontFamily="sans-serif"
            fontStyle="bold"
            align="center"
            padding={5}
          />
        ) : (
          <Html divProps={{ style: { position: 'absolute', top: 0, left: 0, pointerEvents: 'auto' } }}>
            <input
              value={localText}
              autoFocus
              className="bg-white border-2 border-blue-500 rounded px-1 outline-none shadow-lg text-slate-800"
              style={{
                fontSize: `${fontSize}px`,
                fontWeight: 'bold',
                fontFamily: 'sans-serif',
                minWidth: '50px'
              }}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => {
                setIsEditing(false);
                onChange({ text: localText });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditing(false);
                  onChange({ text: localText });
                }
              }}
            />
          </Html>
        )}
      </Group>
    </React.Fragment>
  );
};
