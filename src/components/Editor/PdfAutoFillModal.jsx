import React, { useState } from 'react';
import { FileText, Users, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';

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

const FieldRow = ({ label, value, checked, onChange }) => {
  if (!value) return null;
  return (
    <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
      <input
        type="checkbox"
        className="mt-0.5 w-4 h-4 rounded"
        checked={checked}
        onChange={onChange}
      />
      <span className="text-[10px] font-bold text-gray-500 min-w-[60px] shrink-0">{label}</span>
      <span className="text-sm text-gray-800 break-all">{value}</span>
    </label>
  );
};

const FloorAreaDisplay = ({ floorAreas }) => {
  if (!floorAreas || floorAreas.length === 0) return null;
  return (
    <span className="text-sm text-gray-800">
      {floorAreas.map((fa, i) => (
        <span key={fa.id || i}>
          {i > 0 && "、"}
          {fa.floor} {fa.area}㎡
        </span>
      ))}
    </span>
  );
};

export const PdfAutoFillModal = ({ isOpen, onClose, extractedData, onApply }) => {
  const [selections, setSelections] = useState(() => ({
    buildings: true,
    land: true,
    people: true,
  }));

  if (!extractedData) return null;

  const { buildings = [], land = [], people = [] } = extractedData;
  const hasData = buildings.length > 0 || land.length > 0 || people.length > 0;

  const toggleSelection = (key) => {
    setSelections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApply = () => {
    const data = {};
    if (selections.buildings && buildings.length > 0) data.buildings = buildings;
    if (selections.land && land.length > 0) data.land = land;
    if (selections.people && people.length > 0) data.people = people;
    onApply(data);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="PDFから読み取った情報"
      maxWidth="max-w-2xl"
      footer={
        <>
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
        </>
      }
    >
      <div className="space-y-4 text-black max-h-[60vh] overflow-y-auto">
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
              <input
                type="checkbox"
                className="w-4 h-4 rounded"
                checked={selections.buildings}
                onChange={() => toggleSelection('buildings')}
              />
              <span className="text-xs font-bold text-emerald-600">建物情報を反映する</span>
            </label>
            {buildings.map((b, idx) => (
              <div key={b.id || idx} className="border border-gray-100 rounded p-2 space-y-1 bg-gray-50/50">
                <FieldRow label="所在" value={b.address} checked={selections.buildings} onChange={() => toggleSelection('buildings')} />
                <FieldRow label="家屋番号" value={b.houseNum} checked={selections.buildings} onChange={() => toggleSelection('buildings')} />
                <FieldRow label="種類" value={b.kind} checked={selections.buildings} onChange={() => toggleSelection('buildings')} />
                <FieldRow label="構造" value={b.struct} checked={selections.buildings} onChange={() => toggleSelection('buildings')} />
                {b.floorAreas && b.floorAreas.length > 0 && (
                  <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 rounded" checked={selections.buildings} onChange={() => toggleSelection('buildings')} />
                    <span className="text-[10px] font-bold text-gray-500 min-w-[60px] shrink-0">床面積</span>
                    <FloorAreaDisplay floorAreas={b.floorAreas} />
                  </label>
                )}
                {b.registrationCause && (
                  <FieldRow label="登記原因" value={b.registrationCause} checked={selections.buildings} onChange={() => toggleSelection('buildings')} />
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
              <input
                type="checkbox"
                className="w-4 h-4 rounded"
                checked={selections.land}
                onChange={() => toggleSelection('land')}
              />
              <span className="text-xs font-bold text-blue-600">土地情報を反映する</span>
            </label>
            {land.map((l, idx) => (
              <div key={l.id || idx} className="border border-gray-100 rounded p-2 space-y-1 bg-gray-50/50">
                <FieldRow label="所在" value={l.address} checked={selections.land} onChange={() => toggleSelection('land')} />
                <FieldRow label="地番" value={l.lotNumber} checked={selections.land} onChange={() => toggleSelection('land')} />
                <FieldRow label="地目" value={l.category} checked={selections.land} onChange={() => toggleSelection('land')} />
                <FieldRow label="地積" value={l.area} checked={selections.land} onChange={() => toggleSelection('land')} />
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
              <input
                type="checkbox"
                className="w-4 h-4 rounded"
                checked={selections.people}
                onChange={() => toggleSelection('people')}
              />
              <span className="text-xs font-bold text-purple-600">所有者情報を反映する</span>
            </label>
            {people.map((p, idx) => (
              <div key={p.id || idx} className="border border-gray-100 rounded p-2 space-y-1 bg-gray-50/50">
                <FieldRow label="住所" value={p.address} checked={selections.people} onChange={() => toggleSelection('people')} />
                <FieldRow label="氏名" value={p.name} checked={selections.people} onChange={() => toggleSelection('people')} />
                {p.share && <FieldRow label="持分" value={p.share} checked={selections.people} onChange={() => toggleSelection('people')} />}
              </div>
            ))}
          </Section>
        )}
      </div>
    </Modal>
  );
};
