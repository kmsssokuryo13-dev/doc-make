import React from 'react';
import { Minus, Plus } from 'lucide-react';

export const DocRow = ({ name, count, isRequired, sources, onChange }) => (
  <div className={`p-4 rounded-xl border-2 bg-white transition-all flex items-center justify-between ${count > 0 ? 'border-blue-400 shadow-sm' : 'border-slate-100 opacity-60'}`}>
    <div className="flex-1 font-bold">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold text-slate-800">{name}</span>
        {isRequired && <span className="text-[8px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter shadow-sm">Required</span>}
      </div>
      <div className="flex flex-wrap gap-1 text-slate-400 font-bold">{sources.map(s => <span key={s} className="text-[8px] text-slate-400 bg-slate-50 px-1 rounded border border-slate-100 font-bold">{s}</span>)}</div>
    </div>
    <div className="flex items-center gap-4 shrink-0 ml-4 font-bold">
      <button onClick={() => onChange(-1)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Minus size={16}/></button>
      <span className="w-4 text-center font-mono font-bold text-sm">{count}</span>
      <button onClick={() => onChange(1)} className="p-1.5 rounded bg-slate-100 hover:bg-blue-600 hover:text-white transition-all active:scale-95 text-blue-600 font-black"><Plus size={16}/></button>
    </div>
  </div>
);
