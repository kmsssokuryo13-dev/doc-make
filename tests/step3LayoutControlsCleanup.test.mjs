import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

import { buildDocumentContext } from '../src/documentContext.js';
import {
  getDocumentTemplateKey,
  LEGACY_DOCUMENT_PICK_DEFAULTS,
  reconcileSiteDocumentCompatibility,
} from '../src/v8Compatibility.js';
import {
  buildStampPositionResetPatch,
  canRelinkDocumentText,
  hasAnyStampAdjustment,
  hasStampPositionAdjustment,
} from '../src/documentLayoutUi.js';

// Step3 P4（2026-09-15 Decision）: 二次操作をレイアウト調整へ退避し、通常UIを確認中心にする。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS_SOURCE = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'step3-p4-tests');
mkdirSync(CACHE_DIR, { recursive: true });

const TARGET_DOCUMENTS = ['委任状（表題）', '工事完了引渡証明書（表題）', '申述書（共有）', '申述書（単独）'];
const RA_ID = 'ra-1';

// ---- 実React(SSR)でDocTemplateの印影位置反映を確認する ----
const realReact = await (async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { DocTemplate } from './src/components/DocTemplate/DocTemplate.jsx';
        export { React, renderToStaticMarkup, DocTemplate };
      `,
      resolveDir: ROOT,
      loader: 'jsx',
      sourcefile: 'p4-real-react.jsx',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    jsx: 'transform',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/*'],
  });
  const file = path.join(CACHE_DIR, 'p4-real-react.mjs');
  writeFileSync(file, result.outputFiles[0].text);
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
})();

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
  confirmationCert: { rNo: '01', code: '架空県知事', number: '123', date: { era: '令和', year: '8', month: '1', day: '2' } },
  confirmApplicantPersonIds: ['p1'],
  confirmApplicantNames: [],
});

const makeSite = ({ docPick = {} } = {}) => reconcileSiteDocumentCompatibility({
  id: 'site-1',
  people: [
    person('p1', '架空 太郎', ['申請人']),
    person('p2', '架空 花子', ['申請人']),
    person('c1', '架空工務店', ['工事人'], ''),
  ],
  proposedBuildings: [building('b1', '101番1')],
  land: [],
  buildings: [],
  registrationApplications: [{
    id: RA_ID,
    type: '建物表題登記',
    targetBuildingIds: ['b1'],
    targetLandIds: [],
    applicantPersonIds: ['p1', 'p2'],
    subject: { beforeBuildingIds: [], afterBuildingIds: ['b1'], landIds: [], primaryBuildingId: null },
    documents: Object.fromEntries([...TARGET_DOCUMENTS, '委任状（保存）'].map(n => [n, 1])),
  }],
  docPick,
});

const findInstance = (site, documentName) => {
  const application = (site.registrationApplications || []).find(ra => ra.id === RA_ID);
  const templateKey = getDocumentTemplateKey(documentName);
  return (application?.documentInstances || []).find(i => i.templateKey === templateKey && i.copyIndex === 1) || null;
};

const contextFor = (site, documentName) => buildDocumentContext({
  site,
  application: (site.registrationApplications || []).find(ra => ra.id === RA_ID),
  documentInstance: findInstance(site, documentName),
  documentName,
  now: new Date('2026-09-15T00:00:00.000Z'),
});

// Docs.jsx の handlePickChange と同じ経路。
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

const pickOf = (site, documentName) => site.docPick?.[`${documentName}__1`] || {};

// Docs.jsx の handleStampPosChange / handleSignerStampPosChange と同じ更新規則。
const dragStamp = (site, documentName, key, index, dx, dy) => {
  const current = pickOf(site, documentName);
  const list = Array.isArray(current[key]) ? current[key] : [];
  const next = list.filter(p => p?.i !== index);
  next.push({ i: index, dx, dy });
  return applyPick(site, documentName, { [key]: next });
};

const renderDoc = ({ site, documentName, isPrint = false }) => {
  const { React, renderToStaticMarkup, DocTemplate } = realReact;
  return renderToStaticMarkup(React.createElement(DocTemplate, {
    name: documentName,
    siteData: site,
    instanceKey: `${documentName}__1`,
    instanceIndex: 1,
    pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...pickOf(site, documentName) },
    isPrint,
    scriveners: [],
    documentContext: contextFor(site, documentName),
  }));
};

// ---------------------------------------------------------------------------

test('1. 対象4帳票のread-only時はfont-size controlもhintも出さない', () => {
  // P4でヒント自体を撤去し、read-only分岐はnullを返す。
  assert.doesNotMatch(DOCS_SOURCE, /data-testid="font-size-control-hint"/);
  assert.doesNotMatch(DOCS_SOURCE, /文字サイズを個別調整する場合は全文編集を開始してください/);
  const guard = DOCS_SOURCE.indexOf('shouldShowFontSizeControl({ documentName: activeInstance.name, textEditingEnabled: isTextEditing })');
  const shown = DOCS_SOURCE.indexOf('data-testid="font-size-control"');
  assert.ok(guard !== -1 && shown !== -1 && guard < shown);
  assert.match(DOCS_SOURCE.slice(guard, shown), /return null;/);
});

test('2. 全文編集開始時だけ「選択文字のサイズ」を表示する', () => {
  assert.match(DOCS_SOURCE, /data-testid="font-size-control"/);
  assert.match(DOCS_SOURCE, /'選択文字のサイズ' : '文字サイズ（選択テキスト）'/);
  assert.match(DOCS_SOURCE, /本文中の文字を選択してからサイズを変更/);
  // 全文編集の開始/再開/終了は維持。
  assert.match(DOCS_SOURCE, /全文編集を開始/);
  assert.match(DOCS_SOURCE, /全文編集を再開/);
  assert.match(DOCS_SOURCE, /編集を終了/);
});

test('3. 選択文字サイズ変更は従来どおりcustomText/detachedを保存する', () => {
  const name = '委任状（表題）';
  const site = applyPick(makeSite(), name, { fontScale: 100, customText: '<p><span style="font-size: 108%;">架空</span></p>' });
  const instance = findInstance(site, name);
  assert.ok(['detached', 'legacy-detached'].includes(instance.editMode));
  assert.match(instance.detachedHtml || '', /font-size: 108%/);
  // 適用patchの形は現行P1のまま。
  assert.match(DOCS_SOURCE, /handlePickChange\(activeInstanceKey, \{ \.\.\.decision\.patch, customText: customHtml \}\);/);
});

test('4. 全文編集を無変更で終了するとlinkedのまま', () => {
  const name = '委任状（表題）';
  const site = makeSite();
  assert.equal(findInstance(site, name).editMode, 'linked');
  const untouched = applyPick(site, name, { printOn: true });
  assert.equal(findInstance(untouched, name).editMode, 'linked');
  assert.equal(findInstance(untouched, name).detachedHtml, null);
});

test('5. 対象4帳票はlinked+customTextなしで「文言をリセット」を出さない', () => {
  TARGET_DOCUMENTS.forEach(name => {
    const context = contextFor(makeSite(), name);
    assert.equal(context.editMode, 'linked', name);
    assert.equal(canRelinkDocumentText({ editMode: 'linked', hasCustomText: false }), false, name);
  });
  // 表示ガードがusesSelectionCleanupとcanRelinkDocumentTextで覆われている。
  assert.match(
    DOCS_SOURCE,
    /const showResetText = !usesSelectionCleanup \|\| canRelinkDocumentText\(\{[\s\S]*?editMode: activeDocumentContext\?\.editMode,[\s\S]*?hasCustomText: !isBlankDocumentHtml\(activePick\.customText\),[\s\S]*?\}\);/
  );
  assert.match(DOCS_SOURCE, /\{showResetText && \(/);
  // 二次操作が全て非表示なら区切り枠ごと出さない。
  assert.match(
    DOCS_SOURCE,
    /if \(!showDetachedAck && !showOverrideAck && !showResetText && !showResetStamps\) return null;/
  );
});

test('6. detached等では「最新データ連動へ切替」を維持する', () => {
  ['detached', 'legacy-detached'].forEach(editMode => {
    assert.equal(canRelinkDocumentText({ editMode, hasCustomText: true }), true, editMode);
    assert.equal(canRelinkDocumentText({ editMode, hasCustomText: false }), true, editMode);
  });
  // linkedでもcustomTextが残っていれば戻せる。
  assert.equal(canRelinkDocumentText({ editMode: 'linked', hasCustomText: true }), true);

  const name = '委任状（表題）';
  const detached = applyPick(makeSite(), name, { customText: '<p>固定本文</p>' });
  const context = contextFor(detached, name);
  assert.notEqual(context.editMode, 'linked');
  assert.equal(canRelinkDocumentText({ editMode: context.editMode, hasCustomText: true }), true);
  assert.match(DOCS_SOURCE, /最新データ連動へ切替/);
  assert.match(DOCS_SOURCE, /data-testid="reset-document-text"/);
});

test('7. レイアウト調整は通常閉じており、永続保存しない', () => {
  assert.match(DOCS_SOURCE, /const \[layoutSettingsOpen, setLayoutSettingsOpen\] = useState\(false\);/);
  assert.match(DOCS_SOURCE, /data-testid="document-layout-settings"/);
  assert.match(DOCS_SOURCE, /data-testid="layout-settings-toggle"/);
  // 書類切替・Step移動で閉じる。
  assert.match(
    DOCS_SOURCE,
    /setLayoutSettingsOpen\(false\);\s*\n\s*\}, \[activeInstanceId, step\]\);/
  );
  // 折りたたみ状態をpatchとして保存していない。
  const panel = DOCS_SOURCE.slice(
    DOCS_SOURCE.indexOf('data-testid="document-layout-settings"'),
    DOCS_SOURCE.indexOf('data-testid="layout-settings-body"')
  );
  assert.doesNotMatch(panel, /handlePickChange/);
});

test('8. 位置未調整なら「位置調整あり」もresetボタンも出さない', () => {
  // 既定はnull。
  assert.equal(LEGACY_DOCUMENT_PICK_DEFAULTS.stampPositions, null);
  assert.equal(LEGACY_DOCUMENT_PICK_DEFAULTS.signerStampPositions, null);
  assert.equal(hasAnyStampAdjustment({}), false);
  assert.equal(hasAnyStampAdjustment({ stampPositions: null, signerStampPositions: null }), false);
  assert.equal(hasStampPositionAdjustment([]), false);
  // 原点へ戻した結果の {dx:0,dy:0} は「調整なし」扱い。
  assert.equal(hasStampPositionAdjustment([{ i: 0, dx: 0, dy: 0 }]), false);
  assert.equal(hasAnyStampAdjustment({ stampPositions: [{ i: 0, dx: 0, dy: 0 }] }), false);

  TARGET_DOCUMENTS.forEach(name => {
    assert.equal(hasAnyStampAdjustment(pickOf(makeSite(), name)), false, name);
  });
  // badgeとresetは stampAdjusted の下にある。
  assert.match(DOCS_SOURCE, /\{stampAdjusted && \(/);
  assert.match(DOCS_SOURCE, /\{stampAdjusted \? \(/);
  assert.match(DOCS_SOURCE, /現在、位置の調整はありません。/);
});

test('9. 位置を動かして保存すると「位置調整あり」になる', () => {
  const name = '委任状（表題）';
  const dragged = dragStamp(makeSite(), name, 'stampPositions', 0, 12, -8);
  assert.deepEqual(pickOf(dragged, name).stampPositions, [{ i: 0, dx: 12, dy: -8 }]);
  assert.equal(hasAnyStampAdjustment(pickOf(dragged, name)), true);

  // 署名者側だけでも判定される。
  const signer = dragStamp(makeSite(), name, 'signerStampPositions', 1, 0, 5);
  assert.equal(hasAnyStampAdjustment(pickOf(signer, name)), true);
  assert.equal(hasStampPositionAdjustment([{ i: 0, dx: 0, dy: 0 }, { i: 1, dx: 0, dy: 5 }]), true);
});

test('10. 位置resetはstampPositions/signerStampPositionsだけを初期化する', () => {
  assert.deepEqual(buildStampPositionResetPatch(), { stampPositions: null, signerStampPositions: null });

  const name = '委任状（表題）';
  let site = dragStamp(makeSite(), name, 'stampPositions', 0, 12, -8);
  site = dragStamp(site, name, 'signerStampPositions', 0, 3, 4);
  assert.equal(hasAnyStampAdjustment(pickOf(site, name)), true);

  const reset = applyPick(site, name, buildStampPositionResetPatch());
  assert.equal(pickOf(reset, name).stampPositions, null);
  assert.equal(pickOf(reset, name).signerStampPositions, null);
  assert.equal(hasAnyStampAdjustment(pickOf(reset, name)), false);
  // layoutOverrides側からも外れる。
  const layout = findInstance(reset, name).layoutOverrides || {};
  assert.equal(hasStampPositionAdjustment(layout.stampPositions), false);
  assert.equal(hasStampPositionAdjustment(layout.signerStampPositions), false);
});

test('11. 位置resetはcustomText/selectionOverrides/案件データを変更しない', () => {
  const name = '委任状（表題）';
  let site = applyPick(makeSite(), name, { customText: '<p>固定本文</p>' });
  site = applyPick(site, name, { applicantPersonIds: ['p2'] });
  site = dragStamp(site, name, 'stampPositions', 0, 10, 10);

  const before = findInstance(site, name);
  const beforeSnapshot = {
    editMode: before.editMode,
    detachedHtml: before.detachedHtml,
    selectionOverrides: JSON.stringify(before.selectionOverrides),
    baselines: JSON.stringify(before.selectionOverrideBaselines),
    people: JSON.stringify(site.people),
    buildings: JSON.stringify(site.proposedBuildings),
    application: JSON.stringify({
      ...site.registrationApplications[0],
      documentInstances: undefined,
    }),
  };

  const reset = applyPick(site, name, buildStampPositionResetPatch());
  const after = findInstance(reset, name);
  assert.equal(after.editMode, beforeSnapshot.editMode);
  assert.equal(after.detachedHtml, beforeSnapshot.detachedHtml);
  assert.equal(JSON.stringify(after.selectionOverrides), beforeSnapshot.selectionOverrides);
  assert.equal(JSON.stringify(after.selectionOverrideBaselines), beforeSnapshot.baselines);
  assert.equal(JSON.stringify(reset.people), beforeSnapshot.people);
  assert.equal(JSON.stringify(reset.proposedBuildings), beforeSnapshot.buildings);
  assert.equal(
    JSON.stringify({ ...reset.registrationApplications[0], documentInstances: undefined }),
    beforeSnapshot.application
  );
  // customTextも維持。
  assert.equal(pickOf(reset, name).customText, '<p>固定本文</p>');
  // patchはstamp2キーのみ。
  assert.deepEqual(Object.keys(buildStampPositionResetPatch()).sort(), ['signerStampPositions', 'stampPositions']);
});

test('12. preview上のドラッグ保存規則に回帰がない', () => {
  // Docs.jsxのhandlerは i でフィルタして push する既存方式のまま。
  assert.match(DOCS_SOURCE, /const next = list\.filter\(p => p\?\.i !== index\);\s*\n\s*next\.push\(\{ i: index, dx: nextDx, dy: nextDy \}\);/);
  assert.match(DOCS_SOURCE, /handlePickChange\(activeInstanceKey, \{ stampPositions: next \}\)/);
  assert.match(DOCS_SOURCE, /handlePickChange\(activeInstanceKey, \{ signerStampPositions: next \}\)/);

  // 同じindexを動かすと上書きされ、別indexは共存する。
  const name = '申述書（共有）';
  let site = dragStamp(makeSite(), name, 'stampPositions', 0, 5, 5);
  site = dragStamp(site, name, 'stampPositions', 1, 7, 7);
  site = dragStamp(site, name, 'stampPositions', 0, 9, 9);
  const list = pickOf(site, name).stampPositions;
  assert.equal(list.length, 2);
  assert.deepEqual(list.find(p => p.i === 0), { i: 0, dx: 9, dy: 9 });
  assert.deepEqual(list.find(p => p.i === 1), { i: 1, dx: 7, dy: 7 });
});

test('13. 保存済み位置がpreviewとprintの両方へ反映される', () => {
  const name = '委任状（表題）';
  const site = dragStamp(makeSite(), name, 'stampPositions', 0, 13, -17);

  // 上部印影は top:calc(8mm + dy) / right:calc(20mm - dx) として出力される。
  const adjusted = /top:calc\(8mm \+ -17px\);right:calc\(20mm - 13px\)/;
  const preview = renderDoc({ site, documentName: name });
  const print = renderDoc({ site, documentName: name, isPrint: true });
  assert.match(preview, adjusted);
  assert.match(print, adjusted);
  // printでもドラッグ操作は無効化されるが座標は同じ。
  assert.doesNotMatch(print, /class="stamp-circle stamp-drag-handle/);

  // 署名者印影は left/top のpxとして出力される。
  const signerSite = dragStamp(site, name, 'signerStampPositions', 1, 6, 9);
  const signerAdjusted = /left:6px;top:9px/;
  assert.match(renderDoc({ site: signerSite, documentName: name }), signerAdjusted);
  assert.match(renderDoc({ site: signerSite, documentName: name, isPrint: true }), signerAdjusted);

  // reset後は両方から消える。
  const reset = applyPick(signerSite, name, buildStampPositionResetPatch());
  assert.doesNotMatch(renderDoc({ site: reset, documentName: name }), adjusted);
  assert.doesNotMatch(renderDoc({ site: reset, documentName: name, isPrint: true }), adjusted);
  assert.doesNotMatch(renderDoc({ site: reset, documentName: name }), signerAdjusted);
  assert.doesNotMatch(renderDoc({ site: reset, documentName: name, isPrint: true }), signerAdjusted);
});

test('14. P1/P2/P3のUIに回帰がない', () => {
  // P1
  assert.match(DOCS_SOURCE, /data-testid="fulltext-edit-control"/);
  assert.match(DOCS_SOURCE, /setTextEditInstanceId/);
  // P2
  assert.match(DOCS_SOURCE, /data-testid="document-detail-settings"/);
  assert.match(DOCS_SOURCE, /data-testid="reset-target-building"/);
  assert.match(DOCS_SOURCE, /data-testid="detail-settings-active-badge"/);
  // P3
  assert.match(DOCS_SOURCE, /data-testid="summary-no-issues"/);
  assert.match(DOCS_SOURCE, /data-testid="summary-issue-guidance"/);
  assert.match(DOCS_SOURCE, /issue-action-\$\{item\.guidance\.kind\}/);
  // P3のacknowledgeボタンはレイアウト調整へ移していない。
  const layoutPanel = DOCS_SOURCE.slice(DOCS_SOURCE.indexOf('data-testid="document-layout-settings"'));
  assert.doesNotMatch(layoutPanel.slice(0, layoutPanel.indexOf('</div>')), /確認済みにする/);
  assert.match(DOCS_SOURCE, /現在の全文を確認済みにする/);
  assert.match(DOCS_SOURCE, /現在の個別設定を確認済みにする/);
});

test('15. 非対象帳票の既存font-size / resetUIに回帰がない', () => {
  // 非対象帳票は従来の文字サイズUIと位置リセットを維持する。
  assert.match(DOCS_SOURCE, /'文字サイズ（選択テキスト）'/);
  assert.match(DOCS_SOURCE, /'テキストを選択してからサイズを変更'/);
  assert.match(DOCS_SOURCE, /const showResetStamps = !usesSelectionCleanup;/);
  assert.match(
    DOCS_SOURCE,
    /\{showResetStamps && \(\s*\n\s*<button onClick=\{\(\) => handlePickChange\(activeInstanceKey, buildStampPositionResetPatch\(\)\)\}/
  );
  // legacy fontScaleのフォールバック保存も維持。
  assert.match(DOCS_SOURCE, /if \(decision\.patch\) handlePickChange\(activeInstanceKey, decision\.patch\);/);
  // fontScaleのrenderは追加していない。
  const templateSource = readFileSync(path.join(ROOT, 'src/components/DocTemplate/DocTemplate.jsx'), 'utf8');
  assert.doesNotMatch(templateSource, /fontScale/);
});

test('16. 要確認があっても印刷を止めない', () => {
  assert.match(DOCS_SOURCE, /要確認事項は注意情報として表示するのみで、印刷\/PDF保存の停止条件にはしない。/);
  assert.match(DOCS_SOURCE, /（出力は可能です）/);
  const site = makeSite();
  TARGET_DOCUMENTS.forEach(name => {
    assert.equal(findInstance(site, name).printEnabled, true, name);
  });
});
