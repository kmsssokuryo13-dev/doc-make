import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, RotateCcw as ResetIcon } from 'lucide-react';
import { naturalSortList, stableSortKeys, getOrderedDocs } from '../../utils.js';
import { APPLICATION_TYPES } from '../../constants.js';
import { StepBadge } from '../ui/StepBadge.jsx';
import { CountRow } from '../ui/CountRow.jsx';
import { DocRow } from '../ui/DocRow.jsx';
import { DocTemplate } from '../DocTemplate/DocTemplate.jsx';

export const Docs = ({ sites, setSites, contractors, scriveners }) => {
  const [params] = useSearchParams();
  const siteId = params.get('siteId');
  const navigate = useNavigate();
  const siteData = sites.find(s => s.id === siteId);
  const [step, setStep] = useState(1);
  const [activeInstanceKey, setActiveInstanceKey] = useState("");

  const orderedDocs = useMemo(() => siteData ? getOrderedDocs(siteData.applications || {}) : [], [siteData?.applications]);

  const DOC_TITLE = "委任状（表題）";
  const DEFAULT_PICK = {
    applicantPersonIds: [],
    showMain: true,
    showAnnex: true,
    reg: { ids: [] },
    prop: { ids: [] },
    customText: null,
    stampPositions: null,
    signerStampPositions: null,
    printOn: true,
    targetPropBuildingId: "",
    targetContractorPersonId: "",
    targetLandIds: [],
    statementPersonIds: [],
    statementApplicantPersonId: "",
    statementConfirmApplicantPersonId: "",
    confirmApplicantPersonIds: []
  };

  const allInstances = useMemo(() => {
    if (!siteData) return [];
    const docs = siteData.documents || {};
    const instances = [];
    const orderedNames = (orderedDocs || []).map(d => d.name);
    const orderedSet = new Set(orderedNames);
    (orderedDocs || []).forEach((d) => {
      const name = d.name;
      const c = Number(docs?.[name] || 0);
      if (!name || c <= 0) return;
      for (let i = 1; i <= c; i++) instances.push({ name, index: i, key: `${name}__${i}`, sources: d.sources || [] });
    });
    Object.entries(docs).forEach(([name, count]) => {
      if (!name || orderedSet.has(name)) return;
      for (let i = 1; i <= (Number(count) || 0); i++) instances.push({ name, index: i, key: `${name}__${i}`, sources: [] });
    });
    return instances;
  }, [siteData, orderedDocs]);

  const activeInstance = useMemo(
    () => (allInstances || []).find(i => i.key === activeInstanceKey) || null,
    [allInstances, activeInstanceKey]
  );

  const activePick = {
    ...DEFAULT_PICK,
    ...(siteData?.docPick?.[activeInstanceKey] || {})
  };

  useEffect(() => {
    if (!siteId || !siteData) return;

    setSites(prev => {
      let changedAny = false;
      const next = prev.map(s => {
        if (s.id !== siteId) return s;

        const buildings = naturalSortList(s.proposedBuildings || [], "houseNum");
        const buildingLimit = buildings.length;

        const apps = { ...(s.applications || {}) };
        const rawTitleCount = Number(apps["建物表題登記"] || 0);
        const clampedTitleCount = Math.min(rawTitleCount, buildingLimit);

        if (rawTitleCount !== clampedTitleCount) {
          apps["建物表題登記"] = clampedTitleCount;
          changedAny = true;
        }

        const desiredCount = clampedTitleCount;
        const docs = { ...(s.documents || {}) };
        const curCount = Number(docs[DOC_TITLE] || 0);
        if (curCount !== desiredCount) {
          docs[DOC_TITLE] = desiredCount;
          changedAny = true;
        }

        const pickMap = { ...(s.docPick || {}) };
        const idAt = (i) => (buildings[i] ? buildings[i].id : "");
        const isValidId = (id) => !!id && buildings.some(b => b.id === id);

        for (let i = 1; i <= desiredCount; i++) {
          const key = `${DOC_TITLE}__${i}`;
          const before = pickMap[key];
          const base = { ...DEFAULT_PICK, ...(before || {}) };

          if (!isValidId(base.targetPropBuildingId)) {
            base.targetPropBuildingId = idAt(i - 1);
          }

          const beforeStr = before ? JSON.stringify(before) : "";
          const afterStr = JSON.stringify(base);
          if (beforeStr !== afterStr) {
            pickMap[key] = base;
            changedAny = true;
          } else {
            pickMap[key] = before;
          }
        }

        const STATEMENT_DOCS = ["申述書（共有）", "申述書（単独）"];
        const fallbackPropId = idAt(0);

        for (const docName of STATEMENT_DOCS) {
          const c = Number(docs?.[docName] || 0);
          if (c <= 0) continue;

          for (let i = 1; i <= c; i++) {
            const key = `${docName}__${i}`;
            const before = pickMap[key];
            const base = { ...DEFAULT_PICK, ...(before || {}) };

            if (!isValidId(base.targetPropBuildingId)) {
              base.targetPropBuildingId = fallbackPropId || "";
            }

            const beforeStr = before ? JSON.stringify(before) : "";
            const afterStr = JSON.stringify(base);
            if (beforeStr !== afterStr) {
              pickMap[key] = base;
              changedAny = true;
            } else {
              pickMap[key] = before;
            }
          }
        }

        if (!changedAny) return s;

        return {
          ...s,
          applications: stableSortKeys(apps),
          documents: stableSortKeys(docs),
          docPick: stableSortKeys(pickMap),
        };
      });
      return changedAny ? next : prev;
    });
  }, [siteId, siteData?.proposedBuildings, siteData?.applications, siteData?.documents, siteData?.docPick]);

  useEffect(() => {
    if (!siteId || !siteData) return;
    if (step < 2) return;
    const requiredNames = (orderedDocs || []).filter(d => d.isRequired).map(d => d.name);
    if (requiredNames.length === 0) return;
    const currentDocs = siteData.documents || {};
    const nextDocs = { ...currentDocs };
    let changed = false;
    for (const name of requiredNames) {
      if (name === DOC_TITLE) continue;
      const c = Number(nextDocs[name] || 0);
      if (c < 1) { nextDocs[name] = 1; changed = true; }
    }
    if (!changed) return;
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, documents: stableSortKeys(nextDocs) } : s));
  }, [step, siteId, siteData, orderedDocs, setSites]);

  useEffect(() => {
    if (step !== 3 || !allInstances.length) return;
    if (!allInstances.some(i => i.key === activeInstanceKey)) {
      setActiveInstanceKey(allInstances[0].key);
    }
  }, [step, allInstances, activeInstanceKey]);

  const handlePickChange = (instanceKey, patch) => {
    const current = {
      ...DEFAULT_PICK,
      ...(siteData?.docPick?.[instanceKey] || {})
    };
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, docPick: { ...s.docPick, [instanceKey]: { ...current, ...patch } } } : s));
  };

  const handleStampPosChange = (index, nextDx, nextDy) => {
    const current = siteData?.docPick?.[activeInstanceKey] || {};
    const list = Array.isArray(current.stampPositions) ? current.stampPositions : [];
    const next = list.filter(p => p?.i !== index);
    next.push({ i: index, dx: nextDx, dy: nextDy });
    handlePickChange(activeInstanceKey, { stampPositions: next });
  };

  const handleSignerStampPosChange = (index, nextDx, nextDy) => {
    const current = siteData?.docPick?.[activeInstanceKey] || {};
    const list = Array.isArray(current.signerStampPositions) ? current.signerStampPositions : [];
    const next = list.filter(p => p?.i !== index);
    next.push({ i: index, dx: nextDx, dy: nextDy });
    handlePickChange(activeInstanceKey, { signerStampPositions: next });
  };

  const printInstances = useMemo(() => allInstances.filter(inst => (siteData?.docPick?.[inst.key]?.printOn ?? true)), [allInstances, siteData?.docPick]);

  const printSelectedInNewWindow = () => {
    const el = document.getElementById("print-area");
    if (!el || !printInstances.length) { alert("印刷対象がありません。"); return; }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => node.outerHTML).join("\n");
    const extraPrintCss = `<style>@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: white; } .break-before-page { break-before: page; page-break-before: always; } .doc-no-bold, .doc-no-bold * { font-weight: normal !important; }</style>`;
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>印刷</title>${styles}${extraPrintCss}</head><body>${el.innerHTML}</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html); w.document.close();
    w.onload = () => { setTimeout(() => { w.focus(); w.print(); setTimeout(() => w.close(), 500); }, 300); };
  };

  const applicantsInPeople = useMemo(
    () => (siteData?.people || []).filter(p => (p.roles || []).includes("申請人")),
    [siteData?.people]
  );

  const statementEligiblePeople = useMemo(
    () => (siteData?.people || []).filter(p => {
      const roles = p?.roles || [];
      return roles.includes("申請人") || roles.includes("建築申請人");
    }),
    [siteData?.people]
  );

  const contractorsInPeople = useMemo(() => (siteData?.people || []).filter(p => (p.roles || []).includes("工事人")), [siteData?.people]);

  if (!siteData) return <div className="h-screen flex items-center justify-center text-black font-bold">案件が見つかりません。</div>;

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden font-sans text-black">
      <style>{`
        .doc-editable[contenteditable="true"]:focus { outline: 1px dashed #60a5fa; outline-offset: 4px; border-radius: 4px; }
        .stamp-drag-handle { cursor: grab; }
        .stamp-dragging { cursor: grabbing; border: 1px solid #60a5fa !important; }
        .doc-no-bold, .doc-no-bold * { font-weight: normal !important; }
        @media print {
          .doc-editable[contenteditable="true"], .doc-editable[contenteditable="true"]:focus { outline: none !important; }
          .stamp-drag-handle, .stamp-dragging { cursor: default !important; border: 0.3mm dotted #666 !important; }
        }
      `}</style>

      <div className="hidden"><div id="print-area">
        {printInstances.map((inst, i) => (
          <div key={inst.key} className={`w-[210mm] h-[297mm] bg-white font-serif leading-relaxed ${i > 0 ? "break-before-page" : ""} relative`}>
            <DocTemplate name={inst.name} siteData={siteData} instanceIndex={inst.index} instanceKey={inst.key} pick={siteData?.docPick?.[inst.key] || DEFAULT_PICK} isPrint={true} scriveners={scriveners} />
          </div>
        ))}
      </div></div>

      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-30">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-slate-100 rounded-full transition-all"><ArrowLeft size={20}/></button>
          <div><h1 className="font-bold text-slate-800 leading-tight">{siteData.name}</h1><p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Document Wizard</p></div>
        </div>
        <div className="flex items-center gap-2 font-bold">
          <StepBadge num={1} label="申請選択" active={step === 1} completed={step > 1} />
          <div className="w-8 h-px bg-slate-200" /><StepBadge num={2} label="書類選定" active={step === 2} completed={step > 2} />
          <div className="w-8 h-px bg-slate-200" /><StepBadge num={3} label="書類作成" active={step === 3} />
        </div>
        <div className="flex gap-2">
          {step > 1 && <button onClick={() => setStep(step - 1)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">戻る</button>}
          {step < 3 ? <button onClick={() => setStep(step + 1)} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-lg active:scale-95 transition-all">次へ進む</button>
          : <button onClick={printSelectedInNewWindow} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 flex items-center gap-2 shadow-lg active:scale-95 transition-all"><Printer size={18} /> 印刷実行</button>}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {step === 1 && (
          <div className="max-w-3xl mx-auto space-y-4">
            <h2 className="text-lg font-black text-slate-800 mb-6">1. 申請する登記を選択</h2>
            {APPLICATION_TYPES.map(type => (
              <CountRow key={type} label={type} count={siteData?.applications?.[type] || 0}
                onChange={(d) => setSites(prev => prev.map(s => s.id === siteId ? { ...s, applications: { ...s.applications, [type]: Math.max(0, (s.applications[type]||0) + d) } } : s))} />
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="max-w-4xl mx-auto space-y-4 font-sans font-bold">
            <h2 className="text-lg font-black text-slate-800 mb-6">2. 作成する書類を選定</h2>
            {orderedDocs.length === 0 ? <p className="p-12 text-center text-gray-400 bg-white border border-dashed rounded-2xl">登記申請を選択してください。</p>
            : <div className="space-y-3">{orderedDocs.map(d => (
                <DocRow key={d.name} name={d.name} count={siteData?.documents?.[d.name] || 0} isRequired={d.isRequired} sources={d.sources}
                  onChange={(delta) => setSites(prev => prev.map(s => s.id === siteId ? { ...s, documents: { ...s.documents, [d.name]: Math.max(0, (s.documents?.[d.name]||0) + delta) } } : s))} />
              ))}</div>}
          </div>
        )}

        {step === 3 && (
          <div className="h-full flex gap-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-64 shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
              <div><h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-2">作成書類一覧</h3>
                <div className="space-y-1.5">{allInstances.map(inst => {
                    const printOn = siteData?.docPick?.[inst.key]?.printOn ?? true;
                    return (
                      <button key={inst.key} onClick={() => setActiveInstanceKey(inst.key)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceKey === inst.key ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                        <div className="flex items-center justify-between"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div>
                      </button>
                    );
                  })}</div></div>

              {activeInstance && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4 font-bold">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">書類設定</h4>
                  {activeInstance.name !== "委任状（地目変更）" && activeInstance.name !== "委任状（滅失）" && activeInstance.name !== "滅失証明書（滅失）" && activeInstance.name !== "非登載証明書" && (
                    <div className="space-y-2 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={activePick.showMain ?? true} onChange={e => handlePickChange(activeInstanceKey, { showMain: e.target.checked })} />主建物を表示</label><label className="flex items-center gap-2"><input type="checkbox" checked={activePick.showAnnex ?? true} onChange={e => handlePickChange(activeInstanceKey, { showAnnex: e.target.checked })} />附属建物を表示</label></div>
                  )}
                  {(() => {
  const isStatement = activeInstance && (activeInstance.name === "申述書（共有）" || activeInstance.name === "申述書（単独）");
  if (isStatement) return null;

  const isLossCert = activeInstance && activeInstance.name === "滅失証明書（滅失）";
  if (isLossCert) return null;

  const isNtrCert = activeInstance && activeInstance.name === "非登載証明書";
  if (isNtrCert) return null;

  const isLandCategoryChange = activeInstance && activeInstance.name === "委任状（地目変更）";
  const isLoss = activeInstance && activeInstance.name === "委任状（滅失）";

  if (isLoss) {
    const lossBuildings = (siteData?.proposedBuildings || []).filter(pb => (pb.registrationCause || "").includes("滅失"));
    const curBldgIds = Array.isArray(activePick.lossBuildingIds) ? activePick.lossBuildingIds : [];
    const defaultBldgIds = new Set(lossBuildings.map(pb => pb.id));
    const effectiveBldgSet = curBldgIds.length > 0 ? new Set(curBldgIds) : defaultBldgIds;

    const toggleBldg = (id) => {
      const base = new Set(curBldgIds.length > 0 ? curBldgIds : Array.from(defaultBldgIds));
      if (base.has(id)) base.delete(id);
      else base.add(id);
      handlePickChange(activeInstanceKey, { lossBuildingIds: Array.from(base) });
    };

    const candidates = (siteData?.people || []).filter(p => {
      const roles = p?.roles || [];
      return roles.includes("建物所有者") || roles.includes("申請人");
    });
    const curAppl = Array.isArray(activePick.applicantPersonIds) ? activePick.applicantPersonIds : [];
    const defaultApplIds = new Set(candidates.filter(p => (p.roles || []).includes("建物所有者")).map(p => p.id));
    const effectiveApplSet = curAppl.length > 0 ? new Set(curAppl) : defaultApplIds;

    const toggleAppl = (id) => {
      const base = new Set(curAppl.length > 0 ? curAppl : Array.from(defaultApplIds));
      if (base.has(id)) base.delete(id);
      else base.add(id);
      if (base.size === 0) return;
      handlePickChange(activeInstanceKey, { applicantPersonIds: Array.from(base) });
    };

    return (
      <>
        <div className="text-black">
          <label className="block text-[10px] font-bold text-gray-500 mb-2">滅失する建物を選択</label>
          {lossBuildings.length === 0 ? (
            <p className="text-[10px] text-slate-400">登記原因「滅失」の申請建物がありません。</p>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {lossBuildings.map((pb) => (
                <label
                  key={pb.id}
                  className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                    effectiveBldgSet.has(pb.id)
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-white border-slate-200 text-slate-500"
                  }`}
                >
                  <input type="checkbox" className="w-3 h-3 rounded" checked={effectiveBldgSet.has(pb.id)} onChange={() => toggleBldg(pb.id)} />
                  <span className="truncate">{pb.houseNum || "(家屋番号未入力)"}{pb.address ? ` - ${pb.address}` : ""}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="border-t pt-4 text-black">
          <label className="block text-[10px] font-bold text-gray-500 mb-2">この書類で使う申請人</label>
          {candidates.length === 0 ? (
            <p className="text-[10px] text-slate-400">「建物所有者」または「申請人」が登録されていません。</p>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {candidates.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                    effectiveApplSet.has(p.id)
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-white border-slate-200 text-slate-500"
                  }`}
                >
                  <input type="checkbox" className="w-3 h-3 rounded" checked={effectiveApplSet.has(p.id)} onChange={() => toggleAppl(p.id)} />
                  <span className="truncate">{p.name || "(氏名未入力)"}{` [${(p.roles || []).join("、")}]`}</span>
                </label>
              ))}
              <p className="text-[9px] text-slate-400 mt-1">※0人にはできません（最低1人）</p>
            </div>
          )}
        </div>
      </>
    );
  }

  if (isLandCategoryChange) {
    const candidates = (siteData?.people || []).filter(p => {
      const roles = p?.roles || [];
      return roles.includes("土地所有者") || roles.includes("申請人");
    });
    const cur = Array.isArray(activePick.applicantPersonIds) ? activePick.applicantPersonIds : [];
    const defaultIds = new Set(candidates.filter(p => (p.roles || []).includes("土地所有者")).map(p => p.id));
    const effectiveSet = cur.length > 0 ? new Set(cur) : defaultIds;

    const toggleOne = (id) => {
      const base = new Set(cur.length > 0 ? cur : Array.from(defaultIds));
      if (base.has(id)) base.delete(id);
      else base.add(id);
      if (base.size === 0) return;
      handlePickChange(activeInstanceKey, { applicantPersonIds: Array.from(base) });
    };

    return (
      <div className="border-t pt-4 text-black">
        <label className="block text-[10px] font-bold text-gray-500 mb-2">
          この書類で使う申請人
        </label>
        {candidates.length === 0 ? (
          <p className="text-[10px] text-slate-400">「土地所有者」または「申請人」が登録されていません。</p>
        ) : (
          <div className="grid grid-cols-1 gap-1">
            {candidates.map((p) => (
              <label
                key={p.id}
                className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                  effectiveSet.has(p.id)
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-white border-slate-200 text-slate-500"
                }`}
              >
                <input
                  type="checkbox"
                  className="w-3 h-3 rounded"
                  checked={effectiveSet.has(p.id)}
                  onChange={() => toggleOne(p.id)}
                />
                <span className="truncate">{p.name || "(氏名未入力)"}{` [${(p.roles || []).join("、")}]`}</span>
              </label>
            ))}
            <p className="text-[9px] text-slate-400 mt-1">※0人にはできません（最低1人）</p>
          </div>
        )}
      </div>
    );
  }

  const all = applicantsInPeople || [];
  const cur = Array.isArray(activePick.applicantPersonIds) ? activePick.applicantPersonIds : [];
  const selecting = cur.length > 0;
  const curSet = new Set(cur);

  const setSelecting = (on) => {
    if (!on) {
      handlePickChange(activeInstanceKey, { applicantPersonIds: [] });
      return;
    }
    handlePickChange(activeInstanceKey, { applicantPersonIds: all.map(p => p.id) });
  };

  const toggleOne = (id) => {
    const nextSet = new Set(curSet);
    if (nextSet.has(id)) nextSet.delete(id);
    else nextSet.add(id);

    const next = Array.from(nextSet);
    if (next.length === 0) return;
    handlePickChange(activeInstanceKey, { applicantPersonIds: next });
  };

  return (
    <div className="border-t pt-4 text-black">
      <label className="block text-[10px] font-bold text-gray-500 mb-2">
        この書類で使う申請人
      </label>

      {all.length === 0 ? (
        <p className="text-[10px] text-slate-400">申請人が登録されていません。</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600">
            <input
              type="checkbox"
              className="w-3 h-3 rounded"
              checked={selecting}
              onChange={(e) => setSelecting(e.target.checked)}
            />
            申請人を指定する（OFFなら全員）
          </label>

          {selecting && (
            <div className="mt-2 grid grid-cols-1 gap-1">
              {all.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                    curSet.has(p.id)
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-white border-slate-200 text-slate-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="w-3 h-3 rounded"
                    checked={curSet.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                  />
                  <span className="truncate">{p.name || "(氏名未入力)"}</span>
                </label>
              ))}
              <p className="text-[9px] text-slate-400 mt-1">※0人にはできません（最低1人）</p>
            </div>
          )}
        </>
      )}
    </div>
  );
})()}

                  {activeInstance.name === "委任状（表題）" && (
                    <div className="border-t pt-4">
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">予定家屋番号選択</label>
                      <select
                        className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                        value={activePick.targetPropBuildingId || ""}
                        onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                      >
                        <option value="">(未選択)</option>
                        {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                          <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(activeInstance.name === "申述書（共有）" || activeInstance.name === "申述書（単独）") && (
                    <div className="border-t pt-4 text-black">
                      <div className="space-y-3">

                        {(() => {
                          const confirmCandidates = (siteData?.people || []).filter(p => {
                            const roles = p?.roles || [];
                            return roles.includes("申請人") || roles.includes("建築申請人");
                          });
                          const curConfirm = Array.isArray(activePick.confirmApplicantPersonIds) ? activePick.confirmApplicantPersonIds : [];
                          const defaultIds = new Set(confirmCandidates.filter(p => (p.roles || []).includes("建築申請人")).map(p => p.id));
                          const effectiveConfirmSet = curConfirm.length > 0 ? new Set(curConfirm) : defaultIds;

                          const toggleConfirm = (id) => {
                            const base = new Set(curConfirm.length > 0 ? curConfirm : Array.from(defaultIds));
                            if (base.has(id)) base.delete(id);
                            else base.add(id);
                            handlePickChange(activeInstanceKey, { confirmApplicantPersonIds: Array.from(base) });
                          };

                          return (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 mb-2">
                                建築確認の申請人
                              </label>
                              {confirmCandidates.length === 0 ? (
                                <p className="text-[10px] text-slate-400">「申請人」または「建築申請人」が登録されていません。</p>
                              ) : (
                                <div className="grid grid-cols-1 gap-1">
                                  {confirmCandidates.map((p) => (
                                    <label
                                      key={p.id}
                                      className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                        effectiveConfirmSet.has(p.id)
                                          ? "bg-blue-50 border-blue-200 text-blue-700"
                                          : "bg-white border-slate-200 text-slate-500"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="w-3 h-3 rounded"
                                        checked={effectiveConfirmSet.has(p.id)}
                                        onChange={() => toggleConfirm(p.id)}
                                      />
                                      <span className="truncate">{p.name || "(氏名未入力)"}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetPropBuildingId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                          >
                            <option value="">(未選択)</option>
                            {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                              <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>

                        {activeInstance.name === "申述書（単独）" && (
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">
                              申請人（単独出資者）
                            </label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.statementApplicantPersonId || ""}
                              onChange={e => handlePickChange(activeInstanceKey, { statementApplicantPersonId: e.target.value })}
                            >
                              <option value="">(未選択)</option>
                              {(applicantsInPeople || []).map(p => (
                                <option key={p.id} value={p.id}>{p.name || "(氏名未入力)"}</option>
                              ))}
                            </select>
                            <p className="text-[9px] text-slate-400 mt-1">※未選択の場合、文中は「［申請人］」表示になります</p>
                          </div>
                        )}

                        {(() => {
                          let candidates = (siteData?.people || []).filter(p =>
                            (p.roles || []).includes("建築申請人")
                          );

                          if (candidates.length === 0) {
                            candidates = (siteData?.people || []).filter(p =>
                              (p.roles || []).includes("申請人")
                            );
                          }

                          if (candidates.length === 0) {
                            return <p className="text-[10px] text-slate-400">「建築申請人」かつ「申請人」の人が登録されていません。</p>;
                          }

                          const cur = Array.isArray(activePick.statementPersonIds) ? activePick.statementPersonIds : [];
                          const selecting = cur.length > 0;
                          const curSet = new Set(cur);

                          const toggleOne= (id) => {
                            const base = new Set(selecting ? cur : candidates.map(p => p.id));
                            if (base.has(id)) base.delete(id);
                            else base.add(id);
                            if (base.size === 0) return;
                            handlePickChange(activeInstanceKey, { statementPersonIds: Array.from(base) });
                          };

                          const effectiveSet= new Set(selecting ? cur : candidates.map(p => p.id));

                          return (
                            <div className="mt-1">
                              <label className="block text-[10px] font-bold text-gray-500 mb-2">
                                申述人（署名・押印する人）
                              </label>

                              <div className="mt-2 grid grid-cols-1 gap-1">
                                {candidates.map((p) => (
                                  <label
                                    key={p.id}
                                    className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                      effectiveSet.has(p.id)
                                        ? "bg-blue-50 border-blue-200 text-blue-700"
                                        : "bg-white border-slate-200 text-slate-500"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="w-3 h-3 rounded"
                                      checked={effectiveSet.has(p.id)}
                                      onChange={() => toggleOne(p.id)}
                                    />
                                    <span className="truncate">{p.name || "(氏名未入力)"}</span>
                                  </label>
                                ))}
                                <p className="text-[9px] text-slate-400 mt-1">※0人にはできません（最低1人）</p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {activeInstance.name === "委任状（住所変更）" && (
                    <div className="border-t pt-4 text-black">
                      <label className="block text-[10px] font-bold text-gray-500 mb-2">
                        表示する地番（複数選択可）
                      </label>

                      {(() => {
                        const all = naturalSortList(siteData.land || [], "lotNumber");
                        if (all.length === 0) {
                          return <p className="text-[10px] text-slate-400">既登記土地情報が登録されていません。</p>;
                        }

                        const cur = Array.isArray(activePick.targetLandIds) ? activePick.targetLandIds : [];
                        const curSet = new Set(cur.length ? cur : all.map(l => l.id));

                        const toggleOne = (id) => {
                          const base = new Set(cur.length ? cur : all.map(l => l.id));
                          if (base.has(id)) base.delete(id);
                          else base.add(id);
                          if (base.size === 0) return;
                          handlePickChange(activeInstanceKey, { targetLandIds: Array.from(base) });
                        };

                        const setAll = () => handlePickChange(activeInstanceKey, { targetLandIds: [] });

                        return (
                          <>
                            {all.length >= 2 && (
                              <button
                                type="button"
                                onClick={setAll}
                                className="mb-2 w-full py-1.5 text-[9px] font-bold rounded bg-slate-100 hover:bg-slate-200"
                              >
                                全て選択に戻す
                              </button>
                            )}

                            <div className="grid grid-cols-1 gap-1">
                              {all.map((l) => (
                                <label
                                  key={l.id}
                                  className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                    curSet.has(l.id)
                                      ? "bg-blue-50 border-blue-200 text-blue-700"
                                      : "bg-white border-slate-200 text-slate-500"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="w-3 h-3 rounded"
                                    checked={curSet.has(l.id)}
                                    onChange={() => toggleOne(l.id)}
                                  />
                                  <span className="truncate">
                                    {l.lotNumber || "(地番未入力)"}{l.address ? `　${l.address}` : ""}
                                  </span>
                                </label>
                              ))}
                              <p className="text-[9px] text-slate-400 mt-1">※少なくとも1つは選択してください</p>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {(activeInstance.name === "滅失証明書（滅失）" || activeInstance.name === "非登載証明書") && (
                    <div>
                      <div className="space-y-3">
                        {(() => {
                          const lossBuildings = (siteData?.proposedBuildings || []).filter(pb => (pb.registrationCause || "").includes("滅失"));
                          const curBldgIds = Array.isArray(activePick.lossBuildingIds) ? activePick.lossBuildingIds : [];
                          const defaultBldgIds = new Set(lossBuildings.map(pb => pb.id));
                          const effectiveBldgSet = curBldgIds.length > 0 ? new Set(curBldgIds) : defaultBldgIds;

                          const toggleBldg = (id) => {
                            const base = new Set(curBldgIds.length > 0 ? curBldgIds : Array.from(defaultBldgIds));
                            if (base.has(id)) base.delete(id);
                            else base.add(id);
                            handlePickChange(activeInstanceKey, { lossBuildingIds: Array.from(base) });
                          };

                          return (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 mb-2">滅失する建物を選択</label>
                              {lossBuildings.length === 0 ? (
                                <p className="text-[10px] text-slate-400">登記原因「滅失」の申請建物がありません。</p>
                              ) : (
                                <div className="grid grid-cols-1 gap-1">
                                  {lossBuildings.map((pb) => (
                                    <label
                                      key={pb.id}
                                      className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                        effectiveBldgSet.has(pb.id)
                                          ? "bg-blue-50 border-blue-200 text-blue-700"
                                          : "bg-white border-slate-200 text-slate-500"
                                      }`}
                                    >
                                      <input type="checkbox" className="w-3 h-3 rounded" checked={effectiveBldgSet.has(pb.id)} onChange={() => toggleBldg(pb.id)} />
                                      <span className="truncate">{pb.houseNum || "(家屋番号未入力)"}{pb.address ? ` - ${pb.address}` : ""}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {(() => {
                          const ownerCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("建物所有者") || (p.roles || []).includes("申請人"));
                          const curOwner = Array.isArray(activePick.lossCertOwnerIds) ? activePick.lossCertOwnerIds : [];
                          const defaultOwnerIds = new Set(ownerCandidates.filter(p => (p.roles || []).includes("建物所有者")).map(p => p.id));
                          const effectiveOwnerSet = curOwner.length > 0 ? new Set(curOwner) : defaultOwnerIds;

                          const toggleOwner = (id) => {
                            const base = new Set(curOwner.length > 0 ? curOwner : Array.from(defaultOwnerIds));
                            if (base.has(id)) base.delete(id);
                            else base.add(id);
                            handlePickChange(activeInstanceKey, { lossCertOwnerIds: Array.from(base) });
                          };

                          return (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 mb-2">建物所有者を選択</label>
                              {ownerCandidates.length === 0 ? (
                                <p className="text-[10px] text-slate-400">「建物所有者」または「申請人」が登録されていません。</p>
                              ) : (
                                <div className="grid grid-cols-1 gap-1">
                                  {ownerCandidates.map((p) => (
                                    <label
                                      key={p.id}
                                      className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                        effectiveOwnerSet.has(p.id)
                                          ? "bg-blue-50 border-blue-200 text-blue-700"
                                          : "bg-white border-slate-200 text-slate-500"
                                      }`}
                                    >
                                      <input type="checkbox" className="w-3 h-3 rounded" checked={effectiveOwnerSet.has(p.id)} onChange={() => toggleOwner(p.id)} />
                                      <span className="truncate">{p.name || "(氏名未入力)"} [{(p.roles || []).join("、")}]</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {activeInstance.name === "滅失証明書（滅失）" && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">工事人を選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetContractorPersonId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetContractorPersonId: e.target.value })}
                          >
                            <option value="">(未選択・最初の工事人)</option>
                            {(contractorsInPeople || []).map(p => (
                              <option key={p.id} value={p.id}>{p.name || "(名前未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeInstance.name === "工事完了引渡証明書（表題）"&& (
                    <div className="border-t pt-4">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">工事人を選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetContractorPersonId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetContractorPersonId: e.target.value })}
                          >
                            <option value="">(未選択・最初の工事人)</option>
                            {(contractorsInPeople || []).map(p => (
                              <option key={p.id} value={p.id}>{p.name || "(名前未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetPropBuildingId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                          >
                            <option value="">(未選択)</option>
                            {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                              <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-2 space-y-2 font-sans font-bold"><button onClick={() => handlePickChange(activeInstanceKey, { customText: null })} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"><ResetIcon size={12} /> 文言をリセット</button><button onClick={() => handlePickChange(activeInstanceKey, { stampPositions: null, signerStampPositions: null })} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"><ResetIcon size={12} /> 位置をリセット</button></div>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col items-center overflow-y-auto custom-scrollbar bg-slate-200 shadow-inner rounded-xl">
              {activeInstance ? (
                <div className="p-10">
                  <div className="document-container w-[210mm] h-[297mm] bg-white shadow-2xl font-serif leading-relaxed text-slate-900 border border-slate-100 relative">
                    <DocTemplate name={activeInstance.name} siteData={siteData} instanceIndex={activeInstance.index}
                       instanceKey={activeInstanceKey}
                      pick={activePick} onPickChange={(p) => handlePickChange(activeInstanceKey, p)} onStampPosChange={handleStampPosChange} onSignerStampPosChange={handleSignerStampPosChange} isPrint={false} scriveners={scriveners} />
                  </div>
                </div>
              ) : <div className="flex items-center text-slate-400 italic h-full font-bold">書類を選択してください</div>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
