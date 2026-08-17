/**
 * Phase 2B-1B: 共通Core schemaVersion 7（siteLandIds / targetLandIds / variant）の
 * 生成・読込・再出力と、applications ↔ registrationApplications 同期を検証する。
 * 実 API 通信は行わない。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSiteData } from '../src/sanitize.js';
import {
  buildExportPayload,
  parseImportPayload,
  EXPORT_SCHEMA_VERSION,
  EXPORT_APP,
  VARIANT,
} from '../src/jsonTransfer.js';
import {
  syncRegistrationApplications,
  migrateLegacyLandTargets,
} from '../src/registrationApplications.js';
import { APPLICATION_TYPES } from '../src/constants.js';

/** 架空データのみを使う合成案件（土地3・既登記建物1・予定建物1・申請3件）。 */
const casePayload = (schemaVersion = 7, variant = 'standard') => ({
  schemaVersion,
  exportedAt: '2026-01-01T00:00:00.000Z',
  app: 'document-builder-building',
  ...(variant ? { variant } : {}),
  activeSiteId: 'site-1',
  contractors: [{ id: 'c1', address: '架空県架空市', tradeName: '架空工務店', representative: '架空 太郎' }],
  scriveners: [{ id: 'sc1', address: '架空県架空市', name: '架空 花子' }],
  sites: [
    {
      id: 'site-1',
      name: '架空案件',
      address: '架空県架空市架空町',
      contractorId: 'c1',
      scrivenerId: 'sc1',
      land: [
        { id: 'land-A', address: '架空県架空市架空町', lotNumber: '100番1', category: '宅地', area: '123.45', ownerPersonIds: ['p1'] },
        { id: 'land-B', address: '架空県架空市架空町', lotNumber: '100番2', category: '宅地', area: '67.89', ownerPersonIds: ['p1'] },
        { id: 'land-C', address: '架空県架空市架空町', lotNumber: '100番3', category: '畑', area: '10.00', ownerPersonIds: ['p2'] },
      ],
      buildings: [
        {
          id: 'building-A', address: '架空県架空市架空町100番地3', houseNum: '100番3',
          kind: '居宅', structMaterial: '木造', structFloor: '2階建',
          floorAreas: [{ id: 'fa1', floor: '１階', area: '50.00' }],
          ownerPersonIds: ['p2'], siteLandIds: ['land-C'], annexes: [],
        },
      ],
      proposedBuildings: [
        {
          id: 'building-B', address: '架空県架空市架空町100番地1、100番地2', houseNum: '100番1',
          kind: '居宅', structMaterial: '木造', structFloor: '2階建',
          floorAreas: [{ id: 'fa2', floor: '１階', area: '78.66' }],
          ownerPersonIds: ['p1'], siteLandIds: ['land-A', 'land-B'],
          confirmApplicantPersonIds: ['p1'], confirmApplicantNames: ['架空 次郎'], annexes: [],
        },
      ],
      people: [
        { id: 'p1', name: '架空 太郎', address: '架空県架空市', roles: ['申請人'] },
        { id: 'p2', name: '架空 次郎', address: '架空県架空市', roles: ['土地所有者'] },
      ],
      applications: { 建物表題登記: 1, 建物滅失登記: 1, 土地地目変更登記: 1 },
      registrationApplications: [
        { id: 'ra-1', type: '建物表題登記', targetBuildingIds: ['building-B'], targetLandIds: [], applicantPersonIds: ['p1'], documents: { '委任状（表題）': 1 } },
        { id: 'ra-2', type: '建物滅失登記', targetBuildingIds: ['building-A'], targetLandIds: [], applicantPersonIds: ['p2'], documents: { '委任状（滅失）': 1 } },
        { id: 'ra-3', type: '土地地目変更登記', targetBuildingIds: [], targetLandIds: ['land-C'], applicantPersonIds: ['p2'], documents: { '委任状（地目変更）': 1 } },
      ],
      documents: { '委任状（表題）': 1, '委任状（滅失）': 1, '委任状（地目変更）': 1 },
      docPick: { '委任状（住所変更）__1': { targetLandIds: ['land-A'], printOn: true } },
    },
  ],
});

const roundTrip = (payload) => {
  const parsed = parseImportPayload(payload);
  return buildExportPayload(
    {
      activeSiteId: parsed.activeSiteId,
      sites: parsed.sites,
      contractors: parsed.contractors ?? [],
      scriveners: parsed.scriveners ?? [],
    },
    { exportedAt: '2026-01-02T00:00:00.000Z' }
  );
};

const firstSite = (payload) => payload.sites[0];

