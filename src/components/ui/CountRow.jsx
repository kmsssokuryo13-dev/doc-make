import React from 'react';
import { Minus, Plus } from 'lucide-react';

export const CountRow = ({ label, count, onChange }) => (
  <div className={`p-4 rounded-xl border-2 transition-all flex items-center justify-between ${count > 0 ? 'bg-white border-blue-500 shadow-md' : 'bg-white border-slate-100 opacity-60'}`}>
    <span className="font-bold text-slate-700">{label}</span>
    <div className="flex items-center gap-4 font-bold">
      <button onClick={() => onChange(-1)} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-500 transition-colors"><Minus size={14}/></button>
      <span className="w-6 text-center font-mono font-bold text-lg">{count}</span>
      <button onClick={() => onChange(1)} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center hover:bg-slate-700 text-white shadow-lg transition-colors"><Plus size={16}/></button>
    </div>
  </div>
);
