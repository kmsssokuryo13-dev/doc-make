import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildDocumentContext } from '../src/documentContext.js';
import {
  getDocumentTemplateKey,
  LEGACY_DOCUMENT_PICK_DEFAULTS,
  reconcileSiteDocumentCompatibility,
} from '../src/v8Compatibility.js';
import {
  buildIssueGuidanceList,
  classifyIssueGuidance,
  countIssuesBySeverity,
  GUIDANCE_KINDS,
  hasNoIssues,
} from '../src/documentIssueGuidance.js';
import { CONTRACTOR_SELECTION_ISSUE_CODES } from '../src/documentSelectionUi.js';

// Step3 P3（2026-09-15 Decision）: 既存issueを分類し、確認導線だけを付ける。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS_SOURCE = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');

const TARGET_DOCUMENTS = ['委任状（表題）', '工事完了引渡証明書（表題）', '申述書（共有）', '申述書（単独）'];
const RA_ID = 'ra-1';

const person = (id, name, roles, share = '1/2') => ({
  id, name, address: `架空県架空市${name}町1番`, roles, share, shareOverrides: {},
});

const building = (id, houseNum, contractorPersonIds = ['c1']) => ({
  id,
  address: '架空県架空市一丁目1番地',
  houseNum,
  kind: '居宅',
  struct: '木造２階建',
  structMaterial: '木造',
  structFloor: '２階建',
  floorAreas: [{ id: `${id}-f1`, floor: '１階', area: '50.00' }],
  registrationCause: '新築',
  registrationDate: { era: '令和', year: '8', month: '1', day: '2' },
  additionalCauses: [],
  annexes: [],
  ownerPersonIds: ['p1', 'p2'],
  contractorPersonIds,
  confirmationCert: {
    rNo: '01', code: '架空県知事', number: '123',
    date: { era: '令和', year: '8', month: '1', day: '2' },
  },
  confirmApplicantPersonIds: ['p1'],
  confirmApplicantNames: [],
});

const makeSite = ({
  applicantPersonIds = ['p1', 'p2'],
  targetBuildingId = 'b1',
  buildings = [building('b1', '101番1'), building('b2', '102番2', ['c1', 'c2'])],
  people = [
    person('p1', '架空 太郎', ['申請人']),
    person('p2', '架空 花子', ['申請人']),
    person('c1', '架空工務店', ['工事人'], ''),
    person('c2', '架空建設', ['工事人'], ''),
  ],
  documents = TARGET_DOCUMENTS,
  docPick = {},
} = {}) => reconcileSiteDocumentCompatibility({
  id: 'site-1',
  people,
  proposedBuildings: buildings,
  land: [],
  buildings: [],
  registrationApplications: [{
    id: RA_ID,
    type: '建物表題登記',
    targetBuildingIds: [targetBuildingId],
    targetLandIds: [],
    applicantPersonIds,
    subject: { beforeBuildingIds: [], afterBuildingIds: [targetBuildingId], landIds: [], primaryBuildingId: null },
    documents: Object.fromEntries(documents.map(name => [name, 1])),
  }],
  docPick,
});

const findInstance = (site, documentName) => {
  const application = (site.registrationApplications || []).find(ra => ra.id === RA_ID);
  const templateKey = getDocumentTemplateKey(documentName);
  return (application?.documentInstances || []).find(
    i => i.templateKey === templateKey && i.copyIndex === 1
  ) || null;
};

const contextFor = (site, documentName) => buildDocumentContext({
  site,
  application: (site.registrationApplications || []).find(ra => ra.id === RA_ID),
  documentInstance: findInstance(site, documentName),
  documentName,
  now: new Date('2026-09-15T00:00:00.000Z'),
});

const applyPick = (site, documentName, patch) => {
  const instanceKey = `${documentName}__1`;
  const context = contextFor(site, documentName);
  const current = { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...(site.docPick?.[instanceKey] || {}) };
  return reconcileSiteDocumentCompatibility(
    { ...site, docPick: { ...site.docPick, [instanceKey]: { ...current, ...patch } } },
    {
      legacyPickIntentFields: { [instanceKey]: Object.keys(patch) },
      selectionOverrideSourceValuesByPick: context?.selectionOverrideSources
        ? { [instanceKey]: context.selectionOverrideSources }
        : {},
    }
  );
};

