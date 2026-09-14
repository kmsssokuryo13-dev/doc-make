import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILDING_TITLE_DOCUMENTS,
  buildDocumentContext,
  buildDocumentContextsForInstances,
  getDocumentContextPrintBlockers,
  isBuildingTitleDocumentContextSupported,
} from '../src/documentContext.js';
import {
  acknowledgeDetachedDocumentSource,
  acknowledgeSelectionOverrideSources,
  getDocumentTemplateKey,
  reconcileSiteDocumentCompatibility,
} from '../src/v8Compatibility.js';
import { ensureRequiredRegistrationDocuments } from '../src/registrationApplications.js';

const completeBuilding = (id, patch = {}) => ({
  id,
  address: `架空県架空市${id}`,
  houseNum: id,
  kind: '居宅',
  struct: '木造２階建',
  structMaterial: '木造',
  structFloor: '２階建',
  floorAreas: [{ id: `${id}-floor`, floor: '１階', area: '50.00' }],
  registrationCause: '新築',
  registrationDate: { era: '令和', year: '8', month: '9', day: '14' },
  additionalCauses: [],
  annexes: [],
  ownerPersonIds: ['p1', 'p2'],
  contractorPersonIds: ['c1'],
  confirmationCert: {
    rNo: '01',
    code: '確認建築架空',
    number: '123',
    date: { era: '令和', year: '8', month: '1', day: '2' },
  },
  confirmApplicantPersonIds: ['p1'],
  confirmApplicantNames: ['手入力 建築主'],
  ...patch,
});

const person = (id, name, roles = [], patch = {}) => ({
  id,
  name,
  address: `架空県架空市${name}町`,
  roles,
  share: '1/2',
  shareOverrides: {},
  ...patch,
});

const titleApplication = (patch = {}) => ({
  id: 'ra-title',
  type: '建物表題登記',
  targetBuildingIds: ['b1'],
  targetLandIds: [],
  applicantPersonIds: ['p2', 'p1'],
  subject: {
    beforeBuildingIds: [],
    afterBuildingIds: ['b1'],
    landIds: [],
    primaryBuildingId: null,
  },
  documents: {},
  ...patch,
});

const documentInstance = (documentName, patch = {}) => ({
  id: `doc-${getDocumentTemplateKey(documentName)}`,
  templateKey: getDocumentTemplateKey(documentName),
  documentName,
  copyIndex: 1,
  printEnabled: true,
  selectionOverrides: {},
  contentOverrides: { blocks: {}, fields: {} },
  layoutOverrides: {},
  editMode: 'linked',
  detachedHtml: null,
  ...patch,
});

const fixture = (patch = {}) => ({
  site: {
    id: 'site-1',
    scrivenerId: 's1',
    people: [
      person('p1', '架空 太郎', ['建物所有者']),
      person('p2', '架空 花子', ['その他']),
      person('c1', '架空工務店', ['工事人'], { representative: '代表 架空次郎' }),
      person('c2', '第二工務店', ['工事人'], { representative: '代表 架空三郎' }),
    ],
    proposedBuildings: [completeBuilding('b1'), completeBuilding('b2')],
    ...patch.site,
  },
  application: titleApplication(patch.application),
});

