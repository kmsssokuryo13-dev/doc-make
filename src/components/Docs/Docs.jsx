import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, RotateCcw as ResetIcon, Loader2 } from 'lucide-react';
import { naturalSortList, stableSortKeys, getOrderedDocs, formatWareki, generateId } from '../../utils.js';
import { APPLICATION_TYPES, APPLICATION_TO_DOCS } from '../../constants.js';
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
  const [isPrinting, setIsPrinting] = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);

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
    targetBeforeBuildingId: "",
    targetContractorPersonId: "",
    targetLandIds: [],
    statementPersonIds: [],
    statementApplicantPersonId: "",
    statementConfirmApplicantPersonId: "",
    confirmApplicantPersonIds: [],
    selectedCauseIds: null,
    mergeBeforeBuildingIds: [],
    splitAfterBuildingIds: [],
    combineBeforeBuildingIds: [],
    combinePurpose: "combineOnly",
    saleBuildingSource: "proposed",
    saleSellerPersonIds: [],
    fontScale: 100
  };

  const allInstances = useMemo(() => {
    if (!siteData) return [];
    const regApps = siteData.registrationApplications || [];
    const instances = [];

    if (regApps.length > 0) {
      // Phase 2: generate instances per registration application
      const globalIndex = {}; // track global index per doc name
      regApps.forEach((ra) => {
        const def = APPLICATION_TO_DOCS[ra.type];
        if (!def) return;
        const allDocNames = [...(def.required || []), ...(def.optional || [])];
        const raDocs = ra.documents || {};
        allDocNames.forEach(docName => {
          const c = Number(raDocs[docName] || 0);
          if (c <= 0) return;
          if (!globalIndex[docName]) globalIndex[docName] = 0;
          for (let j = 0; j < c; j++) {
            globalIndex[docName]++;
            const idx = globalIndex[docName];
            instances.push({ name: docName, index: idx, key: `${docName}__${idx}`, raId: ra.id, sources: [ra.type] });
          }
        });
      });
    } else {
      // Legacy: flat document list (backward compat)
      const docs = siteData.documents || {};
      const orderedNames = (orderedDocs || []).map(d => d.name);
      const orderedSet = new Set(orderedNames);
      (orderedDocs || []).forEach((d) => {
        const name = d.name;
        const c = Number(docs?.[name] || 0);
        if (!name || c <= 0) return;
        for (let i = 1; i <= c; i++) instances.push({ name, index: i, key: `${name}__${i}`, raId: null, sources: d.sources || [] });
      });
      Object.entries(docs).forEach(([name, count]) => {
        if (!name || orderedSet.has(name)) return;
        for (let i = 1; i <= (Number(count) || 0); i++) instances.push({ name, index: i, key: `${name}__${i}`, raId: null, sources: [] });
      });
    }
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

          const assignedBldg = buildings.find(b => b.id === base.targetPropBuildingId);
          if (!before && assignedBldg && Array.isArray(assignedBldg.ownerPersonIds) && assignedBldg.ownerPersonIds.length > 0) {
            if (!base.applicantPersonIds || base.applicantPersonIds.length === 0) {
              base.applicantPersonIds = assignedBldg.ownerPersonIds;
            }
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

  // Sync registrationApplications when application counts change
  useEffect(() => {
    if (!siteId || !siteData) return;
    const apps = siteData.applications || {};
    const regApps = siteData.registrationApplications || [];
    let changed = false;
    let next = [...regApps];

    for (const type of APPLICATION_TYPES) {
      const desired = Number(apps[type] || 0);
      const current = next.filter(ra => ra.type === type);
      if (current.length < desired) {
        for (let i = current.length; i < desired; i++) {
          next.push({ id: generateId(), type, targetBuildingIds: [], applicantPersonIds: [], documents: {} });
          changed = true;
        }
      } else if (current.length > desired) {
        let toRemove = current.length - desired;
        const reversed = [...next].reverse();
        next = reversed.filter(ra => {
          if (ra.type === type && toRemove > 0) { toRemove--; return false; }
          return true;
        }).reverse();
        changed = true;
      }
    }
    // Remove entries for types not in APPLICATION_TYPES
    const validTypes = new Set(APPLICATION_TYPES);
    const filtered = next.filter(ra => validTypes.has(ra.type));
    if (filtered.length !== next.length) { next = filtered; changed = true; }

    if (changed) {
      setSites(prev => prev.map(s => s.id === siteId ? { ...s, registrationApplications: next } : s));
    }
  }, [siteId, siteData?.applications]);

  // Sync siteData.documents from registrationApplications documents
  useEffect(() => {
    if (!siteId || !siteData) return;
    const regApps = siteData.registrationApplications || [];
    if (regApps.length === 0) return;

    const aggregated = {};
    regApps.forEach(ra => {
      Object.entries(ra.documents || {}).forEach(([docName, count]) => {
        aggregated[docName] = (aggregated[docName] || 0) + Number(count || 0);
      });
    });

    const currentDocs = siteData.documents || {};
    let changed = false;
    const merged = { ...currentDocs };
    for (const [name, total] of Object.entries(aggregated)) {
      if (Number(merged[name] || 0) !== total) { merged[name] = total; changed = true; }
    }
    // Remove document counts that no longer exist in any RA
    // Skip clearing when all RAs have empty documents (fresh migration from legacy data)
    const allRaDocsEmpty = regApps.every(ra => Object.keys(ra.documents || {}).length === 0);
    if (!allRaDocsEmpty) {
      for (const name of Object.keys(merged)) {
        if (!(name in aggregated) && Number(merged[name] || 0) > 0) {
          // Check if this doc comes from an application type - only clear those
          const allRaDocNames = new Set();
          regApps.forEach(ra => {
            const def = APPLICATION_TO_DOCS[ra.type];
            if (def) { (def.required || []).forEach(d => allRaDocNames.add(d)); (def.optional || []).forEach(d => allRaDocNames.add(d)); }
          });
          if (allRaDocNames.has(name)) { merged[name] = 0; changed = true; }
        }
      }
    }
    if (changed) {
      setSites(prev => prev.map(s => s.id === siteId ? { ...s, documents: stableSortKeys(merged) } : s));
    }
  }, [siteId, siteData?.registrationApplications]);

  // Auto-fill docPick from registration application when entering Step 3
  useEffect(() => {
    if (!siteId || !siteData || step !== 3) return;
    const regApps = siteData.registrationApplications || [];
    if (regApps.length === 0) return;

    const pick = { ...(siteData.docPick || {}) };
    let changed = false;

    allInstances.forEach(inst => {
      if (!inst.raId) return;
      const ra = regApps.find(r => r.id === inst.raId);
      if (!ra) return;

      const existing = pick[inst.key];
      if (existing && existing._raApplied === ra.id) return; // already applied for this RA

      const patch = { ...(existing || {}), _raApplied: ra.id };
      const bid = ra.targetBuildingIds?.[0] || "";

      // Auto-fill building selection based on application type
      const needsProposed = ["建物表題登記"].includes(ra.type);
      const needsBefore = ["建物表題部変更登記", "建物表題部更正登記", "建物合併登記", "建物分割登記", "建物合体登記"].includes(ra.type);
      const isLoss = ra.type === "建物滅失登記";

      if (needsProposed && bid) {
        patch.targetPropBuildingId = bid;
      }
      if (needsBefore && bid) {
        patch.targetBeforeBuildingId = bid;
      }
      if (isLoss && bid) {
        patch.lossBuildingIds = [bid];
      }

      // Auto-fill applicant
      if (ra.applicantPersonIds && ra.applicantPersonIds.length > 0) {
        patch.applicantPersonIds = ra.applicantPersonIds;
      }

      pick[inst.key] = { ...DEFAULT_PICK, ...patch };
      changed = true;
    });

    if (changed) {
      setSites(prev => prev.map(s => s.id === siteId ? { ...s, docPick: pick } : s));
    }
  }, [step, siteId, allInstances, siteData?.registrationApplications]);

  // Helper to get a label for a registration application
  const getRegAppLabel = (ra) => {
    if (!ra) return "";
    const regApps = siteData?.registrationApplications || [];
    const sameType = regApps.filter(r => r.type === ra.type);
    const idx = sameType.findIndex(r => r.id === ra.id) + 1;
    const buildingSource = ["建物表題登記", "建物滅失登記"].includes(ra.type) ? (siteData?.proposedBuildings || [])
      : ["建物表題部変更登記", "建物表題部更正登記", "建物合併登記", "建物分割登記", "建物合体登記"].includes(ra.type) ? (siteData?.buildings || [])
      : [];
    const isLandType = ra.type === "土地地目変更登記";
    const targetId = ra.targetBuildingIds?.[0];
    let targetLabel = "";
    if (isLandType) {
      const land = (siteData?.land || []).find(l => l.id === targetId);
      targetLabel = land ? (land.lotNumber || land.address || "") : "";
    } else {
      const bldg = buildingSource.find(b => b.id === targetId);
      targetLabel = bldg ? (bldg.houseNum || "") : "";
    }
    const people = siteData?.people || [];
    const applicantNames = (ra.applicantPersonIds || []).map(pid => people.find(p => p.id === pid)?.name || "").filter(Boolean).join("・");
    const parts = [ra.type];
    if (sameType.length > 1) parts[0] += ` #${idx}`;
    if (targetLabel) parts.push(targetLabel);
    if (applicantNames) parts.push(applicantNames);
    return parts[0] + (parts.length > 1 ? "（" + parts.slice(1).join("・") + "）" : "");
  };

  const updateRegApp = (raId, patch) => {
    setSites(prev => prev.map(s => s.id === siteId ? {
      ...s,
      registrationApplications: (s.registrationApplications || []).map(ra =>
        ra.id === raId ? { ...ra, ...patch } : ra
      )
    } : s));
  };

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

  const openPrintWindowForDoc = (pages, title, styles) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return false;

    const pagesHtml = pages.map((p, i) => {
      const wrapper = document.createElement('div');
      wrapper.className = p.className;
      if (i > 0) wrapper.classList.add('break-before-page');
      else wrapper.classList.remove('break-before-page');
      wrapper.innerHTML = p.innerHTML;
      return wrapper.outerHTML;
    }).join('\n');

    printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
${styles}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; }
  body { font-family: "MS Mincho","ＭＳ 明朝",serif; }
  .doc-no-bold, .doc-no-bold * { font-weight: normal !important; }
  .stamp-circle { cursor: default !important; }
  .stamp-drag-handle { cursor: default !important; }
  [contenteditable] { outline: none !important; }
  @media print {
    @page { size: A4 portrait; margin: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media screen {
    body > div > div { margin: 0 auto 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  }
</style>
</head><body>
<div>${pagesHtml}</div>
</body></html>`);
    printWindow.document.close();

    printWindow.onload = () => {
      setTimeout(() => printWindow.print(), 300);
    };
    return true;
  };

  const printDocEntries = useMemo(() => {
    const nameCount = {};
    printInstances.forEach(inst => { nameCount[inst.name] = (nameCount[inst.name] || 0) + 1; });
    return printInstances.map(inst => ({
      key: inst.key,
      label: nameCount[inst.name] > 1 ? `${inst.name}${inst.index}` : inst.name
    }));
  }, [printInstances]);

  const printSingleDoc = (docKey, title) => {
    const el = document.getElementById("print-area");
    if (!el) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map(s => s.outerHTML).join('\n');
      const pages = Array.from(el.children).filter(c => c.dataset.docKey === docKey);
      if (!pages.length) return;
      if (!openPrintWindowForDoc(pages, title, styles)) {
        alert("ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。");
      }
    }));
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
          .stamp-drag-handle, .stamp-dragging { cursor: default !important; }
        }
      `}</style>

      <div style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1 }}><div id="print-area">
        {printInstances.map((inst, i) => {
          const instPick = siteData?.docPick?.[inst.key] || DEFAULT_PICK;
          return (
            <div key={inst.key} data-doc-name={inst.name} data-doc-key={inst.key} className={`w-[210mm] h-[297mm] bg-white font-serif leading-relaxed ${i > 0 ? "break-before-page" : ""} relative overflow-hidden`}>
                <DocTemplate name={inst.name} siteData={siteData} instanceIndex={inst.index} instanceKey={inst.key} pick={instPick} isPrint={true} scriveners={scriveners} />
            </div>
          );
        })}
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
          : <button onClick={() => { if (!printInstances.length) { alert("印刷対象がありません。"); return; } setShowPrintPanel(true); }} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 flex items-center gap-2 shadow-lg active:scale-95 transition-all"><Printer size={18} /> 印刷実行</button>}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {step === 1 && (
          <div className="max-w-3xl mx-auto space-y-4">
            <h2 className="text-lg font-black text-slate-800 mb-6">1. 申請する登記を選択</h2>
            {APPLICATION_TYPES.map(type => {
              const count = siteData?.applications?.[type] || 0;
              const regAppsForType = (siteData?.registrationApplications || []).filter(ra => ra.type === type);
              const needsProposed = ["建物表題登記", "建物滅失登記"].includes(type);
              const needsBefore = ["建物表題部変更登記", "建物表題部更正登記", "建物合併登記", "建物分割登記", "建物合体登記"].includes(type);
              const buildingSource = needsProposed ? (siteData?.proposedBuildings || []) : needsBefore ? (siteData?.buildings || []) : [];
              const isLandType = type === "土地地目変更登記";
              return (
                <div key={type}>
                  <CountRow label={type} count={count}
                    onChange={(d) => setSites(prev => prev.map(s => s.id === siteId ? { ...s, applications: { ...s.applications, [type]: Math.max(0, (s.applications[type]||0) + d) } } : s))} />
                  {regAppsForType.length > 0 && (
                    <div className="ml-4 mt-2 space-y-2">
                      {regAppsForType.map((ra, idx) => (
                        <div key={ra.id} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">申請 #{idx + 1}</div>
                          {!isLandType && buildingSource.length > 0 && (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物</label>
                              <select
                                className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                                value={ra.targetBuildingIds?.[0] || ""}
                                onChange={e => {
                                  const bid = e.target.value;
                                  const patch = { targetBuildingIds: bid ? [bid] : [] };
                                  const bldg = buildingSource.find(b => b.id === bid);
                                  if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                                    patch.applicantPersonIds = bldg.ownerPersonIds;
                                  }
                                  updateRegApp(ra.id, patch);
                                }}
                              >
                                <option value="">(未選択)</option>
                                {naturalSortList(buildingSource, 'houseNum').map(b => (
                                  <option key={b.id} value={b.id}>{b.houseNum || "(家屋番号未入力)"}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {isLandType && (siteData?.land || []).length > 0 && (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 mb-1">対象土地</label>
                              <select
                                className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                                value={ra.targetBuildingIds?.[0] || ""}
                                onChange={e => {
                                  const lid = e.target.value;
                                  const patch = { targetBuildingIds: lid ? [lid] : [] };
                                  const land = (siteData?.land || []).find(l => l.id === lid);
                                  if (land && Array.isArray(land.ownerPersonIds) && land.ownerPersonIds.length > 0) {
                                    patch.applicantPersonIds = land.ownerPersonIds;
                                  }
                                  updateRegApp(ra.id, patch);
                                }}
                              >
                                <option value="">(未選択)</option>
                                {(siteData?.land || []).map(l => (
                                  <option key={l.id} value={l.id}>{l.lotNumber || l.address || "(地番未入力)"}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">申請人</label>
                            {(siteData?.people || []).filter(p => {
                              const roles = p?.roles || [];
                              return roles.includes("建物所有者") || roles.includes("申請人") || roles.includes("土地所有者");
                            }).length === 0 ? (
                              <p className="text-[9px] text-slate-400">関係人が登録されていません。</p>
                            ) : (
                              <div className="grid grid-cols-2 gap-1">
                                {(siteData?.people || []).filter(p => {
                                  const roles = p?.roles || [];
                                  return roles.includes("建物所有者") || roles.includes("申請人") || roles.includes("土地所有者");
                                }).map(p => {
                                  const checked = (ra.applicantPersonIds || []).includes(p.id);
                                  return (
                                    <label key={p.id} className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${checked ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-slate-200 text-slate-500"}`}>
                                      <input type="checkbox" className="w-3 h-3 accent-blue-600" checked={checked}
                                        onChange={() => {
                                          const cur = new Set(ra.applicantPersonIds || []);
                                          if (cur.has(p.id)) cur.delete(p.id); else cur.add(p.id);
                                          updateRegApp(ra.id, { applicantPersonIds: Array.from(cur) });
                                        }}
                                      />
                                      <span className="truncate">{p.name || "(氏名未入力)"}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {step === 2 && (() => {
          const regApps = siteData?.registrationApplications || [];
          if (regApps.length > 0) {
            return (
              <div className="max-w-4xl mx-auto space-y-6 font-sans font-bold">
                <h2 className="text-lg font-black text-slate-800 mb-6">2. 作成する書類を選定</h2>
                {regApps.map(ra => {
                  const def = APPLICATION_TO_DOCS[ra.type];
                  if (!def) return null;
                  const allDocNames = [...(def.required || []), ...(def.optional || [])];
                  const requiredSet = new Set(def.required || []);
                  const raDocs = ra.documents || {};
                  return (
                    <div key={ra.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <h3 className="text-sm font-black text-slate-700 mb-3 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">申請</span>
                        {getRegAppLabel(ra)}
                      </h3>
                      <div className="space-y-2">
                        {allDocNames.map(docName => {
                          const isReq = requiredSet.has(docName);
                          const count = Number(raDocs[docName] || 0);
                          return (
                            <DocRow key={docName} name={docName} count={count} isRequired={isReq} sources={[ra.type]}
                              onChange={(delta) => {
                                const next = Math.max(0, count + delta);
                                updateRegApp(ra.id, { documents: { ...raDocs, [docName]: next } });
                              }} />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          // Legacy fallback: flat document list
          return (
            <div className="max-w-4xl mx-auto space-y-4 font-sans font-bold">
              <h2 className="text-lg font-black text-slate-800 mb-6">2. 作成する書類を選定</h2>
              {orderedDocs.length === 0 ? <p className="p-12 text-center text-gray-400 bg-white border border-dashed rounded-2xl">登記申請を選択してください。</p>
              : <div className="space-y-3">{orderedDocs.map(d => (
                  <DocRow key={d.name} name={d.name} count={siteData?.documents?.[d.name] || 0} isRequired={d.isRequired} sources={d.sources}
                    onChange={(delta) => setSites(prev => prev.map(s => s.id === siteId ? { ...s, documents: { ...s.documents, [d.name]: Math.max(0, (s.documents?.[d.name]||0) + delta) } } : s))} />
                ))}</div>}
            </div>
          );
        })()}

        {step === 3 && (
          <div className="h-full flex gap-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-64 shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
              <div><h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-2">作成書類一覧</h3>
                {(() => {
                  const regApps = siteData?.registrationApplications || [];
                  const hasRegApps = regApps.length > 0 && allInstances.some(i => i.raId);
                  if (hasRegApps) {
                    // Grouped by registration application
                    const raMap = new Map(regApps.map(ra => [ra.id, ra]));
                    const groups = [];
                    const ungrouped = [];
                    allInstances.forEach(inst => {
                      if (inst.raId && raMap.has(inst.raId)) {
                        let group = groups.find(g => g.raId === inst.raId);
                        if (!group) { group = { raId: inst.raId, ra: raMap.get(inst.raId), instances: [] }; groups.push(group); }
                        group.instances.push(inst);
                      } else {
                        ungrouped.push(inst);
                      }
                    });
                    return (
                      <div className="space-y-3">
                        {groups.map(group => (
                          <div key={group.raId}>
                            <div className="px-2 py-1 text-[9px] font-black text-blue-600 bg-blue-50 rounded mb-1 truncate" title={getRegAppLabel(group.ra)}>{getRegAppLabel(group.ra)}</div>
                            <div className="space-y-1 ml-1">
                              {group.instances.map(inst => {
                                const printOn = siteData?.docPick?.[inst.key]?.printOn ?? true;
                                return (
                                  <button key={inst.key} onClick={() => setActiveInstanceKey(inst.key)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceKey === inst.key ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                                    <div className="flex items-center justify-between"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        {ungrouped.length > 0 && (
                          <div>
                            <div className="px-2 py-1 text-[9px] font-black text-slate-400 bg-slate-50 rounded mb-1">その他</div>
                            <div className="space-y-1 ml-1">
                              {ungrouped.map(inst => {
                                const printOn = siteData?.docPick?.[inst.key]?.printOn ?? true;
                                return (
                                  <button key={inst.key} onClick={() => setActiveInstanceKey(inst.key)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceKey === inst.key ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                                    <div className="flex items-center justify-between"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  // Legacy flat list
                  return (
                    <div className="space-y-1.5">{allInstances.map(inst => {
                      const printOn = siteData?.docPick?.[inst.key]?.printOn ?? true;
                      return (
                        <button key={inst.key} onClick={() => setActiveInstanceKey(inst.key)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceKey === inst.key ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                          <div className="flex items-center justify-between"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div>
                        </button>
                      );
                    })}</div>
                  );
                })()}</div>

              {activeInstance && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4 font-bold">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">書類設定</h4>
                  {activeInstance.name !== "委任状（地目変更）" && activeInstance.name !== "委任状（滅失）" && activeInstance.name !== "滅失証明書（滅失）" && activeInstance.name !== "滅失証明書（表題部変更）" && activeInstance.name !== "非登載証明書" && activeInstance.name !== "委任状（表題）" && activeInstance.name !== "委任状（保存）" && activeInstance.name !== "工事完了引渡証明書（表題）" && activeInstance.name !== "申述書（共有）" && activeInstance.name !== "申述書（単独）" && (
                    <div className="space-y-2 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={activePick.showMain ?? true} onChange={e => handlePickChange(activeInstanceKey, { showMain: e.target.checked })} />主建物を表示</label><label className="flex items-center gap-2"><input type="checkbox" checked={activePick.showAnnex ?? true} onChange={e => handlePickChange(activeInstanceKey, { showAnnex: e.target.checked })} />附属建物を表示</label></div>
                  )}
                  {(() => {
  const isStatement = activeInstance && (activeInstance.name === "申述書（共有）" || activeInstance.name === "申述書（単独）");
  if (isStatement) return null;

  const isLossCert = activeInstance && (activeInstance.name === "滅失証明書（滅失）" || activeInstance.name === "滅失証明書（表題部変更）");
  if (isLossCert) return null;

  const isNtrCert = activeInstance && activeInstance.name === "非登載証明書";
  if (isNtrCert) return null;

  const isLandCategoryChange = activeInstance && activeInstance.name === "委任状（地目変更）";
  const isLoss = activeInstance && activeInstance.name === "委任状（滅失）";

  if (isLoss) {
    const lossBuildings = (siteData?.proposedBuildings || []).filter(pb => { const c = pb.registrationCause || ""; return c.includes("取壊し") || c.includes("焼失") || c.includes("倒壊"); });
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
            <p className="text-[10px] text-slate-400">滅失に関する登記原因の申請建物がありません。</p>
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

  const hideBuildingToggle = activeInstance && (activeInstance.name === "委任状（表題）" || activeInstance.name === "委任状（保存）" || activeInstance.name === "工事完了引渡証明書（表題）" || activeInstance.name === "申述書（共有）" || activeInstance.name === "申述書（単独）");
  return (
    <div className={`${hideBuildingToggle ? '' : 'border-t pt-4'} text-black`}>
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

                  {(activeInstance.name === "委任状（表題）" || activeInstance.name === "委任状（保存）") && (
                    <div className="border-t pt-4">
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">予定家屋番号選択</label>
                      <select
                        className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                        value={activePick.targetPropBuildingId || ""}
                        onChange={e => {
                          const bid = e.target.value;
                          const patch = { targetPropBuildingId: bid };
                          const bldg = (siteData.proposedBuildings || []).find(b => b.id === bid);
                          if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                            patch.applicantPersonIds = bldg.ownerPersonIds;
                          }
                          handlePickChange(activeInstanceKey, patch);
                        }}
                      >
                        <option value="">(未選択)</option>
                        {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                          <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(activeInstance.name === "委任状（表題部変更）" || activeInstance.name === "委任状（表題部更正）") && (
                    <div className="border-t pt-4">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">{activeInstance.name === "委任状（表題部更正）" ? "更正前" : "変更前"}の建物を選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetBeforeBuildingId || ""}
                            onChange={e => {
                              const bid = e.target.value;
                              const patch = { targetBeforeBuildingId: bid };
                              const bldg = (siteData.buildings || []).find(b => b.id === bid);
                              if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                                patch.applicantPersonIds = bldg.ownerPersonIds;
                              }
                              handlePickChange(activeInstanceKey, patch);
                            }}
                          >
                            <option value="">(全て表示)</option>
                            {(naturalSortList(siteData.buildings || [], 'houseNum')).map(b => (
                              <option key={b.id} value={b.id}>{b.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">{activeInstance.name === "委任状（表題部更正）" ? "更正後" : "変更後"}の建物を選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetPropBuildingId || ""}
                            onChange={e => {
                              const bid = e.target.value;
                              const patch = { targetPropBuildingId: bid };
                              const bldg = (siteData.proposedBuildings || []).find(b => b.id === bid);
                              if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                                patch.applicantPersonIds = bldg.ownerPersonIds;
                              }
                              handlePickChange(activeInstanceKey, patch);
                            }}
                          >
                            <option value="">(全て表示)</option>
                            {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                              <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeInstance.name === "委任状（合併）" && (() => {
                    const sortedBldgs = naturalSortList(siteData.buildings || [], 'houseNum');
                    const curIds = new Set(Array.isArray(activePick.mergeBeforeBuildingIds) ? activePick.mergeBeforeBuildingIds : []);
                    const toggleMergeBefore = (id) => {
                      const next = new Set(curIds);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      handlePickChange(activeInstanceKey, { mergeBeforeBuildingIds: Array.from(next) });
                    };
                    return (
                      <div className="border-t pt-4">
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-2">合併前の建物を選択（複数可）</label>
                            {sortedBldgs.length === 0 ? (
                              <p className="text-[10px] text-slate-400">登記建物が登録されていません。</p>
                            ) : (
                              <div className="grid grid-cols-1 gap-1">
                                {sortedBldgs.map(b => (
                                  <label
                                    key={b.id}
                                    className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${curIds.has(b.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
                                  >
                                    <input type="checkbox" checked={curIds.has(b.id)} onChange={() => toggleMergeBefore(b.id)} className="accent-blue-600" />
                                    {b.houseNum || "(家屋番号未入力)"}
                                  </label>
                                ))}
                              </div>
                            )}
                            <p className="text-[9px] text-slate-400 mt-1">※未選択の場合は全て表示</p>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">合併後の建物を選択</label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.targetPropBuildingId || ""}
                              onChange={e => {
                                const bid = e.target.value;
                                const patch = { targetPropBuildingId: bid };
                                const bldg = (siteData.proposedBuildings || []).find(b => b.id === bid);
                                if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                                  patch.applicantPersonIds = bldg.ownerPersonIds;
                                }
                                handlePickChange(activeInstanceKey, patch);
                              }}
                            >
                              <option value="">(全て表示)</option>
                              {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                                <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {activeInstance.name === "委任状（分割）" && (() => {
                    const sortedProps = naturalSortList(siteData.proposedBuildings || [], 'houseNum');
                    const curIds = new Set(Array.isArray(activePick.splitAfterBuildingIds) ? activePick.splitAfterBuildingIds : []);
                    const toggleSplitAfter = (id) => {
                      const next = new Set(curIds);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      handlePickChange(activeInstanceKey, { splitAfterBuildingIds: Array.from(next) });
                    };
                    return (
                      <div className="border-t pt-4">
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">分割前の建物を選択</label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.targetBeforeBuildingId || ""}
                              onChange={e => {
                                const bid = e.target.value;
                                const patch = { targetBeforeBuildingId: bid };
                                const bldg = (siteData.buildings || []).find(b => b.id === bid);
                                if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                                  patch.applicantPersonIds = bldg.ownerPersonIds;
                                }
                                handlePickChange(activeInstanceKey, patch);
                              }}
                            >
                              <option value="">(全て表示)</option>
                              {(naturalSortList(siteData.buildings || [], 'houseNum')).map(b => (
                                <option key={b.id} value={b.id}>{b.houseNum || "(家屋番号未入力)"}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-2">分割後の建物を選択（複数可）</label>
                            {sortedProps.length === 0 ? (
                              <p className="text-[10px] text-slate-400">申請建物が登録されていません。</p>
                            ) : (
                              <div className="grid grid-cols-1 gap-1">
                                {sortedProps.map(pb => (
                                  <label
                                    key={pb.id}
                                    className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${curIds.has(pb.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
                                  >
                                    <input type="checkbox" checked={curIds.has(pb.id)} onChange={() => toggleSplitAfter(pb.id)} className="accent-blue-600" />
                                    {pb.houseNum || "(家屋番号未入力)"}
                                  </label>
                                ))}
                              </div>
                            )}
                            <p className="text-[9px] text-slate-400 mt-1">※未選択の場合は全て表示</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {activeInstance.name === "委任状（合体）" && (() => {
                    const sortedBldgs = naturalSortList(siteData.buildings || [], 'houseNum');
                    const curIds = new Set(Array.isArray(activePick.combineBeforeBuildingIds) ? activePick.combineBeforeBuildingIds : []);
                    const toggleCombineBefore = (id) => {
                      const next = new Set(curIds);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      handlePickChange(activeInstanceKey, { combineBeforeBuildingIds: Array.from(next) });
                    };
                    return (
                      <div className="border-t pt-4">
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">登記の目的</label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.combinePurpose || "combineOnly"}
                              onChange={e => handlePickChange(activeInstanceKey, { combinePurpose: e.target.value })}
                            >
                              <option value="combineOnly">合体登記のみ</option>
                              <option value="combineAndPreserve">合体登記並びに保存登記</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-2">合体前の建物を選択（複数可）</label>
                            {sortedBldgs.length === 0 ? (
                              <p className="text-[10px] text-slate-400">登記建物が登録されていません。</p>
                            ) : (
                              <div className="grid grid-cols-1 gap-1">
                                {sortedBldgs.map(b => (
                                  <label
                                    key={b.id}
                                    className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${curIds.has(b.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
                                  >
                                    <input type="checkbox" checked={curIds.has(b.id)} onChange={() => toggleCombineBefore(b.id)} className="accent-blue-600" />
                                    {b.houseNum || "(家屋番号未入力)"}
                                  </label>
                                ))}
                              </div>
                            )}
                            <p className="text-[9px] text-slate-400 mt-1">※未選択の場合は全て表示</p>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">合体後の建物を選択</label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.targetPropBuildingId || ""}
                              onChange={e => {
                                const bid = e.target.value;
                                const patch = { targetPropBuildingId: bid };
                                const bldg = (siteData.proposedBuildings || []).find(b => b.id === bid);
                                if (bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
                                  patch.applicantPersonIds = bldg.ownerPersonIds;
                                }
                                handlePickChange(activeInstanceKey, patch);
                              }}
                            >
                              <option value="">(全て表示)</option>
                              {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                                <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

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

                  {(activeInstance.name === "滅失証明書（滅失）" || activeInstance.name === "滅失証明書（表題部変更）" || activeInstance.name === "非登載証明書") && (
                    <div>
                      <div className="space-y-3">
                        {(() => {
                          const isLossCause = (c) => (c || "").includes("取壊し") || (c || "").includes("焼失") || (c || "").includes("倒壊");
                          const lossBuildings = (siteData?.proposedBuildings || []).filter(pb => {
                            if (isLossCause(pb.registrationCause)) return true;
                            if ((pb.additionalCauses || []).some(ac => isLossCause(ac.cause))) return true;
                            return (pb.annexes || []).some(a => {
                              if (isLossCause(a.registrationCause)) return true;
                              return (a.additionalCauses || []).some(ac => isLossCause(ac.cause));
                            });
                          });
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
                                <p className="text-[10px] text-slate-400">滅失に関する登記原因の申請建物がありません。</p>
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

                        {activeInstance.name === "滅失証明書（表題部変更）" && (() => {
                          const isLossCause = (c) => (c || "").includes("取壊し") || (c || "").includes("焼失") || (c || "").includes("倒壊");
                          const lossBuildings = (siteData?.proposedBuildings || []).filter(pb => {
                            if (isLossCause(pb.registrationCause)) return true;
                            if ((pb.additionalCauses || []).some(ac => isLossCause(ac.cause))) return true;
                            return (pb.annexes || []).some(a => {
                              if (isLossCause(a.registrationCause)) return true;
                              return (a.additionalCauses || []).some(ac => isLossCause(ac.cause));
                            });
                          });
                          const curBldgIds = Array.isArray(activePick.lossBuildingIds) ? activePick.lossBuildingIds : [];
                          const defaultBldgIds = new Set(lossBuildings.map(pb => pb.id));
                          const effectiveBldgSet = curBldgIds.length > 0 ? new Set(curBldgIds) : defaultBldgIds;
                          const selectedBuildings = lossBuildings.filter(pb => effectiveBldgSet.has(pb.id));

                          const hasText = (s) => typeof s === "string" && s.replace(/[\s　]/g, "").length > 0;
                          const annexHasContent = (a) => {
                            if (hasText(a.symbol) || hasText(a.kind) || hasText(a.struct)) return true;
                            const fas = Array.isArray(a.floorAreas) ? a.floorAreas : [];
                            return fas.some(fa => hasText(fa.floor) || hasText(fa.area));
                          };

                          const annexCandidates = selectedBuildings.flatMap(pb => (pb.annexes || [])
                            .filter(a => annexHasContent(a))
                            .map(a => ({ ...a, __parentHouseNum: pb.houseNum, __parentAddress: pb.address }))
                          );

                          const showMain = activePick.lossCertShowMain ?? true;
                          const hidden = new Set(Array.isArray(activePick.lossCertHiddenAnnexIds) ? activePick.lossCertHiddenAnnexIds : []);

                          const toggleHiddenAnnex = (id) => {
                            const base = new Set(hidden);
                            if (base.has(id)) base.delete(id);
                            else base.add(id);
                            handlePickChange(activeInstanceKey, { lossCertHiddenAnnexIds: Array.from(base) });
                          };

                          const showAllAnnexes = () => handlePickChange(activeInstanceKey, { lossCertHiddenAnnexIds: [] });

                          return (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 mb-2">建物の表示を選択</label>
                              <div className="space-y-2 text-xs">
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" checked={showMain} onChange={e => handlePickChange(activeInstanceKey, { lossCertShowMain: e.target.checked })} />
                                  主である建物を表示
                                </label>

                                {annexCandidates.length > 0 && (
                                  <div className="space-y-1">
                                    <button type="button" onClick={showAllAnnexes} className="w-full py-1 text-[9px] font-bold rounded bg-slate-100 hover:bg-slate-200">附属建物を全て表示</button>
                                    <div className="grid grid-cols-1 gap-1">
                                      {annexCandidates.map((a) => {
                                        const sym = (a.symbol || "").replace(/[\s　]/g, "");
                                        const label = `${a.__parentHouseNum || "(家屋番号未入力)"}${sym ? ` - 符号${sym}の附属建物` : " - 附属建物(符号未入力)"}`;
                                        const isShown = !hidden.has(a.id);
                                        return (
                                          <label
                                            key={a.id}
                                            className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                              isShown ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-500"
                                            }`}
                                          >
                                            <input type="checkbox" className="w-3 h-3 rounded" checked={isShown} onChange={() => toggleHiddenAnnex(a.id)} />
                                            <span className="truncate">{label}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
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

                  {activeInstance.name === "売渡証明書" && (() => {
                    const sortedProp = naturalSortList(siteData.proposedBuildings || [], 'houseNum');
                    const sortedReg = naturalSortList(siteData.buildings || [], 'houseNum');
                    const saleSrc = activePick.saleBuildingSource || "proposed";

                    const applicantCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("申請人"));
                    const curApplIds = Array.isArray(activePick.applicantPersonIds) ? activePick.applicantPersonIds : [];
                    const defaultApplIds = new Set(applicantCandidates.map(p => p.id));
                    const effectiveApplSet = curApplIds.length > 0 ? new Set(curApplIds) : defaultApplIds;
                    const toggleApplicant = (id) => {
                      const base = new Set(curApplIds.length > 0 ? curApplIds : Array.from(defaultApplIds));
                      if (base.has(id)) base.delete(id); else base.add(id);
                      handlePickChange(activeInstanceKey, { applicantPersonIds: Array.from(base) });
                    };

                    const sellerCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("その他"));
                    const curSellerIds = Array.isArray(activePick.saleSellerPersonIds) ? activePick.saleSellerPersonIds : [];
                    const defaultSellerIds = new Set(sellerCandidates.map(p => p.id));
                    const effectiveSellerSet = curSellerIds.length > 0 ? new Set(curSellerIds) : defaultSellerIds;
                    const toggleSeller = (id) => {
                      const base = new Set(curSellerIds.length > 0 ? curSellerIds : Array.from(defaultSellerIds));
                      if (base.has(id)) base.delete(id); else base.add(id);
                      handlePickChange(activeInstanceKey, { saleSellerPersonIds: Array.from(base) });
                    };

                    return (
                    <div className="border-t pt-4">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">建物情報のソース</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={saleSrc}
                            onChange={e => handlePickChange(activeInstanceKey, { saleBuildingSource: e.target.value })}
                          >
                            <option value="proposed">申請建物</option>
                            <option value="registered">既登記建物</option>
                          </select>
                        </div>
                        {saleSrc === "proposed" ? (
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物選択</label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.targetPropBuildingId || ""}
                              onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                            >
                              <option value="">(未選択・最初の建物)</option>
                              {sortedProp.map(pb => (
                                <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物選択（既登記）</label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activePick.targetBeforeBuildingId || ""}
                              onChange={e => handlePickChange(activeInstanceKey, { targetBeforeBuildingId: e.target.value })}
                            >
                              <option value="">(未選択・最初の建物)</option>
                              {sortedReg.map(b => (
                                <option key={b.id} value={b.id}>{b.houseNum || "(家屋番号未入力)"}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-2">申請人（買主）を選択</label>
                          {applicantCandidates.length === 0 ? (
                            <p className="text-[10px] text-slate-400">「申請人」が登録されていません。</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-1">
                              {applicantCandidates.map((p) => (
                                <label
                                  key={p.id}
                                  className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                    effectiveApplSet.has(p.id)
                                      ? "bg-blue-50 border-blue-200 text-blue-700"
                                      : "bg-white border-slate-200 text-slate-500"
                                  }`}
                                >
                                  <input type="checkbox" className="w-3 h-3 rounded" checked={effectiveApplSet.has(p.id)} onChange={() => toggleApplicant(p.id)} />
                                  <span className="truncate">{p.name || "(氏名未入力)"}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-2">売渡人を選択（役割「その他」）</label>
                          {sellerCandidates.length === 0 ? (
                            <p className="text-[10px] text-slate-400">「その他」の役割の人が登録されていません。</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-1">
                              {sellerCandidates.map((p) => (
                                <label
                                  key={p.id}
                                  className={`flex items-center gap-2 p-1 rounded border text-[9px] cursor-pointer ${
                                    effectiveSellerSet.has(p.id)
                                      ? "bg-blue-50 border-blue-200 text-blue-700"
                                      : "bg-white border-slate-200 text-slate-500"
                                  }`}
                                >
                                  <input type="checkbox" className="w-3 h-3 rounded" checked={effectiveSellerSet.has(p.id)} onChange={() => toggleSeller(p.id)} />
                                  <span className="truncate">{p.name || "(氏名未入力)"}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })()}

                  {activeInstance.name === "工事完了引渡証明書（表題部変更）" && (() => {
                    const sortedProp = naturalSortList(siteData.proposedBuildings || [], 'houseNum');
                    const sortedBefore = naturalSortList(siteData.buildings || [], 'houseNum');
                    const targetPropB = activePick.targetPropBuildingId
                      ? sortedProp.find(b => b.id === activePick.targetPropBuildingId)
                      : null;
                    const propsForCauses = targetPropB ? [targetPropB] : sortedProp;
                    const hasAnyAnnexes = sortedBefore.some(b => (b.annexes || []).length > 0)
                      || propsForCauses.some(b => (b.annexes || []).length > 0);
                    const causeEntries = [];
                    propsForCauses.forEach(b => {
                      const mainPrefix = hasAnyAnnexes ? "主である建物" : "";
                      if (b.registrationCause) {
                        causeEntries.push({ id: `${b.id}_main`, label: `${formatWareki(b.registrationDate, b.additionalUnknownDate)}${mainPrefix}${b.registrationCause}` });
                      }
                      (b.additionalCauses || []).forEach(ac => {
                        if (ac.cause) {
                          causeEntries.push({ id: ac.id, label: `${formatWareki(ac.date)}${mainPrefix}${ac.cause}` });
                        }
                      });
                      (b.annexes || []).forEach(a => {
                        const sym = (a.symbol || '').replace(/[\s\u3000]/g, '');
                        const annexPrefix = sym ? `符号${sym}の附属建物` : "附属建物";
                        if (a.registrationCause) {
                          causeEntries.push({ id: `${a.id}_main`, label: `${formatWareki(a.registrationDate, a.additionalUnknownDate)}${annexPrefix}${a.registrationCause}` });
                        }
                        (a.additionalCauses || []).forEach(ac => {
                          if (ac.cause) {
                            causeEntries.push({ id: ac.id, label: `${formatWareki(ac.date)}${annexPrefix}${ac.cause}` });
                          }
                        });
                      });
                    });
                    const currentSelected = activePick.selectedCauseIds;
                    const isAllSelected = currentSelected == null || causeEntries.every(c => currentSelected.includes(c.id));
                    const toggleCause = (causeId) => {
                      let ids = currentSelected == null ? causeEntries.map(c => c.id) : [...currentSelected];
                      if (ids.includes(causeId)) {
                        ids = ids.filter(id => id !== causeId);
                      } else {
                        ids.push(causeId);
                      }
                      if (causeEntries.every(c => ids.includes(c.id))) ids = null;
                      handlePickChange(activeInstanceKey, { selectedCauseIds: ids });
                    };
                    const toggleAll = () => {
                      handlePickChange(activeInstanceKey, { selectedCauseIds: isAllSelected ? [] : null });
                    };
                    return (
                    <div className="border-t pt-4">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">変更前の建物を選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetBeforeBuildingId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetBeforeBuildingId: e.target.value })}
                          >
                            <option value="">(全て表示)</option>
                            {(naturalSortList(siteData.buildings || [], 'houseNum')).map(b => (
                              <option key={b.id} value={b.id}>{b.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">変更後の建物を選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activePick.targetPropBuildingId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                          >
                            <option value="">(全て表示)</option>
                            {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                              <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        {causeEntries.length > 0 && (
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">登記原因を選択</label>
                            <div className="space-y-1">
                              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                <input type="checkbox" checked={isAllSelected} onChange={toggleAll} className="accent-blue-600" />
                                <span className="font-bold">全て選択</span>
                              </label>
                              {causeEntries.map(c => (
                                <label key={c.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={currentSelected == null || currentSelected.includes(c.id)}
                                    onChange={() => toggleCause(c.id)}
                                    className="accent-blue-600"
                                  />
                                  <span>{c.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
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
                      </div>
                    </div>
                    );
                  })()}

                  <div className="border-t pt-2">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">文字サイズ（選択テキスト）</label>
                    <select
                      className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                      value={activePick.fontScale || 100}
                      onMouseDown={() => {
                        const sel = window.getSelection();
                        if (sel.rangeCount > 0 && sel.toString().length > 0) {
                          const range = sel.getRangeAt(0);
                          const container = document.querySelector('.document-container');
                          if (container && container.contains(range.startContainer)) {
                            window.__savedFontRange = range.cloneRange();
                          } else {
                            window.__savedFontRange = null;
                          }
                        } else {
                          window.__savedFontRange = null;
                        }
                      }}
                      onChange={e => {
                        const pct = Number(e.target.value);
                        const savedRange = window.__savedFontRange;
                        if (!savedRange || savedRange.toString().length === 0) {
                          handlePickChange(activeInstanceKey, { fontScale: pct });
                          return;
                        }
                        // Find the contenteditable element from the saved range
                        const startNode = savedRange.startContainer;
                        const editableEl = (startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode)?.closest?.('[contenteditable="true"]');
                        if (!editableEl) return;
                        if (pct === 100) {
                          // Extract selected content, strip font-size spans, re-insert
                          const contents = savedRange.extractContents();
                          contents.querySelectorAll('span[style]').forEach(span => {
                            if (span.style.fontSize) {
                              while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
                              span.remove();
                            }
                          });
                          savedRange.insertNode(contents);
                        } else {
                          // Wrap the selected text directly in a <span> with font-size
                          const contents = savedRange.extractContents();
                          // Remove any existing font-size spans inside the extracted content
                          contents.querySelectorAll('span[style]').forEach(span => {
                            if (span.style.fontSize) {
                              while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
                              span.remove();
                            }
                          });
                          const wrapper = document.createElement('span');
                          wrapper.style.fontSize = pct + '%';
                          wrapper.appendChild(contents);
                          savedRange.insertNode(wrapper);
                        }
                        // Dispatch input event so EditableDocBody captures the change
                        editableEl.dispatchEvent(new Event('input', { bubbles: true }));
                        // Capture the modified HTML
                        const clone = editableEl.cloneNode(true);
                        clone.querySelectorAll('[contenteditable="false"]').forEach(el => el.remove());
                        const customHtml = clone.innerHTML;
                        handlePickChange(activeInstanceKey, { fontScale: 100, customText: customHtml });
                        window.__savedFontRange = null;
                      }}
                    >
                      {Array.from({ length: 21 }, (_, i) => 90 + i).map(v => (
                        <option key={v} value={v}>{v === 100 ? '100%（標準）' : `${v}%`}</option>
                      ))}
                    </select>
                    <p className="text-[9px] text-gray-400 mt-1">テキストを選択してからサイズを変更</p>
                  </div>

                  <div className="border-t pt-2 space-y-2 font-sans font-bold"><button onClick={() => handlePickChange(activeInstanceKey, { customText: null })} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"><ResetIcon size={12} /> 文言をリセット</button><button onClick={() => handlePickChange(activeInstanceKey, { stampPositions: null, signerStampPositions: null })} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"><ResetIcon size={12} /> 位置をリセット</button></div>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col items-center overflow-y-auto custom-scrollbar bg-slate-200 shadow-inner rounded-xl">
              {activeInstance ? (
                <div className="p-10">
                  <div className="document-container w-[210mm] h-[297mm] bg-white shadow-2xl font-serif leading-relaxed text-slate-900 border border-slate-100 relative overflow-hidden">
                    <DocTemplate key={activeInstanceKey} name={activeInstance.name} siteData={siteData} instanceIndex={activeInstance.index}
                       instanceKey={activeInstanceKey}
                      pick={activePick} onPickChange={(p) => handlePickChange(activeInstanceKey, p)} onStampPosChange={handleStampPosChange} onSignerStampPosChange={handleSignerStampPosChange} isPrint={false} scriveners={scriveners} />
                  </div>
                </div>
              ) : <div className="flex items-center text-slate-400 italic h-full font-bold">書類を選択してください</div>}
            </div>
          </div>
        )}
      </main>

      {showPrintPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPrintPanel(false); }}
        >
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px 28px', minWidth: '340px', maxWidth: '480px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 'bold', color: '#1e293b' }}>書類ごとに印刷</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
              各ボタンをクリックすると印刷ウィンドウが開きます。<br/>印刷先を「PDFに保存」にして保存してください。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {printDocEntries.map(entry => (
                <button
                  key={entry.key}
                  onClick={() => printSingleDoc(entry.key, entry.label)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg font-bold text-left hover:bg-blue-50 active:bg-blue-100 transition-colors"
                  style={{ border: '1px solid #e2e8f0', fontSize: '14px', color: '#1e293b', cursor: 'pointer', background: 'white' }}
                >
                  <Printer size={16} className="text-blue-600 flex-shrink-0" />
                  {entry.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowPrintPanel(false)}
              className="mt-4 w-full px-4 py-2 rounded-lg font-bold hover:bg-slate-100 transition-colors"
              style={{ border: '1px solid #e2e8f0', fontSize: '13px', color: '#64748b', cursor: 'pointer', background: 'white' }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
