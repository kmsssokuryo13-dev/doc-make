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
  buildSelectionResetPatch,
  CONTRACTOR_SELECTION_ISSUE_CODES,
  getSelectionOverrideKeys,
  hasSelectionOverride,
  isSelectionCleanupDocument,
  SELECTION_OVERRIDE_LABELS,
  shouldShowContractorSelect,
  shouldShowSoleApplicantSelect,
  SOLE_APPLICANT_SELECTION_ISSUE_CODES,
  usesSelectionCleanupUi,
} from '../src/documentSelectionUi.js';

// Step3 P2（2026-09-15 Decision）: Step1を正本とし、対象4帳票の重複選択UIを個別設定へ移す。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS_SOURCE = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');

const TARGET_DOCUMENTS = ['委任状（表題）', '工事完了引渡証明書（表題）', '申述書（共有）', '申述書（単独）'];
const APPLICANT_OVERRIDE_DOCUMENTS = ['委任状（表題）', '工事完了引渡証明書（表題）'];
const ALL_DOCUMENTS = [...TARGET_DOCUMENTS, '委任状（保存）'];
const RA_ID = 'ra-1';

const person = (id, name, roles) => ({
  id, name, address: `架空県架空市${name}町`, roles, share: '1/2', shareOverrides: {},
});

const building = (id, houseNum, contractorPersonIds) => ({
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
  confirmationCert: { rNo: '01', code: '確認建築架空', number: '123', date: { era: '令和', year: '8', month: '1', day: '2' } },
  confirmApplicantPersonIds: ['p1'],
  confirmApplicantNames: [],
});

// 既定: 申請人2名 / 対象建物b1（工事人c1が1名だけ紐づく）。
const makeSite = ({
  applicantPersonIds = ['p1', 'p2'],
  targetBuildingId = 'b1',
  buildings = [building('b1', '101番1', ['c1']), building('b2', '102番2', ['c1', 'c2'])],
  people = [
    person('p1', '架空 太郎', ['申請人']),
    person('p2', '架空 花子', ['申請人']),
    person('c1', '架空工務店', ['工事人']),
    person('c2', '架空建設', ['工事人']),
    person('o1', '架空 三郎', ['その他']),
  ],
  documents = ALL_DOCUMENTS,
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
    subject: {
      beforeBuildingIds: [],
      afterBuildingIds: [targetBuildingId],
      landIds: [],
      primaryBuildingId: null,
    },
    documents: Object.fromEntries(documents.map(name => [name, 1])),
  }],
  docPick: {},
});

const instanceKeyFor = (documentName) => `${documentName}__1`;

const findInstance = (site, documentName) => {
  const application = (site.registrationApplications || []).find(ra => ra.id === RA_ID);
  const templateKey = getDocumentTemplateKey(documentName);
  return (application?.documentInstances || []).find(
    instance => instance.templateKey === templateKey && instance.copyIndex === 1
  ) || null;
};

const contextFor = (site, documentName) => {
  const application = (site.registrationApplications || []).find(ra => ra.id === RA_ID);
  return buildDocumentContext({
    site,
    application,
    documentInstance: findInstance(site, documentName),
    documentName,
    now: new Date('2026-09-15T00:00:00.000Z'),
  });
};

// Docs.jsx の handlePickChange と同じ経路でpatchを適用する。
const applyPick = (site, documentName, patch) => {
  const instanceKey = instanceKeyFor(documentName);
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

const overridesOf = (site, documentName) => findInstance(site, documentName)?.selectionOverrides || {};

const issueCodes = (context) => (context?.issues || []).map(issue => issue.code);

// Docs.jsx 内で、指定テキストがP2の整理対象ガードの下にあるかを確認する。
const sourceBetween = (startMarker, endMarker) => {
  const start = DOCS_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `marker not found: ${startMarker}`);
  const end = DOCS_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `marker not found: ${endMarker}`);
  return DOCS_SOURCE.slice(start, end);
};