// handleIssueGuidanceAction の本体だけを切り出す（後続のeffectを巻き込まない）。
const issueActionHandlerSource = () => {
  const start = DOCS_SOURCE.indexOf('const handleIssueGuidanceAction');
  assert.notEqual(start, -1);
  const end = DOCS_SOURCE.indexOf('\n  };', start);
  assert.notEqual(end, -1);
  return DOCS_SOURCE.slice(start, end);
};

const codes = (context) => (context?.issues || []).map(i => i.code);
const kindOf = (context, code) => {
  const issue = (context?.issues || []).find(i => i.code === code);
  assert.ok(issue, `issue not found: ${code}`);
  return classifyIssueGuidance(issue).kind;
};

// ---------------------------------------------------------------------------

test('1. issueなしの対象4帳票はresolved値と「確認事項なし」を表示できる', () => {
  // 委任状（表題）は申請人の持分合計、申述書は申述人の持分合計を検証する。
  const site = makeSite();
  const clean = TARGET_DOCUMENTS.filter(name => {
    const context = contextFor(site, name);
    return context.issues.length === 0;
  });
  assert.ok(clean.length > 0, '少なくとも1帳票はissueなしで解決できること');

  clean.forEach(name => {
    const context = contextFor(site, name);
    assert.equal(hasNoIssues(context), true, name);
    assert.deepEqual(countIssuesBySeverity(context), { blocking: 0, warning: 0, total: 0 }, name);
    assert.deepEqual(buildIssueGuidanceList(context), [], name);
    // resolved値は維持する。
    assert.equal(context.data.building?.houseNum, '101番1', name);
    assert.deepEqual(context.selection.applicantPersonIds, ['p1', 'p2'], name);
    assert.equal(context.status, 'current', name);
  });

  // 正常表示はSummary内の短い一文で、大きなパネルを足さない。
  assert.match(DOCS_SOURCE, /data-testid="summary-no-issues"/);
  assert.match(DOCS_SOURCE, /確認事項なし/);
});

