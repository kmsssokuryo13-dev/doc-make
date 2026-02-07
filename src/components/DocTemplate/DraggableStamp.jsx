import React, { useState, useRef } from 'react';
import { Move } from 'lucide-react';

export const DraggableStamp = ({ index, dx = 0, dy = 0, editable, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const baseRightMm = 15 + index * (26.6 + 2);
  const baseTopMm = 5;

  const handlePointerDown = (e) => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true); startPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !editable) return;
    const diffX = e.clientX - startPos.current.x;
    const diffY = e.clientY - startPos.current.y;
    onChange?.(index, dx + diffX, dy + diffY);
    startPos.current = { x: e.clientX, y: e.clientY };
  };

  const stopDrag = () => setIsDragging(false);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      className={`stamp-circle ${editable ? 'stamp-drag-handle' : ''} ${isDragging ? 'stamp-dragging' : ''}`}
      style={{
        position: 'absolute',
        top: `calc(${baseTopMm}mm + ${dy}px)`,
        right: `calc(${baseRightMm}mm - ${dx}px)`,
        width: '26.6mm', height: '26.6mm',
        border: '0.3mm dotted #666', borderRadius: '50%',
        zIndex: 2000, touchAction: 'none',
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isDragging ? 'rgba(96, 165, 250, 0.1)' : 'transparent'
      }}
    >
      {editable && !isDragging && <Move size={16} className="text-blue-500" />}
    </div>
  );
};
