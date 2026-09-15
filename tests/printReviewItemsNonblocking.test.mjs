import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildDocumentContextsForInstances,
  getDocumentContextPrintBlockers,
} from '../src/documentContext.js';
import { getDocumentTemplateKey } from '../src/v8Compatibility.js';

// 要確認事項は注意情報であり、印刷パネル表示・個別印刷/PDF保存の停止条件にしない（2026-09-15 Decision）。
const docsSource = readFileSync(new URL('../src/components/Docs/Docs.jsx', import.meta.url), 'utf8');

const sliceBetween = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} が見つかりません`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `${end} が見つかりません`);
  return source.slice(from, to);
};

test('個別印刷は要確認事項を理由に停止しない', () => {
  const body = sliceBetween(docsSource, 'const printSingleDoc = ', 'const applicantsInPeople');
  assert.doesNotMatch(body, /blockingPrintInstances|getDocumentContextPrintBlockers|canPrint/);
  assert.match(body, /ポップアップがブロックされました/);
});

test('印刷実行ボタンは要確認事項を理由に印刷パネルを止めない', () => {
  const handler = sliceBetween(docsSource, '印刷対象がありません。', 'setShowPrintPanel(true)');
  assert.doesNotMatch(handler, /blockingPrintInstances|getDocumentContextPrintBlockers|canPrint/);
  assert.doesNotMatch(docsSource, /未解決の確認項目があります/);
});

test('印刷対象の選定は印刷ON/OFFだけで決まり、要確認事項で除外しない', () => {
  const line = docsSource.split('\n').find(item => item.includes('const printInstances = useMemo'));
  assert.ok(line);
  assert.match(line, /printOn \?\? true/);
  assert.doesNotMatch(line, /blockingPrintInstances|getDocumentContextPrintBlockers|canPrint|issues/);
});

const building = (id) => ({
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
  ownerPersonIds: ['p1'],
  contractorPersonIds: [],
});

const docInstance = (id) => ({
  id,
  templateKey: getDocumentTemplateKey('委任状（表題）'),
  documentName: '委任状（表題）',
  copyIndex: 1,
  printEnabled: true,
  selectionOverrides: {},
  contentOverrides: { blocks: {}, fields: {} },
  layoutOverrides: {},
  editMode: 'linked',
  detachedHtml: null,
});

const application = (id, buildingId, personId, documentId) => ({
  id,
  type: '建物表題登記',
  targetBuildingIds: [buildingId],
  targetLandIds: [],
  applicantPersonIds: [personId],
  subject: { beforeBuildingIds: [], afterBuildingIds: [buildingId], landIds: [], primaryBuildingId: null },
  documents: {},
  documentInstances: [docInstance(documentId)],
});

test('要確認あり/なし混在でも確認情報は残り、算出処理は案件データを変更しない', () => {
  const site = {
    id: 'site-1',
    people: [
      { id: 'p1', name: '架空 太郎', address: '架空県架空市', roles: ['建物所有者'], share: '1', shareOverrides: {} },
      { id: 'p2', name: '架空 花子', address: '架空県架空市', roles: ['その他'], share: '1', shareOverrides: {} },
    ],
    proposedBuildings: [building('b1')],
    registrationApplications: [
      application('ra-valid', 'b1', 'p1', 'doc-valid'),
      application('ra-invalid', 'missing', 'p2', 'doc-invalid'),
    ],
    docPick: {
      '委任状（表題）__1': { printOn: true },
      '委任状（表題）__2': { printOn: true, customText: null },
    },
  };
  const instances = [
    { name: '委任状（表題）', key: '委任状（表題）__1', identity: 'valid', raId: 'ra-valid', copyIndex: 1 },
    { name: '委任状（表題）', key: '委任状（表題）__2', identity: 'invalid', raId: 'ra-invalid', copyIndex: 1 },
  ];
  const snapshot = structuredClone(site);

  const contexts = buildDocumentContextsForInstances({ site, instances });
  const blockers = getDocumentContextPrintBlockers({ instances, contextsByIdentity: contexts, docPick: site.docPick });

  assert.deepEqual(blockers.map(item => item.identity), ['invalid']);
  assert.ok(contexts.invalid.issues.some(issue => issue.severity === 'blocking'));
  assert.equal(contexts.invalid.status, 'review-required');
  assert.deepEqual(site, snapshot);

  // Docs.jsx と同じ条件: 印刷対象は printOn のみで決まり、要確認の書類も含まれる。
  const printInstances = instances.filter(inst => (site.docPick?.[inst.key]?.printOn ?? true));
  assert.deepEqual(printInstances.map(item => item.identity), ['valid', 'invalid']);

  site.docPick['委任状（表題）__2'].printOn = false;
  assert.deepEqual(
    instances.filter(inst => (site.docPick?.[inst.key]?.printOn ?? true)).map(item => item.identity),
    ['valid']
  );
});