const build = (documentName, patch = {}) => {
  const base = fixture(patch);
  return buildDocumentContext({
    ...base,
    documentName,
    documentInstance: documentInstance(documentName, patch.instance),
    scriveners: [{ id: 's1', name: '架空 調査士', address: '架空県架空市' }],
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
};

const issueCodes = (context) => context.issues.map(issue => issue.code);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

test('建物表題DocumentContextの対象4帳票だけを対応対象にする', () => {
  assert.deepEqual(BUILDING_TITLE_DOCUMENTS, [
    '委任状（表題）',
    '工事完了引渡証明書（表題）',
    '申述書（共有）',
    '申述書（単独）',
  ]);
  assert.equal(isBuildingTitleDocumentContextSupported('建物表題登記', '委任状（表題）'), true);
  assert.equal(isBuildingTitleDocumentContextSupported('建物滅失登記', '委任状（表題）'), false);
  assert.equal(isBuildingTitleDocumentContextSupported('建物表題登記', '委任状（保存）'), false);
});

test('申請人はrolesで絞らずStep1のID順に解決する', () => {
  const context = build('委任状（表題）');
  assert.deepEqual(context.data.applicants.map(item => item.id), ['p2', 'p1']);
  assert.equal(context.data.building.id, 'b1');
  assert.equal(context.status, 'current');
  assert.equal(context.canPrint, true);
  assert.deepEqual(context.issues, []);
});

test('人物の最新値を毎回解決し、入力オブジェクトは変更しない', () => {
  const base = fixture();
  const frozen = deepFreeze(structuredClone(base));
  const first = buildDocumentContext({
    ...frozen,
    documentName: '委任状（表題）',
    documentInstance: documentInstance('委任状（表題）'),
  });
  assert.equal(first.data.applicants[0].address, '架空県架空市架空 花子町');

  const changed = structuredClone(base);
  changed.site.people.find(item => item.id === 'p2').address = '架空県架空市変更後1番3号';
  const second = buildDocumentContext({
    ...changed,
    documentName: '委任状（表題）',
    documentInstance: documentInstance('委任状（表題）'),
  });
  assert.equal(second.data.applicants[0].address, '架空県架空市変更後1番3号');
  assert.equal(frozen.site.people[1].address, '架空県架空市架空 花子町');
});

test('不明な対象建物IDを先頭建物へfallbackしない', () => {
  const context = build('委任状（表題）', {
    application: {
      targetBuildingIds: ['missing'],
      subject: { beforeBuildingIds: [], afterBuildingIds: ['missing'], landIds: [], primaryBuildingId: null },
    },
  });
  assert.equal(context.data.building, null);
  assert.ok(issueCodes(context).includes('TARGET_BUILDING_NOT_FOUND'));
  assert.equal(context.canPrint, false);
});

test('対象建物が複数でprimary未指定なら推測しない', () => {
  const context = build('委任状（表題）', {
    application: {
      targetBuildingIds: ['b1', 'b2'],
      subject: { beforeBuildingIds: [], afterBuildingIds: ['b1', 'b2'], landIds: [], primaryBuildingId: null },
    },
  });
  assert.equal(context.data.building, null);
  assert.ok(issueCodes(context).includes('TARGET_BUILDING_AMBIGUOUS'));
});

test('primaryBuildingIdがあれば複数対象から一意に解決する', () => {
  const context = build('委任状（表題）', {
    application: {
      targetBuildingIds: ['b1', 'b2'],
      subject: { beforeBuildingIds: [], afterBuildingIds: ['b1', 'b2'], landIds: [], primaryBuildingId: 'b2' },
    },
  });
  assert.equal(context.data.building.id, 'b2');
  assert.equal(context.canPrint, true);
});

test('選択overrideは編集時のcanonical baselineと一致すれば適用して印刷できる', () => {
  const selectionOverrides = {
    targetPropBuildingId: 'b2',
    applicantPersonIds: ['p1'],
  };
  const people = [
    person('p1', '架空 太郎', ['建物所有者'], { share: '1' }),
    person('p2', '架空 花子', ['その他']),
    person('c1', '架空工務店', ['工事人'], { representative: '代表 架空次郎' }),
    person('c2', '第二工務店', ['工事人'], { representative: '代表 架空三郎' }),
  ];
  const beforeAcknowledgement = build('委任状（表題）', {
    site: { people },
    instance: { selectionOverrides },
  });
  const context = build('委任状（表題）', {
    site: { people },
    instance: {
      selectionOverrides,
      selectionOverrideBaselines: beforeAcknowledgement.selectionOverrideSources,
    },
  });
  assert.equal(context.canonicalSelection.targetBuildingId, 'b1');
  assert.deepEqual(context.canonicalSelection.applicantPersonIds, ['p2', 'p1']);
  assert.equal(context.data.building.id, 'b2');
  assert.deepEqual(context.data.applicants.map(item => item.id), ['p1']);
  assert.equal(context.status, 'modified');
  assert.equal(context.canPrint, true);
  assert.equal(issueCodes(context).includes('SELECTION_OVERRIDE_BASELINE_UNKNOWN'), false);
});

test('selection override後にStep1の対象建物または申請人が変われば印刷を止める', () => {
  const selectionOverrides = {
    targetPropBuildingId: 'b2',
    applicantPersonIds: ['p1'],
  };
  const people = [
    person('p1', '架空 太郎', [], { share: '1' }),
    person('p2', '架空 花子', []),
    person('c1', '架空工務店', ['工事人'], { representative: '代表者' }),
  ];
  const initial = build('委任状（表題）', {
    site: { people },
    instance: { selectionOverrides },
  });
  const instance = {
    selectionOverrides,
    selectionOverrideBaselines: initial.selectionOverrideSources,
  };

  const changedTarget = build('委任状（表題）', {
    site: { people },
    application: {
      targetBuildingIds: ['b2'],
      subject: { beforeBuildingIds: [], afterBuildingIds: ['b2'], landIds: [], primaryBuildingId: null },
    },
    instance,
  });
  assert.ok(issueCodes(changedTarget).includes('SELECTION_OVERRIDE_SOURCE_CHANGED'));
  assert.equal(changedTarget.canPrint, false);

  const changedApplicants = build('委任状（表題）', {
    site: { people },
    application: { applicantPersonIds: ['p1'] },
    instance,
  });
  assert.ok(issueCodes(changedApplicants).includes('SELECTION_OVERRIDE_SOURCE_CHANGED'));
  assert.equal(changedApplicants.canPrint, false);
});

test('baselineのない旧selection overrideは確認完了まで印刷できない', () => {
  const context = build('委任状（表題）', {
    instance: {
      selectionOverrides: { targetPropBuildingId: 'b2' },
    },
  });
  assert.ok(issueCodes(context).includes('SELECTION_OVERRIDE_BASELINE_UNKNOWN'));
  assert.equal(context.canPrint, false);
});

test('selection overrideの元情報は利用者の明示確認でのみ現在値へ更新する', () => {
  const documentName = '委任状（表題）';
  const selectionOverrides = { targetPropBuildingId: 'b2' };
  const instance = documentInstance(documentName, { selectionOverrides });
  const application = titleApplication({ documentInstances: [instance] });
  const current = buildDocumentContext({
    ...fixture(),
    application,
    documentInstance: instance,
    documentName,
  });
  assert.ok(issueCodes(current).includes('SELECTION_OVERRIDE_BASELINE_UNKNOWN'));
  assert.equal(current.canPrint, false);

  const acknowledged = acknowledgeSelectionOverrideSources(application, {
    documentInstanceId: instance.id,
    selectionOverrideSources: current.selectionOverrideSources,
  });
  assert.equal(acknowledged.changed, true);
  assert.equal(application.documentInstances[0].selectionOverrideBaselines, undefined);
  assert.deepEqual(
    acknowledged.next.documentInstances[0].selectionOverrideBaselines,
    { targetPropBuildingId: current.selectionOverrideSources.targetPropBuildingId }
  );

  const verified = buildDocumentContext({
    ...fixture(),
    application: acknowledged.next,
    documentInstance: acknowledged.next.documentInstances[0],
    documentName,
  });
  assert.equal(verified.status, 'modified');
  assert.equal(verified.canPrint, true);
});

test('Step3の選択操作はその時点のcanonical値をoverride別baselineとして保存する', () => {
  const documentName = '委任状（表題）';
  const instanceKey = `${documentName}__1`;
  const initialInstance = documentInstance(documentName, { legacyInstanceKey: instanceKey });
  const application = titleApplication({
    documents: { [documentName]: 1 },
    documentInstances: [initialInstance],
  });
  const site = {
    ...fixture().site,
    people: fixture().site.people.map(item => item.id === 'p1' ? { ...item, share: '1' } : item),
    registrationApplications: [application],
    docPick: {
      [instanceKey]: { printOn: true, _raApplied: application.id },
    },
  };
  const beforeEdit = buildDocumentContext({
    site,
    application,
    documentInstance: initialInstance,
    documentName,
  });
  const edited = reconcileSiteDocumentCompatibility({
    ...site,
    docPick: {
      ...site.docPick,
      [instanceKey]: {
        ...site.docPick[instanceKey],
        targetPropBuildingId: 'b2',
        applicantPersonIds: ['p1'],
      },
    },
  }, {
    legacyPickIntentFields: {
      [instanceKey]: ['targetPropBuildingId', 'applicantPersonIds'],
    },
    selectionOverrideSourceValuesByPick: {
      [instanceKey]: beforeEdit.selectionOverrideSources,
    },
  });
  const stored = edited.registrationApplications[0].documentInstances[0];
  assert.deepEqual(stored.selectionOverrideBaselines, {
    targetPropBuildingId: beforeEdit.selectionOverrideSources.targetPropBuildingId,
    applicantPersonIds: beforeEdit.selectionOverrideSources.applicantPersonIds,
  });

  const context = buildDocumentContext({
    site: edited,
    application: edited.registrationApplications[0],
    documentInstance: stored,
    documentName,
  });
  assert.equal(context.status, 'modified');
  assert.equal(context.canPrint, true);
});

test('canonicalの対象建物と申請人が空ならoverrideが有効でも印刷を止める', () => {
  const selectionOverrides = {
    targetPropBuildingId: 'b2',
    applicantPersonIds: ['p1'],
  };
  const people = [
    person('p1', '架空 太郎', [], { share: '1' }),
    person('c1', '架空工務店', ['工事人'], { representative: '代表者' }),
  ];
  const application = {
    targetBuildingIds: [],
    applicantPersonIds: [],
    subject: { beforeBuildingIds: [], afterBuildingIds: [], landIds: [], primaryBuildingId: null },
  };
  const beforeAcknowledgement = build('委任状（表題）', {
    site: { people },
    application,
    instance: { selectionOverrides },
  });
  const context = build('委任状（表題）', {
    site: { people },
    application,
    instance: {
      selectionOverrides,
      selectionOverrideBaselines: beforeAcknowledgement.selectionOverrideSources,
    },
  });
  assert.equal(context.canonicalSelection.targetBuildingId, null);
  assert.deepEqual(context.canonicalSelection.applicantPersonIds, []);
  assert.equal(issueCodes(context).includes('SELECTION_OVERRIDE_BASELINE_UNKNOWN'), false);
  assert.equal(issueCodes(context).includes('SELECTION_OVERRIDE_SOURCE_CHANGED'), false);
  assert.ok(context.issues.some(issue => issue.severity === 'blocking' && issue.scope === 'source'));
  assert.equal(context.canPrint, false);
});

test('subjectとlegacy対象の不一致を黙って採用しない', () => {
  const context = build('委任状（表題）', {
    application: {
      targetBuildingIds: ['b1'],
      subject: { beforeBuildingIds: [], afterBuildingIds: ['b2'], landIds: [], primaryBuildingId: null },
    },
  });
  assert.equal(context.data.building.id, 'b2');
  assert.ok(issueCodes(context).includes('SUBJECT_LEGACY_MISMATCH'));
  assert.equal(context.canPrint, false);
});

test('完了証明書の工事人は対象建物との関係から解決する', () => {
  const context = build('工事完了引渡証明書（表題）', {
    site: {
      people: [
        person('p1', '架空 太郎', []),
        person('p2', '架空 花子', []),
        person('c1', '建物紐付工務店', [], { representative: '代表者' }),
        person('c2', '役割先頭工務店', ['工事人'], { representative: '代表者' }),
      ],
    },
  });
  assert.equal(context.data.contractor.id, 'c1');
  assert.equal(issueCodes(context).includes('LEGACY_CONTRACTOR_FALLBACK'), false);
});

test('建物紐付けがなく案件内工事人が1名だけなら暫定利用を明示する', () => {
  const context = build('工事完了引渡証明書（表題）', {
    site: {
      people: [
        person('p1', '架空 太郎', []),
        person('p2', '架空 花子', []),
        person('c1', '唯一工務店', ['工事人'], { representative: '代表者' }),
      ],
      proposedBuildings: [completeBuilding('b1', { contractorPersonIds: [] })],
    },
  });
  assert.equal(context.data.contractor.id, 'c1');
  assert.ok(issueCodes(context).includes('LEGACY_CONTRACTOR_FALLBACK'));
  assert.equal(context.status, 'warning');
  assert.equal(context.canPrint, true);
});

test('複数工事人を先頭採用せず要確認にする', () => {
  const context = build('工事完了引渡証明書（表題）', {
    site: {
      proposedBuildings: [completeBuilding('b1', { contractorPersonIds: ['c1', 'c2'] })],
    },
  });
  assert.equal(context.data.contractor, null);
  assert.ok(issueCodes(context).includes('CONTRACTOR_AMBIGUOUS'));
  assert.equal(context.canPrint, false);
});

test('共有申述書はRA申請人を申述人にし、対象建物の建築主だけを表示用に解決する', () => {
  const context = build('申述書（共有）');
  assert.deepEqual(context.data.statementPeople.map(item => item.id), ['p2', 'p1']);
  assert.deepEqual(
    context.data.confirmation.applicants.map(item => [item.key, item.name]),
    [['person:p1', '架空 太郎'], ['manual:0', '手入力 建築主']]
  );
  assert.equal(context.blocks['statement.body'], '上記の建物は下記の通りの持分であることを証明します。');
  assert.equal(context.canPrint, true);
});

test('単独申述書は申請人が1名なら単独出資者を自動決定する', () => {
  const context = build('申述書（単独）', {
    application: { applicantPersonIds: ['p1'] },
  });
  assert.equal(context.data.soleApplicant.id, 'p1');
  assert.match(context.blocks['statement.body'], /架空 太郎が単独で全額出資/);
  assert.equal(issueCodes(context).includes('SOLE_APPLICANT_REQUIRED'), false);
});

test('単独申述書の申請人が複数なら勝手に単独出資者を選ばない', () => {
  const context = build('申述書（単独）');
  assert.equal(context.data.soleApplicant, null);
  assert.ok(issueCodes(context).includes('SOLE_APPLICANT_REQUIRED'));
  assert.match(context.blocks['statement.body'], /［申請人］/);
  assert.equal(context.canPrint, false);
});

test('不明な申述人overrideをRA申請人へfallbackしない', () => {
  const context = build('申述書（共有）', {
    instance: { selectionOverrides: { statementPersonIds: ['missing-person'] } },
  });
  assert.deepEqual(context.data.statementPeople, []);
  assert.ok(issueCodes(context).includes('STATEMENT_SIGNER_NOT_FOUND'));
});

test('個別指定した申述人の氏名・住所が空なら共有・単独とも印刷を止める', () => {
  for (const documentName of ['申述書（共有）', '申述書（単独）']) {
    const application = documentName === '申述書（単独）'
      ? { applicantPersonIds: ['p1'] }
      : {};
    const selectionOverrides = { statementPersonIds: ['p3'] };
    const site = {
      people: [
        ...fixture().site.people,
        person('p3', '', [], { address: '', share: '1' }),
      ],
    };
    const beforeAcknowledgement = build(documentName, {
      application,
      site,
      instance: { selectionOverrides },
    });
    const context = build(documentName, {
      application,
      site,
      instance: {
        selectionOverrides,
        selectionOverrideBaselines: beforeAcknowledgement.selectionOverrideSources,
      },
    });

    assert.ok(issueCodes(context).includes('STATEMENT_SIGNER_NAME_REQUIRED'));
    assert.ok(issueCodes(context).includes('STATEMENT_SIGNER_ADDRESS_REQUIRED'));
    assert.equal(context.canPrint, false);
  }
});

test('旧全文固定は最新扱いにせずbaseline不明を表示する', () => {
  const context = build('委任状（表題）', {
    instance: {
      editMode: 'legacy-detached',
      detachedHtml: '<p>旧形式の編集</p>',
    },
  });
  assert.equal(context.status, 'review-required');
  assert.ok(issueCodes(context).includes('LEGACY_DETACHED_BASELINE_UNKNOWN'));
  assert.equal(context.detachedHtml, '<p>旧形式の編集</p>');
  assert.equal(context.canPrint, false);
});

test('対応帳票で申請が見つからない場合は到達可能なblocking issueを返す', () => {
  const context = buildDocumentContext({
    site: fixture().site,
    application: null,
    documentName: '委任状（表題）',
    documentInstance: documentInstance('委任状（表題）'),
  });
  assert.equal(context.supported, true);
  assert.ok(issueCodes(context).includes('APPLICATION_NOT_FOUND'));
  assert.equal(context.canPrint, false);
});

test('完了証明書の所有者はRA申請人でなく対象建物ownerPersonIdsから解決する', () => {
  const context = build('工事完了引渡証明書（表題）', {
    application: { applicantPersonIds: ['p1'] },
    site: {
      people: [
        person('p1', '架空 太郎', [], { share: '1' }),
        person('p2', '架空 花子', [], { share: '1' }),
        person('c1', '架空工務店', ['工事人'], { representative: '代表 架空次郎' }),
      ],
      proposedBuildings: [completeBuilding('b1', { ownerPersonIds: ['p2'] })],
    },
  });
  assert.deepEqual(context.data.applicants.map(item => item.id), ['p1']);
  assert.deepEqual(context.data.owners.map(item => item.id), ['p2']);
  assert.ok(issueCodes(context).includes('OWNER_APPLICANT_MISMATCH'));
  assert.equal(context.canPrint, true);
});

test('複数名の帳票は持分未入力と合計不一致を検出する', () => {
  const missing = build('委任状（表題）', {
    site: {
      people: [
        person('p1', '架空 太郎', [], { share: '' }),
        person('p2', '架空 花子', [], { share: '1/2' }),
      ],
    },
  });
  assert.ok(issueCodes(missing).includes('SHARE_REQUIRED'));
  assert.equal(missing.canPrint, false);

  const mismatch = build('委任状（表題）', {
    site: {
      people: [
        person('p1', '架空 太郎', [], { share: '1/3' }),
        person('p2', '架空 花子', [], { share: '1/3' }),
      ],
    },
  });
  assert.ok(issueCodes(mismatch).includes('SHARE_TOTAL_MISMATCH'));
});

test('1名でも明示された部分持分を検証し、空欄だけを全部所有として扱う', () => {
  const partial = build('委任状（表題）', {
    application: { applicantPersonIds: ['p1'] },
    site: {
      people: [person('p1', '架空 太郎', [], { share: '1/2' })],
    },
  });
  assert.ok(issueCodes(partial).includes('SHARE_TOTAL_MISMATCH'));
  assert.equal(partial.canPrint, false);

  const implicitWhole = build('委任状（表題）', {
    application: { applicantPersonIds: ['p1'] },
    site: {
      people: [person('p1', '架空 太郎', [], { share: '' })],
    },
  });
  assert.equal(issueCodes(implicitWhole).some(code => code.startsWith('SHARE_')), false);
  assert.equal(implicitWhole.canPrint, true);
});

test('原因日付の不詳指定は年月日未入力でも許容する', () => {
  const context = build('委任状（表題）', {
    site: {
      proposedBuildings: [completeBuilding('b1', {
        registrationDate: { era: '令和', year: '', month: '', day: '' },
        additionalUnknownDate: true,
      })],
    },
  });
  assert.equal(issueCodes(context).includes('REGISTRATION_CAUSE_DATE_REQUIRED'), false);
  assert.equal(context.canPrint, true);
});

test('主建物の登記原因は附属建物とは独立して必須確認する', () => {
  const context = build('委任状（表題）', {
    site: {
      proposedBuildings: [completeBuilding('b1', {
        registrationCause: '',
        registrationDate: null,
        annexes: [{
          id: 'annex-1', symbol: '1', kind: '倉庫', struct: '木造平家建',
          floorAreas: [{ id: 'annex-floor', floor: '１階', area: '10.00' }],
          registrationCause: '新築',
          registrationDate: { era: '令和', year: '8', month: '9', day: '14' },
          additionalCauses: [],
        }],
      })],
    },
  });
  assert.ok(issueCodes(context).includes('REGISTRATION_CAUSE_REQUIRED'));
  assert.equal(context.canPrint, false);
});

test('附属建物の登記原因日付も主建物とは独立して確認する', () => {
  const context = build('委任状（表題）', {
    site: {
      proposedBuildings: [completeBuilding('b1', {
        annexes: [{
          id: 'annex-1', symbol: '1', kind: '倉庫', struct: '木造平家建',
          floorAreas: [{ id: 'annex-floor', floor: '１階', area: '10.00' }],
          registrationCause: '新築',
          registrationDate: { era: '令和', year: '', month: '', day: '' },
          additionalCauses: [],
        }],
      })],
    },
  });
  assert.ok(issueCodes(context).includes('ANNEX_REGISTRATION_CAUSE_DATE_REQUIRED'));
  assert.equal(context.canPrint, false);
});

test('内容のある不完全な附属建物を検出し、空placeholderは無視する', () => {
  const incomplete = build('委任状（表題）', {
    site: {
      proposedBuildings: [completeBuilding('b1', {
        annexes: [{
          id: 'annex-1', symbol: '1', kind: '倉庫', struct: '',
          floorAreas: [{ id: 'annex-floor', floor: '１階', area: '10.00' }],
          registrationCause: '新築',
          registrationDate: { era: '令和', year: '8', month: '9', day: '14' },
          additionalCauses: [],
        }],
      })],
    },
  });
  assert.ok(issueCodes(incomplete).includes('ANNEX_STRUCTURE_REQUIRED'));

  const placeholder = build('委任状（表題）', {
    site: {
      proposedBuildings: [completeBuilding('b1', {
        annexes: [{ id: 'annex-empty', symbol: '', kind: '', struct: '', floorAreas: [] }],
      })],
    },
  });
  assert.equal(issueCodes(placeholder).some(code => code.startsWith('ANNEX_')), false);
});

test('確認済証建築主の人物名が空なら申述書を印刷可能扱いにしない', () => {
  const context = build('申述書（単独）', {
    application: { applicantPersonIds: ['p2'] },
    site: {
      people: [
        person('p1', '', []),
        person('p2', '架空 花子', []),
        person('c1', '架空工務店', ['工事人']),
      ],
      proposedBuildings: [completeBuilding('b1', {
        confirmApplicantPersonIds: ['p1'],
        confirmApplicantNames: [],
      })],
    },
  });
  assert.ok(issueCodes(context).includes('CONFIRMATION_APPLICANT_NAME_REQUIRED'));
  assert.equal(context.canPrint, false);
});

test('確認済証の手入力建築主名は文字列だけを受理する', () => {
  const context = build('申述書（単独）', {
    application: { applicantPersonIds: ['p2'] },
    site: {
      proposedBuildings: [completeBuilding('b1', {
        confirmApplicantPersonIds: [],
        confirmApplicantNames: [{}],
      })],
    },
  });
  assert.deepEqual(context.data.confirmation.applicants, []);
  assert.ok(issueCodes(context).includes('CONFIRMATION_APPLICANT_REQUIRED'));
  assert.equal(context.canPrint, false);
});

test('通常の全文固定はsnapshot一致時だけ維持し、元データ変更を検出する', () => {
  const baseFixture = fixture();
  const baseInstance = documentInstance('委任状（表題）');
  const linked = buildDocumentContext({
    ...baseFixture,
    documentName: '委任状（表題）',
    documentInstance: baseInstance,
  });
  const detachedInstance = documentInstance('委任状（表題）', {
    editMode: 'detached',
    detachedHtml: '<p>固定本文</p>',
    detachedSourceSnapshot: linked.sourceSnapshot,
  });
  const unchanged = buildDocumentContext({
    ...baseFixture,
    documentName: '委任状（表題）',
    documentInstance: detachedInstance,
  });
  assert.equal(unchanged.status, 'detached');
  assert.equal(unchanged.canPrint, true);

  const changedFixture = structuredClone(baseFixture);
  changedFixture.site.people.find(item => item.id === 'p2').address = '架空県架空市変更後';
  const changed = buildDocumentContext({
    ...changedFixture,
    documentName: '委任状（表題）',
    documentInstance: detachedInstance,
  });
  assert.ok(issueCodes(changed).includes('DETACHED_SOURCE_CHANGED'));
  assert.equal(changed.canPrint, false);
});

test('全文編集操作はその時点のsourceSnapshot付きdetachedとして保存する', () => {
  const documentName = '委任状（表題）';
  const instanceKey = `${documentName}__1`;
  const initialInstance = documentInstance(documentName, { legacyInstanceKey: instanceKey });
  const application = titleApplication({
    documents: { [documentName]: 1 },
    documentInstances: [initialInstance],
  });
  const baseSite = {
    ...fixture().site,
    registrationApplications: [application],
    docPick: {
      [instanceKey]: { customText: null, printOn: true, _raApplied: application.id },
    },
  };
  const linked = buildDocumentContext({
    site: baseSite,
    application,
    documentInstance: initialInstance,
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  const edited = reconcileSiteDocumentCompatibility({
    ...baseSite,
    docPick: {
      ...baseSite.docPick,
      [instanceKey]: {
        ...baseSite.docPick[instanceKey],
        customText: '<p>固定本文</p>',
      },
    },
  }, {
    legacyPickIntentFields: { [instanceKey]: ['customText'] },
    detachedSourceSnapshots: { [instanceKey]: linked.sourceSnapshot },
  });
  const stored = edited.registrationApplications[0].documentInstances[0];
  assert.equal(stored.editMode, 'detached');
  assert.equal(stored.detachedHtml, '<p>固定本文</p>');
  assert.deepEqual(stored.detachedSourceSnapshot, linked.sourceSnapshot);

  const unchanged = buildDocumentContext({
    site: edited,
    application: edited.registrationApplications[0],
    documentInstance: stored,
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  assert.equal(unchanged.status, 'detached');
  assert.equal(unchanged.canPrint, true);
});

test('全文固定後の本文編集だけでは古くなったsourceSnapshotを更新しない', () => {
  const documentName = '委任状（表題）';
  const instanceKey = `${documentName}__1`;
  const application = titleApplication({ documents: { [documentName]: 1 } });
  const initialInstance = documentInstance(documentName, { legacyInstanceKey: instanceKey });
  const initialSite = {
    ...fixture().site,
    registrationApplications: [{ ...application, documentInstances: [initialInstance] }],
    docPick: {
      [instanceKey]: { customText: null, printOn: true, _raApplied: application.id },
    },
  };
  const initialContext = buildDocumentContext({
    site: initialSite,
    application: initialSite.registrationApplications[0],
    documentInstance: initialInstance,
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  const firstEdit = reconcileSiteDocumentCompatibility({
    ...initialSite,
    docPick: {
      [instanceKey]: {
        ...initialSite.docPick[instanceKey],
        customText: '<p>旧住所を含む固定本文</p>',
      },
    },
  }, {
    legacyPickIntentFields: { [instanceKey]: ['customText'] },
    detachedSourceSnapshots: { [instanceKey]: initialContext.sourceSnapshot },
  });

  const changedSite = structuredClone(firstEdit);
  changedSite.people.find(item => item.id === 'p2').address = '架空県架空市変更後住所';
  const detachedInstance = changedSite.registrationApplications[0].documentInstances[0];
  const staleContext = buildDocumentContext({
    site: changedSite,
    application: changedSite.registrationApplications[0],
    documentInstance: detachedInstance,
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  assert.ok(issueCodes(staleContext).includes('DETACHED_SOURCE_CHANGED'));

  const editedAgain = reconcileSiteDocumentCompatibility({
    ...changedSite,
    docPick: {
      ...changedSite.docPick,
      [instanceKey]: {
        ...changedSite.docPick[instanceKey],
        customText: '<p>旧住所を含む固定本文。</p>',
      },
    },
  }, {
    legacyPickIntentFields: { [instanceKey]: ['customText'] },
    detachedSourceSnapshots: { [instanceKey]: staleContext.sourceSnapshot },
  });
  const editedInstance = editedAgain.registrationApplications[0].documentInstances[0];
  assert.deepEqual(editedInstance.detachedSourceSnapshot, initialContext.sourceSnapshot);

  const stillStale = buildDocumentContext({
    site: editedAgain,
    application: editedAgain.registrationApplications[0],
    documentInstance: editedInstance,
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  assert.ok(issueCodes(stillStale).includes('DETACHED_SOURCE_CHANGED'));
  assert.equal(stillStale.canPrint, false);
});

test('snapshotのない通常detachedも確認完了まで印刷不可にする', () => {
  const context = build('委任状（表題）', {
    instance: {
      editMode: 'detached',
      detachedHtml: '<p>基準不明</p>',
      detachedSourceSnapshot: null,
    },
  });
  assert.ok(issueCodes(context).includes('DETACHED_BASELINE_UNKNOWN'));
  assert.equal(context.canPrint, false);
});

test('旧全文固定は明示確認した時だけ現在のsourceSnapshotへ昇格する', () => {
  const documentName = '委任状（表題）';
  const legacyInstance = documentInstance(documentName, {
    editMode: 'legacy-detached',
    detachedHtml: '<p>確認した全文</p>',
    detachedSourceSnapshot: null,
  });
  const application = titleApplication({ documentInstances: [legacyInstance] });
  const current = buildDocumentContext({
    ...fixture(),
    application,
    documentInstance: legacyInstance,
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  assert.equal(current.canPrint, false);

  const acknowledged = acknowledgeDetachedDocumentSource(application, {
    documentInstanceId: legacyInstance.id,
    sourceSnapshot: current.sourceSnapshot,
  });
  assert.equal(acknowledged.changed, true);
  assert.equal(application.documentInstances[0].editMode, 'legacy-detached');
  assert.equal(acknowledged.next.documentInstances[0].editMode, 'detached');
  assert.deepEqual(
    acknowledged.next.documentInstances[0].detachedSourceSnapshot,
    current.sourceSnapshot
  );

  const verified = buildDocumentContext({
    ...fixture(),
    application: acknowledged.next,
    documentInstance: acknowledged.next.documentInstances[0],
    documentName,
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  assert.equal(verified.status, 'detached');
  assert.equal(verified.canPrint, true);
});

test('未対応のcontent overrideを黙って標準文へ置換しない', () => {
  const context = build('委任状（表題）', {
    instance: {
      contentOverrides: { blocks: { 'delegation.body': '個別文言' }, fields: {} },
    },
  });
  assert.ok(issueCodes(context).includes('CONTENT_OVERRIDES_NOT_APPLIED'));
  assert.equal(context.canPrint, false);
});

test('複数RA・複数instanceをidentity単位で正しいContextへ接続する', () => {
  const titleName = '委任状（表題）';
  const firstDocument = documentInstance(titleName, { id: 'doc-first' });
  const secondDocument = documentInstance(titleName, { id: 'doc-second' });
  const firstApplication = titleApplication({
    id: 'ra-first',
    targetBuildingIds: ['b1'],
    applicantPersonIds: ['p1'],
    subject: { beforeBuildingIds: [], afterBuildingIds: ['b1'], landIds: [], primaryBuildingId: null },
    documentInstances: [firstDocument],
  });
  const secondApplication = titleApplication({
    id: 'ra-second',
    targetBuildingIds: ['b2'],
    applicantPersonIds: ['p2'],
    subject: { beforeBuildingIds: [], afterBuildingIds: ['b2'], landIds: [], primaryBuildingId: null },
    documentInstances: [secondDocument],
  });
  const site = {
    ...fixture().site,
    people: fixture().site.people.map(item => (
      item.id === 'p1' || item.id === 'p2' ? { ...item, share: '1' } : item
    )),
    registrationApplications: [firstApplication, secondApplication],
    docPick: {
      '委任状（表題）__1': { printOn: true },
      '委任状（表題）__2': { printOn: true },
    },
  };
  const instances = [
    { name: titleName, key: '委任状（表題）__1', identity: 'identity-first', raId: 'ra-first', copyIndex: 1, documentInstanceId: 'doc-first' },
    { name: titleName, key: '委任状（表題）__2', identity: 'identity-second', raId: 'ra-second', copyIndex: 1, documentInstanceId: 'doc-second' },
  ];
  const contexts = buildDocumentContextsForInstances({ site, instances });
  assert.equal(contexts['identity-first'].data.building.id, 'b1');
  assert.deepEqual(contexts['identity-first'].data.applicants.map(item => item.id), ['p1']);
  assert.equal(contexts['identity-second'].data.building.id, 'b2');
  assert.deepEqual(contexts['identity-second'].data.applicants.map(item => item.id), ['p2']);
  assert.deepEqual(getDocumentContextPrintBlockers({ instances, contextsByIdentity: contexts, docPick: site.docPick }), []);
});

test('印刷対象の別書類にblocking issueがあればinstanceを返し、印刷OFFなら除外する', () => {
  const titleName = '委任状（表題）';
  const validDocument = documentInstance(titleName, { id: 'doc-valid' });
  const invalidDocument = documentInstance(titleName, { id: 'doc-invalid' });
  const validApplication = titleApplication({
    id: 'ra-valid',
    applicantPersonIds: ['p1'],
    documentInstances: [validDocument],
  });
  const invalidApplication = titleApplication({
    id: 'ra-invalid',
    targetBuildingIds: ['missing'],
    applicantPersonIds: ['p2'],
    subject: { beforeBuildingIds: [], afterBuildingIds: ['missing'], landIds: [], primaryBuildingId: null },
    documentInstances: [invalidDocument],
  });
  const instances = [
    { name: titleName, key: '委任状（表題）__1', identity: 'valid', raId: 'ra-valid', copyIndex: 1 },
    { name: titleName, key: '委任状（表題）__2', identity: 'invalid', raId: 'ra-invalid', copyIndex: 1 },
  ];
  const site = {
    ...fixture().site,
    people: fixture().site.people.map(item => (
      item.id === 'p1' || item.id === 'p2' ? { ...item, share: '1' } : item
    )),
    registrationApplications: [validApplication, invalidApplication],
    docPick: {
      '委任状（表題）__1': { printOn: true },
      '委任状（表題）__2': { printOn: true },
    },
  };
  const contexts = buildDocumentContextsForInstances({ site, instances });
  assert.deepEqual(
    getDocumentContextPrintBlockers({ instances, contextsByIdentity: contexts, docPick: site.docPick }).map(item => item.identity),
    ['invalid']
  );
  site.docPick['委任状（表題）__2'].printOn = false;
  assert.deepEqual(getDocumentContextPrintBlockers({ instances, contextsByIdentity: contexts, docPick: site.docPick }), []);
});

test('登記申請の必須書類は最低1通にし、既存通数と元入力を保持する', () => {
  const applications = [
    titleApplication({ id: 'required-zero', documents: { '委任状（表題）': 0 } }),
    titleApplication({ id: 'required-two', documents: { '委任状（表題）': 2 } }),
  ];
  const snapshot = structuredClone(applications);
  const result = ensureRequiredRegistrationDocuments(applications);
  assert.equal(result.changed, true);
  assert.equal(result.next[0].documents['委任状（表題）'], 1);
  assert.equal(result.next[1], applications[1]);
  assert.deepEqual(applications, snapshot);

  const stable = ensureRequiredRegistrationDocuments(result.next);
  assert.equal(stable.changed, false);
  assert.equal(stable.next[0], result.next[0]);
});
