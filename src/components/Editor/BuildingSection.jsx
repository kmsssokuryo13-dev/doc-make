import React, { useState, useMemo, useCallback } from 'react';
import { Building, Plus, Trash2, Copy, X, Users, MapPin } from 'lucide-react';
import {
  generateId, naturalSortList, toHalfWidth, toFullWidthDigits,
  createNewBuilding, createNewAnnex, parseStructureToFloors,
  parseAnnexStructureToFloors, createDefaultConfirmationCert, createDefaultCauseDate,
  computeStructFloor, ensureNextFloors
} from '../../utils.js';
import { FormField } from '../ui/FormField.jsx';
import { DateInput } from '../ui/DateInput.jsx';
import { Modal } from '../ui/Modal.jsx';

const lotNumberToChiban = (lotNumber) => {
  const s = (lotNumber || '').trim();
  if (!s) return '';
  return s.replace(/番/, '番地');
};

const buildAddressFromSelections = (selections, landMap) => {
  if (!selections.length) return { address: '', houseNum: '' };
  const parts = [];
  let prevAddress = null;
  for (const landId of selections) {
    const land = landMap.get(landId);
    if (!land) continue;
    const addr = (land.address || '').trim();
    const lot = (land.lotNumber || '').trim();
    const chibanChi = lotNumberToChiban(lot);
    if (addr === prevAddress) {
      parts.push(chibanChi);
    } else {
      parts.push(addr + chibanChi);
      prevAddress = addr;
    }
  }
  const firstLand = landMap.get(selections[0]);
  const houseNum = firstLand ? (firstLand.lotNumber || '').trim() : '';
  return { address: parts.join('、'), houseNum };
};

