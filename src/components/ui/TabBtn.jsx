import React from 'react';

export function TabBtn({ active, label, onClick, icon }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-3 text-[11px] font-bold rounded-t-md transition-all border-b-2 shrink-0 ${active ? 'bg-white text-blue-600 border-blue-600 shadow-[0_-2px_4px_rgba(0,0,0,0.02)]' : 'text-gray-400 border-transparent hover:text-gray-600'}`}>
      {icon} {label}
    </button>
  );
}
