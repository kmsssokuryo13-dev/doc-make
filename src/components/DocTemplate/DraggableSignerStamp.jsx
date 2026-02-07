import React, { useState, useRef } from 'react';
import { Move } from 'lucide-react';

export const DraggableSignerStamp = ({ index, dx = 0, dy = 0, editable, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });

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

  return (
    <div
      contentEditable={false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => setIsDragging(false)}
      onPointerCancel={() => setIsDragging(false)}
      className={`${editable ? 'stamp-drag-handle' : ''} ${isDragging ? 'stamp-dragging' : ''}`}
      style={{
        position: 'absolute',
        left: `${dx}px`, top: `${dy}px`,
        width: '26.6mm', height: '26.6mm',
        border: '0.3mm dotted #666', borderRadius: '50%',
        zIndex: 100, touchAction: 'none',
        pointerEvents: 'auto',
        background: isDragging ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
      }}
    >
      {editable && !isDragging && <Move size={16} className="text-blue-500" />}
    </div>
  );
};