const LandSelectModal = ({ isOpen, onClose, lands, onConfirm }) => {
  const [selections, setSelections] = useState([]);

  const grouped = useMemo(() => {
    const groups = [];
    const map = new Map();
    for (const land of lands) {
      const addr = (land.address || '').trim() || '（所在なし）';
      if (!map.has(addr)) {
        const group = { address: addr, items: [] };
        map.set(addr, group);
        groups.push(group);
      }
      map.get(addr).items.push(land);
    }
    return groups;
  }, [lands]);

  const toggleSelection = useCallback((landId) => {
    setSelections(prev => {
      if (prev.includes(landId)) return prev.filter(id => id !== landId);
      return [...prev, landId];
    });
  }, []);

  const handleConfirm = () => {
    onConfirm(selections);
    setSelections([]);
  };

  const handleClose = () => {
    setSelections([]);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="土地情報を選択"
      maxWidth="max-w-lg"
      footer={
        <>
          <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-bold transition-colors">
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={selections.length === 0}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            決定（{selections.length}件選択中）
          </button>
        </>
      }
    >
      <p className="text-xs text-gray-500 mb-4">転記する土地を選択してください（複数選択可・クリック順に番号が付きます）</p>
      <div className="space-y-4">
        {grouped.map(group => (
          <div key={group.address}>
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin size={14} className="text-blue-500" />
              <span className="text-sm font-bold text-gray-700">{group.address}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pl-5">
              {group.items.map(land => {
                const idx = selections.indexOf(land.id);
                const selected = idx >= 0;
                return (
                  <button
                    key={land.id}
                    onClick={() => toggleSelection(land.id)}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-sm transition-all ${
                      selected
                        ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/30'
                    }`}
                  >
                    {selected && (
                      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">
                        {idx + 1}
                      </span>
                    )}
                    <span className="font-bold truncate">{land.lotNumber || '（地番なし）'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export const BuildingSection = ({ type, site, update }) => {
  const isReg = type === 'registered';
  const dataKey = isReg ? 'buildings' : 'proposedBuildings';
  const buildings = site[dataKey] || [];
  const CONFIRM_R2_OPTIONS = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0"));
  const [isLandSelectOpen, setIsLandSelectOpen] = useState(false);

  const landMap = useMemo(() => {
    const m = new Map();
    for (const l of (site.land || [])) m.set(l.id, l);
    return m;
  }, [site.land]);

  const handleLandCopy = useCallback(() => {
    const lands = site.land || [];
    if (lands.length === 0) return;
    if (lands.length === 1) {
      const { address, houseNum } = buildAddressFromSelections([lands[0].id], landMap);
      const newBldg = createNewBuilding();
      newBldg.address = address;
      newBldg.houseNum = houseNum;
      update({ [dataKey]: [...buildings, newBldg] });
      return;
    }
    setIsLandSelectOpen(true);
  }, [site.land, landMap, buildings, dataKey, update]);

  const handleLandSelectConfirm = useCallback((selections) => {
    if (selections.length === 0) return;
    const { address, houseNum } = buildAddressFromSelections(selections, landMap);
    const newBldg = createNewBuilding();
    newBldg.address = address;
    newBldg.houseNum = houseNum;
    update({ [dataKey]: [...buildings, newBldg] });
    setIsLandSelectOpen(false);
  }, [landMap, buildings, dataKey, update]);

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
        });
        return { ...b, annexes };
      })
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-black font-sans">
      <div className="flex justify-between items-center px-1 font-bold">
        <h3 className="text-gray-700 text-sm flex items-center gap-2"><Building size={16} className={isReg ? "text-amber-500" : "text-emerald-500"} /> {isReg ? '既登記建物情報' : '申請建物情報'}</h3>
        <div className="flex items-center gap-2">
          {!isReg && (site.land || []).length > 0 && (
            <button onClick={handleLandCopy} className="text-[10px] bg-emerald-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-emerald-700 font-bold transition-all active:scale-95 shadow-sm">
              <MapPin size={12} /> 土地から転記
            </button>
          )}
          <button onClick={() => update({ [dataKey]: [...buildings, createNewBuilding()] })} className="text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-blue-700 font-bold transition-all active:scale-95 shadow-sm">
            <Plus size={12} /> 物件を追加
          </button>
        </div>
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
              <FormField label="所在" value={b.address} onChange={v => updateBuild(b.id, 'address', v)} imeMode="active" />
              <FormField label="家屋番号" value={b.houseNum} onChange={v => updateBuild(b.id, 'houseNum', v)} imeMode="active" />
              <FormField label="符号" value={(b.annexes || []).some(a => {
                const sym = (a.symbol || '').replace(/[\s\u3000]/g, '');
                const hasContent = (a.kind || '').replace(/[\s\u3000]/g, '').length > 0 || (a.struct || '').replace(/[\s\u3000]/g, '').length > 0 || (a.floorAreas || []).some(fa => (fa.area || '').replace(/[\s\u3000]/g, '').length > 0);
                return sym.length > 0 && hasContent;
              }) ? '主' : ''} readOnly />
              <FormField label="種類" value={b.kind} onChange={v => updateBuild(b.id, 'kind', v)} imeMode="active" />
              <FormField label="構造（構成材料・屋根の種類）" value={b.structMaterial || ''} onChange={v => updateBuild(b.id, 'structMaterial', v)} placeholder="例: 木造スレート葺" imeMode="active" />
              <FormField label="構造（階層）" value={b.structFloor || ''} readOnly />
              {(b.floorAreas || []).filter(fa => !fa.floor.includes("地下")).map((fa) => (<FormField key={fa.id} label={`床面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = b.floorAreas.map(f => f.id === fa.id ? {...f, area: v} : f); updateBuild(b.id, 'floorAreas', n); }} autoConfirm />))}
              {!b.hasBasement ? (
                <div className="flex items-end pb-1">
                  <button onClick={() => updateBuild(b.id, 'hasBasement', true)} className="text-[10px] bg-slate-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-700 font-bold active:scale-95 shadow-sm whitespace-nowrap">
                    <Plus size={12} /> 地下階を追加
                  </button>
                </div>
              ) : (
                <>
                  {(b.floorAreas || []).filter(fa => fa.floor.includes("地下")).map((fa) => (<FormField key={fa.id} label={`床面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = b.floorAreas.map(f => f.id === fa.id ? {...f, area: v} : f); updateBuild(b.id, 'floorAreas', n); }} autoConfirm />))}
                </>
              )}
            </div>

            {!isReg && (
              <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col gap-3 text-black">
                <div className="flex items-center gap-3">
                  <div className="flex-[1.5]">
                    <FormField label="登記原因" value={b.registrationCause} onChange={v => updateBuild(b.id, 'registrationCause', v)} placeholder="例: 新築" imeMode="active" />
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
                      <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={b.registrationDate?.year || ""} placeholder="年"
                        onChange={v => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, year: v })}
                      />
                      <span className="text-[10px] font-bold text-gray-400">年</span>
                      <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={b.registrationDate?.month || ""} placeholder="月"
                        onChange={v => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, month: v })}
                      />
                      <span className="text-[10px] font-bold text-gray-400">月</span>
                      <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={b.registrationDate?.day || ""} placeholder="日"
                        onChange={v => updateBuild(b.id, 'registrationDate', { ...b.registrationDate, day: v })}
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
                        <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.year || ""} placeholder="年"
                          onChange={v => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, year: v } }; updateBuild(b.id, 'additionalCauses', next); }}
                        />
                        <span className="text-[10px] font-bold text-gray-400">年</span>
                        <DateInput                        className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.month || ""} placeholder="月"
                                                  onChange={v => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, month: v } }; updateBuild(b.id, 'additionalCauses', next); }}
                        />
                        <span className="text-[10px] font-bold text-gray-400">月</span>
                        <DateInput                        className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.day || ""} placeholder="日"
                                                  onChange={v => { const next = [...(b.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, day: v } }; updateBuild(b.id, 'additionalCauses', next); }}
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
                        <DateInput
                          className="w-10 text-center text-sm p-1 border rounded text-black bg-white"
                          value={b.confirmationCert?.date?.year ?? ""}
                          onChange={v => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), year: v }
                          })}
                        />
                        <DateInput
                          className="w-10 text-center text-sm p-1 border rounded text-black bg-white"
                          value={b.confirmationCert?.date?.month ?? ""}
                          onChange={v => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), month: v }
                          })}
                        />
                        <span className="text-[10px] font-bold text-gray-400">月</span>
                        <DateInput
                          className="w-10 text-center text-sm p-1 border rounded text-black bg-white"
                          value={b.confirmationCert?.date?.day ?? ""}
                          onChange={v => updateBuild(b.id, "confirmationCert", {
                            ...b.confirmationCert,
                            date: { ...(b.confirmationCert?.date || {}), day: v }
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
          {(() => {
            const people = Array.isArray(site?.people) ? site.people : [];
            const ownerCandidates = people.filter(p => {
              const roles = p?.roles || [];
              return roles.includes("建物所有者") || roles.includes("申請人");
            });
            const curIds = new Set(Array.isArray(b.ownerPersonIds) ? b.ownerPersonIds : []);
            const toggleOwner = (pid) => {
              const next = new Set(curIds);
              if (next.has(pid)) next.delete(pid); else next.add(pid);
              updateBuild(b.id, 'ownerPersonIds', Array.from(next));
            };
            if (ownerCandidates.length === 0) return null;
            return (
              <div className="px-4 py-3 bg-purple-50/50 border-b border-gray-200">
                <label className="block text-[10px] font-bold text-purple-600 uppercase mb-2 flex items-center gap-1">
                  <Users size={12} /> この建物の所有者
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {ownerCandidates.map(p => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                        curIds.has(p.id)
                          ? "bg-purple-100 border-purple-300 text-purple-700"
                          : "bg-white border-slate-200 text-slate-500"
                      }`}
                    >
                      <input type="checkbox" className="w-3 h-3 rounded accent-purple-600" checked={curIds.has(p.id)} onChange={() => toggleOwner(p.id)} />
                      <span className="truncate">{p.name || "(氏名未入力)"}{` [${(p.roles || []).join("、")}]`}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="p-4 bg-white">
            <div className="flex justify-between items-center mb-3 text-black font-sans font-bold">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Plus size={10} /> 附属建物</h4>
              <button onClick={() => update({ [dataKey]: buildings.map(x => x.id === b.id ? {...x, annexes: [...(x.annexes||[]), createNewAnnex()]} : x)})} className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1 transition-all">
                <Plus size={12} /> 附属追加
              </button>
            </div>
            <div className="space-y-4 text-black">
              {(b.annexes || []).map(a => (
                <div key={a.id} className="relative bg-orange-50/60 p-3 rounded-lg border border-dashed border-orange-200 font-sans text-black">
                  <div className="grid grid-cols-3 lg:grid-cols-4 gap-3 pr-8 text-black">
                    <FormField label="符号" value={a.symbol} onChange={v => updateAnnex(b.id, a.id, 'symbol', v)} autoConfirm />
                    <FormField label="種類" value={a.kind} onChange={v => updateAnnex(b.id, a.id, 'kind', v)} imeMode="active" />
                    <FormField label="構造（構成材料・屋根の種類）" value={a.structMaterial || ''} onChange={v => updateAnnex(b.id, a.id, 'structMaterial', v)} placeholder="例: 木造スレート葺" imeMode="active" />
                    <FormField label="構造（階層）" value={a.structFloor || ''} readOnly />
                    {(a.floorAreas || []).filter(fa => !fa.floor.includes("地下")).map((fa) => (<FormField key={fa.id} label={`面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = a.floorAreas.map(f => f.id === fa.id ? {...f, area: v} : f); updateAnnex(b.id, a.id, 'floorAreas', n); }} autoConfirm />))}
                    {!a.hasBasement ? (
                      <div className="flex items-end pb-1">
                        <button onClick={() => updateAnnex(b.id, a.id, 'hasBasement', true)} className="text-[10px] bg-slate-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-700 font-bold active:scale-95 shadow-sm whitespace-nowrap">
                          <Plus size={12} /> 地下階を追加
                        </button>
                      </div>
                    ) : (
                      <>
                        {(a.floorAreas || []).filter(fa => fa.floor.includes("地下")).map((fa) => (<FormField key={fa.id} label={`面積（${fa.floor}）`} value={fa.area} onChange={v => { const n = a.floorAreas.map(f => f.id === fa.id ? {...f, area: v} : f); updateAnnex(b.id, a.id, 'floorAreas', n); }} autoConfirm />))}
                      </>
                    )}
                  </div>
                  {!isReg && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200 flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex-[1.5]">
                          <FormField label="登記原因" value={a.registrationCause || ""} onChange={v => updateAnnex(b.id, a.id, 'registrationCause', v)} placeholder="例: 新築" imeMode="active" />
                        </div>
                        <div className="flex-[3] flex flex-col">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">原因日付</label>
                          <div className="flex items-center gap-1 text-black">
                            <select className="text-xs p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                              value={a.registrationDate?.era ?? "令和"}
                              onChange={e => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), era: e.target.value })}>
                              {["","令和","平成","昭和","大正","明治"].map(e => <option key={e || "_blank"} value={e}>{e || "　"}</option>)}
                            </select>
                            <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={a.registrationDate?.year || ""} placeholder="年"
                              onChange={v => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), year: v })}
                            />
                            <span className="text-[10px] font-bold text-gray-400">年</span>
                            <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={a.registrationDate?.month || ""} placeholder="月"
                              onChange={v => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), month: v })}
                            />
                            <span className="text-[10px] font-bold text-gray-400">月</span>
                            <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={a.registrationDate?.day || ""} placeholder="日"
                              onChange={v => updateAnnex(b.id, a.id, 'registrationDate', { ...(a.registrationDate || {}), day: v })}
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
                              <DateInput className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.year || ""} placeholder="年"
                                onChange={v => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, year: v } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}
                              />
                              <span className="text-[10px] font-bold text-gray-400">年</span>
                              <DateInput                              className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.month || ""} placeholder="月"
                                                              onChange={v => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, month: v } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}
                              />
                              <span className="text-[10px] font-bold text-gray-400">月</span>
                              <DateInput                              className="w-10 text-center text-sm p-1 border rounded text-black bg-white" value={ac.date?.day || ""} placeholder="日"
                                                              onChange={v => { const next = [...(a.additionalCauses || [])]; next[acIdx] = { ...ac, date: { ...ac.date, day: v } }; updateAnnex(b.id, a.id, 'additionalCauses', next); }}
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
                    {!isReg && <button
                      onClick={() => {
                        if (window.confirm('この附属建物の「種類」「構造」「床面積」をクリアし、登記原因に「取壊し」を入力しますか？')) {
                          update({
                            [dataKey]: buildings.map(x => x.id === b.id ? {
                              ...x,
                              annexes: (x.annexes || []).map(ax => ax.id === a.id ? {
                                ...ax, kind: '', structMaterial: '', structFloor: '', struct: '', hasBasement: false, floorAreas: [{ id: generateId(), floor: '１階', area: '' }], registrationCause: '取壊し'
                              } : ax)
                            } : x)
                          });
                        }
                      }}
                      className="text-[10px] text-orange-600 font-bold hover:underline flex items-center gap-1 transition-all"
                    >
                      この建物を取壊し
                    </button>}
                    <button
                      onClick={() => {
                        if (window.confirm('この附属建物の「種類」「構造」「床面積」を主である建物に転写しますか？')) {
                          update({
                            [dataKey]: buildings.map(x => x.id === b.id ? {
                              ...x,
                              kind: a.kind || '',
                              structMaterial: a.structMaterial || '',
                              structFloor: a.structFloor || '',
                              struct: a.struct || '',
                              hasBasement: !!a.hasBasement,
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
      {!isReg && <LandSelectModal isOpen={isLandSelectOpen} onClose={() => setIsLandSelectOpen(false)} lands={site.land || []} onConfirm={handleLandSelectConfirm} />}
    </div>
  );
};
