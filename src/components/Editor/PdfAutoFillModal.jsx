import React, { useState, useEffect } from 'react';
import { FileText, Users, Check, ChevronDown, ChevronRight, X } from 'lucide-react';

const Section = ({ title, icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left font-bold text-sm text-slate-700"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
      </button>
      {open && <div className="p-3 space-y-2 bg-white">{children}</div>}
    </div>
  );
};

const EditableFieldRow = ({ label, value, checked, onCheck, onChange }) => {
  if (value === undefined || value === null) return null;
  return (
    <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
      <input type="checkbox" className="mt-1.5 w-4 h-4 rounded shrink-0" checked={checked} onChange={onCheck} />
      <span className="text-[10px] font-bold text-gray-500 min-w-[60px] shrink-0 mt-1">{label}</span>
      <input type="text" className="flex-1 text-sm text-gray-800 border border-gray-200 rounded px-2 py-0.5 focus:ring-1 focus:ring-blue-400 outline-none bg-white" value={value} onChange={(e) => onChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
    </label>
  );
};

const EditableFloorAreaRow = ({ label, floorAreas, checked, onCheck, onChangeFloor }) => {
  if (!floorAreas || floorAreas.length === 0) return null;
  return (
    <div className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 text-sm">
      <input type="checkbox" className="mt-1.5 w-4 h-4 rounded shrink-0" checked={checked} onChange={onCheck} />
      <span className="text-[10px] font-bold text-gray-500 min-w-[60px] shrink-0 mt-1">{label}</span>
      <div className="flex-1 flex flex-wrap gap-1">
        {floorAreas.map((fa, i) => (
          <div key={fa.id || i} className="flex items-center gap-1">
            <span className="text-xs text-gray-500">{fa.floor}</span>
            <input type="text" className="w-24 text-sm text-gray-800 border border-gray-200 rounded px-2 py-0.5 focus:ring-1 focus:ring-blue-400 outline-none bg-white" value={fa.area} onChange={(e) => onChangeFloor(i, e.target.value)} />
            <span className="text-xs text-gray-400">㎡</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const buildFieldKeys = (data) => {
  const keys = {};
  (data.buildings || []).forEach((b, bIdx) => {
    ['address', 'houseNum', 'kind', 'struct', 'floorAreas'].forEach(f => { keys[`b_${bIdx}_${f}`] = true; });
    (b.annexes || []).forEach((a, aIdx) => {
      ['symbol', 'kind', 'struct', 'floorAreas'].forEach(f => { keys[`b_${bIdx}_a_${aIdx}_${f}`] = true; });
    });
  });
  (data.land || []).forEach((l, lIdx) => {
    ['address', 'lotNumber', 'category', 'area'].forEach(f => { keys[`l_${lIdx}_${f}`] = true; });
  });
  (data.people || []).forEach((p, pIdx) => {
    ['address', 'name', 'share'].forEach(f => { keys[`p_${pIdx}_${f}`] = true; });
  });
  return keys;
};

export const PdfAutoFillPanel = ({ isOpen, onClose, extractedData, onApply }) => {
  const [editData, setEditData] = useState(null);
  const [fieldChecks, setFieldChecks] = useState({});

  useEffect(() => {
    if (extractedData) {
      const cloned = JSON.parse(JSON.stringify(extractedData));
      setEditData(cloned);
      setFieldChecks(buildFieldKeys(cloned));
    }
  }, [extractedData]);

  if (!isOpen || !editData) return null;

  const { buildings = [], land = [], people = [] } = editData;
  const hasData = buildings.length > 0 || land.length > 0 || people.length > 0;

  const isFieldChecked = (key) => !!fieldChecks[key];

  const toggleField = (key) => {
    setFieldChecks(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isSectionChecked = (prefix) => {
    return Object.keys(fieldChecks).filter(k => k.startsWith(prefix)).every(k => fieldChecks[k]);
  };

  const toggleSection = (prefix) => {
    const keys = Object.keys(fieldChecks).filter(k => k.startsWith(prefix));
    const allChecked = keys.every(k => fieldChecks[k]);
    setFieldChecks(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = !allChecked; });
      return next;
    });
  };

  const updateBuilding = (bIdx, field, value) => {
    setEditData(prev => {
      const next = { ...prev, buildings: [...prev.buildings] };
      const b = { ...next.buildings[bIdx], [field]: value };
      if (field === 'struct') {
        delete b.structMaterial;
        delete b.structFloor;
      }
      next.buildings[bIdx] = b;
      return next;
    });
  };

  const updateBuildingFloor = (bIdx, fIdx, area) => {
    setEditData(prev => {
      const next = { ...prev, buildings: [...prev.buildings] };
      const b = { ...next.buildings[bIdx] };
      b.floorAreas = b.floorAreas.map((fa, i) => i === fIdx ? { ...fa, area } : fa);
      next.buildings[bIdx] = b;
      return next;
    });
  };

  const updateAnnex = (bIdx, aIdx, field, value) => {
    setEditData(prev => {
      const next = { ...prev, buildings: [...prev.buildings] };
      const b = { ...next.buildings[bIdx] };
      b.annexes = [...(b.annexes || [])];
      const a = { ...b.annexes[aIdx], [field]: value };
      if (field === 'struct') {
        delete a.structMaterial;
        delete a.structFloor;
      }
      b.annexes[aIdx] = a;
      next.buildings[bIdx] = b;
      return next;
    });
  };

  const updateAnnexFloor = (bIdx, aIdx, fIdx, area) => {
    setEditData(prev => {
      const next = { ...prev, buildings: [...prev.buildings] };
      const b = { ...next.buildings[bIdx] };
      b.annexes = [...(b.annexes || [])];
      const a = { ...b.annexes[aIdx] };
      a.floorAreas = a.floorAreas.map((fa, i) => i === fIdx ? { ...fa, area } : fa);
      b.annexes[aIdx] = a;
      next.buildings[bIdx] = b;
      return next;
    });
  };

  const updateLand = (lIdx, field, value) => {
    setEditData(prev => {
      const next = { ...prev, land: [...prev.land] };
      next.land[lIdx] = { ...next.land[lIdx], [field]: value };
      return next;
    });
  };

  const updatePerson = (pIdx, field, value) => {
    setEditData(prev => {
      const next = { ...prev, people: [...prev.people] };
      next.people[pIdx] = { ...next.people[pIdx], [field]: value };
      return next;
    });
  };

  const handleApply = () => {
    const data = {};
    const anyBuildingField = Object.keys(fieldChecks).some(k => k.startsWith('b_') && fieldChecks[k]);
    const anyLandField = Object.keys(fieldChecks).some(k => k.startsWith('l_') && fieldChecks[k]);
    const anyPeopleField = Object.keys(fieldChecks).some(k => k.startsWith('p_') && fieldChecks[k]);

    if (anyBuildingField && buildings.length > 0) {
      data.buildings = editData.buildings.map((b, bIdx) => {
        const filtered = {};
        if (fieldChecks[`b_${bIdx}_address`]) filtered.address = b.address;
        if (fieldChecks[`b_${bIdx}_houseNum`]) filtered.houseNum = b.houseNum;
        if (fieldChecks[`b_${bIdx}_kind`]) filtered.kind = b.kind;
        if (fieldChecks[`b_${bIdx}_struct`]) {
          filtered.struct = b.struct;
          filtered.structMaterial = b.structMaterial;
          filtered.structFloor = b.structFloor;
        }
        if (fieldChecks[`b_${bIdx}_floorAreas`]) {
          filtered.floorAreas = b.floorAreas;
          filtered.hasBasement = b.hasBasement;
        }
        filtered.id = b.id;
        filtered.annexes = (b.annexes || []).map((a, aIdx) => {
          const af = { id: a.id };
          if (fieldChecks[`b_${bIdx}_a_${aIdx}_symbol`]) af.symbol = a.symbol;
          if (fieldChecks[`b_${bIdx}_a_${aIdx}_kind`]) af.kind = a.kind;
          if (fieldChecks[`b_${bIdx}_a_${aIdx}_struct`]) {
            af.struct = a.struct;
            af.structMaterial = a.structMaterial;
            af.structFloor = a.structFloor;
          }
          if (fieldChecks[`b_${bIdx}_a_${aIdx}_floorAreas`]) {
            af.floorAreas = a.floorAreas;
            af.hasBasement = a.hasBasement;
          }
          return af;
        });
        return filtered;
      });
    }
    if (anyLandField && land.length > 0) {
      data.land = editData.land.map((l, lIdx) => {
        const filtered = { id: l.id };
        if (fieldChecks[`l_${lIdx}_address`]) filtered.address = l.address;
        if (fieldChecks[`l_${lIdx}_lotNumber`]) filtered.lotNumber = l.lotNumber;
        if (fieldChecks[`l_${lIdx}_category`]) filtered.category = l.category;
        if (fieldChecks[`l_${lIdx}_area`]) filtered.area = l.area;
        return filtered;
      });
    }
    if (anyPeopleField && people.length > 0) {
      const ppl = editData.people.map((p, pIdx) => {
        const filtered = { id: p.id };
        if (fieldChecks[`p_${pIdx}_address`]) filtered.address = p.address;
        if (fieldChecks[`p_${pIdx}_name`]) filtered.name = p.name;
        if (fieldChecks[`p_${pIdx}_share`]) filtered.share = p.share;
        filtered.roles = new Set(p.roles || ["申請人"]);
        if (anyBuildingField) filtered.roles.add("建物所有者");
        if (anyLandField) filtered.roles.add("土地所有者");
        filtered.roles = Array.from(filtered.roles);
        filtered.role = filtered.roles.join("、");
        return filtered;
      });
      data.people = ppl;
    }
    onApply(data);
    onClose();
  };

  return (
    <div className="flex flex-col h-full bg-white text-black font-sans">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-slate-50 shrink-0">
        <h3 className="font-bold text-gray-800 text-sm">PDFから読み取った情報</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!hasData && (
          <div className="text-center py-8 text-gray-500">
            <FileText size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-bold text-sm">読み取れる情報が見つかりませんでした</p>
            <p className="text-xs mt-1 text-gray-400">登記情報PDFを表示した状態でお試しください</p>
          </div>
        )}

        {buildings.length > 0 && (
          <Section
            title={`建物情報（${buildings.length}件）`}
            icon={<FileText size={14} className="text-emerald-500" />}
          >
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded" checked={isSectionChecked('b_')} onChange={() => toggleSection('b_')} />
              <span className="text-xs font-bold text-emerald-600">建物情報を反映する</span>
            </label>
            {buildings.map((b, bIdx) => (
              <div key={b.id || bIdx} className="border border-gray-100 rounded p-2 space-y-1 bg-gray-50/50">
                <EditableFieldRow label="所在" value={b.address} checked={isFieldChecked(`b_${bIdx}_address`)} onCheck={() => toggleField(`b_${bIdx}_address`)} onChange={(v) => updateBuilding(bIdx, 'address', v)} />
                <EditableFieldRow label="家屋番号" value={b.houseNum} checked={isFieldChecked(`b_${bIdx}_houseNum`)} onCheck={() => toggleField(`b_${bIdx}_houseNum`)} onChange={(v) => updateBuilding(bIdx, 'houseNum', v)} />
                <EditableFieldRow label="種類" value={b.kind} checked={isFieldChecked(`b_${bIdx}_kind`)} onCheck={() => toggleField(`b_${bIdx}_kind`)} onChange={(v) => updateBuilding(bIdx, 'kind', v)} />
                <EditableFieldRow label="構造" value={b.struct} checked={isFieldChecked(`b_${bIdx}_struct`)} onCheck={() => toggleField(`b_${bIdx}_struct`)} onChange={(v) => updateBuilding(bIdx, 'struct', v)} />
                <EditableFloorAreaRow label="床面積" floorAreas={b.floorAreas} checked={isFieldChecked(`b_${bIdx}_floorAreas`)} onCheck={() => toggleField(`b_${bIdx}_floorAreas`)} onChangeFloor={(fIdx, area) => updateBuildingFloor(bIdx, fIdx, area)} />
                {(b.annexes || []).length > 0 && (
                  <div className="mt-2 border-t border-gray-200 pt-2">
                    <div className="text-[10px] font-bold text-orange-600 mb-1">附属建物</div>
                    {b.annexes.map((a, aIdx) => (
                      <div key={a.id || aIdx} className="border border-orange-100 rounded p-2 space-y-1 bg-orange-50/30 mb-1">
                        <EditableFieldRow label="符号" value={a.symbol} checked={isFieldChecked(`b_${bIdx}_a_${aIdx}_symbol`)} onCheck={() => toggleField(`b_${bIdx}_a_${aIdx}_symbol`)} onChange={(v) => updateAnnex(bIdx, aIdx, 'symbol', v)} />
                        <EditableFieldRow label="種類" value={a.kind} checked={isFieldChecked(`b_${bIdx}_a_${aIdx}_kind`)} onCheck={() => toggleField(`b_${bIdx}_a_${aIdx}_kind`)} onChange={(v) => updateAnnex(bIdx, aIdx, 'kind', v)} />
                        <EditableFieldRow label="構造" value={a.struct || ((a.structMaterial || '') + (a.structFloor || ''))} checked={isFieldChecked(`b_${bIdx}_a_${aIdx}_struct`)} onCheck={() => toggleField(`b_${bIdx}_a_${aIdx}_struct`)} onChange={(v) => updateAnnex(bIdx, aIdx, 'struct', v)} />
                        <EditableFloorAreaRow label="床面積" floorAreas={a.floorAreas} checked={isFieldChecked(`b_${bIdx}_a_${aIdx}_floorAreas`)} onCheck={() => toggleField(`b_${bIdx}_a_${aIdx}_floorAreas`)} onChangeFloor={(fIdx, area) => updateAnnexFloor(bIdx, aIdx, fIdx, area)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {land.length > 0 && (
          <Section
            title={`土地情報（${land.length}件）`}
            icon={<FileText size={14} className="text-blue-500" />}
          >
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded" checked={isSectionChecked('l_')} onChange={() => toggleSection('l_')} />
              <span className="text-xs font-bold text-blue-600">土地情報を反映する</span>
            </label>
            {land.map((l, lIdx) => (
              <div key={l.id || lIdx} className="border border-gray-100 rounded p-2 space-y-1 bg-gray-50/50">
                <EditableFieldRow label="所在" value={l.address} checked={isFieldChecked(`l_${lIdx}_address`)} onCheck={() => toggleField(`l_${lIdx}_address`)} onChange={(v) => updateLand(lIdx, 'address', v)} />
                <EditableFieldRow label="地番" value={l.lotNumber} checked={isFieldChecked(`l_${lIdx}_lotNumber`)} onCheck={() => toggleField(`l_${lIdx}_lotNumber`)} onChange={(v) => updateLand(lIdx, 'lotNumber', v)} />
                <EditableFieldRow label="地目" value={l.category} checked={isFieldChecked(`l_${lIdx}_category`)} onCheck={() => toggleField(`l_${lIdx}_category`)} onChange={(v) => updateLand(lIdx, 'category', v)} />
                <EditableFieldRow label="地積" value={l.area} checked={isFieldChecked(`l_${lIdx}_area`)} onCheck={() => toggleField(`l_${lIdx}_area`)} onChange={(v) => updateLand(lIdx, 'area', v)} />
              </div>
            ))}
          </Section>
        )}

        {people.length > 0 && (
          <Section
            title={`所有者情報（${people.length}件）`}
            icon={<Users size={14} className="text-purple-500" />}
          >
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded" checked={isSectionChecked('p_')} onChange={() => toggleSection('p_')} />
              <span className="text-xs font-bold text-purple-600">所有者情報を反映する</span>
            </label>
            {people.map((p, pIdx) => (
              <div key={p.id || pIdx} className="border border-gray-100 rounded p-2 space-y-1 bg-gray-50/50">
                <EditableFieldRow label="住所" value={p.address} checked={isFieldChecked(`p_${pIdx}_address`)} onCheck={() => toggleField(`p_${pIdx}_address`)} onChange={(v) => updatePerson(pIdx, 'address', v)} />
                <EditableFieldRow label="氏名" value={p.name} checked={isFieldChecked(`p_${pIdx}_name`)} onCheck={() => toggleField(`p_${pIdx}_name`)} onChange={(v) => updatePerson(pIdx, 'name', v)} />
                {p.share && <EditableFieldRow label="持分" value={p.share} checked={isFieldChecked(`p_${pIdx}_share`)} onCheck={() => toggleField(`p_${pIdx}_share`)} onChange={(v) => updatePerson(pIdx, 'share', v)} />}
              </div>
            ))}
          </Section>
        )}
      </div>

      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-black">
          キャンセル
        </button>
        <button
          onClick={handleApply}
          disabled={!hasData}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 flex items-center gap-2"
        >
          <Check size={16} /> 入力に反映
        </button>
      </div>
    </div>
  );
};
