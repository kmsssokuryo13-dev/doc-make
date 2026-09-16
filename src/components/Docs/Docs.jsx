import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, RotateCcw as ResetIcon, Loader2 } from 'lucide-react';
import { naturalSortList, stableSortKeys, getOrderedDocs, formatWareki } from '../../utils.js';
import { APPLICATION_TYPES, APPLICATION_TO_DOCS } from '../../constants.js';
import {
  applyRegistrationApplicationPatch,
  ensureRequiredRegistrationDocuments,
  syncRegistrationApplications,
  isLandApplicationType,
} from '../../registrationApplications.js';
import {
  acknowledgeDetachedDocumentSource,
  acknowledgeSelectionOverrideSources,
  createStableDocumentInstanceId,
  getDocumentTemplateKey,
  isBlankDocumentHtml,
  LEGACY_DOCUMENT_PICK_DEFAULTS,
  MAX_DOCUMENT_COPIES_PER_APPLICATION,
  normalizeDocumentCount,
  reconcileSiteDocumentCompatibility,
  selectLegacyPickForApplication,
} from '../../v8Compatibility.js';
import {
  buildDocumentContextsForInstances,
  getDocumentContextPrintBlockers,
} from '../../documentContext.js';
import {
  canApplySelectionFontSize,
  isExplicitTextEditDocument,
  resolveFontSizeChange,
  shouldShowFontSizeControl,
} from '../../documentTextEditing.js';
import {
  buildIssueGuidanceList,
  countIssuesBySeverity,
  GUIDANCE_KINDS,
} from '../../documentIssueGuidance.js';
import {
  buildStampPositionResetPatch,
  canRelinkDocumentText,
  hasAnyStampAdjustment,
} from '../../documentLayoutUi.js';
import { isSignerStampAutoAlignDocument } from '../../signerStampAlignment.js';
import {
  buildSelectionResetPatch,
  getSelectionOverrideKeys,
  hasSelectionOverride,
  SELECTION_OVERRIDE_LABELS,
  shouldShowContractorSelect,
  shouldShowSoleApplicantSelect,
  usesSelectionCleanupUi,
} from '../../documentSelectionUi.js';
import { StepBadge } from '../ui/StepBadge.jsx';
import { CountRow } from '../ui/CountRow.jsx';
import { DocRow } from '../ui/DocRow.jsx';
import { DocTemplate } from '../DocTemplate/DocTemplate.jsx';
import { DraggableApplicantList } from '../ui/DraggableApplicantList.jsx';

const DOCUMENT_CONTEXT_STATUS = {
  current: { label: '最新', badge: 'bg-emerald-100 text-emerald-700', panel: 'border-emerald-200 bg-emerald-50/60' },
  modified: { label: '個別設定', badge: 'bg-blue-100 text-blue-700', panel: 'border-blue-200 bg-blue-50/60' },
  detached: { label: '全文固定', badge: 'bg-amber-100 text-amber-700', panel: 'border-amber-200 bg-amber-50/60' },
  warning: { label: '確認推奨', badge: 'bg-amber-100 text-amber-700', panel: 'border-amber-200 bg-amber-50/60' },
  'review-required': { label: '要確認', badge: 'bg-rose-100 text-rose-700', panel: 'border-rose-200 bg-rose-50/60' },
};

const getDocumentContextStatusStyle = (context) => {
  if (context?.status === 'review-required' &&
      !context.issues?.some(issue => issue.severity === 'blocking')) {
    return DOCUMENT_CONTEXT_STATUS.warning;
  }
  return DOCUMENT_CONTEXT_STATUS[context?.status] || DOCUMENT_CONTEXT_STATUS.current;
};

// P3: issue種別ごとの「確認する場所」を表す小さな補助ボタン。押しても値は変更しない。
const GUIDANCE_ACTION_LABELS = {
  [GUIDANCE_KINDS.STEP1]: 'Step1で確認',
  [GUIDANCE_KINDS.CASE_INFO]: '案件情報で確認',
  [GUIDANCE_KINDS.DETAIL_SETTINGS]: '個別設定を確認',
  [GUIDANCE_KINDS.FULLTEXT]: '全文固定を確認',
};

const guidanceActionLabel = (info) => {
  if (info?.kind === GUIDANCE_KINDS.STEP3_SELECT) {
    return info.targetTestId === 'contractor-select' ? '工事人の選択を確認' : '単独出資者の選択を確認';
  }
  return GUIDANCE_ACTION_LABELS[info?.kind] || '';
};

const DocumentContextSummary = ({ context, guidanceEnabled = false, onIssueAction = null }) => {
  if (!context?.supported) return null;
  const status = getDocumentContextStatusStyle(context);
  const building = context.data?.building;
  const applicantNames = (context.data?.applicants || [])
    .map(person => person?.name || '(氏名未入力)')
    .join('・');
  const ownerNames = (context.data?.owners || [])
    .map(person => person?.name || '(氏名未入力)')
    .join('・');
  const contractorName = context.data?.contractor?.name || '';

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${status.panel}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black text-slate-600">
          {context.editMode === 'linked' ? '自動設定' : '最新データ（全文固定には未反映）'}
        </span>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-black ${status.badge}`}>{status.label}</span>
      </div>
      <dl className="grid grid-cols-[4.5em_1fr] gap-x-2 gap-y-1 text-[9px] leading-relaxed">
        <dt className="text-slate-400">対象建物</dt>
        <dd className="text-slate-700 break-words">{building ? (building.houseNum || building.address || '(建物情報未入力)') : '未解決'}</dd>
        <dt className="text-slate-400">申請人</dt>
        <dd className="text-slate-700 break-words">{applicantNames || '未解決'}</dd>
        {context.meta?.documentName === '工事完了引渡証明書（表題）' && (
          <>
            <dt className="text-slate-400">所有者</dt>
            <dd className="text-slate-700 break-words">{ownerNames || '未解決'}</dd>
            <dt className="text-slate-400">工事人</dt>
            <dd className="text-slate-700 break-words">{contractorName || '未解決'}</dd>
          </>
        )}
      </dl>
      {/* P3: 対象4帳票は件数と確認導線付きで表示する。非対象帳票は従来の一覧のまま。 */}
      {guidanceEnabled ? (() => {
        const counts = countIssuesBySeverity(context);
        if (counts.total === 0) {
          return (
            <p className="border-t border-current/10 pt-2 text-[9px] font-bold text-emerald-700" data-testid="summary-no-issues">
              確認事項なし
            </p>
          );
        }
        const guided = buildIssueGuidanceList(context);
        return (
          <div className="border-t border-current/10 pt-2 space-y-1.5" data-testid="summary-issue-guidance">
            <div className="flex items-center gap-1.5" data-testid="summary-issue-counts">
              {counts.blocking > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-black">
                  要確認 {counts.blocking}件
                </span>
              )}
              {counts.warning > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-black">
                  確認推奨 {counts.warning}件
                </span>
              )}
            </div>
            <ul className="space-y-1.5 text-[9px] leading-relaxed">
              {guided.map((item, index) => {
                const label = guidanceActionLabel(item.guidance);
                return (
                  <li key={`${item.code}-${index}`} className={item.severity === 'warning' ? 'text-amber-700' : 'text-rose-700'}>
                    <span>{item.severity === 'blocking' ? '⚠ ' : '● '}{item.message}</span>
                    {item.guidance.tab && (
                      <span className="text-slate-400">（{item.guidance.tab}）</span>
                    )}
                    {label && onIssueAction && (
                      <button
                        type="button"
                        onClick={() => onIssueAction(item.guidance)}
                        className="ml-1 px-1.5 py-0.5 rounded bg-white/70 hover:bg-white border border-current/20 text-[8px] font-bold"
                        data-testid={`issue-action-${item.guidance.kind}`}
                      >
                        {label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })() : context.issues?.length > 0 && (
        <ul className="border-t border-current/10 pt-2 space-y-1 text-[9px] leading-relaxed text-rose-700">
          {context.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={issue.severity === 'warning' ? 'text-amber-700' : ''}>
              {issue.severity === 'blocking' ? '⚠ ' : '● '}{issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const DocumentContextStatusBadge = ({ context }) => {
  if (!context?.supported) return null;
  const status = getDocumentContextStatusStyle(context);
  return (
    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap ${status.badge}`}>
      {status.label}
    </span>
  );
};