test('export は schemaVersion 7 / variant standard を出力する', () => {
  const out = roundTrip(casePayload(7));
  assert.equal(out.schemaVersion, 7);
  assert.equal(EXPORT_SCHEMA_VERSION, 7);
  assert.equal(out.variant, VARIANT);
  assert.equal(out.variant, 'standard');
  assert.equal(out.app, EXPORT_APP);
});

test('schemaVersion 6 / 7 の JSON をどちらも警告なしで読み込む', () => {
  for (const version of [6, 7]) {
    const parsed = parseImportPayload(casePayload(version, version === 7 ? 'standard' : null));
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.schemaVersion, version);
  }
});

test('未知の新しい schemaVersion は黙って正常扱いにせず警告する', () => {
  const parsed = parseImportPayload(casePayload(8));
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /schemaVersion 8/);
  // 既知の範囲は読み込める。
  assert.equal(parsed.sites.length, 1);
});

test('siteLandIds は round-trip 後も維持され、address 生成規則は変わらない', () => {
  const out = roundTrip(casePayload());
  const site = firstSite(out);
  assert.deepEqual(site.proposedBuildings[0].siteLandIds, ['land-A', 'land-B']);
  assert.deepEqual(site.buildings[0].siteLandIds, ['land-C']);
  assert.equal(site.proposedBuildings[0].address, '架空県架空市架空町１００番地１、１００番地２');
});

test('siteLandIds が無い旧 JSON は空配列になる', () => {
  const payload = casePayload(6, null);
  delete payload.sites[0].proposedBuildings[0].siteLandIds;
  const out = roundTrip(payload);
  assert.deepEqual(firstSite(out).proposedBuildings[0].siteLandIds, []);
});

test('土地地目変更の targetLandIds は round-trip 後も維持される', () => {
  const out = roundTrip(casePayload());
  const ra = firstSite(out).registrationApplications.find(r => r.id === 'ra-3');
  assert.deepEqual(ra.targetLandIds, ['land-C']);
  assert.deepEqual(ra.targetBuildingIds, []);
});

test('旧形式（土地IDが targetBuildingIds）は安全に targetLandIds へ正規化する', () => {
  const payload = casePayload(6, null);
  payload.sites[0].registrationApplications[2] = {
    id: 'ra-3', type: '土地地目変更登記',
    targetBuildingIds: ['land-C'], targetLandIds: [],
    applicantPersonIds: ['p2'], documents: { '委任状（地目変更）': 1 },
  };
  const out = roundTrip(payload);
  const ra = firstSite(out).registrationApplications.find(r => r.id === 'ra-3');
  assert.deepEqual(ra.targetLandIds, ['land-C']);
  assert.deepEqual(ra.targetBuildingIds, []);
});

test('土地 ID として判別できない場合は旧値を書き換えない', () => {
  const landIds = new Set(['land-C']);
  // land[] に存在しない ID
  assert.deepEqual(
    migrateLegacyLandTargets([{ type: '土地地目変更登記', targetBuildingIds: ['building-A'], targetLandIds: [] }], landIds),
    [{ type: '土地地目変更登記', targetBuildingIds: ['building-A'], targetLandIds: [] }]
  );
  // 既に新形式
  assert.deepEqual(
    migrateLegacyLandTargets([{ type: '土地地目変更登記', targetBuildingIds: ['x'], targetLandIds: ['land-C'] }], landIds),
    [{ type: '土地地目変更登記', targetBuildingIds: ['x'], targetLandIds: ['land-C'] }]
  );
  // 建物系申請は対象外
  assert.deepEqual(
    migrateLegacyLandTargets([{ type: '建物表題登記', targetBuildingIds: ['land-C'], targetLandIds: [] }], landIds),
    [{ type: '建物表題登記', targetBuildingIds: ['land-C'], targetLandIds: [] }]
  );
});

test('複数申請の対象 ID が round-trip で混ざらない', () => {
  const out = roundTrip(casePayload());
  const [ra1, ra2, ra3] = firstSite(out).registrationApplications;
  assert.deepEqual([ra1.type, ra1.targetBuildingIds, ra1.targetLandIds], ['建物表題登記', ['building-B'], []]);
  assert.deepEqual([ra2.type, ra2.targetBuildingIds, ra2.targetLandIds], ['建物滅失登記', ['building-A'], []]);
  assert.deepEqual([ra3.type, ra3.targetBuildingIds, ra3.targetLandIds], ['土地地目変更登記', [], ['land-C']]);
});

