import React, { useState } from 'react';
import { UserPlus, Briefcase, Users, Trash2, Plus, Settings2, X, UserCheck } from 'lucide-react';
import { createNewPerson } from '../../utils.js';
import { ROLE_OPTIONS } from '../../constants.js';
import { Modal } from '../ui/Modal.jsx';
import { FormField } from '../ui/FormField.jsx';

export const PeopleSection = ({ site, update, contractors = [], openMasterModal }) => {
  const people = Array.isArray(site?.people) ? site.people : [];
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);

  const updatePerson = (id, field, val) => {
    update({ people: people.map(p => {
      if (p.id === id) {
        const up = { ...p, [field]: val };
        if (field === "roles") up.role = (val || []).join("、");
        return up;
      }
      return p;
    }) });
  };

  const applyContractorMaster = (pId, masterId) => {
    const master = (contractors || []).find(c => c.id === masterId);
    if (!master) return;
    update({ people: people.map(p => {
      if (p.id === pId) {
        return {
          ...p,
          contractorMasterId: masterId,
          address: p.address || master.address,
          name: p.name || master.tradeName,
          representative: p.representative || master.representative
        };
      }
      return p;
    })});
  };

  const handleAddFromMaster = (master) => {
    const newP = createNewPerson({
      roles: ["工事人"],
      role: "工事人",
      contractorMasterId: master ? master.id : "",
      address: master ? master.address : "",
      name: master ? master.tradeName : "",
      representative: master ? master.representative : ""
    });
    update({ people: [...people, newP] });
    setIsSelectModalOpen(false);
  };

  const decedentName = site?.decedentName || "";
  const [showDecedent, setShowDecedent] = useState(!!decedentName);

  const handleDeleteDecedent = () => {
    if (!window.confirm("被相続人の情報を削除しますか？")) return;
    update({ decedentName: "" });
    setShowDecedent(false);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300 font-sans text-black">
      <div className="flex gap-2 font-sans font-bold mb-4 text-black">
        <button onClick={() => update({ people: [...people, createNewPerson()] })} className="flex-1 text-[10px] bg-purple-600 text-white px-3 py-2.5 rounded-xl font-bold hover:bg-purple-700 active:scale-95 shadow-md flex items-center justify-center gap-2"><UserPlus size={14} /> 申請人を追加</button>
        <button onClick={() => setIsSelectModalOpen(true)} className="flex-1 text-[10px] bg-blue-600 text-white px-3 py-2.5 rounded-xl font-bold hover:bg-blue-700 active:scale-95 shadow-md flex items-center justify-center gap-2"><Briefcase size={14} /> 工事人を追加</button>
      </div>

      {!showDecedent ? (
        <button onClick={() => setShowDecedent(true)} className="w-full text-[10px] bg-amber-600 text-white px-3 py-2 rounded-xl font-bold hover:bg-amber-700 active:scale-95 shadow-md flex items-center justify-center gap-2"><UserCheck size={14} /> 被相続人を入力</button>
      ) : (
        <div className="p-3 border border-amber-200 rounded-xl bg-amber-50 shadow-sm flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-100 text-amber-500 shrink-0"><UserCheck size={16} /></div>
          <div className="flex-1 min-w-0">
            <label className="block text-[9px] font-black text-amber-600 uppercase mb-1">被相続人の氏名</label>
            <input type="text" className="w-full text-xs p-1.5 bg-white border border-amber-200 rounded outline-none text-black" placeholder="氏名を入力" value={decedentName} onChange={e => update({ decedentName: e.target.value })} />
          </div>
          <button onClick={handleDeleteDecedent} className="text-gray-300 hover:text-red-500 p-1 shrink-0 transition-colors" title="被相続人を削除"><X size={16} /></button>
        </div>
      )}

      {(people || []).map((p) => {
        const isContractor = (p.roles || []).includes("工事人");
        return (
          <div key={p.id} className="p-4 border border-gray-200 rounded-xl bg-white shadow-sm relative group flex gap-4 items-start hover:shadow-md transition-all text-black font-sans">
            <div className={`p-2 rounded-lg shrink-0 ${isContractor ? "bg-blue-50 text-blue-400" : "bg-purple-50 text-purple-400"}`}>{isContractor ? <Briefcase size={18} /> : <Users size={18} />}</div>
            <div className="flex-1 grid grid-cols-1 gap-3 text-black">
              {isContractor && (
                <div className="flex items-end gap-2 bg-blue-50/50 p-2 rounded-lg border border-blue-100 text-black">
                  <div className="flex-1 text-black">
                    <label className="block text-[9px] font-black text-blue-500 uppercase mb-1">工事人マスタ連携</label>
                    <select
                      className="w-full text-xs p-1 bg-white border border-blue-200 rounded outline-none text-black"
                      value={p.contractorMasterId || ""}
                      onChange={e => applyContractorMaster(p.id, e.target.value)}
                    >
                      <option value="">(未連携・直接入力)</option>
                      {(contractors || []).map(c => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                    </select>
                  </div>
                  <button onClick={openMasterModal} className="p-1.5 text-blue-400 hover:text-blue-600 transition-colors" title="マスタ管理を開く">
                    <Settings2 size={16} />
                  </button>
                </div>
              )}

              <FormField label="住所" value={p.address} onChange={(v) => updatePerson(p.id, "address", v)} />
              <div className="flex gap-3 text-black">
                <FormField label="氏名・会社名" value={p.name} onChange={(v) => updatePerson(p.id, "name", v)} />
                <FormField label="代表者" value={p.representative} onChange={(v) => updatePerson(p.id, "representative", v)} placeholder="法人の場合のみ" />
              </div>
              <div className="flex gap-3 items-end text-black">
                <FormField label="持分" value={p.share} onChange={(v) => updatePerson(p.id, "share", v)} />
                <div className="flex-1 text-black">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">役割</label>
                  <div className="grid grid-cols-2 gap-1 text-black">
                    {ROLE_OPTIONS.map((r) => {
                      const checked = (p.roles || []).includes(r);
                      return (
                        <label key={r} className={`flex items-center gap-2 p-1 rounded border cursor-pointer text-[9px] ${checked ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-500"}`}>
                          <input type="checkbox" className="w-3 h-3" checked={checked} onChange={() => {
                            const set = new Set(p.roles || []);
                            if (set.has(r)) set.delete(r); else set.add(r);
                            updatePerson(p.id, "roles", Array.from(set));
                          }} /> {r}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <button onClick={() => update({ people: people.filter((x) => x.id !== p.id)})} className="text-gray-300 hover:text-red-500 p-1 shrink-0 transition-colors"><Trash2 size={16} /></button>
          </div>
        );
      })}

      <Modal isOpen={isSelectModalOpen} onClose={() => setIsSelectModalOpen(false)} title="工事人を追加" maxWidth="max-w-lg">
        <div className="space-y-4 text-black">
          <button
            onClick={() => handleAddFromMaster(null)}
            className="w-full p-4 border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex justify-between items-center group bg-white shadow-sm text-black"
          >
            <div className="text-left text-black">
              <p className="font-bold text-sm text-slate-800">工事人マスタから追加しない</p>
              <p className="text-[10px] text-slate-400">役割「工事人」のみ設定し、内容は後で入力します。</p>
            </div>
            <UserPlus size={18} className="text-slate-400 group-hover:text-slate-600" />
          </button>

          <div className="relative py-2 text-black">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200"></span></div>
            <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-2 text-slate-400 font-black tracking-widest">or マスタから選択</span></div>
          </div>

          {(!contractors || contractors.length === 0) ? (
            <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-black">
              <p className="text-xs text-gray-500 mb-4">マスタが登録されていません。</p>
              <button onClick={() => { setIsSelectModalOpen(false); openMasterModal(); }} className="bg-white border border-slate-300 text-slate-600 px-4 py-2 rounded-lg text-[10px] font-bold shadow-sm hover:bg-slate-50">マスタ管理を開く</button>
            </div>
          ) : (
            <div className="space-y-2 text-black">
              {contractors.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleAddFromMaster(c)}
                  className="w-full text-left p-4 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-300 transition-all flex justify-between items-center bg-white shadow-sm group text-black"
                >
                  <div className="text-black">
                    <p className="font-bold text-sm text-slate-800">{c.tradeName}</p>
                    <p className="text-[10px] text-slate-500">{c.address}</p>
                  </div>
                  <Plus size={18} className="text-blue-400 group-hover:text-blue-600" />
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