export const Docs = ({ sites, setSites, contractors, scriveners }) => {
  const [params] = useSearchParams();
  const siteId = params.get('siteId');
  const navigate = useNavigate();
  const siteData = sites.find(s => s.id === siteId);
  const [step, setStep] = useState(1);
  const [activeInstanceId, setActiveInstanceId] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  // 全文編集モードは永続editModeとは別の一時UI state。書類切替・Step移動で終了する。
  const [textEditInstanceId, setTextEditInstanceId] = useState("");
  // P2: 書類固有の例外設定をまとめる折りたたみ領域。既定は閉じる（overrideがあれば展開）。
  const [detailSettingsOpen, setDetailSettingsOpen] = useState(false);
  // P4: 印影位置等のレイアウト二次操作。一時UI stateで永続化せず、書類切替で閉じる。
  const [layoutSettingsOpen, setLayoutSettingsOpen] = useState(false);

  const orderedDocs = useMemo(() => siteData ? getOrderedDocs(siteData.applications || {}) : [], [siteData?.applications]);

  const DOC_TITLE = "委任状（表題）";
  const DEFAULT_PICK = LEGACY_DOCUMENT_PICK_DEFAULTS;

  const allInstances = useMemo(() => {
    if (!siteData) return [];
    const regApps = siteData.registrationApplications || [];
    const instances = [];

    if (regApps.length > 0) {
      // Phase 2: generate instances per registration application
      const globalIndex = {}; // track global index per doc name
      regApps.forEach((ra) => {
        const def = Object.prototype.hasOwnProperty.call(APPLICATION_TO_DOCS, ra.type)
          ? APPLICATION_TO_DOCS[ra.type]
          : null;
        if (!def) return;
        const allDocNames = [...(def.required || []), ...(def.optional || [])];
        const raDocs = ra.documents || {};
        allDocNames.forEach(docName => {
          const c = normalizeDocumentCount(raDocs[docName]);
          if (c <= 0) return;
          if (!globalIndex[docName]) globalIndex[docName] = 0;
          for (let j = 0; j < c; j++) {
            globalIndex[docName]++;
            const idx = globalIndex[docName];
            const copyIndex = j + 1;
            const templateKey = getDocumentTemplateKey(docName);
            const shadowInstance = (ra.documentInstances || []).find(instance =>
              instance.active !== false &&
              instance.templateKey === templateKey &&
              instance.documentName === docName &&
              instance.copyIndex === copyIndex
            );
            const stableId = shadowInstance?.id ||
              createStableDocumentInstanceId(ra.id, templateKey, copyIndex);
            instances.push({
              name: docName,
              index: idx,
              copyIndex,
              key: `${docName}__${idx}`,
              identity: `${siteData.id}:v8:${stableId}`,
              documentInstanceId: stableId,
              raId: ra.id,
              sources: [ra.type],
            });
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
        const c = normalizeDocumentCount(docs?.[name]);
        if (!name || c <= 0) return;
        for (let i = 1; i <= c; i++) {
          const key = `${name}__${i}`;
          instances.push({ name, index: i, copyIndex: i, key, identity: `${siteData.id}:legacy:${key}`, raId: null, sources: d.sources || [] });
        }
      });
      Object.entries(docs).forEach(([name, count]) => {
        if (!name || orderedSet.has(name)) return;
        const safeCount = normalizeDocumentCount(count);
        for (let i = 1; i <= safeCount; i++) {
          const key = `${name}__${i}`;
          instances.push({ name, index: i, copyIndex: i, key, identity: `${siteData.id}:legacy:${key}`, raId: null, sources: [] });
        }
      });
    }
    return instances;
  }, [siteData, orderedDocs]);

  const activeInstance = useMemo(
    () => (allInstances || []).find(instance => instance.identity === activeInstanceId) || null,
    [allInstances, activeInstanceId]
  );
  const activeInstanceKey = activeInstance?.key || "";
  const isTextEditing = step === 3 && !!activeInstance && textEditInstanceId === activeInstance.identity;

  useEffect(() => {
    setTextEditInstanceId("");
  }, [activeInstanceId, step]);

  const activePick = {
    ...DEFAULT_PICK,
    ...(siteData?.docPick?.[activeInstanceKey] || {})
  };

  // Previewと印刷が同じ日付・同じ解決結果を使うよう、画面を開いた時刻を固定する。
  const documentContextNow = useMemo(() => new Date(), [siteId]);
  const documentContextsByIdentity = useMemo(() => buildDocumentContextsForInstances({
    site: siteData,
    instances: allInstances,
    scriveners,
    now: documentContextNow,
  }), [allInstances, documentContextNow, scriveners, siteData]);
  const activeDocumentContext = activeInstance
    ? documentContextsByIdentity[activeInstance.identity] || null
    : null;

  // P2: 個別設定(selectionOverrides)の有無はdocumentInstanceが正本。
  // 読み取り専用で参照し、v8Compatibilityの投影方式は変更しない。
  const activeDocumentInstance = useMemo(() => {
    if (!activeInstance?.documentInstanceId) return null;
    const application = (siteData?.registrationApplications || [])
      .find(ra => ra?.id === activeInstance.raId);
    return (application?.documentInstances || [])
      .find(instance => instance?.id === activeInstance.documentInstanceId) || null;
  }, [siteData, activeInstance]);
  const activeOverrideKeys = useMemo(
    () => getSelectionOverrideKeys(activeDocumentInstance),
    [activeDocumentInstance]
  );
  const usesSelectionCleanup = usesSelectionCleanupUi({
    documentName: activeInstance?.name,
    context: activeDocumentContext,
  });
  const showContractorSelect = shouldShowContractorSelect({
    documentName: activeInstance?.name,
    context: activeDocumentContext,
    documentInstance: activeDocumentInstance,
  });
  const resetSelectionOverride = (key) => {
    const patch = buildSelectionResetPatch(key, activeDocumentContext);
    if (patch) handlePickChange(activeInstanceKey, patch);
  };

  // P3: issue導線は「確認箇所を見せる」だけ。siteData / selectionOverrides / customText /
  // acknowledge状態を変更せず、保存も発生させない。
  const scrollToTestId = (testId) => {
    if (typeof document === 'undefined') return;
    requestAnimationFrame(() => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  };
  const handleIssueGuidanceAction = (info) => {
    switch (info?.kind) {
      case GUIDANCE_KINDS.STEP1:
        setStep(1);
        return;
      case GUIDANCE_KINDS.CASE_INFO:
        // Editorのタブ選択はEditorのlocal stateで、既存のdeep-link手段がない。
        // 新しい遷移方式を作らず、既存の戻る導線と同じ案件情報画面までに留める。
        navigate('/');
        return;
      case GUIDANCE_KINDS.DETAIL_SETTINGS:
        setDetailSettingsOpen(true);
        scrollToTestId('document-detail-settings');
        return;
      case GUIDANCE_KINDS.FULLTEXT:
        scrollToTestId('fulltext-edit-control');
        return;
      case GUIDANCE_KINDS.STEP3_SELECT:
        if (info.targetTestId) scrollToTestId(info.targetTestId);
        return;
      default:
        return;
    }
  };

  // 個別設定が既にある書類は、開いた時点で内容を見失わないよう展開しておく。
  useEffect(() => {
    setDetailSettingsOpen(getSelectionOverrideKeys(activeDocumentInstance).length > 0);
  }, [activeInstanceId, step]);

  // P4: レイアウト調整は書類切替・Step移動で閉じる（位置調整の有無はbadgeで分かる）。
  useEffect(() => {
    setLayoutSettingsOpen(false);
  }, [activeInstanceId, step]);

  useEffect(() => {
    if (!siteId || !siteData) return;

    setSites(prev => {
      let changedAny = false;
      const next = prev.map(s => {
        if (s.id !== siteId) return s;

        const buildings = naturalSortList(s.proposedBuildings || [], "houseNum");
        const buildingLimit = buildings.length;
        const hasRegistrationApplications = Array.isArray(s.registrationApplications) &&
          s.registrationApplications.length > 0;

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
        if (!hasRegistrationApplications && curCount !== desiredCount) {
          docs[DOC_TITLE] = desiredCount;
          changedAny = true;
        }

        const pickMap = { ...(s.docPick || {}) };
        const idAt = (i) => (buildings[i] ? buildings[i].id : "");
        const isValidId = (id) => !!id && buildings.some(b => b.id === id);

        // RA導入後はStep1の対象・申請人を正本とし、並び順からdocPickを補正しない。
        // ここで旧flat pickを更新すると、不正対象をRAへ戻す投影との更新ループになる。
        if (!hasRegistrationApplications) {
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
            const c = normalizeDocumentCount(docs?.[docName]);
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
        }

        if (!changedAny) return s;

        const nextSite = {
          ...s,
          applications: stableSortKeys(apps),
          documents: stableSortKeys(docs),
          docPick: stableSortKeys(pickMap),
        };
        return reconcileSiteDocumentCompatibility(nextSite);
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

  // 登記申請ごとの必須書類はStep2到達時に最低1通を保証する。
  useEffect(() => {
    if (!siteId || step < 2) return;
    setSites(prev => prev.map(site => {
      if (site.id !== siteId) return site;
      const { next: applications, changed } = ensureRequiredRegistrationDocuments(
        site.registrationApplications || []
      );
      return changed
        ? reconcileSiteDocumentCompatibility({ ...site, registrationApplications: applications })
        : site;
    }));
  }, [setSites, siteId, step]);

  // Sync registrationApplications when application counts change
  useEffect(() => {
    if (!siteId || !siteData) return;
    const { next, changed } = syncRegistrationApplications(
      siteData.applications || {},
      siteData.registrationApplications || [],
      APPLICATION_TYPES
    );

    if (changed) {
      setSites(prev => prev.map(s => s.id === siteId
        ? reconcileSiteDocumentCompatibility(
            { ...s, registrationApplications: next },
            { preferApplicationValues: true }
          )
        : s));
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
            const def = Object.prototype.hasOwnProperty.call(APPLICATION_TO_DOCS, ra.type)
              ? APPLICATION_TO_DOCS[ra.type]
              : null;
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

    const sourcePick = { ...(siteData.docPick || {}) };
    const pick = { ...sourcePick };
    let changed = false;

    allInstances.forEach(inst => {
      if (!inst.raId) return;
      const ra = regApps.find(r => r.id === inst.raId);
      if (!ra) return;

      const existing = pick[inst.key];
      if (existing && existing._raApplied === ra.id) return; // already applied for this RA

      const shadowInstance = (ra.documentInstances || []).find(instance =>
        instance.templateKey === getDocumentTemplateKey(inst.name) &&
        instance.documentName === inst.name &&
        instance.copyIndex === inst.copyIndex
      );
      const compatiblePick = selectLegacyPickForApplication({
        docPick: sourcePick,
        currentInstanceKey: inst.key,
        previousInstanceKey: shadowInstance?.legacyInstanceKey || "",
        applicationId: ra.id,
      });
      const patch = { ...compatiblePick, _raApplied: ra.id };
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
      setSites(prev => prev.map(s => s.id === siteId
        ? reconcileSiteDocumentCompatibility({ ...s, docPick: pick })
        : s));
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
    const isLandType = isLandApplicationType(ra.type);
    const targetId = isLandType ? ra.targetLandIds?.[0] : ra.targetBuildingIds?.[0];
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
    setSites(prev => prev.map(s => {
      if (s.id !== siteId) return s;
      const applications = (s.registrationApplications || []).map(ra =>
        ra.id === raId ? applyRegistrationApplicationPatch(ra, patch) : ra
      );
      return reconcileSiteDocumentCompatibility({
        ...s,
        registrationApplications: applications,
      }, { preferApplicationValues: true });
    }));
  };

  useEffect(() => {
    if (step !== 3 || !allInstances.length) return;
    if (!allInstances.some(instance => instance.identity === activeInstanceId)) {
      setActiveInstanceId(allInstances[0].identity);
    }
  }, [step, allInstances, activeInstanceId]);

  const handlePickChange = (instanceKey, patch) => {
    const editedInstance = allInstances.find(instance => instance.key === instanceKey);
    const editedContext = editedInstance
      ? documentContextsByIdentity[editedInstance.identity] || null
      : null;
    const sourceSnapshotAtEdit = Object.prototype.hasOwnProperty.call(patch, 'customText') &&
      typeof patch.customText === 'string' && patch.customText.trim()
      ? editedContext?.sourceSnapshot || null
      : null;
    const selectionOverrideSourcesAtEdit = editedContext?.selectionOverrideSources || null;
    setSites(prev => prev.map(s => {
      if (s.id !== siteId) return s;
      const current = {
        ...DEFAULT_PICK,
        ...(s.docPick?.[instanceKey] || {}),
      };
      const docPick = {
        ...s.docPick,
        [instanceKey]: { ...current, ...patch },
      };
      return reconcileSiteDocumentCompatibility(
        { ...s, docPick },
        {
          legacyPickIntentFields: { [instanceKey]: Object.keys(patch) },
          detachedSourceSnapshots: sourceSnapshotAtEdit
            ? { [instanceKey]: sourceSnapshotAtEdit }
            : {},
          selectionOverrideSourceValuesByPick: selectionOverrideSourcesAtEdit
            ? { [instanceKey]: selectionOverrideSourcesAtEdit }
            : {},
        }
      );
    }));
  };

  const handleAcknowledgeDetachedSource = () => {
    if (!activeInstance?.raId || !activeInstance.documentInstanceId ||
        !activeDocumentContext?.sourceSnapshot) return;
    const confirmed = window.confirm(
      '現在の全文固定内容を維持し、最新の案件情報を確認済みとして扱います。\n' +
      '固定本文の氏名・住所などは自動更新されません。表示内容を確認しましたか？'
    );
    if (!confirmed) return;
    setSites(prev => prev.map(site => {
      if (site.id !== siteId) return site;
      let changed = false;
      const registrationApplications = (site.registrationApplications || []).map(application => {
        if (application.id !== activeInstance.raId) return application;
        const result = acknowledgeDetachedDocumentSource(application, {
          documentInstanceId: activeInstance.documentInstanceId,
          sourceSnapshot: activeDocumentContext.sourceSnapshot,
        });
        changed = changed || result.changed;
        return result.next;
      });
      return changed
        ? reconcileSiteDocumentCompatibility({ ...site, registrationApplications })
        : site;
    }));
  };

  const handleAcknowledgeSelectionOverrides = () => {
    if (!activeInstance?.raId || !activeInstance.documentInstanceId ||
        !activeDocumentContext?.selectionOverrideSources) return;
    const confirmed = window.confirm(
      '現在の書類固有設定を維持し、最新のStep1情報を確認済みとして扱います。\n' +
      '対象建物・申請人などの設定内容を確認しましたか？'
    );
    if (!confirmed) return;
    setSites(prev => prev.map(site => {
      if (site.id !== siteId) return site;
      let changed = false;
      const registrationApplications = (site.registrationApplications || []).map(application => {
        if (application.id !== activeInstance.raId) return application;
        const result = acknowledgeSelectionOverrideSources(application, {
          documentInstanceId: activeInstance.documentInstanceId,
          selectionOverrideSources: activeDocumentContext.selectionOverrideSources,
        });
        changed = changed || result.changed;
        return result.next;
      });
      return changed
        ? reconcileSiteDocumentCompatibility({ ...site, registrationApplications })
        : site;
    }));
  };

  const handleResetDocumentText = () => {
    const hasDetachedText = typeof activePick.customText === 'string' && activePick.customText.trim();
    if (hasDetachedText && !window.confirm(
      '全文編集した内容を破棄し、最新データ連動方式へ戻します。よろしいですか？'
    )) return;
    handlePickChange(activeInstanceKey, { customText: null });
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

  // 署名者印影の自動配置。書類切替後に前の書類の非同期計測が書き込まれないよう、
  // 現在プレビュー中のinstanceKeyと一致する通知だけを受け付ける。
  const activeInstanceKeyRef = useRef(activeInstanceKey);
  activeInstanceKeyRef.current = activeInstanceKey;
  const handlePickChangeRef = useRef(handlePickChange);
  handlePickChangeRef.current = handlePickChange;

  const handleSignerStampBaselineChange = useCallback((instanceKey, baseRatio) => {
    if (!instanceKey || instanceKey !== activeInstanceKeyRef.current) return;
    if (!Number.isFinite(baseRatio)) return;
    // 保存するのはfallback再現用のレイアウト情報だけ。本文・人物・確認状態は触らない。
    handlePickChangeRef.current(instanceKey, { signerStampBaseRatio: baseRatio });
  }, []);

  // 注意はどのinstanceのものかを一緒に持つ。描画時にキーを照合するため、
  // 書類切替のeffect順序に関係なく前の書類の注意が残らない。
  const [signerStampNotice, setSignerStampNotice] = useState({ key: '', notices: [] });
  const handleSignerStampNoticeChange = useCallback((instanceKey, notices) => {
    if (!instanceKey || instanceKey !== activeInstanceKeyRef.current) return;
    const next = Array.isArray(notices) ? notices : [];
    setSignerStampNotice(prev => (
      prev.key === instanceKey &&
      prev.notices.length === next.length &&
      prev.notices.every((item, i) => item === next[i])
        ? prev
        : { key: instanceKey, notices: next }
    ));
  }, []);
  const activeSignerStampNotices = signerStampNotice.key === activeInstanceKey
    ? signerStampNotice.notices
    : [];

  const printInstances = useMemo(() => allInstances.filter(inst => (siteData?.docPick?.[inst.key]?.printOn ?? true)), [allInstances, siteData?.docPick]);
  const blockingPrintInstances = useMemo(() => getDocumentContextPrintBlockers({
    instances: allInstances,
    contextsByIdentity: documentContextsByIdentity,
    docPick: siteData?.docPick || {},
  }), [allInstances, documentContextsByIdentity, siteData?.docPick]);

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

  // 要確認事項は注意情報として表示するのみで、印刷/PDF保存の停止条件にはしない。
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

  const statementEligiblePeople = useMemo(() => {
    const people = siteData?.people || [];
    const applicants = people.filter(p => (p.roles || []).includes("申請人"));
    const others = people.filter(p => (p.roles || []).includes("その他"));
    const confirmPersonIds = new Set();
    for (const bldg of (siteData?.proposedBuildings || [])) {
      for (const pid of (bldg.confirmApplicantPersonIds || [])) confirmPersonIds.add(pid);
    }
    const confirmPeople = [...confirmPersonIds].map(id => people.find(p => p.id === id)).filter(Boolean);
    const seen = new Set();
    const result = [];
    for (const p of [...applicants, ...others, ...confirmPeople]) {
      if (!seen.has(p.id)) { seen.add(p.id); result.push(p); }
    }
    return result;
  }, [siteData?.people, siteData?.proposedBuildings]);

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
                <DocTemplate name={inst.name} siteData={siteData} instanceIndex={inst.index} instanceKey={inst.key} pick={instPick} isPrint={true} scriveners={scriveners} documentContext={documentContextsByIdentity[inst.identity] || null} />
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
          : <button onClick={() => {
              if (!printInstances.length) { alert("印刷対象がありません。"); return; }
              setShowPrintPanel(true);
            }} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 flex items-center gap-2 shadow-lg active:scale-95 transition-all"><Printer size={18} /> 印刷実行</button>}
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
              const isLandType = isLandApplicationType(type);
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
                                value={ra.targetLandIds?.[0] || ""}
                                onChange={e => {
                                  const lid = e.target.value;
                                  // 土地系申請の対象土地は targetLandIds を正式な source とする。
                                  const patch = { targetLandIds: lid ? [lid] : [], targetBuildingIds: [] };
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
                          {(() => {
                            const raApplCandidates = (siteData?.people || []).filter(p => {
                              const roles = p?.roles || [];
                              return roles.includes("建物所有者") || roles.includes("申請人") || roles.includes("土地所有者");
                            });
                            return (
                              <div>
                                <label className="block text-[10px] font-bold text-gray-500 mb-1">申請人</label>
                                {raApplCandidates.length === 0 ? (
                                  <p className="text-[9px] text-slate-400">関係人が登録されていません。</p>
                                ) : (
                                  <DraggableApplicantList
                                    candidates={raApplCandidates}
                                    selectedIds={ra.applicantPersonIds || []}
                                    onToggle={(id) => {
                                      const cur = new Set(ra.applicantPersonIds || []);
                                      if (cur.has(id)) cur.delete(id); else cur.add(id);
                                      updateRegApp(ra.id, { applicantPersonIds: Array.from(cur) });
                                    }}
                                    onReorder={(newIds) => updateRegApp(ra.id, { applicantPersonIds: newIds })}
                                  />
                                )}
                              </div>
                            );
                          })()}
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
                  const def = Object.prototype.hasOwnProperty.call(APPLICATION_TO_DOCS, ra.type)
                    ? APPLICATION_TO_DOCS[ra.type]
                    : null;
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
                              min={isReq ? 1 : 0}
                              max={MAX_DOCUMENT_COPIES_PER_APPLICATION}
                              onChange={(delta) => {
                                const next = Math.min(
                                  MAX_DOCUMENT_COPIES_PER_APPLICATION,
                                  Math.max(isReq ? 1 : 0, count + delta)
                                );
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
                    max={MAX_DOCUMENT_COPIES_PER_APPLICATION}
                    onChange={(delta) => setSites(prev => prev.map(s => s.id === siteId ? { ...s, documents: { ...s.documents, [d.name]: Math.min(MAX_DOCUMENT_COPIES_PER_APPLICATION, Math.max(0, (s.documents?.[d.name]||0) + delta)) } } : s))} />
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
                                const context = documentContextsByIdentity[inst.identity] || null;
                                return (
                                  <button key={inst.identity} onClick={() => setActiveInstanceId(inst.identity)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceId === inst.identity ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                                    <div className="flex items-center justify-between gap-1"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><div className="flex items-center gap-1"><DocumentContextStatusBadge context={context} /><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div></div>
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
                                const context = documentContextsByIdentity[inst.identity] || null;
                                return (
                                  <button key={inst.identity} onClick={() => setActiveInstanceId(inst.identity)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceId === inst.identity ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                                    <div className="flex items-center justify-between gap-1"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><div className="flex items-center gap-1"><DocumentContextStatusBadge context={context} /><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div></div>
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
                      const context = documentContextsByIdentity[inst.identity] || null;
                      return (
                        <button key={inst.identity} onClick={() => setActiveInstanceId(inst.identity)} className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${activeInstanceId === inst.identity ? "bg-blue-600/10 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                          <div className="flex items-center justify-between gap-1"><div className="flex items-center gap-2 min-w-0 font-bold"><input type="checkbox" checked={printOn} onClick={e => e.stopPropagation()} onChange={e => handlePickChange(inst.key, { printOn: e.target.checked })} /><span className="truncate text-[11px]">{inst.name}</span></div><div className="flex items-center gap-1"><DocumentContextStatusBadge context={context} /><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">#{inst.index}</span></div></div>
                        </button>
                      );
                    })}</div>
                  );
                })()}</div>

              {activeInstance && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4 font-bold">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">書類設定</h4>
                  <DocumentContextSummary
                    context={activeDocumentContext}
                    guidanceEnabled={usesSelectionCleanup}
                    onIssueAction={handleIssueGuidanceAction}
                  />

                  {/* P2: Step1と重複する対象建物・申請人・申述人の再選択を個別設定へ集約する。
                      通常はStep1/案件データを正本として使い、ここを開いた時だけ書類固有に上書きする。 */}
                  {usesSelectionCleanup && (() => {
                    const documentName = activeInstance.name;
                    const isStatementDoc = documentName === "申述書（共有）" || documentName === "申述書（単独）";
                    const usesApplicantOverride = documentName === "委任状（表題）" || documentName === "工事完了引渡証明書（表題）";
                    const people = siteData?.people || [];
                    const buildings = naturalSortList(siteData.proposedBuildings || [], 'houseNum');
                    const selectedBuildingId = activeDocumentContext?.selection?.targetBuildingId || "";
                    const buildingOverridden = hasSelectionOverride(activeDocumentInstance, 'targetPropBuildingId');
                    const applicantOverridden = hasSelectionOverride(activeDocumentInstance, 'applicantPersonIds');
                    const statementOverridden = hasSelectionOverride(activeDocumentInstance, 'statementPersonIds');
                    const currentApplicantIds = activeDocumentContext?.selection?.applicantPersonIds || [];
                    const overrideSummary = activeOverrideKeys
                      .map(key => SELECTION_OVERRIDE_LABELS[key] || '個別設定')
                      .join('・');

                    const toggleApplicant = (id) => {
                      const next = new Set(currentApplicantIds);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      if (next.size === 0) return;
                      handlePickChange(activeInstanceKey, { applicantPersonIds: Array.from(next) });
                    };

                    return (
                      <div className="border-t pt-3 space-y-2" data-testid="document-detail-settings">
                        <button
                          type="button"
                          onClick={() => setDetailSettingsOpen(open => !open)}
                          className="w-full flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-slate-50 hover:bg-slate-100"
                          data-testid="detail-settings-toggle"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-black text-slate-500">個別設定</span>
                            {activeOverrideKeys.length > 0 && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-black" data-testid="detail-settings-active-badge">
                                個別設定中
                              </span>
                            )}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400">{detailSettingsOpen ? '閉じる' : '開く'}</span>
                        </button>

                        {/* 折りたたんでいても、個別設定中の項目は見失わないよう常に表示する。 */}
                        {activeOverrideKeys.length > 0 && (
                          <p className="text-[9px] text-blue-700 leading-relaxed px-1" data-testid="selection-override-summary">
                            この書類だけの設定: {overrideSummary}
                          </p>
                        )}

                        {detailSettingsOpen && (
                          <div className="space-y-3 pt-1" data-testid="detail-settings-body">
                            <div data-testid="detail-target-building">
                              <label className="block text-[10px] font-bold text-gray-500 mb-1">この書類だけ対象建物を変更</label>
                              <select
                                className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                                value={selectedBuildingId}
                                onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                              >
                                {/* 空のoverrideを新規作成させないため、選択できる「(未選択)」は置かない。
                                    Step1側で対象建物が未確定な時だけ、状態を偽らないようdisabledの
                                    プレースホルダを出す。Step1へ戻す操作は下の解除ボタンで行う。 */}
                                {!selectedBuildingId && (
                                  <option value="" disabled>(Step1で対象建物が未確定)</option>
                                )}
                                {buildings.map(pb => (
                                  <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                                ))}
                              </select>
                              {buildingOverridden ? (
                                <button
                                  type="button"
                                  onClick={() => resetSelectionOverride('targetPropBuildingId')}
                                  className="mt-1.5 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
                                  data-testid="reset-target-building"
                                >
                                  Step1の対象建物に戻す
                                </button>
                              ) : (
                                <p className="text-[9px] text-slate-400 mt-1">Step1の対象建物を自動使用しています。</p>
                              )}
                            </div>

                            {usesApplicantOverride && (
                              <div className="border-t pt-3" data-testid="detail-applicants">
                                <label className="block text-[10px] font-bold text-gray-500 mb-1">この書類だけ申請人を変更</label>
                                {people.length === 0 ? (
                                  <p className="text-[10px] text-slate-400">申請人が登録されていません。</p>
                                ) : (
                                  <>
                                    <DraggableApplicantList
                                      candidates={people}
                                      selectedIds={currentApplicantIds}
                                      onToggle={toggleApplicant}
                                      onReorder={(newIds) => handlePickChange(activeInstanceKey, { applicantPersonIds: newIds })}
                                      minOne
                                    />
                                    {applicantOverridden ? (
                                      <button
                                        type="button"
                                        onClick={() => resetSelectionOverride('applicantPersonIds')}
                                        className="mt-2 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
                                        data-testid="reset-applicants"
                                      >
                                        Step1の申請人に戻す
                                      </button>
                                    ) : (
                                      <p className="text-[9px] text-slate-400 mt-1">Step1の申請人と順序を自動使用しています。</p>
                                    )}
                                  </>
                                )}
                              </div>
                            )}

                            {isStatementDoc && (() => {
                              const others = people.filter(p => (p.roles || []).includes("その他"));
                              const confirmPeople = (activeDocumentContext?.data?.confirmation?.applicants || [])
                                .map(item => item.person).filter(Boolean);
                              const contextApplicants = activeDocumentContext?.data?.applicants || [];
                              const currentStatementPeople = activeDocumentContext?.data?.statementPeople || [];
                              const seen = new Set();
                              const candidates = [];
                              for (const p of [...contextApplicants, ...others, ...confirmPeople, ...currentStatementPeople]) {
                                if (!seen.has(p.id)) { seen.add(p.id); candidates.push(p); }
                              }
                              const currentStatementIds = activeDocumentContext?.selection?.statementPersonIds || [];
                              const toggleStatementPerson = (id) => {
                                const next = new Set(currentStatementIds);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                if (next.size === 0) return;
                                handlePickChange(activeInstanceKey, { statementPersonIds: Array.from(next) });
                              };
                              return (
                                <div className="border-t pt-3" data-testid="detail-statement-people">
                                  <label className="block text-[10px] font-bold text-gray-500 mb-1">申述人（署名・押印する人）</label>
                                  {candidates.length === 0 ? (
                                    <p className="text-[10px] text-slate-400">「申請人」「その他」または確認済証建築申請人が登録されていません。</p>
                                  ) : (
                                    <>
                                      <p className="text-[9px] text-slate-400 mb-1">※既定はStep1の申請人。その他・確認済証建築申請人も追加できます。</p>
                                      <DraggableApplicantList
                                        candidates={candidates}
                                        selectedIds={currentStatementIds}
                                        onToggle={toggleStatementPerson}
                                        onReorder={(newIds) => handlePickChange(activeInstanceKey, { statementPersonIds: newIds })}
                                        minOne
                                      />
                                      {statementOverridden && (
                                        <button
                                          type="button"
                                          onClick={() => resetSelectionOverride('statementPersonIds')}
                                          className="mt-2 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
                                          data-testid="reset-statement-people"
                                        >
                                          Step1の申請人に戻す
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {activeInstance.name !== "委任状（地目変更）" && activeInstance.name !== "委任状（滅失）" && activeInstance.name !== "滅失証明書（滅失）" && activeInstance.name !== "滅失証明書（表題部変更）" && activeInstance.name !== "非登載証明書" && activeInstance.name !== "委任状（表題）" && activeInstance.name !== "委任状（保存）" && activeInstance.name !== "工事完了引渡証明書（表題）" && activeInstance.name !== "申述書（共有）" && activeInstance.name !== "申述書（単独）" && (
                    <div className="space-y-2 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={activePick.showMain ?? true} onChange={e => handlePickChange(activeInstanceKey, { showMain: e.target.checked })} />主建物を表示</label><label className="flex items-center gap-2"><input type="checkbox" checked={activePick.showAnnex ?? true} onChange={e => handlePickChange(activeInstanceKey, { showAnnex: e.target.checked })} />附属建物を表示</label></div>
                  )}
                  {(() => {
  // P2: 対象4帳票はStep1の申請人をそのまま使う。変更は個別設定へ移した。
  if (usesSelectionCleanup) return null;

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
            <DraggableApplicantList
              candidates={candidates}
              selectedIds={curAppl.length > 0 ? curAppl : candidates.filter(p => (p.roles || []).includes("建物所有者")).map(p => p.id)}
              onToggle={toggleAppl}
              onReorder={(newIds) => handlePickChange(activeInstanceKey, { applicantPersonIds: newIds })}
              showRoles
              minOne
            />
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
          <DraggableApplicantList
            candidates={candidates}
            selectedIds={cur.length > 0 ? cur : candidates.filter(p => (p.roles || []).includes("土地所有者")).map(p => p.id)}
            onToggle={toggleOne}
            onReorder={(newIds) => handlePickChange(activeInstanceKey, { applicantPersonIds: newIds })}
            showRoles
            minOne
          />
        )}
      </div>
    );
  }

  const usesDocumentContext = activeDocumentContext?.supported === true;
  const all = usesDocumentContext ? (siteData?.people || []) : (applicantsInPeople || []);
  const cur = usesDocumentContext
    ? (activeDocumentContext.selection?.applicantPersonIds || [])
    : (Array.isArray(activePick.applicantPersonIds) ? activePick.applicantPersonIds : []);
  const canonicalIds = usesDocumentContext
    ? (activeDocumentContext.canonicalSelection?.applicantPersonIds || [])
    : [];
  const selecting = cur.length > 0;
  const curSet = new Set(cur);
  const hasContextOverride = usesDocumentContext && (
    cur.length !== canonicalIds.length || cur.some((id, index) => id !== canonicalIds[index])
  );

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
      ) : usesDocumentContext ? (
        <>
          <p className="text-[9px] text-slate-400 mb-2">Step1の申請人を自動使用します。ここで変更すると、この書類だけの個別設定になります。</p>
          <DraggableApplicantList
            candidates={all}
            selectedIds={cur}
            onToggle={toggleOne}
            onReorder={(newIds) => handlePickChange(activeInstanceKey, { applicantPersonIds: newIds })}
            minOne
          />
          {hasContextOverride && (
            <button
              type="button"
              onClick={() => handlePickChange(activeInstanceKey, { applicantPersonIds: canonicalIds })}
              className="mt-2 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
            >
              Step1の申請人に戻す
            </button>
          )}
        </>
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
            <div className="mt-2">
              <DraggableApplicantList
                candidates={all}
                selectedIds={cur}
                onToggle={toggleOne}
                onReorder={(newIds) => handlePickChange(activeInstanceKey, { applicantPersonIds: newIds })}
                minOne
              />
            </div>
          )}
        </>
      )}
    </div>
  );
})()}

                  {/* P2: 委任状（表題）の対象建物は個別設定へ移動。非対象の委任状（保存）は従来どおり。 */}
                  {(activeInstance.name === "委任状（保存）" ||
                    (activeInstance.name === "委任状（表題）" && !usesSelectionCleanup)) && (
                    <div className="border-t pt-4">
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">予定家屋番号選択</label>
                      <select
                        className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                        value={activeDocumentContext?.selection?.targetBuildingId || activePick.targetPropBuildingId || ""}
                        onChange={e => {
                          const bid = e.target.value;
                          const patch = { targetPropBuildingId: bid };
                          const bldg = (siteData.proposedBuildings || []).find(b => b.id === bid);
                          if (!activeDocumentContext?.supported && bldg && Array.isArray(bldg.ownerPersonIds) && bldg.ownerPersonIds.length > 0) {
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
                            value={activeDocumentContext?.selection?.targetBuildingId || activePick.targetPropBuildingId || ""}
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

                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-2">
                            建築確認の申請人
                          </label>
                          <p className="text-[9px] text-slate-400">※申請建物タブの確認済証情報内「建築申請人」から自動参照されます。</p>
                        </div>

                        {/* P2: 対象建物はStep1を正本とし、変更は個別設定へ移した。 */}
                        {!usesSelectionCleanup && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activeDocumentContext?.selection?.targetBuildingId || activePick.targetPropBuildingId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                          >
                            <option value="">(未選択)</option>
                            {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                              <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        )}

                        {/* P2: 申請人1名なら自動解決。複数名・要選択issue・override時だけ表示する。 */}
                        {activeInstance.name === "申述書（単独）" && shouldShowSoleApplicantSelect({
                          documentName: activeInstance.name,
                          context: activeDocumentContext,
                          documentInstance: activeDocumentInstance,
                        }) && (
                          <div data-testid="sole-applicant-select">
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">
                              申請人（単独出資者）
                            </label>
                            <select
                              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                              value={activeDocumentContext?.selection?.soleApplicantPersonId || activePick.statementApplicantPersonId || ""}
                              onChange={e => handlePickChange(activeInstanceKey, { statementApplicantPersonId: e.target.value })}
                            >
                              <option value="">(未選択)</option>
                              {(activeDocumentContext?.data?.applicants || applicantsInPeople || []).map(p => (
                                <option key={p.id} value={p.id}>{p.name || "(氏名未入力)"}</option>
                              ))}
                            </select>
                            <p className="text-[9px] text-slate-400 mt-1">※未選択の場合、文中は「［申請人］」表示になります</p>
                            {usesSelectionCleanup && hasSelectionOverride(activeDocumentInstance, 'statementApplicantPersonId') && (
                              <button
                                type="button"
                                onClick={() => resetSelectionOverride('statementApplicantPersonId')}
                                className="mt-1.5 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
                                data-testid="reset-sole-applicant"
                              >
                                自動設定に戻す
                              </button>
                            )}
                          </div>
                        )}

                        {/* P2: 申述人の変更は個別設定へ移した。通常時は主UIに出さない。 */}
                        {!usesSelectionCleanup && (() => {
                          const people = siteData?.people || [];
                          const usesContext = activeDocumentContext?.supported === true;
                          const applicants = usesContext
                            ? (activeDocumentContext.data?.applicants || [])
                            : people.filter(p => (p.roles || []).includes("申請人"));
                          const others = people.filter(p => (p.roles || []).includes("その他"));
                          const confirmPeople = usesContext
                            ? (activeDocumentContext.data?.confirmation?.applicants || []).map(item => item.person).filter(Boolean)
                            : (() => {
                                const confirmPersonIds = new Set();
                                for (const bldg of (siteData?.proposedBuildings || [])) {
                                  for (const pid of (bldg.confirmApplicantPersonIds || [])) confirmPersonIds.add(pid);
                                }
                                return [...confirmPersonIds].map(id => people.find(p => p.id === id)).filter(Boolean);
                              })();
                          const currentContextPeople = usesContext
                            ? (activeDocumentContext.data?.statementPeople || [])
                            : [];
                          const seen = new Set();
                          const candidates = [];
                          for (const p of [...applicants, ...others, ...confirmPeople, ...currentContextPeople]) {
                            if (!seen.has(p.id)) { seen.add(p.id); candidates.push(p); }
                          }

                          if (candidates.length === 0) {
                            return <p className="text-[10px] text-slate-400">「申請人」「その他」または確認済証建築申請人が登録されていません。</p>;
                          }

                          const defaultIds = usesContext
                            ? (activeDocumentContext.selection?.applicantPersonIds || [])
                            : applicants.map(p => p.id);
                          const cur = usesContext
                            ? (activeDocumentContext.selection?.statementPersonIds || [])
                            : (Array.isArray(activePick.statementPersonIds) ? activePick.statementPersonIds : []);
                          const selecting = usesContext
                            ? (cur.length !== defaultIds.length || cur.some((id, index) => id !== defaultIds[index]))
                            : cur.length > 0;
                          const selectedIds = usesContext ? cur : (selecting ? cur : defaultIds);

                          const toggleOne = (id) => {
                            const base = new Set(selectedIds);
                            if (base.has(id)) base.delete(id);
                            else base.add(id);
                            if (base.size === 0) return;
                            handlePickChange(activeInstanceKey, { statementPersonIds: Array.from(base) });
                          };

                          return (
                            <div className="mt-1">
                              <label className="block text-[10px] font-bold text-gray-500 mb-2">
                                申述人（署名・押印する人）
                              </label>
                              <p className="text-[9px] text-slate-400 mb-1">※デフォルトは申請人のみ。その他・確認済証建築申請人も選択可能です。</p>
                              <div className="mt-2">
                                <DraggableApplicantList
                                  candidates={candidates}
                                  selectedIds={selectedIds}
                                  onToggle={toggleOne}
                                  onReorder={(newIds) => handlePickChange(activeInstanceKey, { statementPersonIds: newIds })}
                                  minOne
                                />
                              </div>
                              {usesContext && selecting && (
                                <button
                                  type="button"
                                  onClick={() => handlePickChange(activeInstanceKey, { statementPersonIds: [] })}
                                  className="mt-2 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
                                >
                                  Step1の申請人に戻す
                                </button>
                              )}
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

                  {/* 工事人も対象建物も自動解決できている通常時は、区切り枠ごと出さない。 */}
                  {activeInstance.name === "工事完了引渡証明書（表題）" && (showContractorSelect || !usesSelectionCleanup) && (
                    <div className="border-t pt-4">
                      <div className="space-y-3">
                        {/* P2: 対象建物から工事人が1名に解決できる通常時はselectを出さない。
                            解決できない/曖昧/要選択issue/override時だけ表示する。 */}
                        {showContractorSelect && (() => {
                          const usesContext = activeDocumentContext?.supported === true;
                          const people = siteData?.people || [];
                          const linkedIds = activeDocumentContext?.data?.building?.contractorPersonIds || [];
                          const linkedPeople = linkedIds.map(id => people.find(person => person.id === id)).filter(Boolean);
                          const currentContractor = activeDocumentContext?.data?.contractor;
                          const seen = new Set();
                          const candidates = [];
                          for (const person of usesContext
                            ? [...linkedPeople, ...(contractorsInPeople || []), ...(currentContractor ? [currentContractor] : [])]
                            : (contractorsInPeople || [])) {
                            if (!seen.has(person.id)) { seen.add(person.id); candidates.push(person); }
                          }
                          return (
                            <div data-testid="contractor-select">
                              <label className="block text-[10px] font-bold text-gray-500 mb-1">工事人を選択</label>
                              <select
                                className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                                value={activeDocumentContext?.selection?.contractorPersonId || activePick.targetContractorPersonId || ""}
                                onChange={e => handlePickChange(activeInstanceKey, { targetContractorPersonId: e.target.value })}
                              >
                                <option value="">(未選択)</option>
                                {candidates.map(person => (
                                  <option key={person.id} value={person.id}>{person.name || "(名前未入力)"}</option>
                                ))}
                              </select>
                              {usesSelectionCleanup && hasSelectionOverride(activeDocumentInstance, 'targetContractorPersonId') && (
                                <button
                                  type="button"
                                  onClick={() => resetSelectionOverride('targetContractorPersonId')}
                                  className="mt-1.5 w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[9px] font-bold text-slate-600"
                                  data-testid="reset-contractor"
                                >
                                  自動設定に戻す
                                </button>
                              )}
                            </div>
                          );
                        })()}
                        {/* P2: 対象建物はStep1を正本とし、変更は個別設定へ移した。 */}
                        {!usesSelectionCleanup && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-1">対象建物選択</label>
                          <select
                            className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                            value={activeDocumentContext?.selection?.targetBuildingId || activePick.targetPropBuildingId || ""}
                            onChange={e => handlePickChange(activeInstanceKey, { targetPropBuildingId: e.target.value })}
                          >
                            <option value="">(未選択)</option>
                            {(naturalSortList(siteData.proposedBuildings || [], 'houseNum')).map(pb => (
                              <option key={pb.id} value={pb.id}>{pb.houseNum || "(家屋番号未入力)"}</option>
                            ))}
                          </select>
                        </div>
                        )}
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
                            <DraggableApplicantList
                              candidates={applicantCandidates}
                              selectedIds={curApplIds.length > 0 ? curApplIds : applicantCandidates.map(p => p.id)}
                              onToggle={toggleApplicant}
                              onReorder={(newIds) => handlePickChange(activeInstanceKey, { applicantPersonIds: newIds })}
                            />
                          )}
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 mb-2">売渡人を選択（役割「その他」）</label>
                          {sellerCandidates.length === 0 ? (
                            <p className="text-[10px] text-slate-400">「その他」の役割の人が登録されていません。</p>
                          ) : (
                            <DraggableApplicantList
                              candidates={sellerCandidates}
                              selectedIds={curSellerIds.length > 0 ? curSellerIds : sellerCandidates.map(p => p.id)}
                              onToggle={toggleSeller}
                              onReorder={(newIds) => handlePickChange(activeInstanceKey, { saleSellerPersonIds: newIds })}
                            />
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

                  {(() => {
                    if (!isExplicitTextEditDocument(activeInstance.name)) return null;
                    const hasCustomText = !isBlankDocumentHtml(activePick.customText);
                    return (
                      <div className="border-t pt-2 space-y-1.5 font-sans font-bold" data-testid="fulltext-edit-control">
                        {isTextEditing ? (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-black text-amber-700">全文編集中</span>
                              <button
                                type="button"
                                // 押下時に本文のblur保存でレイアウトが動きクリックを取り逃がさないよう、
                                // フォーカスを移さず終了し、未保存の入力はEditableDocBody側で保存する。
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => setTextEditInstanceId("")}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white text-[9px] font-bold rounded"
                              >
                                編集を終了
                              </button>
                            </div>
                            <p className="text-[9px] text-amber-700 leading-relaxed">本文を変更すると最新の案件データとは自動連動しなくなります。</p>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTextEditInstanceId(activeInstance.identity)}
                            className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"
                          >
                            {hasCustomText ? '全文編集を再開' : '全文編集を開始'}
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const isTargetDocument = isExplicitTextEditDocument(activeInstance.name);
                    // P1: fontScaleはDocTemplateの描画処理から参照されないため、対象4帳票のread-only時は
                    // 効かない文書全体スケールのUIを出さない。
                    // P4: 帳票全体スケールは対象4帳票では実装しないと確定。既存fontScaleは互換保持のみ。
                    if (!shouldShowFontSizeControl({ documentName: activeInstance.name, textEditingEnabled: isTextEditing })) {
                      // P4: 通常read-only時は文字サイズselectもヒントも出さない。
                      // 「全文編集を開始」ボタン自体が導線として残るため、常設の説明文は不要。
                      return null;
                    }
                    return (
                  <div className="border-t pt-2" data-testid="font-size-control">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">
                      {isTargetDocument ? '選択文字のサイズ' : '文字サイズ（選択テキスト）'}
                    </label>
                    <select
                      className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white"
                      value={activePick.fontScale || 100}
                      onMouseDown={() => {
                        // 読み取り専用の本文では選択文字HTMLを書き換えず、customTextを生成しない。
                        if (!canApplySelectionFontSize({ documentName: activeInstance.name, textEditingEnabled: isTextEditing })) {
                          window.__savedFontRange = null;
                          return;
                        }
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
                        const savedRange = canApplySelectionFontSize({ documentName: activeInstance.name, textEditingEnabled: isTextEditing })
                          ? window.__savedFontRange
                          : null;
                        const decision = resolveFontSizeChange({
                          documentName: activeInstance.name,
                          textEditingEnabled: isTextEditing,
                          hasSelection: !!savedRange && savedRange.toString().length > 0,
                          fontScale: pct,
                        });
                        if (decision.action !== 'applySelection') {
                          window.__savedFontRange = null;
                          // 対象4帳票で選択文字がない場合はpatchがnullになり、何も保存しない。
                          // controlled valueが元の値へ戻るだけで、fontScale/customTextは生成しない。
                          if (decision.patch) handlePickChange(activeInstanceKey, decision.patch);
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
                        handlePickChange(activeInstanceKey, { ...decision.patch, customText: customHtml });
                        window.__savedFontRange = null;
                      }}
                    >
                      {Array.from({ length: 21 }, (_, i) => 90 + i).map(v => (
                        <option key={v} value={v}>{v === 100 ? '100%（標準）' : `${v}%`}</option>
                      ))}
                    </select>
                    <p className="text-[9px] text-gray-400 mt-1">
                      {isTargetDocument
                        ? '本文中の文字を選択してからサイズを変更（選択文字だけに適用し、全文固定として保存します）'
                        : 'テキストを選択してからサイズを変更'}
                    </p>
                  </div>
                    );
                  })()}

                  {/* 署名者印影の自動配置の注意。非阻害で、印刷/PDF出力の禁止条件にはしない。
                      印刷本文へ混入しないよう、プレビュー本文ではなく左パネルに出す。 */}
                  {isSignerStampAutoAlignDocument(activeInstance.name) && activeSignerStampNotices.length > 0 && (
                    <div
                      className="border-t pt-2 space-y-1.5 font-sans"
                      data-testid="signer-stamp-notice"
                    >
                      {activeSignerStampNotices.map(notice => (
                        <p
                          key={notice}
                          className="text-[9px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 font-bold"
                        >
                          {notice}
                        </p>
                      ))}
                      <p className="text-[9px] text-slate-400 leading-relaxed px-1">
                        印影はプレビュー上でドラッグして手修正できます。本文側を直す場合は全文編集を使ってください。
                      </p>
                      {usesSelectionCleanup && !layoutSettingsOpen && (
                        <button
                          type="button"
                          onClick={() => setLayoutSettingsOpen(true)}
                          className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"
                          data-testid="signer-stamp-notice-open-layout"
                        >
                          レイアウト調整を開く
                        </button>
                      )}
                    </div>
                  )}

                  {/* P4: 中身が全て非表示になる通常状態では、区切り枠だけが残らないようにする。 */}
                  {(() => {
                    const showDetachedAck = !!activeDocumentContext?.issues?.some(issue =>
                      issue.scope === 'detached' && issue.severity === 'blocking'
                    );
                    const showOverrideAck = !!activeDocumentContext?.issues?.some(issue =>
                      issue.scope === 'selection-override' && issue.severity === 'blocking'
                    );
                    const showResetText = !usesSelectionCleanup || canRelinkDocumentText({
                      editMode: activeDocumentContext?.editMode,
                      hasCustomText: !isBlankDocumentHtml(activePick.customText),
                    });
                    const showResetStamps = !usesSelectionCleanup;
                    if (!showDetachedAck && !showOverrideAck && !showResetText && !showResetStamps) return null;
                    return (
                  <div className="border-t pt-2 space-y-2 font-sans font-bold" data-testid="document-secondary-actions">
                    {showDetachedAck && (
                      <button
                        type="button"
                        onClick={handleAcknowledgeDetachedSource}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-[9px] font-bold rounded"
                      >
                        現在の全文を確認済みにする
                      </button>
                    )}
                    {showOverrideAck && (
                      <button
                        type="button"
                        onClick={handleAcknowledgeSelectionOverrides}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-[9px] font-bold rounded"
                      >
                        現在の個別設定を確認済みにする
                      </button>
                    )}
                    {/* P4: 対象4帳票はlinked+customTextなしだと戻す対象が無いので常時表示しない。
                        detached等で意味がある時だけ「最新データ連動へ切替」として残す。 */}
                    {showResetText && (
                      <button onClick={handleResetDocumentText} data-testid="reset-document-text" className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"><ResetIcon size={12} /> {activeDocumentContext?.editMode && activeDocumentContext.editMode !== 'linked' ? '最新データ連動へ切替' : '文言をリセット'}</button>
                    )}
                    {/* P4: 対象4帳票の位置リセットはレイアウト調整へ移動。非対象帳票は従来どおり常時表示。 */}
                    {showResetStamps && (
                      <button onClick={() => handlePickChange(activeInstanceKey, buildStampPositionResetPatch())} className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"><ResetIcon size={12} /> 位置をリセット</button>
                    )}
                  </div>
                    );
                  })()}

                  {/* P4: 印影位置等の二次操作は通常閉じた折りたたみへ退避する。
                      保存済みの位置調整は閉じたままでも見失わないようbadgeで示す。 */}
                  {usesSelectionCleanup && (() => {
                    const stampAdjusted = hasAnyStampAdjustment(activePick);
                    return (
                      <div className="border-t pt-3 space-y-2" data-testid="document-layout-settings">
                        <button
                          type="button"
                          onClick={() => setLayoutSettingsOpen(open => !open)}
                          className="w-full flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-slate-50 hover:bg-slate-100"
                          data-testid="layout-settings-toggle"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-black text-slate-500">レイアウト調整</span>
                            {stampAdjusted && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-black" data-testid="layout-settings-active-badge">
                                位置調整あり
                              </span>
                            )}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400">{layoutSettingsOpen ? '閉じる' : '開く'}</span>
                        </button>

                        {layoutSettingsOpen && (
                          <div className="space-y-2 pt-1" data-testid="layout-settings-body">
                            <p className="text-[9px] text-slate-400 leading-relaxed px-1">
                              印影はプレビュー上でドラッグして位置を調整できます。
                            </p>
                            {stampAdjusted ? (
                              <button
                                type="button"
                                onClick={() => handlePickChange(activeInstanceKey, buildStampPositionResetPatch())}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[9px] font-bold rounded"
                                data-testid="reset-stamp-positions"
                              >
                                <ResetIcon size={12} /> 位置をリセット
                              </button>
                            ) : (
                              <p className="text-[9px] text-slate-400 px-1">現在、位置の調整はありません。</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col items-center overflow-y-auto custom-scrollbar bg-slate-200 shadow-inner rounded-xl">
              {activeInstance ? (
                <div className="p-10">
                  <div className={`document-container w-[210mm] h-[297mm] bg-white shadow-2xl font-serif leading-relaxed text-slate-900 border border-slate-100 relative overflow-hidden ${isTextEditing ? 'ring-2 ring-amber-400' : ''}`} data-text-editing={isTextEditing ? 'true' : 'false'}>
                    <DocTemplate key={activeInstance.identity} name={activeInstance.name} siteData={siteData} instanceIndex={activeInstance.index}
                       instanceKey={activeInstanceKey}
                      pick={activePick} onPickChange={(p) => handlePickChange(activeInstanceKey, p)} onStampPosChange={handleStampPosChange} onSignerStampPosChange={handleSignerStampPosChange} isPrint={false} scriveners={scriveners} documentContext={activeDocumentContext} textEditingEnabled={isTextEditing}
                      onSignerStampBaselineChange={handleSignerStampBaselineChange}
                      onSignerStampNoticeChange={handleSignerStampNoticeChange} />
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
            {blockingPrintInstances.length > 0 && (
              <p data-testid="print-review-notice" style={{ margin: '0 0 16px 0', padding: '8px 10px', fontSize: '12px', color: '#9f1239', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', lineHeight: '1.5' }}>
                要確認事項が残っている書類があります（出力は可能です）：{blockingPrintInstances.map(instance => printDocEntries.find(entry => entry.key === instance.key)?.label || instance.name).join('、')}
              </p>
            )}
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
