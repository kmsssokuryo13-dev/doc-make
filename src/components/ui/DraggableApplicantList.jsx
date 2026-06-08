import React, { useState } from 'react';
import { GripVertical } from 'lucide-react';

export const DraggableApplicantList = ({
  candidates,
  selectedIds,
  onToggle,
  onReorder,
  showRoles = false,
  minOne = false,
}) => {
  const [dragSrcIdx, setDragSrcIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const selectedSet = new Set(selectedIds);
  const selectedItems = selectedIds
    .map(id => candidates.find(p => p.id === id))
    .filter(Boolean);
  const unselectedItems = candidates.filter(p => !selectedSet.has(p.id));

  const handleDragStart = (e, idx) => {
    setDragSrcIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  };

  const handleDrop = (e, dropIdx) => {
    e.preventDefault();
    if (dragSrcIdx !== null && dragSrcIdx !== dropIdx) {
      const next = [...selectedIds];
      const [moved] = next.splice(dragSrcIdx, 1);
      next.splice(dropIdx, 0, moved);
      onReorder(next);
    }
    setDragSrcIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragSrcIdx(null);
    setDragOverIdx(null);
  };

  if (candidates.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-1">
      {selectedItems.map((p, idx) => (
        <div
          key={p.id}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={`flex items-center gap-1.5 p-1 rounded border text-[9px] select-none
            bg-blue-50 text-blue-700
            ${dragOverIdx === idx && dragSrcIdx !== idx ? 'border-blue-500 shadow-sm' : 'border-blue-200'}
            ${dragSrcIdx === idx ? 'opacity-40' : ''}`}
        >
          <GripVertical size={12} className="text-blue-400 cursor-grab shrink-0" />
          <input
            type="checkbox"
            className="w-3 h-3 rounded accent-blue-600"
            checked
            onChange={() => onToggle(p.id)}
          />
          <span className="truncate">
            {p.name || "(氏名未入力)"}
            {showRoles ? ` [${(p.roles || []).join("、")}]` : ''}
          </span>
        </div>
      ))}
      {unselectedItems.map((p) => (
        <label
          key={p.id}
          className="flex items-center gap-1.5 p-1 rounded border text-[9px] cursor-pointer bg-white border-slate-200 text-slate-500"
        >
          <div className="w-3 shrink-0" />
          <input
            type="checkbox"
            className="w-3 h-3 rounded"
            checked={false}
            onChange={() => onToggle(p.id)}
          />
          <span className="truncate">
            {p.name || "(氏名未入力)"}
            {showRoles ? ` [${(p.roles || []).join("、")}]` : ''}
          </span>
        </label>
      ))}
      {minOne && <p className="text-[9px] text-slate-400 mt-1">※0人にはできません（最低1人）</p>}
    </div>
  );
};