test('2. blocking / warning の件数を正しく数える', () => {
  // 所有者の氏名未入力(blocking) + 所有者と申請人の不一致(warning)を同時に起こす。
  const site = makeSite({
    applicantPersonIds: ['p1'],
    people: [
      person('p1', '架空 太郎', ['申請人'], '1/1'),
      person('p2', '', ['申請人']),
      person('c1', '架空工務店', ['工事人'], ''),
    ],
  });
  const context = contextFor(site, '工事完了引渡証明書（表題）');
  const counts = countIssuesBySeverity(context);
  assert.ok(counts.blocking > 0);
  assert.ok(counts.warning > 0, 'OWNER_APPLICANT_MISMATCH等のwarningを含むこと');
  assert.equal(counts.total, context.issues.length);
  assert.equal(counts.blocking + counts.warning, counts.total);

  // 件数表示と重複排除された一覧がある。
  assert.match(DOCS_SOURCE, /data-testid="summary-issue-counts"/);
  assert.match(DOCS_SOURCE, /要確認 \{counts\.blocking\}件/);
  assert.match(DOCS_SOURCE, /確認推奨 \{counts\.warning\}件/);

  // 同じ文言は1件にまとめる（人物ごとに同一messageが並ばない）。
  const list = buildIssueGuidanceList(context);
  const keys = list.map(i => `${i.severity}|${i.guidance.kind}|${i.message}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('3. Step1由来issueはstep1へ分類し、actionはデータを変更しない', () => {
  const noApplicants = contextFor(makeSite({ applicantPersonIds: [] }), '委任状（表題）');
  assert.ok(codes(noApplicants).includes('APPLICANT_REQUIRED'));
  assert.equal(kindOf(noApplicants, 'APPLICANT_REQUIRED'), GUIDANCE_KINDS.STEP1);

  // Step1の申請人が空のまま個別設定がある場合のAPPLICATION_APPLICANT_REQUIREDもStep1。
  const overridden = applyPick(makeSite(), '委任状（表題）', { applicantPersonIds: ['p2'] });
  const overriddenApp = overridden.registrationApplications.find(ra => ra.id === RA_ID);
  const emptyStep1 = {
    ...overridden,
    registrationApplications: [{ ...overriddenApp, applicantPersonIds: [], subject: { ...overriddenApp.subject } }],
  };
  const emptyStep1Context = contextFor(emptyStep1, '委任状（表題）');
  assert.ok(codes(emptyStep1Context).includes('APPLICATION_APPLICANT_REQUIRED'));
  assert.equal(kindOf(emptyStep1Context, 'APPLICATION_APPLICANT_REQUIRED'), GUIDANCE_KINDS.STEP1);

  // 対象建物未選択もStep1。
  const noBuilding = contextFor(makeSite({ targetBuildingId: '' }), '委任状（表題）');
  assert.ok(codes(noBuilding).includes('TARGET_BUILDING_REQUIRED'));
  assert.equal(kindOf(noBuilding, 'TARGET_BUILDING_REQUIRED'), GUIDANCE_KINDS.STEP1);

  // actionはsetStep(1)だけ。
  assert.match(DOCS_SOURCE, /case GUIDANCE_KINDS\.STEP1:\s*\n\s*setStep\(1\);\s*\n\s*return;/);
});

test('4. 案件情報由来issueはcase-infoへ分類し、タブは文言ヒントのみ', () => {
  // 氏名・住所未入力 → 関係人
  const noName = contextFor(makeSite({
    people: [person('p1', '', ['申請人']), person('p2', '架空 花子', ['申請人']), person('c1', '架空工務店', ['工事人'], '')],
  }), '委任状（表題）');
  assert.ok(codes(noName).includes('PERSON_NAME_REQUIRED'));
  const nameIssue = noName.issues.find(i => i.code === 'PERSON_NAME_REQUIRED');
  assert.equal(classifyIssueGuidance(nameIssue).kind, GUIDANCE_KINDS.CASE_INFO);
  assert.equal(classifyIssueGuidance(nameIssue).tab, '関係人');

  // 建物情報未入力 → 申請建物
  const badBuilding = { ...building('b1', '101番1'), address: '', floorAreas: [] };
  const noAddress = contextFor(makeSite({ buildings: [badBuilding] }), '委任状（表題）');
  assert.ok(codes(noAddress).includes('BUILDING_ADDRESS_REQUIRED'));
  const addrIssue = noAddress.issues.find(i => i.code === 'BUILDING_ADDRESS_REQUIRED');
  assert.equal(classifyIssueGuidance(addrIssue).kind, GUIDANCE_KINDS.CASE_INFO);
  assert.equal(classifyIssueGuidance(addrIssue).tab, '申請建物');

  // 持分は関係人で編集するためcase-info。
  ['SHARE_REQUIRED', 'SHARE_INVALID', 'SHARE_TOTAL_MISMATCH'].forEach(code => {
    const info = classifyIssueGuidance({ code, scope: 'source', path: 'application.applicantPersonIds.share' });
    assert.equal(info.kind, GUIDANCE_KINDS.CASE_INFO, code);
    assert.equal(info.tab, '関係人', code);
  });

  // 人物ID重複も関係人。
  ['APPLICANT_DUPLICATE_ID', 'OWNER_DUPLICATE_ID', 'STATEMENT_SIGNER_DUPLICATE_ID', 'CONTRACTOR_DUPLICATE_ID', 'SOLE_APPLICANT_DUPLICATE_ID'].forEach(code => {
    assert.equal(classifyIssueGuidance({ code, scope: 'source', path: 'site.people' }).kind, GUIDANCE_KINDS.CASE_INFO, code);
  });

  // Editorのタブへのdeep-linkは作らず、既存の案件情報画面へ戻るだけ。
  assert.match(DOCS_SOURCE, /case GUIDANCE_KINDS\.CASE_INFO:[\s\S]*?navigate\('\/'\);\s*\n\s*return;/);
  assert.doesNotMatch(DOCS_SOURCE, /navigate\('\/\?tab=/);
  assert.doesNotMatch(DOCS_SOURCE, /setActiveTab/);
});

test('5. selection-override issueは個別設定へ分類し、override値を変えない', () => {
  const name = '委任状（表題）';
  const overridden = applyPick(makeSite(), name, { applicantPersonIds: ['p2'] });
  const application = overridden.registrationApplications.find(ra => ra.id === RA_ID);
  const changed = {
    ...overridden,
    registrationApplications: [{ ...application, applicantPersonIds: ['p1'] }],
  };
  const context = contextFor(changed, name);
  assert.ok(codes(context).includes('SELECTION_OVERRIDE_SOURCE_CHANGED'));
  assert.equal(kindOf(context, 'SELECTION_OVERRIDE_SOURCE_CHANGED'), GUIDANCE_KINDS.DETAIL_SETTINGS);
  assert.equal(
    classifyIssueGuidance({ code: 'SELECTION_OVERRIDE_BASELINE_UNKNOWN', scope: 'selection-override', path: 'document.selectionOverrides.applicantPersonIds' }).kind,
    GUIDANCE_KINDS.DETAIL_SETTINGS
  );
  // scope:'override' でも、対象がselectionOverridesなら個別設定へ誘導する。
  assert.equal(
    classifyIssueGuidance({ code: 'TARGET_BUILDING_REQUIRED', scope: 'override', path: 'document.selectionOverrides.targetPropBuildingId' }).kind,
    GUIDANCE_KINDS.DETAIL_SETTINGS
  );
  // 同じcodeでもStep1側(source)ならStep1へ誘導する。
  assert.equal(
    classifyIssueGuidance({ code: 'TARGET_BUILDING_REQUIRED', scope: 'source', path: 'application.subject.afterBuildingIds' }).kind,
    GUIDANCE_KINDS.STEP1
  );
  // 個別設定のoverride値は分類しただけでは変化しない。
  assert.deepEqual(findInstance(changed, name).selectionOverrides.applicantPersonIds, ['p2']);

  // actionは個別設定を開いて表示するだけ。
  assert.match(
    DOCS_SOURCE,
    /case GUIDANCE_KINDS\.DETAIL_SETTINGS:\s*\n\s*setDetailSettingsOpen\(true\);\s*\n\s*scrollToTestId\('document-detail-settings'\);\s*\n\s*return;/
  );
});

test('6. detached issueは全文固定導線へ分類し、自動relink/acknowledgeしない', () => {
  ['DETACHED_SOURCE_CHANGED', 'DETACHED_BASELINE_UNKNOWN', 'LEGACY_DETACHED_BASELINE_UNKNOWN'].forEach(code => {
    assert.equal(
      classifyIssueGuidance({ code, scope: 'detached', path: 'document.detachedSourceSnapshot' }).kind,
      GUIDANCE_KINDS.FULLTEXT,
      code
    );
  });

  // 実データでも detached issue が出ることを確認する。
  const name = '委任状（表題）';
  const detached = applyPick(makeSite(), name, { customText: '<p>固定本文</p>' });
  const instance = findInstance(detached, name);
  assert.ok(['detached', 'legacy-detached'].includes(instance.editMode));
  const context = contextFor(detached, name);
  const detachedIssues = (context.issues || []).filter(i => i.scope === 'detached');
  assert.ok(detachedIssues.length > 0);
  detachedIssues.forEach(i => assert.equal(classifyIssueGuidance(i).kind, GUIDANCE_KINDS.FULLTEXT, i.code));

  // actionはスクロールのみ。relink / acknowledge を呼ばない。
  assert.match(DOCS_SOURCE, /case GUIDANCE_KINDS\.FULLTEXT:\s*\n\s*scrollToTestId\('fulltext-edit-control'\);\s*\n\s*return;/);
  const handler = issueActionHandlerSource();
  assert.ok(handler.length > 0);
  assert.doesNotMatch(handler, /handleResetDocumentText|handleAcknowledge|setTextEditInstanceId/);
});

test('7. CONTRACTOR系issueは既存工事人selectへ誘導し、Summaryへ複製しない', () => {
  const name = '工事完了引渡証明書（表題）';
  const ambiguous = contextFor(makeSite({ targetBuildingId: 'b2' }), name);
  assert.ok(codes(ambiguous).includes('CONTRACTOR_AMBIGUOUS'));
  const info = classifyIssueGuidance(ambiguous.issues.find(i => i.code === 'CONTRACTOR_AMBIGUOUS'));
  assert.equal(info.kind, GUIDANCE_KINDS.STEP3_SELECT);
  assert.equal(info.targetTestId, 'contractor-select');

  ['CONTRACTOR_NOT_FOUND', 'LEGACY_CONTRACTOR_FALLBACK'].forEach(code => {
    const g = classifyIssueGuidance({ code, scope: 'source', path: 'building.contractorPersonIds' });
    assert.equal(g.kind, GUIDANCE_KINDS.STEP3_SELECT, code);
    assert.equal(g.targetTestId, 'contractor-select', code);
  });
  // 人物ID重複はselectで選び直せないため案件情報（関係人）。
  assert.deepEqual(
    classifyIssueGuidance({ code: 'CONTRACTOR_DUPLICATE_ID', scope: 'source', path: 'site.people' }),
    { kind: GUIDANCE_KINDS.CASE_INFO, tab: '関係人' }
  );
  // 氏名・住所未入力は案件情報側。
  ['CONTRACTOR_NAME_REQUIRED', 'CONTRACTOR_ADDRESS_REQUIRED'].forEach(code => {
    assert.equal(classifyIssueGuidance({ code, scope: 'source', path: 'people.c1.name' }).kind, GUIDANCE_KINDS.CASE_INFO, code);
  });

  // Summary内にselectを新規実装しない（既存selectへscrollするだけ）。
  const summaryBlock = DOCS_SOURCE.slice(
    DOCS_SOURCE.indexOf('const DocumentContextSummary'),
    DOCS_SOURCE.indexOf('const DocumentContextStatusBadge')
  );
  assert.doesNotMatch(summaryBlock, /<select/);
  assert.doesNotMatch(summaryBlock, /handlePickChange/);
  assert.match(DOCS_SOURCE, /case GUIDANCE_KINDS\.STEP3_SELECT:\s*\n\s*if \(info\.targetTestId\) scrollToTestId\(info\.targetTestId\);/);
});

test('7b. 工事人role人物が0名のCONTRACTOR_REQUIREDは案件情報（関係人）へ誘導する', () => {
  const name = '工事完了引渡証明書（表題）';
  // 対象建物のcontractorPersonIdsが0件、かつ案件内に「工事人」roleの人物も0名。
  const site = makeSite({
    buildings: [building('b1', '101番1', [])],
    people: [
      person('p1', '架空 太郎', ['申請人']),
      person('p2', '架空 花子', ['申請人']),
    ],
  });
  const context = contextFor(site, name);
  assert.ok(codes(context).includes('CONTRACTOR_REQUIRED'), '実contextでCONTRACTOR_REQUIREDが出ること');

  const issue = context.issues.find(i => i.code === 'CONTRACTOR_REQUIRED');
  // 1. CASE_INFO / 関係人 へ分類する。
  assert.deepEqual(classifyIssueGuidance(issue), { kind: GUIDANCE_KINDS.CASE_INFO, tab: '関係人' });
  // 2. STEP3_SELECT にはしない（空のselectへ誘導しない）。
  assert.notEqual(classifyIssueGuidance(issue).kind, GUIDANCE_KINDS.STEP3_SELECT);
  assert.equal(classifyIssueGuidance(issue).targetTestId, undefined);

  // Summary表示でも「案件情報で確認」になる。
  const shown = buildIssueGuidanceList(context).find(i => i.code === 'CONTRACTOR_REQUIRED');
  assert.ok(shown);
  assert.equal(shown.guidance.kind, GUIDANCE_KINDS.CASE_INFO);
  assert.equal(shown.guidance.tab, '関係人');

  // 選択候補が本当に無いことを確認する（P2のselect候補源が全て空）。
  assert.deepEqual(context.data.building?.contractorPersonIds, []);
  assert.equal(context.data.contractor, null);
  assert.equal((site.people || []).filter(p => (p.roles || []).includes('工事人')).length, 0);

  // P2側の表示条件定数そのものは変更しない。
  assert.ok(CONTRACTOR_SELECTION_ISSUE_CODES.includes('CONTRACTOR_REQUIRED'));
});

test('8. SOLE_APPLICANT系issueは既存単独出資者selectへ誘導する', () => {
  const name = '申述書（単独）';
  const context = contextFor(makeSite({ applicantPersonIds: ['p1', 'p2'] }), name);
  assert.ok(codes(context).includes('SOLE_APPLICANT_REQUIRED'));
  const info = classifyIssueGuidance(context.issues.find(i => i.code === 'SOLE_APPLICANT_REQUIRED'));
  assert.equal(info.kind, GUIDANCE_KINDS.STEP3_SELECT);
  assert.equal(info.targetTestId, 'sole-applicant-select');

  ['SOLE_APPLICANT_NOT_APPLICANT', 'SOLE_APPLICANT_NOT_FOUND'].forEach(code => {
    const g = classifyIssueGuidance({ code, scope: 'source', path: 'document.selectionOverrides.statementApplicantPersonId' });
    assert.equal(g.kind, GUIDANCE_KINDS.STEP3_SELECT, code);
    assert.equal(g.targetTestId, 'sole-applicant-select', code);
  });
  // 人物ID重複はselectで解決できないため案件情報。
  assert.equal(
    classifyIssueGuidance({ code: 'SOLE_APPLICANT_DUPLICATE_ID', scope: 'source', path: 'site.people' }).kind,
    GUIDANCE_KINDS.CASE_INFO
  );
});

test('9. 未知issue・導線不明issueはmessageだけでactionを付けない', () => {
  assert.equal(classifyIssueGuidance({ code: 'FUTURE_UNKNOWN_CODE', scope: 'source', path: '' }).kind, GUIDANCE_KINDS.NONE);
  assert.equal(classifyIssueGuidance({ code: 'FUTURE_UNKNOWN_CODE', scope: 'source', path: 'document.somethingElse' }).kind, GUIDANCE_KINDS.NONE);
  // contentOverridesは対応UIが無いので導線なし。
  assert.equal(
    classifyIssueGuidance({ code: 'CONTENT_OVERRIDES_NOT_APPLIED', scope: 'override', path: 'document.contentOverrides' }).kind,
    GUIDANCE_KINDS.NONE
  );
  assert.equal(classifyIssueGuidance(null).kind, GUIDANCE_KINDS.NONE);
  assert.equal(classifyIssueGuidance(undefined).kind, GUIDANCE_KINDS.NONE);

  // NONEにはラベルが無く、ボタンを描画しない。
  assert.match(DOCS_SOURCE, /\{label && onIssueAction && \(/);
  assert.doesNotMatch(DOCS_SOURCE, /GUIDANCE_ACTION_LABELS\[GUIDANCE_KINDS\.NONE\]/);
});

test('10. issue actionは案件データ・保存状態を変更しない', () => {
  const handler = issueActionHandlerSource();
  assert.ok(handler.length > 0);
  // 許可されるのは画面遷移・表示状態だけ。
  [/setSites\(/, /handlePickChange\(/, /reconcileSiteDocumentCompatibility\(/, /localStorage/, /resetSelectionOverride\(/]
    .forEach(pattern => assert.doesNotMatch(handler, pattern, String(pattern)));
  assert.match(handler, /setStep\(1\)/);
  assert.match(handler, /navigate\('\/'\)/);
  assert.match(handler, /setDetailSettingsOpen\(true\)/);
  assert.match(handler, /scrollToTestId\(/);

  // 分類関数自体もpureで、入力issueを書き換えない。
  const issue = Object.freeze({ code: 'SELECTION_OVERRIDE_SOURCE_CHANGED', scope: 'selection-override', path: 'document.selectionOverrides.applicantPersonIds', severity: 'blocking', message: 'm' });
  assert.doesNotThrow(() => classifyIssueGuidance(issue));
  const before = JSON.stringify(issue);
  classifyIssueGuidance(issue);
  buildIssueGuidanceList({ issues: [issue], supported: true });
  assert.equal(JSON.stringify(issue), before);
});

test('11. P2の個別設定 作成・解除に回帰がない', () => {
  const name = '委任状（表題）';
  const overridden = applyPick(makeSite(), name, { targetPropBuildingId: 'b2' });
  assert.equal(findInstance(overridden, name).selectionOverrides.targetPropBuildingId, 'b2');
  const reset = applyPick(overridden, name, { targetPropBuildingId: 'b1' });
  assert.equal(
    Object.prototype.hasOwnProperty.call(findInstance(reset, name).selectionOverrides, 'targetPropBuildingId'),
    false
  );
  assert.match(DOCS_SOURCE, /data-testid="document-detail-settings"/);
  assert.match(DOCS_SOURCE, /data-testid="reset-target-building"/);
  assert.match(DOCS_SOURCE, /data-testid="detail-settings-active-badge"/);
});

test('12. P1の全文編集UIに回帰がない', () => {
  assert.match(DOCS_SOURCE, /data-testid="fulltext-edit-control"/);
  assert.match(DOCS_SOURCE, /全文編集を開始/);
  assert.match(DOCS_SOURCE, /全文編集を再開/);
  assert.match(DOCS_SOURCE, /編集を終了/);
  assert.match(DOCS_SOURCE, /選択文字のサイズ/);
  assert.match(DOCS_SOURCE, /data-testid="font-size-control-hint"/);
});

test('13. 要確認があっても印刷を止めない', () => {
  assert.match(DOCS_SOURCE, /要確認事項は注意情報として表示するのみで、印刷\/PDF保存の停止条件にはしない。/);
  assert.match(DOCS_SOURCE, /（出力は可能です）/);
  // blocking issue があっても printOn 既定は維持される。
  const site = makeSite({ applicantPersonIds: [] });
  const context = contextFor(site, '委任状（表題）');
  assert.ok(countIssuesBySeverity(context).blocking > 0);
  assert.equal(findInstance(site, '委任状（表題）').printEnabled, true);
});

test('14. 非対象帳票・legacyは従来のissue表示のまま', () => {
  // guidanceEnabledがfalseなら従来の<ul>一覧にフォールバックする。
  const summaryBlock = DOCS_SOURCE.slice(
    DOCS_SOURCE.indexOf('const DocumentContextSummary'),
    DOCS_SOURCE.indexOf('const DocumentContextStatusBadge')
  );
  assert.match(summaryBlock, /guidanceEnabled = false/);
  assert.match(summaryBlock, /\}\)\(\) : context\.issues\?\.length > 0 && \(/);
  // guidanceEnabledはP2の対象4帳票判定を再利用する。
  assert.match(DOCS_SOURCE, /guidanceEnabled=\{usesSelectionCleanup\}/);
  // context非対応(legacy)ではSummary自体を描画しない既存挙動を維持。
  assert.match(summaryBlock, /if \(!context\?\.supported\) return null;/);
});

test('15. 対象4帳票で到達し得るissueが分類漏れしていない', () => {
  // 代表シナリオを通して、実際に出たissueのうちNONEになるものを点検する。
  const scenarios = [
    makeSite(),
    makeSite({ applicantPersonIds: [] }),
    makeSite({ targetBuildingId: '' }),
    makeSite({ targetBuildingId: 'b2' }),
    makeSite({ applicantPersonIds: ['p1'] }),
    makeSite({ buildings: [{ ...building('b1', '101番1'), address: '', kind: '', struct: '', floorAreas: [], registrationCause: '', confirmationCert: null, confirmApplicantPersonIds: [] }] }),
    makeSite({ people: [person('p1', '', ['申請人'], ''), person('p2', '架空 花子', ['申請人']), person('c1', '架空工務店', ['工事人'], '')] }),
  ];
  const unclassified = new Set();
  const seenCodes = new Set();
  scenarios.forEach(site => {
    TARGET_DOCUMENTS.forEach(name => {
      const context = contextFor(site, name);
      (context.issues || []).forEach(issue => {
        seenCodes.add(issue.code);
        if (classifyIssueGuidance(issue).kind === GUIDANCE_KINDS.NONE) unclassified.add(issue.code);
      });
    });
  });
  assert.ok(seenCodes.size >= 15, `代表シナリオで十分なissueを網羅すること (${seenCodes.size})`);
  assert.deepEqual([...unclassified], [], `分類漏れ: ${[...unclassified].join(', ')}`);
});
