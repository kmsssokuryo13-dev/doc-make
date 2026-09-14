/**
 * v8互換基盤のテスト。
 * UIと外部JSONはv7のまま維持し、local state内のshadowだけを検証する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { APPLICATION_TO_DOCS } from '../src/constants.js';
import { buildExportPayload, parseImportPayload } from '../src/jsonTransfer.js';
import {
  applyRegistrationApplicationPatch,
  normalizeRegistrationApplication,
} from '../src/registrationApplications.js';
import { sanitizeSiteData } from '../src/sanitize.js';
import {
  DOCUMENT_TEMPLATE_KEYS,
  MAX_DOCUMENT_COPIES_PER_APPLICATION,
  createStableDocumentInstanceId,
  getDocumentTemplateKey,
  isBlankDocumentHtml,
  normalizeCompatibilityRecord,
  normalizeDocumentCount,
  reconcileSiteDocumentCompatibility,
  selectLegacyPickForApplication,
} from '../src/v8Compatibility.js';

const DOC_TITLE = '委任状（表題）';
const DOC_ADDRESS = '委任状（住所変更）';
const DOC_SALE = '売渡証明書';

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const mappingFixture = () => {
  const customHtml = '<p data-x="1">修正文\n　A&amp;B</p>';
  return {
    id: 'site-map',
    name: '架空の移行確認案件',
    applications: { 建物表題登記: 2, 建物表題部変更登記: 1 },
    registrationApplications: [
      {
        id: 'ra-title-a',
        type: '建物表題登記',
        targetBuildingIds: ['new-a'],
        applicantPersonIds: ['p1'],
        documents: { [DOC_TITLE]: 2, [DOC_ADDRESS]: 1, [DOC_SALE]: 1 },
      },
      {
        id: 'ra-change',
        type: '建物表題部変更登記',
        targetBuildingIds: ['old-a'],
        applicantPersonIds: ['p2'],
        documents: { [DOC_ADDRESS]: 2, [DOC_SALE]: 1 },
      },
      {
        id: 'ra-title-b',
        type: '建物表題登記',
        targetBuildingIds: ['new-b'],
        applicantPersonIds: ['p3'],
        documents: { [DOC_TITLE]: 1, [DOC_ADDRESS]: 1 },
      },
    ],
    // 挿入順はわざと帳票順と異ならせる。割当はキー探索で行う。
    docPick: {
      [`${DOC_SALE}__2`]: { marker: 'sale-change', _raApplied: 'ra-change' },
      [`${DOC_ADDRESS}__4`]: { marker: 'address-title-b', _raApplied: 'ra-title-b' },
      [`${DOC_TITLE}__3`]: { marker: 'title-b', _raApplied: 'ra-title-b' },
      [`${DOC_ADDRESS}__2`]: {
        marker: 'must-not-migrate',
        printOn: false,
        _raApplied: 'ra-title-a',
      },
      [`${DOC_TITLE}__1`]: {
        customText: customHtml,
        printOn: false,
        showMain: false,
        fontScale: 0,
        stampPositions: [{ i: 0, dx: 0, dy: -2 }],
        marker: 'title-a-1',
        _raApplied: 'ra-title-a',
      },
      [`${DOC_SALE}__1`]: { marker: 'sale-title-a', _raApplied: 'ra-title-a' },
      [`${DOC_ADDRESS}__3`]: { marker: 'address-change-2', _raApplied: 'ra-change' },
      [`${DOC_TITLE}__2`]: {
        customText: '<div>&nbsp;<br></div>',
        marker: 'title-a-2',
        _raApplied: 'ra-title-a',
      },
      [`${DOC_ADDRESS}__1`]: { marker: 'address-title-a', _raApplied: 'ra-title-a' },
      [`${DOC_TITLE}__99`]: { customText: '<p>未割当</p>', marker: 'orphan' },
      '未知書類__1': { customText: '<p>未知</p>', marker: 'unknown' },
      '壊れたキー': { customText: '<p>壊れたキー</p>' },
    },
  };
};

const getApplication = (site, id) =>
  site.registrationApplications.find(application => application.id === id);

test('固定templateKeyは全帳票定義を重複なく網羅する', () => {
  const definedNames = new Set(
    Object.values(APPLICATION_TO_DOCS).flatMap(def => [
      ...(def.required || []),
      ...(def.optional || []),
    ])
  );
  assert.deepEqual(new Set(Object.keys(DOCUMENT_TEMPLATE_KEYS)), definedNames);
  assert.equal(new Set(Object.values(DOCUMENT_TEMPLATE_KEYS)).size, definedNames.size);
});

test('prototype名・非JSON数値・不正Unicodeでも安全かつJSON安定に正規化する', () => {
  assert.equal(getDocumentTemplateKey('__proto__'), 'legacy:__proto__');
  assert.equal(getDocumentTemplateKey('constructor'), 'legacy:constructor');
  const record = normalizeCompatibilityRecord(JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":"value","numbers":[1,null]}'
  ));
  assert.equal(Object.prototype.hasOwnProperty.call(record, '__proto__'), true);
  assert.deepEqual(record.__proto__, { polluted: true });
  assert.equal(record.constructor, 'value');
  assert.equal({}.polluted, undefined);

  const normalized = normalizeRegistrationApplication({
    id: 'ra-prototype-names',
    type: 'unknown',
    details: { values: [NaN, Infinity, -0, undefined] },
    documentInstances: [{ documentName: '__proto__' }, { documentName: 'constructor' }],
  });
  assert.deepEqual(normalized.details.values, [null, null, 0, null]);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.documents, '__proto__'), true);
  assert.equal(normalized.documents.__proto__, 1);
  assert.equal(normalized.documents.constructor, 1);
  assert.doesNotThrow(() => createStableDocumentInstanceId('bad-\uD800-id', 'key', 1));
  assert.match(createStableDocumentInstanceId('bad-\uD800-id', 'key', 1), /%uD800/);
  assert.notEqual(
    createStableDocumentInstanceId('\uD800', 'key', 1),
    createStableDocumentInstanceId('\uFFFD', 'key', 1)
  );
});

test('v7対象IDからsubjectを安全に生成し、主たる建物は推測しない', () => {
  const site = sanitizeSiteData({
    id: 'site-subject',
    land: [{ id: 'land-a' }],
    registrationApplications: [
      { id: 'title', type: '建物表題登記', targetBuildingIds: ['new-a'] },
      { id: 'loss', type: '建物滅失登記', targetBuildingIds: ['old-a'] },
      { id: 'land', type: '土地地目変更登記', targetBuildingIds: ['land-a'] },
      { id: 'change', type: '建物表題部変更登記', targetBuildingIds: ['old-b'] },
    ],
  });

  assert.deepEqual(getApplication(site, 'title').subject, {
    beforeBuildingIds: [], afterBuildingIds: ['new-a'], landIds: [], primaryBuildingId: null,
  });
  assert.deepEqual(getApplication(site, 'loss').subject, {
    beforeBuildingIds: ['old-a'], afterBuildingIds: [], landIds: [], primaryBuildingId: null,
  });
  assert.deepEqual(getApplication(site, 'land').subject, {
    beforeBuildingIds: [], afterBuildingIds: [], landIds: ['land-a'], primaryBuildingId: null,
  });
  assert.deepEqual(getApplication(site, 'land').targetLandIds, ['land-a']);
  assert.deepEqual(getApplication(site, 'land').targetBuildingIds, []);
  assert.deepEqual(getApplication(site, 'change').subject.beforeBuildingIds, ['old-b']);
});

test('明示済みsubjectの空配列はlegacy対象IDで埋め戻さない', () => {
  const site = sanitizeSiteData({
    id: 'site-explicit-subject',
    registrationApplications: [{
      id: 'ra-explicit',
      type: '建物表題登記',
      targetBuildingIds: ['legacy-building'],
      subject: {
        beforeBuildingIds: [], afterBuildingIds: [], landIds: [], primaryBuildingId: null,
      },
    }],
  });
  assert.deepEqual(site.registrationApplications[0].subject, {
    beforeBuildingIds: [], afterBuildingIds: [], landIds: [], primaryBuildingId: null,
  });
});

test('不正型の土地対象を移行前に受けても例外にせず空配列へ倒す', () => {
  const site = sanitizeSiteData({
    id: 'site-malformed-land-target',
    land: [{ id: 'land-a' }],
    registrationApplications: [{
      id: 'ra-malformed-land',
      type: '土地地目変更登記',
      targetBuildingIds: { unexpected: 'land-a' },
      targetLandIds: 42,
    }, {
      id: 'ra-mixed-land',
      type: '土地地目変更登記',
      targetBuildingIds: [42, 'land-a'],
      targetLandIds: [42],
    }],
  });
  const application = site.registrationApplications[0];
  assert.deepEqual(application.targetBuildingIds, []);
  assert.deepEqual(application.targetLandIds, []);
  assert.deepEqual(application.subject.landIds, []);
  const mixed = getApplication(site, 'ra-mixed-land');
  assert.deepEqual(mixed.targetBuildingIds, []);
  assert.deepEqual(mixed.targetLandIds, ['land-a']);
  assert.deepEqual(mixed.subject.landIds, ['land-a']);
});

test('現行のRA順・帳票定義順・全RA横断通番でdocPickを割り当てる', () => {
  const site = sanitizeSiteData(mappingFixture());
  const summarize = (raId) => getApplication(site, raId).documentInstances.map(instance => ({
    name: instance.documentName,
    copy: instance.copyIndex,
    legacyKey: instance.legacyInstanceKey,
    marker: instance.selectionOverrides.marker,
  }));

  assert.deepEqual(summarize('ra-title-a'), [
    { name: DOC_TITLE, copy: 1, legacyKey: `${DOC_TITLE}__1`, marker: 'title-a-1' },
    { name: DOC_TITLE, copy: 2, legacyKey: `${DOC_TITLE}__2`, marker: 'title-a-2' },
    { name: DOC_ADDRESS, copy: 1, legacyKey: `${DOC_ADDRESS}__1`, marker: 'address-title-a' },
    { name: DOC_SALE, copy: 1, legacyKey: `${DOC_SALE}__1`, marker: 'sale-title-a' },
  ]);
  assert.deepEqual(summarize('ra-change'), [
    // _raAppliedが別申請を示すpickは推測して移さない。
    { name: DOC_ADDRESS, copy: 1, legacyKey: `${DOC_ADDRESS}__2`, marker: undefined },
    { name: DOC_ADDRESS, copy: 2, legacyKey: `${DOC_ADDRESS}__3`, marker: 'address-change-2' },
    { name: DOC_SALE, copy: 1, legacyKey: `${DOC_SALE}__2`, marker: 'sale-change' },
  ]);
  assert.deepEqual(summarize('ra-title-b'), [
    { name: DOC_TITLE, copy: 1, legacyKey: `${DOC_TITLE}__3`, marker: 'title-b' },
    { name: DOC_ADDRESS, copy: 1, legacyKey: `${DOC_ADDRESS}__4`, marker: 'address-title-b' },
  ]);
});

test('旧customTextは非空だけを全文固定として1文字も変えず移す', () => {
  const raw = mappingFixture();
  const originalHtml = raw.docPick[`${DOC_TITLE}__1`].customText;
  const site = sanitizeSiteData(raw);
  const [edited, blank] = getApplication(site, 'ra-title-a').documentInstances;

  assert.equal(edited.editMode, 'legacy-detached');
  assert.equal(edited.detachedHtml, originalHtml);
  assert.equal(edited.printEnabled, false);
  assert.equal(edited.layoutOverrides.showMain, false);
  assert.equal(edited.layoutOverrides.fontScale, 0);
  assert.deepEqual(edited.layoutOverrides.stampPositions, [{ i: 0, dx: 0, dy: -2 }]);
  assert.equal(blank.editMode, 'linked');
  assert.equal(blank.detachedHtml, null);

  for (const html of [null, undefined, '', ' \n　', '<div><br></div>', '<div>&nbsp;<br></div>']) {
    assert.equal(isBlankDocumentHtml(html), true);
  }
  assert.equal(isBlankDocumentHtml('<p>本文</p>'), false);
});

test('旧pickを既定値・RA由来値へ戻すとshadow側のoverrideも解除する', () => {
  const key = `${DOC_TITLE}__1`;
  const edited = sanitizeSiteData({
    id: 'site-reset-overrides',
    registrationApplications: [{
      id: 'ra-reset',
      type: '建物表題登記',
      targetBuildingIds: ['building-a'],
      applicantPersonIds: ['p1'],
      documents: { [DOC_TITLE]: 1 },
    }],
    docPick: {
      [key]: {
        applicantPersonIds: ['p2'],
        showMain: false,
        fontScale: 90,
        _raApplied: 'ra-reset',
      },
    },
  });
  const editedInstance = getApplication(edited, 'ra-reset').documentInstances[0];
  assert.deepEqual(editedInstance.selectionOverrides.applicantPersonIds, ['p2']);
  assert.equal(editedInstance.layoutOverrides.showMain, false);
  assert.equal(editedInstance.layoutOverrides.fontScale, 90);

  const reset = reconcileSiteDocumentCompatibility({
    ...edited,
    docPick: {
      ...edited.docPick,
      [key]: {
        ...edited.docPick[key],
        applicantPersonIds: ['p1'],
        showMain: true,
        fontScale: 100,
        _raApplied: 'ra-reset',
      },
    },
  }, {
    legacyPickIntentFields: {
      [key]: ['applicantPersonIds', 'showMain', 'fontScale'],
    },
  });
  const resetInstance = getApplication(reset, 'ra-reset').documentInstances[0];
  assert.equal('applicantPersonIds' in resetInstance.selectionOverrides, false);
  assert.equal('showMain' in resetInstance.layoutOverrides, false);
  assert.equal('fontScale' in resetInstance.layoutOverrides, false);
});

test('安定IDはRA ID・templateKey・RA内通番で決まり、再sanitizeでも変わらない', () => {
  const once = sanitizeSiteData(mappingFixture());
  const twice = sanitizeSiteData(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);

  const ids = once.registrationApplications.flatMap(ra =>
    ra.documentInstances.map(instance => instance.id)
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    getApplication(once, 'ra-title-b').documentInstances[0].id,
    createStableDocumentInstanceId('ra-title-b', DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], 1)
  );

  const reordered = sanitizeSiteData({
    ...JSON.parse(JSON.stringify(once)),
    registrationApplications: [...once.registrationApplications].reverse(),
  });
  for (const originalRa of once.registrationApplications) {
    assert.deepEqual(
      getApplication(reordered, originalRa.id).documentInstances.map(instance => instance.id).sort(),
      originalRa.documentInstances.map(instance => instance.id).sort()
    );
  }
});

test('申請順を変えても申請ID表示のない旧全文を別instanceへ入れ替えない', () => {
  const first = sanitizeSiteData({
    id: 'site-reorder-without-marker',
    registrationApplications: [
      {
        id: 'ra-a', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: 'stable-a', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE] }],
      },
      {
        id: 'ra-b', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: 'stable-b', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE] }],
      },
    ],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: '<p>申請A</p>' },
      [`${DOC_TITLE}__2`]: { customText: '<p>申請B</p>' },
    },
  });
  const reordered = sanitizeSiteData({
    ...JSON.parse(JSON.stringify(first)),
    registrationApplications: [...first.registrationApplications].reverse(),
  });
  assert.equal(getApplication(reordered, 'ra-a').documentInstances[0].detachedHtml, '<p>申請A</p>');
  assert.equal(getApplication(reordered, 'ra-b').documentInstances[0].detachedHtml, '<p>申請B</p>');

  const exported = buildExportPayload(
    { activeSiteId: reordered.id, sites: [reordered] },
    { exportedAt: '2026-09-14T00:00:00.000Z' }
  );
  const imported = parseImportPayload(JSON.parse(JSON.stringify(exported))).sites[0];
  assert.equal(getApplication(imported, 'ra-a').documentInstances[0].detachedHtml, '<p>申請A</p>');
  assert.equal(getApplication(imported, 'ra-b').documentInstances[0].detachedHtml, '<p>申請B</p>');
});

test('前段RA削除後のStep3自動設定でも別申請の旧全文を引き継がない', () => {
  const first = sanitizeSiteData({
    id: 'site-remove-leading-ra',
    registrationApplications: [
      { id: 'ra-a', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
      { id: 'ra-b', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
    ],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: '<p>申請A</p>', _raApplied: 'ra-a' },
      [`${DOC_TITLE}__2`]: { customText: '<p>申請B</p>', _raApplied: 'ra-b' },
    },
  });
  const afterRemoval = sanitizeSiteData({
    ...JSON.parse(JSON.stringify(first)),
    registrationApplications: [getApplication(first, 'ra-b')],
  });
  const shadow = getApplication(afterRemoval, 'ra-b').documentInstances[0];
  const currentKey = `${DOC_TITLE}__1`;
  const compatiblePick = selectLegacyPickForApplication({
    docPick: afterRemoval.docPick,
    currentInstanceKey: currentKey,
    previousInstanceKey: shadow.legacyInstanceKey,
    applicationId: 'ra-b',
  });
  assert.equal(compatiblePick.customText, '<p>申請B</p>');

  const afterStep3Autofill = sanitizeSiteData({
    ...afterRemoval,
    docPick: {
      ...afterRemoval.docPick,
      [currentKey]: { ...compatiblePick, _raApplied: 'ra-b' },
    },
  });
  assert.equal(
    getApplication(afterStep3Autofill, 'ra-b').documentInstances[0].detachedHtml,
    '<p>申請B</p>'
  );
});

test('前段へ新規RAを挿入して再sanitizeしても既存全文を複製しない', () => {
  const initial = sanitizeSiteData({
    id: 'site-insert-leading-ra',
    registrationApplications: [
      { id: 'ra-a', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
    ],
    docPick: { [`${DOC_TITLE}__1`]: { customText: '<p>既存A</p>' } },
  });
  const inserted = sanitizeSiteData({
    ...initial,
    registrationApplications: [
      { id: 'ra-new', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
      getApplication(initial, 'ra-a'),
    ],
  });
  const twice = sanitizeSiteData(JSON.parse(JSON.stringify(inserted)));
  assert.equal(getApplication(twice, 'ra-new').documentInstances[0].detachedHtml, null);
  assert.equal(getApplication(twice, 'ra-new').documentInstances[0].editMode, 'linked');
  assert.equal(getApplication(twice, 'ra-a').documentInstances[0].detachedHtml, '<p>既存A</p>');
  assert.deepEqual(twice, inserted);
});

test('同一RA内の通数増減でも別copyの旧全文を新copyへ複製しない', () => {
  const initial = sanitizeSiteData({
    id: 'site-copy-shift',
    registrationApplications: [
      { id: 'ra-a', type: '建物表題登記', documents: { [DOC_TITLE]: 2 } },
      { id: 'ra-b', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
    ],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: '<p>A1</p>', _raApplied: 'ra-a' },
      [`${DOC_TITLE}__2`]: { customText: '<p>A2</p>', _raApplied: 'ra-a' },
      [`${DOC_TITLE}__3`]: { customText: '<p>B1</p>', _raApplied: 'ra-b' },
    },
  });
  const shifted = sanitizeSiteData({
    ...initial,
    registrationApplications: [
      { ...getApplication(initial, 'ra-a'), documents: { [DOC_TITLE]: 1 } },
      { ...getApplication(initial, 'ra-b'), documents: { [DOC_TITLE]: 2 } },
    ],
  });
  const bInstances = getApplication(shifted, 'ra-b').documentInstances
    .filter(instance => instance.active);
  assert.equal(bInstances[0].detachedHtml, '<p>B1</p>');
  assert.equal(bInstances[1].detachedHtml, null);
  assert.deepEqual(sanitizeSiteData(JSON.parse(JSON.stringify(shifted))), shifted);
});

test('custom IDの複数copyも前段RA挿入後にcopyIndexで正しく照合する', () => {
  const initial = sanitizeSiteData({
    id: 'site-custom-id-shift',
    registrationApplications: [{
      id: 'ra-b',
      type: '建物表題登記',
      documents: { [DOC_TITLE]: 2 },
      documentInstances: [
        { id: 'custom-b1', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], copyIndex: 1 },
        { id: 'custom-b2', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], copyIndex: 2 },
      ],
    }],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: '<p>B1</p>' },
      [`${DOC_TITLE}__2`]: { customText: '<p>B2</p>' },
    },
  });
  const inserted = sanitizeSiteData({
    ...initial,
    registrationApplications: [
      { id: 'ra-a', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
      getApplication(initial, 'ra-b'),
    ],
  });
  const bInstances = getApplication(inserted, 'ra-b').documentInstances
    .filter(instance => instance.active);
  assert.deepEqual(bInstances.map(instance => instance.id), ['custom-b1', 'custom-b2']);
  assert.deepEqual(bInstances.map(instance => instance.copyIndex), [1, 2]);
  assert.deepEqual(bInstances.map(instance => instance.detachedHtml), ['<p>B1</p>', '<p>B2</p>']);
  assert.equal(getApplication(inserted, 'ra-a').documentInstances[0].detachedHtml, null);
});

test('既存v8 instanceのID・override・全文固定と未対応instanceを保持する', () => {
  const site = sanitizeSiteData({
    id: 'site-v8',
    registrationApplications: [{
      id: 'ra-v8',
      type: '建物表題登記',
      targetBuildingIds: ['legacy-building'],
      subject: { beforeBuildingIds: [], afterBuildingIds: [], landIds: [], primaryBuildingId: null },
      details: { reason: '利用者が確定した詳細', invalid: () => 'drop' },
      documents: { [DOC_TITLE]: 1, [DOC_ADDRESS]: 1, 未知書類: 1 },
      documentInstances: [
        {
          id: 'instance-kept',
          templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE],
          copyIndex: 1,
          printEnabled: false,
          selectionOverrides: { selected: ['p1'] },
          contentOverrides: { blocks: { body: '<p>ブロック修正</p>' }, fields: { address: '別表記' } },
          layoutOverrides: { itemOffsets: { address: { dx: 1, dy: 2 } } },
          editMode: 'detached',
          detachedHtml: '<section>確定済み全文</section>',
          detachedSourceSnapshot: { sourceHash: 'abc' },
        },
        {
          id: 'address-instance-kept',
          templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_ADDRESS],
          contentOverrides: { blocks: {}, fields: { address: '住所別表記' } },
        },
        {
          id: 'unsupported-kept',
          templateKey: 'custom.future-template',
          documentName: '将来帳票',
          copyIndex: 1,
          contentOverrides: { blocks: { body: '保持' }, fields: {} },
        },
      ],
    }],
    docPick: {
      [`${DOC_TITLE}__1`]: {
        customText: '<p>旧全文で上書きしてはいけない</p>',
        showMain: false,
        _raApplied: 'ra-v8',
      },
      '未知書類__1': { customText: '<p>未割当の原文</p>' },
    },
  });

  const ra = getApplication(site, 'ra-v8');
  const kept = ra.documentInstances.find(instance => instance.id === 'instance-kept');
  assert.equal(kept.documentName, DOC_TITLE);
  assert.equal(kept.editMode, 'detached');
  assert.equal(kept.detachedHtml, '<section>確定済み全文</section>');
  assert.deepEqual(kept.contentOverrides.blocks, { body: '<p>ブロック修正</p>' });
  assert.deepEqual(kept.contentOverrides.fields, { address: '別表記' });
  assert.deepEqual(kept.layoutOverrides.itemOffsets, { address: { dx: 1, dy: 2 } });
  assert.equal(kept.layoutOverrides.showMain, false);
  assert.equal(
    ra.documentInstances.find(instance => instance.id === 'address-instance-kept')
      .contentOverrides.fields.address,
    '住所別表記'
  );
  assert.ok(ra.documentInstances.some(instance => instance.id === 'unsupported-kept'));
  assert.equal(ra.documentInstances.length, 3);
  assert.equal(ra.documentInstances.some(instance => instance.documentName === '未知書類'), false);
  assert.deepEqual(site.docPick['未知書類__1'], { customText: '<p>未割当の原文</p>' });
  assert.deepEqual(ra.details, { reason: '利用者が確定した詳細' });
});

test('既知templateKeyを表示名より優先し、future instanceを正式slotへ誤割当しない', () => {
  const normalized = normalizeRegistrationApplication({
    id: 'ra-key-name-conflict',
    type: '建物表題登記',
    documentInstances: [{
      id: 'conflict',
      templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE],
      documentName: DOC_SALE,
    }],
  });
  assert.equal(normalized.documentInstances[0].documentName, DOC_TITLE);
  assert.deepEqual(normalized.documents, { [DOC_TITLE]: 1 });

  const site = sanitizeSiteData({
    id: 'site-future-instance',
    registrationApplications: [{
      id: 'ra-future-instance',
      type: '建物表題登記',
      documents: { [DOC_TITLE]: 1 },
      documentInstances: [{
        id: 'future-kept',
        templateKey: 'custom.future',
        documentName: DOC_TITLE,
        copyIndex: 1,
      }],
    }],
  });
  const instances = site.registrationApplications[0].documentInstances;
  assert.equal(instances.length, 2);
  assert.ok(instances.some(instance =>
    instance.templateKey === DOCUMENT_TEMPLATE_KEYS[DOC_TITLE] && instance.active
  ));
  assert.ok(instances.some(instance =>
    instance.id === 'future-kept' && instance.templateKey === 'custom.future'
  ));
});

test('documentInstancesだけの入力はlegacy documents shadowを生成する', () => {
  const normalized = normalizeRegistrationApplication({
    id: 'ra-instance-only',
    type: '建物表題登記',
    documentInstances: [
      { templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], copyIndex: 1 },
      { templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], copyIndex: 2 },
    ],
  });
  assert.deepEqual(normalized.documents, { [DOC_TITLE]: 2 });

  const explicitlyEmpty = normalizeRegistrationApplication({
    id: 'ra-explicit-empty',
    type: '建物表題登記',
    documents: {},
    documentInstances: [{ templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE] }],
  });
  assert.deepEqual(explicitlyEmpty.documents, {});
});

test('documentInstancesだけの入力ではactive instanceを詰めて正しい書類を表示対象にする', () => {
  const site = sanitizeSiteData({
    id: 'site-active-only-instances',
    registrationApplications: [{
      id: 'ra-active-only-instances',
      type: '建物表題登記',
      documentInstances: [
        {
          id: 'inactive-instance',
          templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE],
          copyIndex: 1,
          active: false,
          editMode: 'detached',
          detachedHtml: '<p>休止中</p>',
        },
        {
          id: 'active-instance',
          templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE],
          copyIndex: 2,
          active: true,
          editMode: 'detached',
          detachedHtml: '<p>表示対象</p>',
        },
      ],
    }],
  });
  const application = site.registrationApplications[0];
  assert.deepEqual(application.documents, { [DOC_TITLE]: 1 });
  const active = application.documentInstances.find(instance => instance.active);
  assert.equal(active.id, 'active-instance');
  assert.equal(active.copyIndex, 1);
  assert.equal(active.detachedHtml, '<p>表示対象</p>');
  assert.equal(
    application.documentInstances.find(instance => instance.id === 'inactive-instance').active,
    false
  );
  assert.equal(
    application.documentInstances.find(instance => instance.id === 'inactive-instance').copyIndex,
    2
  );
  assert.deepEqual(sanitizeSiteData(JSON.parse(JSON.stringify(site))), site);

  const restored = sanitizeSiteData({
    ...site,
    registrationApplications: [{
      ...application,
      documents: { [DOC_TITLE]: 2 },
    }],
  });
  assert.deepEqual(
    restored.registrationApplications[0].documentInstances
      .filter(instance => instance.active)
      .sort((left, right) => left.copyIndex - right.copyIndex)
      .map(instance => instance.detachedHtml),
    ['<p>表示対象</p>', '<p>休止中</p>']
  );
});

test('重複したcopyIndexとinstance IDは決定的に一意化する', () => {
  const raw = {
    id: 'ra-duplicate-instance',
    type: '建物表題登記',
    documentInstances: [
      { id: 'duplicate-id', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], copyIndex: 1 },
      { id: 'duplicate-id', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE], copyIndex: 1 },
    ],
  };
  const once = normalizeRegistrationApplication(raw);
  const twice = normalizeRegistrationApplication(raw);
  assert.deepEqual(once.documentInstances.map(instance => instance.copyIndex), [1, 2]);
  assert.equal(new Set(once.documentInstances.map(instance => instance.id)).size, 2);
  assert.deepEqual(
    twice.documentInstances.map(instance => instance.id),
    once.documentInstances.map(instance => instance.id)
  );
});

test('矛盾した派生IDより帳票slot構造を優先して全文を対応付ける', () => {
  const templateKey = DOCUMENT_TEMPLATE_KEYS[DOC_TITLE];
  const site = sanitizeSiteData({
    id: 'site-conflicting-derived-id',
    registrationApplications: [{
      id: 'ra-conflicting-derived-id',
      type: '建物表題登記',
      documents: { [DOC_TITLE]: 2 },
      documentInstances: [
        {
          id: createStableDocumentInstanceId('ra-conflicting-derived-id', templateKey, 1),
          templateKey,
          copyIndex: 2,
          editMode: 'detached',
          detachedHtml: 'WRONG2',
        },
        {
          id: 'custom-one',
          templateKey,
          copyIndex: 1,
          editMode: 'detached',
          detachedHtml: 'RIGHT1',
        },
      ],
    }],
  });
  const html = site.registrationApplications[0].documentInstances
    .filter(instance => instance.active)
    .sort((left, right) => left.copyIndex - right.copyIndex)
    .map(instance => instance.detachedHtml);
  assert.deepEqual(html, ['RIGHT1', 'WRONG2']);
  assert.deepEqual(sanitizeSiteData(JSON.parse(JSON.stringify(site))), site);
});

test('重複したRA IDとRA横断instance IDも決定的に一意化する', () => {
  const site = sanitizeSiteData({
    id: 'site-duplicate-global-ids',
    registrationApplications: [
      {
        id: 'duplicate-ra',
        type: '建物表題登記',
        documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: 'duplicate-instance', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE] }],
      },
      {
        id: 'duplicate-ra',
        type: '建物表題登記',
        documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: 'duplicate-instance', templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE] }],
      },
    ],
  });
  const applicationIds = site.registrationApplications.map(application => application.id);
  const instanceIds = site.registrationApplications.flatMap(application =>
    application.documentInstances.map(instance => instance.id)
  );
  assert.equal(new Set(applicationIds).size, applicationIds.length);
  assert.equal(new Set(instanceIds).size, instanceIds.length);
  assert.deepEqual(
    sanitizeSiteData(JSON.parse(JSON.stringify(site))).registrationApplications.map(application => application.id),
    applicationIds
  );
});

test('重複RA IDの修復時も位置対応する旧全文と所有者markerを保持する', () => {
  const site = sanitizeSiteData({
    id: 'site-duplicate-ra-content',
    registrationApplications: [
      { id: 'duplicate-ra', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
      { id: 'duplicate-ra', type: '建物表題登記', documents: { [DOC_TITLE]: 1 } },
    ],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: 'A', _raApplied: 'duplicate-ra' },
      [`${DOC_TITLE}__2`]: { customText: 'B', _raApplied: 'duplicate-ra' },
    },
  });
  assert.deepEqual(
    site.registrationApplications.map(application => application.id),
    ['duplicate-ra', 'duplicate-ra~2']
  );
  assert.deepEqual(
    site.registrationApplications.map(application =>
      application.documentInstances.find(instance => instance.active)?.detachedHtml
    ),
    ['A', 'B']
  );
  assert.equal(site.docPick[`${DOC_TITLE}__2`]._raApplied, 'duplicate-ra~2');
  assert.deepEqual(sanitizeSiteData(JSON.parse(JSON.stringify(site))), site);
});

test('重複instance IDの修復は後続の一意な元IDを横取りしない', () => {
  const templateKey = DOCUMENT_TEMPLATE_KEYS[DOC_TITLE];
  const reservedId = createStableDocumentInstanceId('ra-b', templateKey, 1);
  const site = sanitizeSiteData({
    id: 'site-reserved-instance-id',
    registrationApplications: [
      {
        id: 'ra-a', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: 'shared', templateKey }],
      },
      {
        id: 'ra-b', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: 'shared', templateKey }],
      },
      {
        id: 'ra-c', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
        documentInstances: [{ id: reservedId, templateKey }],
      },
    ],
  });
  const ids = site.registrationApplications.map(application =>
    application.documentInstances.find(instance => instance.active).id
  );
  assert.equal(ids[0], 'shared');
  assert.notEqual(ids[1], 'shared');
  assert.notEqual(ids[1], reservedId);
  assert.equal(ids[2], reservedId);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(sanitizeSiteData(JSON.parse(JSON.stringify(site))), site);
});

test('書類件数を減らしたinstanceは休止扱いで保持し、再追加時に同じIDで戻す', () => {
  const initial = sanitizeSiteData({
    id: 'site-document-count-change',
    registrationApplications: [{
      id: 'ra-count-change',
      type: '建物表題登記',
      documents: { [DOC_TITLE]: 2 },
    }],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: '<p>1通目</p>' },
      [`${DOC_TITLE}__2`]: { customText: '<p>2通目</p>' },
    },
  });
  const originalIds = getApplication(initial, 'ra-count-change')
    .documentInstances.map(instance => instance.id);
  const reduced = sanitizeSiteData({
    ...initial,
    registrationApplications: [{
      ...getApplication(initial, 'ra-count-change'),
      documents: { [DOC_TITLE]: 1 },
    }],
  });
  const reducedInstances = getApplication(reduced, 'ra-count-change').documentInstances;
  assert.deepEqual(reducedInstances.map(instance => instance.active), [true, false]);

  const restored = sanitizeSiteData({
    ...reduced,
    registrationApplications: [{
      ...getApplication(reduced, 'ra-count-change'),
      documents: { [DOC_TITLE]: 2 },
    }],
  });
  const restoredInstances = getApplication(restored, 'ra-count-change').documentInstances;
  assert.deepEqual(restoredInstances.map(instance => instance.active), [true, true]);
  assert.deepEqual(restoredInstances.map(instance => instance.id), originalIds);
  assert.equal(restoredInstances[1].detachedHtml, '<p>2通目</p>');
});

test('休止中に旧通番が別copyへ再利用されても元の全文で再活性化する', () => {
  const titleDocs = count => ({ [DOC_TITLE]: count });
  const initial = sanitizeSiteData({
    id: 'site-reactivate-after-key-reuse',
    registrationApplications: [
      { id: 'ra-a', type: '建物表題登記', documents: titleDocs(3) },
      { id: 'ra-b', type: '建物表題登記', documents: titleDocs(2) },
    ],
    docPick: {
      [`${DOC_TITLE}__4`]: { customText: '<p>B1</p>', _raApplied: 'ra-b' },
      [`${DOC_TITLE}__5`]: { customText: '<p>B2</p>', _raApplied: 'ra-b' },
    },
  });
  const reduced = sanitizeSiteData({
    ...initial,
    registrationApplications: [
      getApplication(initial, 'ra-a'),
      { ...getApplication(initial, 'ra-b'), documents: titleDocs(1) },
    ],
  });
  const keyReused = sanitizeSiteData({
    ...reduced,
    registrationApplications: [
      { ...getApplication(reduced, 'ra-a'), documents: titleDocs(4) },
      getApplication(reduced, 'ra-b'),
    ],
  });
  assert.equal(keyReused.docPick[`${DOC_TITLE}__5`].customText, '<p>B1</p>');

  const restored = sanitizeSiteData({
    ...keyReused,
    registrationApplications: [
      getApplication(keyReused, 'ra-a'),
      { ...getApplication(keyReused, 'ra-b'), documents: titleDocs(2) },
    ],
  });
  const bInstances = getApplication(restored, 'ra-b').documentInstances
    .filter(instance => instance.active);
  assert.equal(bInstances[0].detachedHtml, '<p>B1</p>');
  assert.equal(bInstances[1].detachedHtml, '<p>B2</p>');
});

test('再活性化で移動した旧slotを新規copyが重複継承しない', () => {
  const titleDocs = count => ({ [DOC_TITLE]: count });
  let site = sanitizeSiteData({
    id: 'site-stale-copy-slot',
    registrationApplications: [
      { id: 'ra-a', type: '建物表題登記', documents: titleDocs(3) },
      { id: 'ra-b', type: '建物表題登記', documents: titleDocs(2) },
    ],
    docPick: {
      [`${DOC_TITLE}__1`]: { customText: 'A1', _raApplied: 'ra-a' },
      [`${DOC_TITLE}__2`]: { customText: 'A2', _raApplied: 'ra-a' },
      [`${DOC_TITLE}__3`]: { customText: 'A3', _raApplied: 'ra-a' },
      [`${DOC_TITLE}__4`]: { customText: 'B1', _raApplied: 'ra-b' },
      [`${DOC_TITLE}__5`]: { customText: 'B2', _raApplied: 'ra-b' },
    },
  });
  const resize = (aCount, bCount) => {
    site = sanitizeSiteData({
      ...site,
      registrationApplications: [
        { ...getApplication(site, 'ra-a'), documents: titleDocs(aCount) },
        { ...getApplication(site, 'ra-b'), documents: titleDocs(bCount) },
      ],
    });
  };
  resize(2, 1);
  resize(2, 2);
  resize(2, 3);
  assert.deepEqual(
    getApplication(site, 'ra-b').documentInstances
      .filter(instance => instance.active)
      .sort((left, right) => left.copyIndex - right.copyIndex)
      .map(instance => instance.detachedHtml),
    ['B1', 'B2', null]
  );
});

test('RA由来値は元データ更新へ同期し、明示overrideだけを維持する', () => {
  let site = sanitizeSiteData({
    id: 'site-source-sync',
    registrationApplications: [{
      id: 'ra-source-sync',
      type: '建物表題登記',
      targetBuildingIds: ['building-a'],
      applicantPersonIds: ['person-a'],
      documents: { [DOC_TITLE]: 1 },
    }],
  });
  let application = applyRegistrationApplicationPatch(
    getApplication(site, 'ra-source-sync'),
    { targetBuildingIds: ['building-b'], applicantPersonIds: ['person-b'] }
  );
  site = reconcileSiteDocumentCompatibility({
    ...site,
    registrationApplications: [application],
  });
  assert.equal(site.docPick[`${DOC_TITLE}__1`].targetPropBuildingId, 'building-b');
  assert.deepEqual(site.docPick[`${DOC_TITLE}__1`].applicantPersonIds, ['person-b']);
  assert.deepEqual(
    getApplication(site, 'ra-source-sync').documentInstances[0].selectionOverrides,
    {}
  );

  const key = `${DOC_TITLE}__1`;
  site = reconcileSiteDocumentCompatibility(
    {
      ...site,
      docPick: {
        ...site.docPick,
        [key]: { ...site.docPick[key], targetPropBuildingId: 'special-building' },
      },
    },
    { legacyPickIntentFields: { [key]: ['targetPropBuildingId'] } }
  );
  application = applyRegistrationApplicationPatch(
    getApplication(site, 'ra-source-sync'),
    { targetBuildingIds: ['building-c'] }
  );
  site = reconcileSiteDocumentCompatibility({
    ...site,
    registrationApplications: [application],
  });
  assert.equal(site.docPick[key].targetPropBuildingId, 'special-building');
});

test('表題の帳票対象overrideはsubjectのprimaryBuildingIdを正本として保持する', () => {
  const key = `${DOC_TITLE}__1`;
  let site = sanitizeSiteData({
    id: 'site-primary-target',
    registrationApplications: [{
      id: 'ra-primary-target',
      type: '建物表題登記',
      targetBuildingIds: ['building-a', 'building-b'],
      subject: {
        beforeBuildingIds: [],
        afterBuildingIds: ['building-a', 'building-b'],
        landIds: [],
        primaryBuildingId: 'building-b',
      },
      documents: { [DOC_TITLE]: 1 },
    }],
  });
  assert.equal(site.docPick[key].targetPropBuildingId, 'building-b');

  site = reconcileSiteDocumentCompatibility({
    ...site,
    docPick: {
      ...site.docPick,
      [key]: { ...site.docPick[key], targetPropBuildingId: 'building-a' },
    },
  }, { legacyPickIntentFields: { [key]: ['targetPropBuildingId'] } });
  assert.equal(site.docPick[key].targetPropBuildingId, 'building-a');
  assert.equal(
    site.registrationApplications[0].documentInstances[0]
      .selectionOverrides.targetPropBuildingId,
    'building-a'
  );

  site = reconcileSiteDocumentCompatibility({
    ...site,
    docPick: {
      ...site.docPick,
      [key]: { ...site.docPick[key], targetPropBuildingId: 'building-b' },
    },
  }, { legacyPickIntentFields: { [key]: ['targetPropBuildingId'] } });
  assert.deepEqual(
    site.registrationApplications[0].documentInstances[0].selectionOverrides,
    {}
  );
});

test('明示overrideは元データと一時的に同値になっても明示解除まで維持する', () => {
  const key = `${DOC_TITLE}__1`;
  let site = sanitizeSiteData({
    id: 'site-sticky-override',
    registrationApplications: [{
      id: 'ra-sticky-override', type: '建物表題登記',
      targetBuildingIds: ['building-a'], documents: { [DOC_TITLE]: 1 },
    }],
  });
  site = reconcileSiteDocumentCompatibility({
    ...site,
    docPick: {
      ...site.docPick,
      [key]: { ...site.docPick[key], targetPropBuildingId: 'building-b' },
    },
  }, { legacyPickIntentFields: { [key]: ['targetPropBuildingId'] } });

  const patchTarget = targetBuildingIds => {
    const application = applyRegistrationApplicationPatch(
      getApplication(site, 'ra-sticky-override'),
      { targetBuildingIds }
    );
    site = reconcileSiteDocumentCompatibility({
      ...site,
      registrationApplications: [application],
    }, { preferApplicationValues: true });
  };
  patchTarget(['building-b']);
  site = reconcileSiteDocumentCompatibility({
    ...site,
    docPick: {
      ...site.docPick,
      [key]: { ...site.docPick[key], fontScale: 90 },
    },
  }, { legacyPickIntentFields: { [key]: ['fontScale'] } });
  patchTarget(['building-c']);
  assert.equal(site.docPick[key].targetPropBuildingId, 'building-b');
  assert.equal(
    site.registrationApplications[0].documentInstances[0]
      .selectionOverrides.targetPropBuildingId,
    'building-b'
  );
});

test('滅失対象を解除したとき旧建物IDを帳票へ残さない', () => {
  const documentName = '委任状（滅失）';
  const key = `${documentName}__1`;
  let site = sanitizeSiteData({
    id: 'site-clear-loss-target',
    registrationApplications: [{
      id: 'ra-clear-loss-target', type: '建物滅失登記',
      targetBuildingIds: ['building-a'], documents: { [documentName]: 1 },
    }],
  });
  const application = applyRegistrationApplicationPatch(
    getApplication(site, 'ra-clear-loss-target'),
    { targetBuildingIds: [] }
  );
  site = reconcileSiteDocumentCompatibility({
    ...site,
    registrationApplications: [application],
  }, { preferApplicationValues: true });
  assert.deepEqual(site.docPick[key].lossBuildingIds, []);
  assert.deepEqual(site.registrationApplications[0].documentInstances[0].selectionOverrides, {});
});

test('未割当の自動pickを新RAのデータ項目overrideとして取り込まない', () => {
  const key = `${DOC_TITLE}__1`;
  const site = reconcileSiteDocumentCompatibility({
    id: 'site-unmarked-auto-pick',
    registrationApplications: [{
      id: 'ra-unmarked-auto-pick',
      type: '建物表題登記',
      targetBuildingIds: ['selected-building'],
      applicantPersonIds: ['selected-owner'],
      documents: { [DOC_TITLE]: 1 },
      subject: {
        beforeBuildingIds: [], afterBuildingIds: ['selected-building'], landIds: [],
        primaryBuildingId: null,
      },
      details: {},
      documentInstances: [],
    }],
    docPick: {
      [key]: {
        targetPropBuildingId: 'sorted-first-building',
        applicantPersonIds: ['sorted-first-owner'],
      },
    },
  }, { preferApplicationValues: true });
  assert.equal(site.docPick[key].targetPropBuildingId, 'selected-building');
  assert.deepEqual(site.docPick[key].applicantPersonIds, ['selected-owner']);
  assert.deepEqual(site.registrationApplications[0].documentInstances[0].selectionOverrides, {});
});

test('全文固定の明示編集と解除は既存instanceにも反映する', () => {
  const key = `${DOC_TITLE}__1`;
  let site = sanitizeSiteData({
    id: 'site-detached-edit',
    registrationApplications: [{
      id: 'ra-detached-edit', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
      documentInstances: [{
        templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE],
        editMode: 'detached',
        detachedHtml: 'OLD',
      }],
    }],
  });
  site = reconcileSiteDocumentCompatibility(
    { ...site, docPick: { ...site.docPick, [key]: { ...site.docPick[key], customText: 'NEW' } } },
    { legacyPickIntentFields: { [key]: ['customText'] } }
  );
  assert.equal(site.registrationApplications[0].documentInstances[0].detachedHtml, 'NEW');
  site = reconcileSiteDocumentCompatibility(
    { ...site, docPick: { ...site.docPick, [key]: { ...site.docPick[key], customText: null } } },
    { legacyPickIntentFields: { [key]: ['customText'] } }
  );
  assert.equal(site.registrationApplications[0].documentInstances[0].editMode, 'linked');
  assert.equal(site.registrationApplications[0].documentInstances[0].detachedHtml, null);
});

test('本文のないdetached指定は旧customTextを失わず救済する', () => {
  for (const detachedHtml of [null, '', '<div>&nbsp;<br></div>']) {
    const site = sanitizeSiteData({
      id: 'site-invalid-detached',
      registrationApplications: [{
        id: 'ra-invalid-detached', type: '建物表題登記', documents: { [DOC_TITLE]: 1 },
        documentInstances: [{
          templateKey: DOCUMENT_TEMPLATE_KEYS[DOC_TITLE],
          editMode: 'detached',
          detachedHtml,
        }],
      }],
      docPick: { [`${DOC_TITLE}__1`]: { customText: 'KEEP' } },
    });
    assert.equal(site.registrationApplications[0].documentInstances[0].detachedHtml, 'KEEP');
  }
});

test('申請種別変更で対象外になった既知帳票は休止し、future帳票は保持する', () => {
  const before = sanitizeSiteData({
    id: 'site-application-type-change',
    registrationApplications: [{
      id: 'ra-type-change',
      type: '建物表題登記',
      documents: { [DOC_TITLE]: 1 },
      documentInstances: [{
        id: 'future-active', templateKey: 'custom.future', documentName: '将来帳票', active: true,
      }],
    }],
  });
  const after = sanitizeSiteData({
    ...before,
    registrationApplications: [{
      ...before.registrationApplications[0],
      type: '土地地目変更登記',
      documents: { '委任状（地目変更）': 1 },
    }],
  });
  const instances = after.registrationApplications[0].documentInstances;
  assert.equal(
    instances.find(instance => instance.templateKey === DOCUMENT_TEMPLATE_KEYS[DOC_TITLE]).active,
    false
  );
  assert.equal(instances.find(instance => instance.id === 'future-active').active, true);
  assert.equal(
    instances.find(instance =>
      instance.templateKey === DOCUMENT_TEMPLATE_KEYS['委任状（地目変更）']
    ).active,
    true
  );
});

test('legacy対象の更新は同じ操作内でsubject shadowにも反映する', () => {
  const title = normalizeRegistrationApplication({
    id: 'ra-patch', type: '建物表題登記', targetBuildingIds: ['before'],
    subject: {
      beforeBuildingIds: [], afterBuildingIds: ['before'], landIds: [], primaryBuildingId: 'before',
    },
  });
  const patchedTitle = applyRegistrationApplicationPatch(title, { targetBuildingIds: ['after'] });
  assert.deepEqual(patchedTitle.subject, {
    beforeBuildingIds: [], afterBuildingIds: ['after'], landIds: [], primaryBuildingId: null,
  });

  const land = normalizeRegistrationApplication({
    id: 'ra-land-patch', type: '土地地目変更登記', targetLandIds: ['land-a'],
  });
  const patchedLand = applyRegistrationApplicationPatch(land, { targetLandIds: ['land-b'] });
  assert.deepEqual(patchedLand.subject.landIds, ['land-b']);

  const change = normalizeRegistrationApplication({
    id: 'ra-change-patch', type: '建物表題部変更登記', targetBuildingIds: ['before-a'],
    subject: {
      beforeBuildingIds: ['before-a'],
      afterBuildingIds: ['after-a'],
      landIds: [],
      primaryBuildingId: 'after-a',
    },
  });
  const patchedChange = applyRegistrationApplicationPatch(change, {
    targetBuildingIds: ['before-b'],
  });
  assert.equal(patchedChange.subject.primaryBuildingId, 'after-a');

  const changedType = applyRegistrationApplicationPatch(title, {
    type: '土地地目変更登記',
    targetBuildingIds: [],
    targetLandIds: ['land-c'],
  });
  assert.deepEqual(changedType.subject, {
    beforeBuildingIds: [], afterBuildingIds: [], landIds: ['land-c'], primaryBuildingId: null,
  });
});

test('不正件数・未知帳票・件数超過pickからphantom instanceを作らない', () => {
  const site = sanitizeSiteData({
    id: 'site-invalid-counts',
    registrationApplications: [{
      id: 'ra-counts',
      type: '建物表題登記',
      documents: {
        [DOC_TITLE]: '2',
        [DOC_ADDRESS]: 1.2,
        [DOC_SALE]: -1,
        未知帳票: 10,
      },
    }],
    docPick: {
      [`${DOC_TITLE}__99`]: { customText: '<p>件数超過</p>' },
      '未知帳票__1': { customText: '<p>未知</p>' },
    },
  });
  const instances = site.registrationApplications[0].documentInstances;
  assert.equal(instances.filter(instance => instance.documentName === DOC_TITLE).length, 2);
  // 現行 `j < count` と同じく、正の小数1.2は2回になる。
  assert.equal(instances.filter(instance => instance.documentName === DOC_ADDRESS).length, 2);
  assert.equal(instances.some(instance => instance.documentName === DOC_SALE), false);
  assert.equal(instances.some(instance => instance.documentName === '未知帳票'), false);
  assert.equal(site.docPick[`${DOC_TITLE}__99`].customText, '<p>件数超過</p>');
  assert.equal(site.docPick['未知帳票__1'].customText, '<p>未知</p>');
});

test('異常に大きい書類件数は有限の安全上限へ制限する', () => {
  assert.equal(normalizeDocumentCount(Infinity), 0);
  assert.equal(normalizeDocumentCount(Number.MAX_SAFE_INTEGER), MAX_DOCUMENT_COPIES_PER_APPLICATION);
  assert.equal(normalizeDocumentCount(1e308), MAX_DOCUMENT_COPIES_PER_APPLICATION);
  const site = sanitizeSiteData({
    id: 'site-huge-count',
    registrationApplications: [{
      id: 'ra-huge-count',
      type: '建物表題登記',
      documents: { [DOC_TITLE]: 1e308 },
    }],
  });
  assert.equal(
    site.registrationApplications[0].documents[DOC_TITLE],
    MAX_DOCUMENT_COPIES_PER_APPLICATION
  );
  assert.equal(
    site.registrationApplications[0].documentInstances.filter(instance => instance.active).length,
    MAX_DOCUMENT_COPIES_PER_APPLICATION
  );
});

test('sanitizeは入力を変更せず、正式v8フィールドだけを型安全に保持する', () => {
  const raw = mappingFixture();
  raw.registrationApplications[0].subject = {
    beforeBuildingIds: ['old', 'old', 3],
    afterBuildingIds: 'invalid',
    landIds: [null, 'land-a'],
    primaryBuildingId: 'not-in-subject',
  };
  raw.registrationApplications[0].details = { nested: { ok: true }, bad: Symbol('drop') };
  const snapshot = JSON.stringify(raw);
  deepFreeze(raw);
  const site = sanitizeSiteData(raw);

  assert.equal(JSON.stringify(raw), snapshot);
  assert.deepEqual(getApplication(site, 'ra-title-a').subject, {
    beforeBuildingIds: ['old'], afterBuildingIds: [], landIds: ['land-a'], primaryBuildingId: null,
  });
  assert.deepEqual(getApplication(site, 'ra-title-a').details, { nested: { ok: true } });
});

test('外部JSONはv7のまま純粋に保ち、v8 shadowを誤って漏らさない', () => {
  const raw = mappingFixture();
  raw.buildings = [{
    id: 'building-with-contractor',
    structMaterial: '木造', structFloor: '平家建',
    floorAreas: [{ id: 'floor-1', floor: '１階', area: '10.00' }],
    contractorPersonIds: ['p-contractor'],
  }];
  raw.registrationApplications[0].details = { internalOnly: true };
  const internalSite = sanitizeSiteData(raw);
  const internalIds = internalSite.registrationApplications.flatMap(ra =>
    ra.documentInstances.map(instance => instance.id)
  );

  const payload = buildExportPayload(
    { activeSiteId: internalSite.id, sites: [internalSite] },
    { exportedAt: '2026-09-14T00:00:00.000Z' }
  );
  const serialized = JSON.parse(JSON.stringify(payload));
  const exportedSite = serialized.sites[0];
  assert.equal(serialized.schemaVersion, 7);
  assert.equal('contractorPersonIds' in exportedSite.buildings[0], false);
  for (const application of exportedSite.registrationApplications) {
    assert.equal('subject' in application, false);
    assert.equal('details' in application, false);
    assert.equal('documentInstances' in application, false);
  }
  // buildExportPayloadはlocal stateを変更しない。
  assert.deepEqual(internalSite.buildings[0].contractorPersonIds, ['p-contractor']);
  assert.ok(internalSite.registrationApplications[0].documentInstances.length > 0);

  // 真のJSON往復後も、v7から再生成可能なIDと旧全文は同じになる。
  const imported = parseImportPayload(serialized).sites[0];
  const importedIds = imported.registrationApplications.flatMap(ra =>
    ra.documentInstances.map(instance => instance.id)
  );
  assert.deepEqual(importedIds, internalIds);
  assert.deepEqual(
    imported.registrationApplications.map(ra => ra.documentInstances),
    internalSite.registrationApplications.map(ra => ra.documentInstances)
  );
  assert.deepEqual(
    imported.docPick[`${DOC_TITLE}__1`].applicantPersonIds,
    internalSite.docPick[`${DOC_TITLE}__1`].applicantPersonIds
  );
  assert.equal(imported.docPick[`${DOC_TITLE}__1`].showMain, false);
  assert.equal(imported.docPick[`${DOC_TITLE}__1`].fontScale, 0);
  assert.equal(imported.docPick[`${DOC_TITLE}__1`].printOn, false);
  assert.equal(
    getApplication(imported, 'ra-title-a').documentInstances[0].detachedHtml,
    raw.docPick[`${DOC_TITLE}__1`].customText
  );
});
