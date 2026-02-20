import React from 'react';
import { Map as MapIcon, Plus, Trash2 } from 'lucide-react';
import { generateId, naturalSortList, toHalfWidth, toFullWidthDigits } from '../../utils.js';
import { FormField } from '../ui/FormField.jsx';

const computeDefaultNewArea = (area) => {
  const raw = (area ?? "").toString();
  const hw = toHalfWidth(raw);
  if (!hw) return "";
  if (hw.includes(".")) return toFullWidthDigits(raw);
  return toFullWidthDigits(raw) + "．００";
};

const updateLandItem = (site, id, patch) => ({
  land: site.land.map(l => l.id === id ? { ...l, ...patch } : l)
});

export const LandSection = ({ site, update }) => (
  <div className="space-y-4 font-sans text-black">
    <div className="flex justify-between items-center px-1 font-bold">
      <h3 className="text-gray-700 text-sm flex items-center gap-2"><MapIcon size={16} className="text-blue-500" /> 既登記土地情報</h3>
      <button onClick={() => update({ land: [...(site.land||[]), { id: generateId(), address: '', lotNumber: '', category: '', area: '', owner: '', categoryChangeEnabled: false, newCategory: '', newArea: '' }] })} className="text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-blue-700 font-bold active:scale-95 shadow-sm">
        <Plus size={12} /> 筆を追加
      </button>
    </div>
    {naturalSortList(site.land || [], 'lotNumber').map((item) => (
      <div key={item.id} className="p-4 border border-gray-200 rounded-xl bg-white relative group shadow-sm hover:shadow-md transition-all font-sans text-black">
        <div className="flex gap-4 text-black">
          <div className="flex-[3]">
            <FormField label="所在" value={item.address} onChange={(v) => update(updateLandItem(site, item.id, { address: v }))} imeMode="active" />
          </div>
          <div className="flex-[1]">
            <FormField label="地番" value={item.lotNumber} onChange={(v) => update(updateLandItem(site, item.id, { lotNumber: v }))} imeMode="active" />
          </div>
          <div className="flex-[1]">
            <FormField label="地目" value={item.category} onChange={(v) => update(updateLandItem(site, item.id, { category: v }))} imeMode="active" />
          </div>
          <div className="flex-[1]">
            <FormField label="地積" value={item.area} onChange={(v) => update(updateLandItem(site, item.id, { area: v }))} autoConfirm />
          </div>
        </div>

        <div className="mt-3">
          <button
            onClick={() => {
              const enabling = !item.categoryChangeEnabled;
              const patch = { categoryChangeEnabled: enabling };
              if (enabling && !item.newCategory) patch.newCategory = "宅地";
              if (enabling && !item.newArea) patch.newArea = computeDefaultNewArea(item.area);
              update(updateLandItem(site, item.id, patch));
            }}
            className={`text-[10px] px-3 py-1.5 rounded-full font-bold active:scale-95 shadow-sm transition-all ${
              item.categoryChangeEnabled
                ? 'bg-orange-100 text-orange-700 border border-orange-300 hover:bg-orange-200'
                : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
            }`}
          >
            {item.categoryChangeEnabled ? '地目変更を取消' : '地目変更する'}
          </button>
        </div>

        {item.categoryChangeEnabled && (
          <div className="grid grid-cols-2 gap-4 mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <FormField label="変更後の地目" value={item.newCategory} onChange={(v) => update(updateLandItem(site, item.id, { newCategory: v }))} />
            <FormField label="変更後の地積" value={item.newArea} onChange={(v) => update(updateLandItem(site, item.id, { newArea: v }))} autoConfirm />
          </div>
        )}

        <button onClick={() => update({ land: site.land.filter(l => l.id !== item.id)})} className="absolute -top-2 -right-2 bg-white text-red-500 p-1.5 rounded-full shadow-md border border-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={14} />
        </button>
      </div>
    ))}
  </div>
);