test('docPick.targetLandIds は登記申請の targetLandIds と独立している', () => {
  const out = roundTrip(casePayload());
  const site = firstSite(out);
  assert.deepEqual(site.docPick['委任状（住所変更）__1'].targetLandIds, ['land-A']);
  assert.deepEqual(site.registrationApplications[0].targetLandIds, []);
  assert.deepEqual(site.registrationApplications[2].targetLandIds, ['land-C']);
});

test('applications 件数を増やすと既存 RA を保持したまま追加だけ行う', () => {
  const site = sanitizeSiteData(casePayload().sites[0]);
  const applications = { ...site.applications, 建物表題登記: 2 };
  const { next, changed } = syncRegistrationApplications(applications, site.registrationApplications, APPLICATION_TYPES);
  assert.equal(changed, true);
  assert.equal(next.length, 4);
  assert.equal(next[0], site.registrationApplications[0]);
  assert.deepEqual(next[0].targetBuildingIds, ['building-B']);
  assert.deepEqual(next[0].documents, { '委任状（表題）': 1 });
  const added = next[3];
  assert.equal(added.type, '建物表題登記');
  assert.deepEqual(added.targetBuildingIds, []);
  assert.deepEqual(added.targetLandIds, []);
});

test('applications 件数を減らすと削除分だけ除去し、残る RA の情報を保持する', () => {
  const site = sanitizeSiteData(casePayload().sites[0]);
  const grown = syncRegistrationApplications({ ...site.applications, 建物表題登記: 2 }, site.registrationApplications, APPLICATION_TYPES).next;
  const { next, changed } = syncRegistrationApplications(site.applications, grown, APPLICATION_TYPES);
  assert.equal(changed, true);
  assert.deepEqual(next.map(ra => ra.id), site.registrationApplications.map(ra => ra.id));
  assert.deepEqual(next[0].targetBuildingIds, ['building-B']);
  assert.deepEqual(next[0].applicantPersonIds, ['p1']);
  assert.deepEqual(next[0].documents, { '委任状（表題）': 1 });
  assert.deepEqual(next[2].targetLandIds, ['land-C']);
});

test('applications 件数が変わらなければ RA オブジェクトをそのまま保つ', () => {
  const site = sanitizeSiteData(casePayload().sites[0]);
  const { next, changed } = syncRegistrationApplications(site.applications, site.registrationApplications, APPLICATION_TYPES);
  assert.equal(changed, false);
  assert.deepEqual(next, site.registrationApplications);
});

test('石友版 v7 JSON を読み込んでも共通Coreを失わない（variant は自版の値で再出力）', () => {
  const ishitomo = casePayload(7, 'ishitomo');
  const out = roundTrip(ishitomo);
  const site = firstSite(out);
  assert.equal(out.variant, 'standard');
  assert.equal(out.schemaVersion, 7);
  assert.deepEqual(site.proposedBuildings[0].siteLandIds, ['land-A', 'land-B']);
  assert.deepEqual(site.registrationApplications.map(ra => ra.targetLandIds), [[], [], ['land-C']]);
  assert.deepEqual(site.registrationApplications.map(ra => ra.targetBuildingIds), [['building-B'], ['building-A'], []]);
  assert.deepEqual(site.people.map(p => p.id), ['p1', 'p2']);
});

test('定義していない未知フィールドは pass-through しない', () => {
  const payload = casePayload();
  payload.sites[0].unknownSiteField = 'x';
  payload.sites[0].land[0].unknownLandField = 'x';
  payload.sites[0].proposedBuildings[0].unknownBuildingField = 'x';
  payload.sites[0].registrationApplications[0].unknownRaField = 'x';
  const site = firstSite(roundTrip(payload));
  assert.equal('unknownSiteField' in site, false);
  assert.equal('unknownLandField' in site.land[0], false);
  assert.equal('unknownBuildingField' in site.proposedBuildings[0], false);
  assert.equal('unknownRaField' in site.registrationApplications[0], false);
});

test('型が不正な値は既定値へ倒す（推測しない）', () => {
  const site = sanitizeSiteData({
    id: 's', name: 'x',
    land: [{ id: 'land-A' }],
    proposedBuildings: [{ id: 'b1', siteLandIds: ['land-A', 42, null] }],
    registrationApplications: [{ id: 'ra', type: '建物表題登記', targetLandIds: 'land-A', documents: null }],
  });
  assert.deepEqual(site.proposedBuildings[0].siteLandIds, ['land-A']);
  assert.deepEqual(site.registrationApplications[0].targetLandIds, []);
  assert.deepEqual(site.registrationApplications[0].documents, {});
});

test('2回 round-trip しても安定する', () => {
  const once = roundTrip(casePayload());
  const twice = roundTrip(once);
  assert.deepEqual(twice.sites, once.sites);
});
