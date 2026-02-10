import React from 'react';
import { Building, Plus, Trash2, Copy, X } from 'lucide-react';
import {
  generateId, naturalSortList, toHalfWidth, toFullWidthDigits,
  createNewBuilding, createNewAnnex, parseStructureToFloors,
  parseAnnexStructureToFloors, createDefaultConfirmationCert, createDefaultCauseDate,
  computeStructFloor, ensureNextFloors
} from '../../utils.js';
import { FormField } from '../ui/FormField.jsx';

export const BuildingSection = ({ type, site, update }) => {
  const isReg = type === 'registered';
  const dataKey = isReg ? 'buildings' : 'proposedBuildings';
  const buildings = site[dataKey] || [];
  const CONFIRM_R2_OPTIONS = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0"));

  const updateBuild = (bid, field, val) => {
    update({ [dataKey]: buildings.map(b => {
      if (b.id !== bid) return b;
      let up = { ...b, [field]: val };
      if (field === 'structMaterial') {
        up.struct = val + (up.structFloor || "");
      }
      if (field === 'floorAreas') {
        up.floorAreas = ensureNextFloors(val, up.hasBasement);
        up.structFloor = computeStructFloor(up.floorAreas);
        up.struct = (up.structMaterial || "") + up.structFloor;
      }
      if (field === 'hasBasement' && val) {
        const newAreas = [...(up.floorAreas || [])];
        const label = toFullWidthDigits("地下1階");
        if (!newAreas.some(fa => toHalfWidth(fa.floor) === "地下1階")) {
          newAreas.push({ id: generateId(), floor: label, area: "" });
        }
        up.floorAreas = newAreas;
      }
      return up;
    })});
  };

  const updateAnnex = (bid, aid, field, val) => {
    update({
      [dataKey]: buildings.map(b => {
        if (b.id !== bid) return b;
        const annexes = (b.annexes || []).map(a => {
          if (a.id !== aid) return a;
          let up = { ...a, [field]: val };
          if (field === "struct" || field === "includeBasement") {
            const nextStruct = field === "struct" ? val : (a.struct || "");
            const nextIncludeBasement = field === "includeBasement" ? !!val : !!a.includeBasement;
            const baseFloors = parseAnnexStructureToFloors(nextStruct);
            const basementFloors = [];
            if (nextIncludeBasement) {
              const hw = toHalfWidth(nextStruct || "");
              const m = hw.match(/地下(\d+)階/);
              const n = m ? parseInt(m[1], 10) : 1;
              for (let i = 1; i <= n; i++) basementFloors.push(`地下${i}階`);
            }
            const labels = [...baseFloors, ...basementFloors];
            const map = new Map((a.floorAreas || []).map(f => [f.floor, f]));
            up.floorAreas = labels.map(l => map.get(l) || { id: generateId(), floor: l, area: "" });
            up.struct = nextStruct;
            up.includeBasement = nextIncludeBasement;
          }
          return up;
        });
        return { ...b, annexes };
      })
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-black font-sans">
      <div className="flex justify-between items-center px-1 font-bold">
        <h3 className="text-gray-700 text-sm flex items-center gap-2"><Building size={16} className={isReg ? "text-amber-500" : "text-emerald-500"} /> {isReg ? '既登記建物情報' : '申請建物情報'}</h3>
        <button onClick={() => update({ [dataKey]: [...buildings, createNewBuilding()] })} className="text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-blue-700 font-bold transition-all active:scale-95 shadow-sm">
          <Plus size={12} /> 物件を追加
        </button>
      </div>
      {naturalSortList(buildings, 'houseNum').map(b => (
        <div key={b.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white relative group">
          <button onClick={() => update({ [dataKey]: buildings.filter(x => x.id !== b.id)})} className="absolute top-2 right-2 text-gray-300 hover:text-red-500 p-1 rounded transition-colors"><Trash2 size={16} /></button>
          <div className="bg-slate-50/80 p-4 border-b border-gray-200 text-black">
            <div className="flex items-center gap-2 mb-4 font-bold text-black font-sans">
              <span className="text-xs font-black text-slate-500 uppercase font-sans font-bold">主である建物</span>
              {isReg && <button onClick={() => update({ proposedBuildings: [...(site.proposedBuildings || []), {...b, id: generateId()}] })} className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded flex items-center gap-1 hover:bg-emerald-700 transition-colors font-bold shadow-sm active:scale-95 shadow-emerald-100">
                <Copy size={12} /> 申請へ転写
              </button>}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-black">
              <FormField label="所在" value={b.address} onChange={v => updateBuild(b.id, 'address', v)} />
              <FormField label="家屋番号" value={b.houseNum} onChange={v => updateBuild(b.id, 'houseNum', v)} />
              <FormField label="符号" value={(b.annexes || []).some(a => {
                const sym = (a.symbol || '').replace(/[\s\u3000]/g, '');
                const hasContent = (a.kind || '').replace(/[\s\u3000]/g, '').length > 0 || (a.struct || '').replace(/[\s\u3000]/g, '').length > 0 || (a.floorAreas || []).some(fa => (fa.area || '').replace(/[\s\u3000]/g, '').length > 0);
                return sym.length > 0 && hasContent;
              }) ? '主' : ''} readOnly />
              <FormField label="所有者" value={b.owner} onChange={v => updateBuild(b.id, 'owner', v)} />
              <FormField label="種類" value={b.kind} onChange={v => updateBuild(b.id, 'kind', v)} />
              <FormField label="構造（構成材料・屋根の種類）" value={b.structMaterial || ''} onChange={v => updateBuild(b.id, 'structMaterial', v)} placeholder="例: 木造スレート葺" />
              <FormField label="構造（階層）" value={b.structFloor || ''} readOnly />
              {(b.floorAreas || []).filter(fa => !fa.floor.includes("地下")).map((fa) => (<FormField key={fa.id} label={`床面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = b.floorAreas.map(f => f.id === fa.id ? {...f, area: v} : f); updateBuild(b.id, 'floorAreas', n); }} />))}
              {!b.hasBasement ? (
                <div className="flex items-end pb-1">
                  <button onClick={() => updateBuild(b.id, 'hasBasement', true)} className="text-[10px] bg-slate-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-700 font-bold active:scale-95 shadow-sm whitespace-nowrap">
                    <Plus size={12} /> 地下階を追加
                  </button>
                </div>
              ) : (
                <>
                  {(b.floorAreas || []).filter(fa => fa.floor.includes("地下")).map((fa) => (<FormField key={fa.id} label={`床面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = b.floorAreas.map(f => f.id === fa.id ? {...f, area: v} : f); updateBuild(b.id, 'floorAreas', n); }} />))}
                </>
              )}
            </div>

            {!isReg && (
              <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col gap-3 text-black">
                <div className="flex items-center gap-3">
                  <div className="flex-[1.5]">
                    <FormField label="登記原因" value={b.registrationCause} onChange={v => updateBuild(b.id, 'registrationCause', v)} placeholder="例: 新築" />
                  </div>
                  <div className="flex-[3] flex flex-col">
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">原因日付</label>
                    <div className="flex items-center gap-1 text-black">
                      <select
                        className="text-xs p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                        value={b.registrationDate?.era ?? "令和"}
                        onChange={e => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, era: e.target.value })}
                      >
                        {["","令和","平成","昭和","大正","明治"].map(e => <option key={e || "_blank"} value={e}>{e || "　"}</option>)}
                      </select>
                      <input
                        type="text" className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={toFullWidthDigits(b.registrationDate?.year || "")} placeholder="年"
                        onChange={e => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, year: toFullWidthDigits(e.target.value) })}
                      />
                      <span className="text-[10px] font-bold text-gray-400">年</span>
                      <input
                        type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={b.registrationDate?.month || ""} placeholder="月"
                        onChange={e => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, month: e.target.value })}
                      />
                      <span className="text-[10px] font-bold text-gray-400">月</span>
                      <input
                        type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={b.registrationDate?.day || ""} placeholder="日"
                        onChange={e => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, day: e.target.value })}
                      />
                      <span className="text-[10px] font-bold text-gray-400">日</span>
                      <label className="ml-1 flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox" className="w-3 h-3 rounded"
                          checked={b.additionalUnknownDate || false}
                          onChange={e => {
                            updateBuild(b.id, 'additionalUnknownDate', e.target.checked);
                          }}
                        />
                        <span className="text-[10px] font-bold text-slate-500">+不詳</span>
                      </label>
                      <button
                        onClick={() => updateBuild(b.id, 'additionalCauses', [...(b.additionalCauses || []), { id: generateId(), cause: '', date: createDefaultCauseDate() }])}
                        className="ml-auto text-[10px] bg-blue-600 text-white px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-700 font-bold active:scale-95 shadow-sm"
                        title="登記原因を追加"
                      >
                        <Plus size={10} /> 原因追加
                      </button>
                    </div>
                  </div>
                </div>
                {(b.additionalCauses || []).map((ac, acIdx) => (
                  <div key={ac.id} className="flex items-center gap-3 pl-2 border-l-2 border-blue-200">
                    <div className="flex-[1.5]">
                      <FormField label={`登記原因${acIdx + 2}`} value={ac.cause} onChange={v => {
                        const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, cause: v }; updateBuild(b.id, 'additionalCauses', next);
                      }} placeholder="例: 增築" />
                    </div>
                    <div className="flex-[3] flex flex-col">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">原因日付</label>
                      <div className="flex items-center gap-1 text-black">
                        <select
                          className="text-xs p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                                                    value={ac.date?.era ?? "令和"}
                                                    onChange={e => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, era: e.target.value } }; updateBuild(b.id, 'additionalCauses', next); }}
                        >
                          {["","令和","平成","昭和","大正","明治"].map(e => <option key={e || "_blank"} value={e}>{e || "　"}</option>)}
                        </select>
                        <input type="text" className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={toFullWidthDigits(ac.date?.year || "")} placeholder="年"
                          onChange={e => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, year: toFullWidthDigits(e.target.value) } }; updateBuild(b.id, 'additionalCauses', next); }}
                        />
                        <span className="text-[10px] font-bold text-gray-400">年</span>
                        <input type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.month || ""} placeholder="月"
                          onChange={e => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, month: e.target.value } }; updateBuild(b.id, 'additionalCauses', next); }}
                        />
                        <span className="text-[10px] font-bold text-gray-400">月</span>
                        <input type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.day || ""} placeholder="日"
                          onChange={e => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, day: e.target.value } }; updateBuild(b.id, 'additionalCauses', next); }}
                        />
                        <span className="text-[10px] font-bold text-gray-400">日</span>
                        <button
                          onClick={() => updateBuild(b.id, 'additionalCauses', (b.additionalCauses || []).filter((_, i) => i !== acIdx))}
                          className="ml-1 text-gray-400 hover:text-red-500 p-0.5 transition-colors" title="この登記原因を削除"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="pt-3 mt-3 border-t border-slate-200">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">
                    確認済証情報（申述書用）
                  </label>

                  {!b.confirmationCert ? (
                    <button
                      onClick={() => updateBuild(b.id, "confirmationCert", createDefaultConfirmationCert())}
                      className="text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-blue-700 font-bold active:scale-95 shadow-sm"
                    >
                      <Plus size={12} /> 確認済証情報追加
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-xs font-bold text-slate-600">第Ｒ</span>
                        <select
                          className="text-xs p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                          value={b.confirmationCert?.rNo || "01"}
                          onChange={e => updateBuild(b.id, "confirmationCert", { ...b.confirmationCert, rNo: e.target.value })}
                        >
                          {CONFIRM_R2_OPTIONS.map(v => (
                            <option key={v} value={v}>{toFullWidthDigits(v)}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="min-w-[140px] flex-1 text-sm p-1 border rounded text-black bg-white"
                          value={b.confirmationCert?.code ?? ""}
                          onChange={e => updateBuild(b.id, "confirmationCert", { ...b.confirmationCert, code: e.target.value })}
                        />
                        <input
                          type="text"
                          className="w-24 text-center text-sm p-1 border rounded text-black bg-white"
                          value={toFullWidthDigits(b.confirmationCert?.number ?? "")}
                          onChange={e => updateBuild(b.id, "confirmationCert", { ...b.confirmationCert, number: toFullWidthDigits(e.target.value) })}
                        />
                        <span className="text-xs font-bold text-slate-600">号</span>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        <input
                          type="text"
                          className="w-16 text-center text-sm p-1 border rounded text-black bg-white"
                          value={b.confirmationCert?.date?.era ?? ""}
                          onChange={e => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), era: e.target.value }
                          })}
                        />
                        <input
                          type="text"
                          className="w-10 text-center text-sm p-1 border rounded text-black bg-white"
                          value={toFullWidthDigits(b.confirmationCert?.date?.year ?? "")}
                          onChange={e => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), year: toFullWidthDigits(e.target.value) }
                          })}
                        />
                        <input
                          type="text"
                          className="w-8 text-center text-sm p-1 border rounded text-black bg-white"
                          value={toFullWidthDigits(b.confirmationCert?.date?.month ?? "")}
                          onChange={e => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), month: toFullWidthDigits(e.target.value) }
                          })}
                        />
                        <span className="text-[10px] font-bold text-gray-400">月</span>
                        <input
                          type="text"
                          className="w-8 text-center text-sm p-1 border rounded text-black bg-white"
                          value={toFullWidthDigits(b.confirmationCert?.date?.day ?? "")}
                          onChange={e => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), day: toFullWidthDigits(e.target.value) }
                          })}
                        />
                        <span className="text-[10px] font-bold text-gray-400">日</span>
                        <button
                          onClick={() => updateBuild(b.id, "confirmationCert", null)}
                          className="ml-2 text-[10px] text-red-600 font-bold hover:underline flex items-center gap-1"
                          title="確認済証情報を削除"
                        >
                          <X size={12} /> 削除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="p-4 bg-white">
            <div className="flex justify-between items-center mb-3 text-black font-sans font-bold">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Plus size={10} /> 附属建物</h4>
              <button onClick={() => update({ [dataKey]: buildings.map(x => x.id === b.id ? {...x, annexes: [...(x.annexes||[]), createNewAnnex()]} : x)})} className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1 transition-all">
                <Plus size={12} /> 附属追加
              </button>
            </div>
            <div className="space-y-4 text-black">
              {(b.annexes || []).map(a => (
                <div key={a.id} className="relative bg-gray-50/50 p-3 rounded-lg border border-dashed border-gray-200 font-sans text-black">
                  <div className="grid grid-cols-3 lg:grid-cols-4 gap-3 pr-8 text-black">
                    <FormField label="符号" value={a.symbol} onChange={v => updateAnnex(b.id, a.id, 'symbol', v)} />
                    <FormField label="種類" value={a.kind} onChange={v => updateAnnex(b.id, a.id, 'kind', v)} />
                    <FormField label="構造" value={a.struct} onChange={v => updateAnnex(b.id, a.id, 'struct', v)} />
                    <div className="flex flex-col justify-center text-black font-sans font-bold">
                      <label className="flex items-center gap-2 cursor-pointer mt-2 text-[9px] font-bold text-gray-500 uppercase tracking-tighter">
                        <input type="checkbox" className="w-3 h-3 rounded" checked={a.includeBasement} onChange={e => updateAnnex(b.id, a.id, 'includeBasement', e.target.checked)} />地下階も入力
                      </label>
                    </div>
                    {(a.floorAreas || []).map((fa, i) => (<FormField key={fa.id} label={`面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = [...a.floorAreas]; n[i].area = v; updateAnnex(b.id, a.id, 'floorAreas', n); }} />))}
                  </div>
                  {!isReg && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200 flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex-[1.5]">
                          <FormField label="登記原因" value={a.registrationCause || ""} onChange={v => updateAnnex(b.id, a.id, 'registrationCause', v)} placeholder="例: 新築" />
                        </div>
                        <div className="flex-[3] flex flex-col">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">原因日付</label>
                          <div className="flex items-center gap-1 text-black">
                            <select className="text-xs p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                              value={a.registrationDate?.era ?? "令和"}
                              onChange={e => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), era: e.target.value })}>
                              {["","令和","平成","昭和","大正","明治"].map(e => <option key={e || "_blank"} value={e}>{e || "　"}</option>)}
                            </select>
                            <input type="text" className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={toFullWidthDigits(a.registrationDate?.year || "")} placeholder="年"
                              onChange={e => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), year: toFullWidthDigits(e.target.value) })}
                            />
                            <span className="text-[10px] font-bold text-gray-400">年</span>
                            <input type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={a.registrationDate?.month || ""}placeholder="月"
                              onChange={e => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), month: e.target.value })}
                            />
                            <span className="text-[10px] font-bold text-gray-400">月</span>
                            <input type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={a.registrationDate?.day || ""}placeholder="日"
                              onChange={e => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), day: e.target.value })}
                            />
                            <span className="text-[10px] font-bold text-gray-400">日</span>
                            <label className="ml-2 flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" className="w-3 h-3 rounded"
                                checked={!!a.additionalUnknownDate}
                                onChange={e => {
                                  updateAnnex(b.id, a.id, 'additionalUnknownDate', e.target.checked);
                                }} />
                              <span className="text-[10px] font-bold text-slate-500">+不詳</span>
                            </label>
                            <button
                              onClick={() => updateAnnex(b.id, a.id, 'additionalCauses', [...(a.additionalCauses || []), { id: generateId(), cause: '', date: createDefaultCauseDate() }])}
                              className="ml-auto text-[10px] bg-blue-600 text-white px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-700 font-bold active:scale-95 shadow-sm"
                              title="登記原因を追加"
                            >
                              <Plus size={10} /> 原因追加
                            </button>
                          </div>
                        </div>
                      </div>
                      {(a.additionalCauses || []).map((ac, acIdx) => (
                        <div key={ac.id} className="flex items-center gap-3 pl-2 border-l-2 border-blue-200">
                          <div className="flex-[1.5]">
                            <FormField label={`登記原因${acIdx + 2}`} value={ac.cause} onChange={v => {
                              const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, cause: v }; updateAnnex(b.id, a.id, 'additionalCauses', next);
                            }} placeholder="例: 增築" />
                          </div>
                          <div className="flex-[3] flex flex-col">
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">原因日付</label>
                            <div className="flex items-center gap-1 text-black">
                              <select className="text-xs p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                                                                value={ac.date?.era ?? "令和"}
                                                                onChange={e => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, era: e.target.value } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}>
                                {["","令和","平成","昭和","大正","明治"].map(e => <option key={e || "_blank"} value={e}>{e || "　"}</option>)}
                              </select>
                              <input type="text" className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={toFullWidthDigits(ac.date?.year || "")} placeholder="年"
                                onChange={e => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, year: toFullWidthDigits(e.target.value) } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}
                              />
                              <span className="text-[10px] font-bold text-gray-400">年</span>
                              <input type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.month || ""}placeholder="月"
                                onChange={e => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, month: e.target.value } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}
                              />
                              <span className="text-[10px] font-bold text-gray-400">月</span>
                              <input type="text" className="w-8 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.day || ""}placeholder="日"
                                onChange={e => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, day: e.target.value } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}
                              />
                              <span className="text-[10px] font-bold text-gray-400">日</span>
                              <button
                                onClick={() => updateAnnex(b.id, a.id, 'additionalCauses', (a.additionalCauses || []).filter((_, i) => i !== acIdx))}
                                className="ml-1 text-gray-400 hover:text-red-500 p-0.5 transition-colors" title="この登記原因を削除"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => {
                        if (window.confirm('この附属建物の「符号」「種類」「構造」「床面積」をクリアしますか？')) {
                          update({
                            [dataKey]: buildings.map(x => x.id === b.id ? {
                              ...x,
                              annexes: (x.annexes || []).map(ax => ax.id === a.id ? {
                                ...ax, symbol: '', kind: '', struct: '', floorAreas: []
                              } : ax)
                            } : x)
                          });
                        }
                      }}
                      className="text-[10px] text-orange-600 font-bold hover:underline flex items-center gap-1 transition-all"
                    >
                      クリア
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('この附属建物の「種類」「構造」「床面積」を主である建物に転写しますか？')) {
                          update({
                            [dataKey]: buildings.map(x => x.id === b.id ? {
                              ...x,
                              kind: a.kind || '',
                              struct: a.struct || '',
                              floorAreas: (a.floorAreas || []).map(fa => ({ ...fa, id: generateId() }))
                            } : x)
                          });
                        }
                      }}
                      className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1 transition-all"
                    >
                      主である建物に転写
                    </button>
                  </div>
                  <button onClick={() => update({ [dataKey]: buildings.map(x => x.id === b.id ? {...x, annexes: x.annexes.filter(z => z.id !== a.id)} : x)})} className="absolute top-2 right-2 text-gray-300 hover:text-red-500 p-1 transition-colors font-sans font-bold">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
