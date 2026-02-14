import React, { useState, useRef } from 'react';
import { Move } from 'lucide-react';

export const DraggableSignerStamp = ({ index, dx = 0, dy = 0, editable, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const dragAxis = useRef(null);
  const startDxDy = useRef({ dx: 0, dy: 0 });

  const handlePointerDown = (e) => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true);
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    startDxDy.current = { dx, dy };
    dragAxis.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !editable) return;
    let diffX = e.clientX - dragOrigin.current.x;
    let diffY = e.clientY - dragOrigin.current.y;
    if (e.shiftKey) {
      if (dragAxis.current === null) {
        if (Math.abs(diffX) > 3 || Math.abs(diffY) > 3) {
          dragAxis.current = Math.abs(diffX) >= Math.abs(diffY) ? 'x' : 'y';
        }
      }
      if (dragAxis.current === 'x') diffY = 0;
      else if (dragAxis.current === 'y') diffX = 0;
      else { diffX = 0; diffY = 0; }
    } else {
      dragAxis.current = null;
    }
    const snap = v => Math.round(v / 7) * 7;
    onChange?.(index, snap(startDxDy.current.dx + diffX), snap(startDxDy.current.dy + diffY));
  };

  const stopDrag = () => { setIsDragging(false); dragAxis.current = null; };

  return (
    <div
      contentEditable={false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
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