// ---------------------------------------------------------------------------

test('P2対象は建物表題4帳票だけで、非対象帳票は整理対象にしない', () => {
  TARGET_DOCUMENTS.forEach(name => assert.equal(isSelectionCleanupDocument(name), true, name));
  ['委任状（保存）', '委任状（住所変更）', '売渡証明書', '上申書'].forEach(name => {
    assert.equal(isSelectionCleanupDocument(name), false, name);
  });
  // context非対応（legacy案件）では従来UIのまま扱う。
  assert.equal(usesSelectionCleanupUi({ documentName: '委任状（表題）', context: { supported: true } }), true);
  assert.equal(usesSelectionCleanupUi({ documentName: '委任状（表題）', context: { supported: false } }), false);
  assert.equal(usesSelectionCleanupUi({ documentName: '委任状（表題）', context: null }), false);
  assert.equal(usesSelectionCleanupUi({ documentName: '委任状（保存）', context: { supported: true } }), false);
});

test('1. 対象4帳票の通常時は対象建物selectを常時表示しない', () => {
  // 申述書ブロックと工事完了ブロックの対象建物selectは整理ガードの下にある。
  const statementBlock = sourceBetween(
    '{/* P2: 対象建物はStep1を正本とし、変更は個別設定へ移した。 */}',
    '申請人（単独出資者）'
  );
  assert.match(statementBlock, /!usesSelectionCleanup && \(/);
  assert.match(statementBlock, /対象建物選択/);

  // 委任状（表題）の予定家屋番号選択も同様。非対象の委任状（保存）は条件に残す。
  const buildingBlock = sourceBetween(
    '{/* P2: 委任状（表題）の対象建物は個別設定へ移動。非対象の委任状（保存）は従来どおり。 */}',
    '予定家屋番号選択'
  );
  assert.match(buildingBlock, /activeInstance\.name === "委任状（保存）"/);
  assert.match(buildingBlock, /activeInstance\.name === "委任状（表題）" && !usesSelectionCleanup/);

  // 個別設定を開いた時だけ出る対象建物UIが存在する。
  assert.match(DOCS_SOURCE, /data-testid="detail-target-building"/);
  assert.match(DOCS_SOURCE, /この書類だけ対象建物を変更/);
});

test('2. 委任状（表題）/工事完了引渡証明書（表題）の通常時は申請人リストを常時表示しない', () => {
  // 申請人リストのIIFEは対象4帳票で早期returnする。
  assert.match(
    DOCS_SOURCE,
    /\/\/ P2: 対象4帳票はStep1の申請人をそのまま使う。変更は個別設定へ移した。\s*\n\s*if \(usesSelectionCleanup\) return null;/
  );
  // 個別設定内にだけ申請人変更UIがある。
  assert.match(DOCS_SOURCE, /data-testid="detail-applicants"/);
  assert.match(DOCS_SOURCE, /この書類だけ申請人を変更/);
  APPLICANT_OVERRIDE_DOCUMENTS.forEach(name => {
    assert.equal(isSelectionCleanupDocument(name), true, name);
  });
});

test('3. overrideなしならStep1変更にプレビュー解決が追従する', () => {
  let site = makeSite();
  TARGET_DOCUMENTS.forEach(name => {
    const context = contextFor(site, name);
    assert.equal(context.selection.targetBuildingId, 'b1', name);
    assert.deepEqual(context.selection.applicantPersonIds, ['p1', 'p2'], name);
    assert.deepEqual(getSelectionOverrideKeys(findInstance(site, name)), [], name);
  });

  // Step1で対象建物と申請人を変更する。
  const changed = makeSite({ targetBuildingId: 'b2', applicantPersonIds: ['p2'] });
  TARGET_DOCUMENTS.forEach(name => {
    const context = contextFor(changed, name);
    assert.equal(context.selection.targetBuildingId, 'b2', name);
    assert.deepEqual(context.selection.applicantPersonIds, ['p2'], name);
  });
});

test('4. 個別設定で対象建物を変更するとselectionOverrideが保存される', () => {
  TARGET_DOCUMENTS.forEach(name => {
    const site = applyPick(makeSite(), name, { targetPropBuildingId: 'b2' });
    assert.equal(overridesOf(site, name).targetPropBuildingId, 'b2', name);
    assert.equal(hasSelectionOverride(findInstance(site, name), 'targetPropBuildingId'), true, name);
    assert.equal(contextFor(site, name).selection.targetBuildingId, 'b2', name);
    // 個別設定中であることがUIから分かるキー一覧に出る。
    assert.deepEqual(getSelectionOverrideKeys(findInstance(site, name)), ['targetPropBuildingId'], name);
  });
});

test('5. 「Step1の対象建物に戻す」でoverrideが解除されStep1へ再追従する', () => {
  TARGET_DOCUMENTS.forEach(name => {
    const overridden = applyPick(makeSite(), name, { targetPropBuildingId: 'b2' });
    const context = contextFor(overridden, name);
    const patch = buildSelectionResetPatch('targetPropBuildingId', context);
    // 空文字ではなくcanonical値を書き戻す。
    assert.deepEqual(patch, { targetPropBuildingId: 'b1' }, name);

    const reset = applyPick(overridden, name, patch);
    assert.equal(hasSelectionOverride(findInstance(reset, name), 'targetPropBuildingId'), false, name);
    assert.deepEqual(getSelectionOverrideKeys(findInstance(reset, name)), [], name);
    assert.equal(contextFor(reset, name).selection.targetBuildingId, 'b1', name);

    // 解除後はStep1変更に再追従する。
    const afterStep1 = applyPick(makeSite({ targetBuildingId: 'b2' }), name, { printOn: true });
    assert.equal(contextFor(afterStep1, name).selection.targetBuildingId, 'b2', name);
  });
});

test('5b. 対象建物の解除は空overrideを作らずTARGET_BUILDING_REQUIREDを誘発しない', () => {
  TARGET_DOCUMENTS.forEach(name => {
    const overridden = applyPick(makeSite(), name, { targetPropBuildingId: 'b2' });
    const reset = applyPick(overridden, name, buildSelectionResetPatch('targetPropBuildingId', contextFor(overridden, name)));
    assert.equal(hasSelectionOverride(findInstance(reset, name), 'targetPropBuildingId'), false, name);
    assert.equal(issueCodes(contextFor(reset, name)).includes('TARGET_BUILDING_REQUIRED'), false, name);

    // 参考: 素朴に "" を保存すると空overrideが出来てblocking issueになる（この経路をUIに出さない）。
    const naive = applyPick(overridden, name, { targetPropBuildingId: '' });
    assert.equal(hasSelectionOverride(findInstance(naive, name), 'targetPropBuildingId'), true, name);
    assert.equal(issueCodes(contextFor(naive, name)).includes('TARGET_BUILDING_REQUIRED'), true, name);
  });
  // 個別設定の対象建物selectに「選択できる」空optionを置いていないこと。
  // Step1未確定時のプレースホルダはdisabledで、空overrideを作れない。
  const detailBlock = sourceBetween('data-testid="detail-target-building"', 'data-testid="reset-target-building"');
  const emptyOptions = detailBlock.match(/<option value=""[^>]*>/g) || [];
  assert.equal(emptyOptions.length, 1, '空optionはプレースホルダ1件だけ');
  assert.match(emptyOptions[0], /disabled/);
  assert.match(detailBlock, /\{!selectedBuildingId && \(/);
});

test('6. 個別設定で申請人を変更するとoverrideが保存される', () => {
  APPLICANT_OVERRIDE_DOCUMENTS.forEach(name => {
    const site = applyPick(makeSite(), name, { applicantPersonIds: ['p2'] });
    assert.deepEqual(overridesOf(site, name).applicantPersonIds, ['p2'], name);
    assert.deepEqual(contextFor(site, name).selection.applicantPersonIds, ['p2'], name);
    assert.deepEqual(getSelectionOverrideKeys(findInstance(site, name)), ['applicantPersonIds'], name);
  });
});

test('7. 「Step1の申請人に戻す」でoverrideが解除されStep1へ再追従する', () => {
  APPLICANT_OVERRIDE_DOCUMENTS.forEach(name => {
    const overridden = applyPick(makeSite(), name, { applicantPersonIds: ['p2'] });
    const patch = buildSelectionResetPatch('applicantPersonIds', contextFor(overridden, name));
    assert.deepEqual(patch, { applicantPersonIds: ['p1', 'p2'] }, name);

    const reset = applyPick(overridden, name, patch);
    assert.equal(hasSelectionOverride(findInstance(reset, name), 'applicantPersonIds'), false, name);
    assert.deepEqual(contextFor(reset, name).selection.applicantPersonIds, ['p1', 'p2'], name);
  });
});

test('8. 工事人が対象建物に1名だけならselectを表示せず自動解決する', () => {
  const name = '工事完了引渡証明書（表題）';
  const site = makeSite({ targetBuildingId: 'b1' });
  const context = contextFor(site, name);
  assert.equal(context.selection.contractorPersonId, 'c1');
  CONTRACTOR_SELECTION_ISSUE_CODES.forEach(code => {
    assert.equal(issueCodes(context).includes(code), false, code);
  });
  assert.equal(shouldShowContractorSelect({
    documentName: name,
    context,
    documentInstance: findInstance(site, name),
  }), false);
});

test('9. 工事人が0名/複数名なら選択UIを表示する', () => {
  const name = '工事完了引渡証明書（表題）';

  // 複数名: CONTRACTOR_AMBIGUOUS
  const many = makeSite({ targetBuildingId: 'b2' });
  const manyContext = contextFor(many, name);
  assert.equal(issueCodes(manyContext).includes('CONTRACTOR_AMBIGUOUS'), true);
  assert.equal(shouldShowContractorSelect({
    documentName: name, context: manyContext, documentInstance: findInstance(many, name),
  }), true);

  // 0名かつ案件内にも工事人がいない: CONTRACTOR_REQUIRED
  const none = makeSite({
    buildings: [building('b1', '101番1', [])],
    people: [person('p1', '架空 太郎', ['申請人']), person('p2', '架空 花子', ['申請人'])],
  });
  const noneContext = contextFor(none, name);
  assert.equal(issueCodes(noneContext).includes('CONTRACTOR_REQUIRED'), true);
  assert.equal(shouldShowContractorSelect({
    documentName: name, context: noneContext, documentInstance: findInstance(none, name),
  }), true);

  // 建物紐付けなし＋案件内に工事人が複数: CONTRACTOR_AMBIGUOUS
  const unlinkedMany = makeSite({ buildings: [building('b1', '101番1', [])] });
  const unlinkedManyContext = contextFor(unlinkedMany, name);
  assert.equal(issueCodes(unlinkedManyContext).includes('CONTRACTOR_AMBIGUOUS'), true);
  assert.equal(shouldShowContractorSelect({
    documentName: name, context: unlinkedManyContext, documentInstance: findInstance(unlinkedMany, name),
  }), true);

  // 建物紐付けなし＋案件内に工事人1名: LEGACY_CONTRACTOR_FALLBACK。
  // 値は暫定解決されるが「対象建物から解決できた」状態ではないため、確認できるよう表示する。
  const fallback = makeSite({
    buildings: [building('b1', '101番1', [])],
    people: [
      person('p1', '架空 太郎', ['申請人']),
      person('p2', '架空 花子', ['申請人']),
      person('c1', '架空工務店', ['工事人']),
    ],
  });
  const fallbackContext = contextFor(fallback, name);
  assert.equal(issueCodes(fallbackContext).includes('LEGACY_CONTRACTOR_FALLBACK'), true);
  assert.equal(fallbackContext.selection.contractorPersonId, 'c1');
  assert.equal(shouldShowContractorSelect({
    documentName: name, context: fallbackContext, documentInstance: findInstance(fallback, name),
  }), true);
});

test('10. 工事人overrideがあれば表示し、「自動設定に戻す」で自動解決へ戻る', () => {
  const name = '工事完了引渡証明書（表題）';
  const overridden = applyPick(makeSite({ targetBuildingId: 'b1' }), name, { targetContractorPersonId: 'c2' });
  assert.equal(overridesOf(overridden, name).targetContractorPersonId, 'c2');

  const overriddenContext = contextFor(overridden, name);
  assert.equal(overriddenContext.selection.contractorPersonId, 'c2');
  // 自動解決できる状態でもoverrideがあるので表示する。
  assert.equal(shouldShowContractorSelect({
    documentName: name, context: overriddenContext, documentInstance: findInstance(overridden, name),
  }), true);

  const reset = applyPick(overridden, name, buildSelectionResetPatch('targetContractorPersonId', overriddenContext));
  assert.equal(hasSelectionOverride(findInstance(reset, name), 'targetContractorPersonId'), false);
  const resetContext = contextFor(reset, name);
  assert.equal(resetContext.selection.contractorPersonId, 'c1');
  assert.equal(shouldShowContractorSelect({
    documentName: name, context: resetContext, documentInstance: findInstance(reset, name),
  }), false);
});

test('11. 申述人overrideがなければ通常時に主UIへ表示しない', () => {
  // 申述人リストは整理ガードの下にある。
  assert.match(
    DOCS_SOURCE,
    /\{\/\* P2: 申述人の変更は個別設定へ移した。通常時は主UIに出さない。 \*\/\}\s*\n\s*\{!usesSelectionCleanup && \(\(\) => \{/
  );
  ['申述書（共有）', '申述書（単独）'].forEach(name => {
    const site = makeSite();
    assert.deepEqual(getSelectionOverrideKeys(findInstance(site, name)), [], name);
    // 既定の申述人はStep1申請人と一致する。
    assert.deepEqual(contextFor(site, name).selection.statementPersonIds, ['p1', 'p2'], name);
  });
  assert.match(DOCS_SOURCE, /data-testid="detail-statement-people"/);
});

test('12. 申述人は個別設定で変更でき、Step1の申請人に戻せる', () => {
  ['申述書（共有）', '申述書（単独）'].forEach(name => {
    const overridden = applyPick(makeSite(), name, { statementPersonIds: ['p1', 'o1'] });
    assert.deepEqual(overridesOf(overridden, name).statementPersonIds, ['p1', 'o1'], name);
    assert.deepEqual(contextFor(overridden, name).selection.statementPersonIds, ['p1', 'o1'], name);

    const patch = buildSelectionResetPatch('statementPersonIds', contextFor(overridden, name));
    assert.deepEqual(patch, { statementPersonIds: [] }, name);
    const reset = applyPick(overridden, name, patch);
    assert.equal(hasSelectionOverride(findInstance(reset, name), 'statementPersonIds'), false, name);
    assert.deepEqual(contextFor(reset, name).selection.statementPersonIds, ['p1', 'p2'], name);
  });
});

test('13. 申述書（単独）は申請人1名なら単独出資者selectを表示せず自動解決する', () => {
  const name = '申述書（単独）';
  const site = makeSite({ applicantPersonIds: ['p1'] });
  const context = contextFor(site, name);
  assert.equal(context.selection.soleApplicantPersonId, 'p1');
  SOLE_APPLICANT_SELECTION_ISSUE_CODES.forEach(code => {
    assert.equal(issueCodes(context).includes(code), false, code);
  });
  assert.equal(shouldShowSoleApplicantSelect({
    documentName: name, context, documentInstance: findInstance(site, name),
  }), false);
});

test('14. 申述書（単独）は申請人が複数なら選択UIを表示し、解除で自動設定へ戻る', () => {
  const name = '申述書（単独）';
  const site = makeSite({ applicantPersonIds: ['p1', 'p2'] });
  const context = contextFor(site, name);
  assert.equal(issueCodes(context).includes('SOLE_APPLICANT_REQUIRED'), true);
  assert.equal(shouldShowSoleApplicantSelect({
    documentName: name, context, documentInstance: findInstance(site, name),
  }), true);

  // 選択するとoverrideとして保存される。
  const chosen = applyPick(site, name, { statementApplicantPersonId: 'p2' });
  assert.equal(overridesOf(chosen, name).statementApplicantPersonId, 'p2');
  assert.equal(contextFor(chosen, name).selection.soleApplicantPersonId, 'p2');

  // 申請人1名 + override は表示し続け、解除すると自動解決へ戻る。
  const single = applyPick(makeSite({ applicantPersonIds: ['p1'] }), name, { statementApplicantPersonId: 'p1' });
  const singleContext = contextFor(single, name);
  assert.equal(shouldShowSoleApplicantSelect({
    documentName: name, context: singleContext, documentInstance: findInstance(single, name),
  }), true);
  const reset = applyPick(single, name, buildSelectionResetPatch('statementApplicantPersonId', singleContext));
  assert.equal(hasSelectionOverride(findInstance(reset, name), 'statementApplicantPersonId'), false);
  const resetContext = contextFor(reset, name);
  assert.equal(resetContext.selection.soleApplicantPersonId, 'p1');
  assert.equal(shouldShowSoleApplicantSelect({
    documentName: name, context: resetContext, documentInstance: findInstance(reset, name),
  }), false);
});

test('15. 既存selectionOverridesは勝手に解除されず、UIから内容を確認できる', () => {
  const name = '工事完了引渡証明書（表題）';
  let site = applyPick(makeSite(), name, { targetPropBuildingId: 'b2' });
  site = applyPick(site, name, { applicantPersonIds: ['p2'] });
  site = applyPick(site, name, { targetContractorPersonId: 'c2' });

  const keys = getSelectionOverrideKeys(findInstance(site, name));
  assert.deepEqual(keys.slice().sort(), ['applicantPersonIds', 'targetContractorPersonId', 'targetPropBuildingId']);
  // 表示用ラベルが全キーに存在する（個別設定中の内容表示に使う）。
  keys.forEach(key => assert.ok(SELECTION_OVERRIDE_LABELS[key], key));

  // 無関係なpatch（印刷ON/OFF）でoverrideが失われない。
  const afterUnrelated = applyPick(site, name, { printOn: false });
  assert.deepEqual(
    getSelectionOverrideKeys(findInstance(afterUnrelated, name)).slice().sort(),
    ['applicantPersonIds', 'targetContractorPersonId', 'targetPropBuildingId']
  );

  // 折りたたんでいてもoverride内容は常に表示する。
  const panel = sourceBetween('data-testid="document-detail-settings"', 'data-testid="detail-settings-body"');
  assert.match(panel, /data-testid="selection-override-summary"/);
  assert.match(panel, /この書類だけの設定/);
  assert.match(panel, /data-testid="detail-settings-active-badge"/);
  // サマリはdetailSettingsOpenの内側に入っていない。
  const summaryIndex = panel.indexOf('data-testid="selection-override-summary"');
  const openGuardIndex = panel.indexOf('{detailSettingsOpen && (');
  assert.ok(summaryIndex !== -1 && openGuardIndex !== -1 && summaryIndex < openGuardIndex);
});

test('16. override中にStep1が変わってもSELECTION_OVERRIDE_SOURCE_CHANGEDを検知する', () => {
  const name = '委任状（表題）';
  const overridden = applyPick(makeSite(), name, { applicantPersonIds: ['p2'] });
  assert.equal(issueCodes(contextFor(overridden, name)).includes('SELECTION_OVERRIDE_SOURCE_CHANGED'), false);

  // Step1の申請人を変更する（overrideは保持されたまま）。
  const application = overridden.registrationApplications.find(ra => ra.id === RA_ID);
  const changed = {
    ...overridden,
    registrationApplications: [{ ...application, applicantPersonIds: ['p1'] }],
  };
  const changedContext = contextFor(changed, name);
  assert.equal(issueCodes(changedContext).includes('SELECTION_OVERRIDE_SOURCE_CHANGED'), true);
  // overrideは勝手に解除されない。
  assert.deepEqual(overridesOf(changed, name).applicantPersonIds, ['p2']);
  assert.deepEqual(changedContext.selection.applicantPersonIds, ['p2']);
});

test('17. 非対象帳票のStep3 UIに回帰がない', () => {
  // 委任状（保存）は予定家屋番号選択と従来の申請人UIを維持する。
  const buildingBlock = sourceBetween(
    '{/* P2: 委任状（表題）の対象建物は個別設定へ移動。非対象の委任状（保存）は従来どおり。 */}',
    '</select>'
  );
  assert.match(buildingBlock, /予定家屋番号選択/);
  assert.match(buildingBlock, /<option value="">\(未選択\)<\/option>/);
  assert.equal(usesSelectionCleanupUi({ documentName: '委任状（保存）', context: { supported: true } }), false);

  // 非対象帳票では工事人・単独出資者の表示判定が従来どおり常に真になる。
  assert.equal(shouldShowContractorSelect({
    documentName: '工事完了引渡証明書（表題）', context: { supported: false }, documentInstance: null,
  }), true);
  assert.equal(shouldShowSoleApplicantSelect({
    documentName: '申述書（単独）', context: { supported: false }, documentInstance: null,
  }), true);
  // 他帳票では工事人/単独出資者の判定対象にならない。
  assert.equal(shouldShowContractorSelect({ documentName: '委任状（保存）', context: { supported: true } }), false);
  assert.equal(shouldShowSoleApplicantSelect({ documentName: '申述書（共有）', context: { supported: true } }), false);
});

test('18. P1の全文編集UIと本文read-only制御を維持している', () => {
  assert.match(DOCS_SOURCE, /全文編集を開始/);
  assert.match(DOCS_SOURCE, /全文編集を再開/);
  assert.match(DOCS_SOURCE, /編集を終了/);
  assert.match(DOCS_SOURCE, /setTextEditInstanceId/);
  // P4: read-only時の常時ヒントは撤去。全文編集中の「選択文字のサイズ」は維持する。
  assert.doesNotMatch(DOCS_SOURCE, /data-testid="font-size-control-hint"/);
  assert.match(DOCS_SOURCE, /選択文字のサイズ/);
  assert.match(DOCS_SOURCE, /最新データ連動へ切替|文言をリセット/);
});

test('19. 要確認事項があってもPDF/印刷を停止条件に戻していない', () => {
  assert.match(DOCS_SOURCE, /要確認事項は注意情報として表示するのみで、印刷\/PDF保存の停止条件にはしない。/);
  assert.match(DOCS_SOURCE, /（出力は可能です）/);
  // 印刷導線と書類一覧・printOn・statusは維持する。
  assert.match(DOCS_SOURCE, /印刷実行/);
  assert.match(DOCS_SOURCE, /DocumentContextStatusBadge/);
  assert.match(DOCS_SOURCE, /printOn: e\.target\.checked/);
});

test('20. 個別設定は既定で閉じ、overrideがある書類では展開する', () => {
  assert.match(DOCS_SOURCE, /const \[detailSettingsOpen, setDetailSettingsOpen\] = useState\(false\);/);
  assert.match(
    DOCS_SOURCE,
    /setDetailSettingsOpen\(getSelectionOverrideKeys\(activeDocumentInstance\)\.length > 0\);/
  );
  assert.match(DOCS_SOURCE, /data-testid="detail-settings-toggle"/);
});
