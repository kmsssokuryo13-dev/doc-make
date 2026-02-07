import React from 'react';
import { Map as MapIcon, Plus, Trash2 } from 'lucide-react';
import { generateId, naturalSortList } from '../../utils.js';
import { FormField } from '../ui/FormField.jsx';

export const LandSection = ({ site, update }) => (
  <div className="space-y-4 font-sans text-black">
    <div className="flex justify-between items-center px-1 font-bold">
      <h3 className="text-gray-700 text-sm flex items-center gap-2"><MapIcon size={16} className="text-blue-500" /> 既登記土地情報</h3>
      <button onClick={() => update({ land: [...(site.land||[]), { id: generateId(), address: '', lotNumber: '', category: '', area: '', owner: '' }] })} className="text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-blue-700 font-bold active:scale-95 shadow-sm">
        <Plus size={12} /> 筆を追加
      </button>
    </div>
    {naturalSortList(site.land || [], 'lotNumber').map((item) => (
      <div key={item.id} className="p-4 border border-gray-200 rounded-xl bg-white relative group shadow-sm hover:shadow-md transition-all font-sans text-black">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-black">
          <FormField label="所在" value={item.address} onChange={(v) => update({ land: site.land.map(l => l.id === item.id ? {...l, address: v} : l)})} />
          <FormField label="地番" value={item.lotNumber} onChange={(v) => update({ land: site.land.map(l => l.id === item.id ? {...l, lotNumber: v} : l)})} />
          <FormField label="地目" value={item.category} onChange={(v) => update({ land: site.land.map(l => l.id === item.id ? {...l, category: v} : l)})} />
          <FormField label="地積" value={item.area} onChange={(v) => update({ land: site.land.map(l => l.id === item.id ? {...l, area: v} : l)})} />
          <FormField label="所有者" value={item.owner} onChange={(v) => update({ land: site.land.map(l => l.id === item.id ? {...l, owner: v} : l)})} />
        </div>
        <button onClick={() => update({ land: site.land.filter(l => l.id !== item.id)})} className="absolute -top-2 -right-2 bg-white text-red-500 p-1.5 rounded-full shadow-md border border-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={14} />
        </button>
      </div>
    ))}
  </div>
);
