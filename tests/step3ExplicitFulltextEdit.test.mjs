import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

import { buildDocumentContext } from '../src/documentContext.js';
import {
  canApplySelectionFontSize,
  canFallbackToDocumentFontScale,
  isDocumentBodyEditable,
  isExplicitTextEditDocument,
  resolveFontSizeChange,
  shouldShowFontSizeControl,
} from '../src/documentTextEditing.js';
import {
  getDocumentTemplateKey,
  reconcileSiteDocumentCompatibility,
} from '../src/v8Compatibility.js';

// Step3 P1（2026-09-15 Decision）: 建物表題4帳票の本文編集は明示的な全文編集中だけ許可する。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'step3-fulltext-tests');
mkdirSync(CACHE_DIR, { recursive: true });

const TARGET_DOCUMENTS = ['委任状（表題）', '工事完了引渡証明書（表題）', '申述書（共有）', '申述書（単独）'];

const bundleModule = async (name, contents, plugins = [], external = []) => {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'jsx', sourcefile: `${name}.jsx` },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    jsx: 'transform',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    logLevel: 'silent',
    plugins,
    external,
  });
  const file = path.join(CACHE_DIR, `${name}.mjs`);
  writeFileSync(file, result.outputFiles[0].text);
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
};

// ---- 実React（SSR）でDocTemplateの描画を確認する ----
const realReact = await bundleModule('real-react', `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { DocTemplate } from './src/components/DocTemplate/DocTemplate.jsx';
  export { React, renderToStaticMarkup, DocTemplate };
`, [], ['react', 'react-dom', 'react-dom/*']);

// ---- Hook呼び出し順を検査する最小のReact代替でEditableDocBodyを動かす ----
const FAKE_REACT = path.join(CACHE_DIR, 'fake-react.mjs');
writeFileSync(FAKE_REACT, `
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
let current = null;
const slot = (kind) => {
  const index = current.index++;
  current.calls.push(kind);
  const prev = current.hooks[index];
  if (prev && prev.kind !== kind) throw new Error('Hook order changed at ' + index + ': ' + prev.kind + ' -> ' + kind);
  return index;
};
export const useRef = (initial) => {
  const i = slot('ref');
  if (!current.hooks[i]) current.hooks[i] = { kind: 'ref', value: { current: initial } };
  return current.hooks[i].value;
};
export const useCallback = (fn, deps) => {
  const i = slot('callback');
  const hook = current.hooks[i];
  if (!hook || !same(hook.deps, deps)) current.hooks[i] = { kind: 'callback', value: fn, deps };
  return current.hooks[i].value;
};
const effectHook = (kind, queueName) => (fn, deps) => {
  const i = slot(kind);
  const hook = current.hooks[i] || { kind };
  current.hooks[i] = hook;
  if (hook.mounted && deps !== undefined && same(hook.deps, deps)) return;
  current[queueName].push(() => {
    if (typeof hook.cleanup === 'function') hook.cleanup();
    const cleanup = fn();
    hook.cleanup = typeof cleanup === 'function' ? cleanup : null;
    hook.deps = deps;
    hook.mounted = true;
  });
};
export const useEffect = effectHook('effect', 'effects');
export const useLayoutEffect = effectHook('layout', 'layoutEffects');
export const useMemo = (fn) => fn();
export const Fragment = Symbol('Fragment');
export const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children } });
export const createInstance = () => ({ hooks: [], lastCalls: null });
export const renderInstance = (instance, Component, props) => {
  instance.index = 0;
  instance.calls = [];
  instance.effects = [];
  instance.layoutEffects = [];
  current = instance;
  let output;
  try { output = Component(props); } finally { current = null; }
  if (instance.lastCalls && instance.lastCalls.join() !== instance.calls.join()) {
    throw new Error('Rendered a different hook sequence: ' + instance.lastCalls.join() + ' -> ' + instance.calls.join());
  }
  instance.lastCalls = instance.calls;
  instance.layoutEffects.forEach(run => run());
  instance.effects.forEach(run => run());
  return output;
};
export const unmountInstance = (instance) => {
  instance.hooks.forEach(hook => { if (typeof hook?.cleanup === 'function') hook.cleanup(); });
};
export default { createElement, Fragment };
`);

const fakeReactPlugin = {
  name: 'fake-react',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react$/ }, () => ({ path: FAKE_REACT }));
  },
};
const hookHarness = await bundleModule('editable-doc-body-harness', `
  export { EditableDocBody } from './src/components/DocTemplate/EditableDocBody.jsx';
  export { createInstance, renderInstance, unmountInstance } from 'react';
`, [fakeReactPlugin]);

const findElement = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (node.props && predicate(node)) return node;
  return findElement(node.props?.children, predicate);
};
const editableElement = (tree) => findElement(tree, node => typeof node.props.onInput === 'function');
const attachFakeDom = (element, html) => {
  element.props.ref.current = {
    cloneNode: () => ({ innerHTML: html, querySelectorAll: () => [] }),
  };
};

// ---- 架空データ ----
const person = (id, name, roles, patch = {}) => ({
  id, name, address: `架空県架空市${name}町`, roles, share: '1/2', shareOverrides: {}, ...patch,
});
const building = {
  id: 'b1',
  address: '架空県架空市一丁目1番地',
  houseNum: '1番',
  kind: '居宅',
  struct: '木造２階建',
  structMaterial: '木造',
  structFloor: '２階建',
  floorAreas: [{ id: 'f1', floor: '１階', area: '50.00' }],
  registrationCause: '新築',
  registrationDate: { era: '令和', year: '8', month: '1', day: '2' },
  additionalCauses: [],
  annexes: [],
  ownerPersonIds: ['p1', 'p2'],
  contractorPersonIds: ['c1'],
  confirmationCert: { rNo: '01', code: '確認建築架空', number: '123', date: { era: '令和', year: '8', month: '1', day: '2' } },
  confirmApplicantPersonIds: ['p1'],
  confirmApplicantNames: [],
};
const baseSite = () => ({
  id: 'site-1',
  people: [
    person('p1', '架空 太郎', ['申請人']),
    person('p2', '架空 花子', ['申請人']),
    person('c1', '架空工務店', ['工事人'], { share: '' }),
  ],
  proposedBuildings: [building],
  land: [],
  buildings: [],
});

const contextFor = (site, documentName, instancePatch = {}) => {
  const applicantPersonIds = documentName === '申述書（単独）' ? ['p1'] : ['p1', 'p2'];
  const documentInstance = {
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
    ...instancePatch,
  };
  const application = {
    id: 'ra-1',
    type: '建物表題登記',
    targetBuildingIds: ['b1'],
    targetLandIds: [],
    applicantPersonIds,
    subject: { beforeBuildingIds: [], afterBuildingIds: ['b1'], landIds: [], primaryBuildingId: null },
    documents: { [documentName]: 1 },
    documentInstances: [documentInstance],
  };
  return buildDocumentContext({
    site: { ...site, registrationApplications: [application] },
    application,
    documentInstance,
    documentName,
    now: new Date('2026-09-15T00:00:00.000Z'),
  });
};

const renderDoc = ({ documentName, site = baseSite(), pick = {}, isPrint = false, textEditingEnabled, onPickChange }) => {
  const { React, renderToStaticMarkup, DocTemplate } = realReact;
  const context = contextFor(site, documentName, typeof pick.customText === 'string'
    ? { editMode: 'legacy-detached', detachedHtml: pick.customText }
    : {});
  return renderToStaticMarkup(React.createElement(DocTemplate, {
    name: documentName,
    siteData: site,
    instanceKey: `${documentName}__1`,
    instanceIndex: 1,
    pick: { customText: null, printOn: true, ...pick },
    onPickChange,
    isPrint,
    scriveners: [],
    documentContext: context,
    ...(textEditingEnabled === undefined ? {} : { textEditingEnabled }),
  }));
};

test('対象は建物表題4帳票だけで、他帳票は現行どおり常時編集可能', () => {
  TARGET_DOCUMENTS.forEach(name => assert.equal(isExplicitTextEditDocument(name), true, name));
  ['委任状（保存）', '委任状（住所変更）', '売渡証明書', '非登載証明書'].forEach(name => {
    assert.equal(isExplicitTextEditDocument(name), false, name);
    assert.equal(isDocumentBodyEditable({ documentName: name }), true, name);
    assert.equal(isDocumentBodyEditable({ documentName: name, isPrint: true }), false, name);
  });
  TARGET_DOCUMENTS.forEach(name => {
    assert.equal(isDocumentBodyEditable({ documentName: name }), false, name);
    assert.equal(isDocumentBodyEditable({ documentName: name, textEditingEnabled: true }), true, name);
    assert.equal(isDocumentBodyEditable({ documentName: name, isPrint: true, textEditingEnabled: true }), false, name);
  });
});

test('1. linkedの通常プレビューは4帳票ともread-onlyでcustomTextを生成しない', () => {
  for (const documentName of TARGET_DOCUMENTS) {
    const calls = [];
    const html = renderDoc({ documentName, onPickChange: patch => calls.push(patch) });
    assert.doesNotMatch(html, /contenteditable="true"/, documentName);
    assert.match(html, /架空県架空市一丁目1番地/, documentName);
    assert.deepEqual(calls, [], documentName);
  }
  // 非対象帳票の本文は従来どおり編集可能のまま。
  const legacyHtml = renderDoc({ documentName: '委任状（保存）' });
  assert.match(legacyHtml, /contenteditable="true"/);
});

test('2. 全文編集を開始しただけでは本文を保存せずlinkedのまま', () => {
  for (const documentName of TARGET_DOCUMENTS) {
    const calls = [];
    const html = renderDoc({ documentName, textEditingEnabled: true, onPickChange: patch => calls.push(patch) });
    assert.match(html, /contenteditable="true"/, documentName);
    assert.deepEqual(calls, [], documentName);
  }
  const { EditableDocBody, createInstance, renderInstance } = hookHarness;
  const saved = [];
  const instance = createInstance();
  const tree = renderInstance(instance, EditableDocBody, { editable: true, customHtml: null, onCustomHtmlChange: html => saved.push(html), children: 'linked' });
  const editable = editableElement(tree);
  attachFakeDom(editable, '<p>linked</p>');
  editable.props.onFocus();
  editable.props.onBlur();
  renderInstance(instance, EditableDocBody, { editable: false, customHtml: null, onCustomHtmlChange: html => saved.push(html), children: 'linked' });
  assert.deepEqual(saved, []);
});

test('3. 全文編集中に本文を変更した時だけcustomTextを保存し、detachedへ移行する', () => {
  const { EditableDocBody, createInstance, renderInstance } = hookHarness;
  const saved = [];
  const instance = createInstance();
  const tree = renderInstance(instance, EditableDocBody, { editable: true, customHtml: null, onCustomHtmlChange: html => saved.push(html), children: 'linked' });
  const editable = editableElement(tree);
  attachFakeDom(editable, '<p>変更後の本文</p>');
  editable.props.onFocus();
  editable.props.onInput();
  editable.props.onBlur();
  assert.deepEqual(saved, ['<p>変更後の本文</p>']);

  // Docs.handlePickChangeと同じ保存経路で全文固定になる。
  const documentName = '委任状（表題）';
  const instanceKey = `${documentName}__1`;
  const site = baseSite();
  const linked = contextFor(site, documentName);
  const application = {
    id: 'ra-1', type: '建物表題登記', targetBuildingIds: ['b1'], targetLandIds: [], applicantPersonIds: ['p1', 'p2'],
    subject: { beforeBuildingIds: [], afterBuildingIds: ['b1'], landIds: [], primaryBuildingId: null },
    documents: { [documentName]: 1 },
    documentInstances: [{
      id: 'doc-1', templateKey: getDocumentTemplateKey(documentName), documentName, copyIndex: 1, printEnabled: true,
      selectionOverrides: {}, contentOverrides: { blocks: {}, fields: {} }, layoutOverrides: {},
      editMode: 'linked', detachedHtml: null, legacyInstanceKey: instanceKey,
    }],
  };
  const edited = reconcileSiteDocumentCompatibility({
    ...site,
    registrationApplications: [application],
    docPick: { [instanceKey]: { customText: saved[0], printOn: true, _raApplied: 'ra-1' } },
  }, {
    legacyPickIntentFields: { [instanceKey]: ['customText'] },
    detachedSourceSnapshots: { [instanceKey]: linked.sourceSnapshot },
  });
  const stored = edited.registrationApplications[0].documentInstances[0];
  assert.equal(stored.editMode, 'detached');
  assert.equal(stored.detachedHtml, '<p>変更後の本文</p>');
  assert.equal(edited.docPick[instanceKey].customText, '<p>変更後の本文</p>');

  // 6. 最新データ連動へ切替（customText: null）で解除される。
  const reset = reconcileSiteDocumentCompatibility({
    ...edited,
    docPick: { ...edited.docPick, [instanceKey]: { ...edited.docPick[instanceKey], customText: null } },
  }, { legacyPickIntentFields: { [instanceKey]: ['customText'] } });
  assert.equal(reset.registrationApplications[0].documentInstances[0].editMode, 'linked');
  assert.equal(reset.registrationApplications[0].documentInstances[0].detachedHtml, null);
  assert.equal(reset.docPick[instanceKey].customText, null);
  const relinked = renderDoc({ documentName });
  assert.doesNotMatch(relinked, /変更後の本文/);
});

test('4/5. 既存customTextは通常read-onlyで内容を維持し、全文編集再開で編集できる', () => {
  const fixed = '<p>既存の固定本文<span style="font-size: 105%">架空</span></p>';
  for (const documentName of TARGET_DOCUMENTS) {
    const calls = [];
    const readOnly = renderDoc({ documentName, pick: { customText: fixed }, onPickChange: patch => calls.push(patch) });
    assert.ok(readOnly.includes(fixed), documentName);
    assert.doesNotMatch(readOnly, /contenteditable="true"/, documentName);

    const resumed = renderDoc({ documentName, pick: { customText: fixed }, textEditingEnabled: true, onPickChange: patch => calls.push(patch) });
    assert.ok(resumed.includes(fixed), documentName);
    assert.match(resumed, /contenteditable="true"/, documentName);
    assert.deepEqual(calls, [], documentName);
  }
});

test('7/8. 選択文字の文字サイズ変更は全文編集中だけ許可する', () => {
  TARGET_DOCUMENTS.forEach(documentName => {
    assert.equal(canApplySelectionFontSize({ documentName }), false, documentName);
    assert.equal(canApplySelectionFontSize({ documentName, textEditingEnabled: true }), true, documentName);
  });
  assert.equal(canApplySelectionFontSize({ documentName: '委任状（保存）' }), true);

  const docsSource = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
  const fontBlock = docsSource.slice(docsSource.indexOf('value={activePick.fontScale || 100}'), docsSource.indexOf("'100%（標準）'"));
  const mouseDown = fontBlock.slice(fontBlock.indexOf('onMouseDown'), fontBlock.indexOf('onChange'));
  const onChange = fontBlock.slice(fontBlock.indexOf('onChange'));
  // 範囲保存時に判定し、保存経路はresolveFontSizeChangeの判断だけに従う。
  assert.match(mouseDown, /canApplySelectionFontSize\(\{ documentName: activeInstance\.name, textEditingEnabled: isTextEditing \}\)/);
  assert.match(onChange, /resolveFontSizeChange\(\{[\s\S]*?documentName: activeInstance\.name,[\s\S]*?textEditingEnabled: isTextEditing,[\s\S]*?hasSelection:[\s\S]*?\}\);/);
  // fontScaleを直接組み立てて保存する経路が残っていないこと。
  assert.doesNotMatch(onChange, /handlePickChange\(activeInstanceKey, \{ fontScale:/);
  assert.match(onChange, /if \(decision\.patch\) handlePickChange\(activeInstanceKey, decision\.patch\);/);
});

// ---- 2026-09-15 実装レビュー補正: read-only時の文字サイズUIを出さない ----

test('R1. 対象4帳票のread-only時は文字サイズselectを表示しない', () => {
  const docsSource = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
  TARGET_DOCUMENTS.forEach(documentName => {
    assert.equal(shouldShowFontSizeControl({ documentName }), false, documentName);
    assert.equal(shouldShowFontSizeControl({ documentName, textEditingEnabled: true }), true, documentName);
  });
  // 表示判定がselectを含むブロック全体を覆っていること。
  const guardIndex = docsSource.indexOf('shouldShowFontSizeControl({ documentName: activeInstance.name, textEditingEnabled: isTextEditing })');
  const selectIndex = docsSource.indexOf('value={activePick.fontScale || 100}');
  assert.notEqual(guardIndex, -1);
  assert.ok(guardIndex < selectIndex, '文字サイズselectより前で表示判定していること');
  // read-only時は何も描画しない（P4で常時ヒントも撤去）。selectもfontScale保存もない。
  const shownIndex = docsSource.indexOf('data-testid="font-size-control"');
  assert.ok(guardIndex < shownIndex && shownIndex < selectIndex);
  const hintBlock = docsSource.slice(guardIndex, shownIndex);
  assert.match(hintBlock, /return null;/);
  assert.doesNotMatch(hintBlock, /<select/);
  assert.doesNotMatch(hintBlock, /handlePickChange/);
  // P4: 常時表示の文字サイズヒント自体を撤去している。
  assert.doesNotMatch(docsSource, /文字サイズを個別調整する場合は全文編集を開始してください/);
  assert.doesNotMatch(docsSource, /data-testid="font-size-control-hint"/);
  // 効かない「帳票全体の文字サイズ」表記が残っていないこと。
  assert.doesNotMatch(docsSource, /帳票全体の文字サイズ/);
});

test('R2. 対象4帳票のread-only時はfontScale/customTextを保存する経路がない', () => {
  TARGET_DOCUMENTS.forEach(documentName => {
    [90, 100, 110].forEach(fontScale => {
      // read-onlyではUIを出さないが、万一呼ばれても何も保存しない。
      assert.deepEqual(
        resolveFontSizeChange({ documentName, textEditingEnabled: false, hasSelection: false, fontScale }),
        { action: 'none', patch: null },
        `${documentName}/${fontScale}`
      );
      // 選択があっても本文read-onlyなら適用しない。
      assert.deepEqual(
        resolveFontSizeChange({ documentName, textEditingEnabled: false, hasSelection: true, fontScale }),
        { action: 'none', patch: null },
        `${documentName}/${fontScale}/selected`
      );
    });
  });
});

test('R3. 対象4帳票の全文編集中に文字選択があれば選択文字サイズを適用しcustomTextを保存する', () => {
  TARGET_DOCUMENTS.forEach(documentName => {
    const decision = resolveFontSizeChange({ documentName, textEditingEnabled: true, hasSelection: true, fontScale: 110 });
    assert.equal(decision.action, 'applySelection', documentName);
    // 現行P1挙動どおり、選択文字へ適用した結果はfontScale:100 + customTextで保存する。
    assert.deepEqual(decision.patch, { fontScale: 100 }, documentName);
    assert.deepEqual({ ...decision.patch, customText: '<p>x</p>' }, { fontScale: 100, customText: '<p>x</p>' }, documentName);
  });

  const docsSource = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
  const onChange = docsSource.slice(docsSource.indexOf('value={activePick.fontScale || 100}'), docsSource.indexOf("'100%（標準）'"));
  assert.match(onChange, /handlePickChange\(activeInstanceKey, \{ \.\.\.decision\.patch, customText: customHtml \}\);/);
  assert.match(onChange, /wrapper\.style\.fontSize = pct \+ '%';/);
});

test('R4. 対象4帳票の全文編集中でも文字選択がなければfontScale/customTextを保存しない', () => {
  TARGET_DOCUMENTS.forEach(documentName => {
    [90, 105, 110].forEach(fontScale => {
      const decision = resolveFontSizeChange({ documentName, textEditingEnabled: true, hasSelection: false, fontScale });
      assert.deepEqual(decision, { action: 'none', patch: null }, `${documentName}/${fontScale}`);
    });
    assert.equal(canFallbackToDocumentFontScale(documentName), false, documentName);
  });

  // 全文編集中の補助文で、文字選択が必要なことが分かること。
  const docsSource = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
  assert.match(docsSource, /'選択文字のサイズ' : '文字サイズ（選択テキスト）'/);
  assert.match(docsSource, /本文中の文字を選択してからサイズを変更/);
  // 選択なしでの新規alert/confirmは足さない。
  const fontBlock = docsSource.slice(docsSource.indexOf('data-testid="font-size-control"'), docsSource.indexOf("'100%（標準）'"));
  assert.doesNotMatch(fontBlock, /window\.(alert|confirm)\(/);
});

test('R5. 非対象帳票は従来の文字サイズUI・挙動を維持する', () => {
  const others = ['委任状（保存）', '上申書', '土地所在図'];
  others.forEach(documentName => {
    assert.equal(shouldShowFontSizeControl({ documentName }), true, documentName);
    assert.equal(canFallbackToDocumentFontScale(documentName), true, documentName);
    // 選択なしなら従来どおりfontScaleだけ保存する。
    assert.deepEqual(
      resolveFontSizeChange({ documentName, hasSelection: false, fontScale: 95 }),
      { action: 'saveFontScale', patch: { fontScale: 95 } },
      documentName
    );
    // 選択ありなら従来どおり選択文字へ適用する。
    assert.equal(resolveFontSizeChange({ documentName, hasSelection: true, fontScale: 95 }).action, 'applySelection', documentName);
  });
  // ラベル・補助文の従来表記を維持していること。
  const docsSource = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
  assert.match(docsSource, /'文字サイズ（選択テキスト）'/);
  assert.match(docsSource, /'テキストを選択してからサイズを変更'/);
});

test('R6. 既存保存済みfontScaleは読込・互換処理で破棄しない', () => {
  TARGET_DOCUMENTS.forEach(documentName => {
    const key = getDocumentTemplateKey(documentName);
    const instanceKey = `${documentName}__1`;
    const site = {
      ...baseSite(),
      registrationApplications: [{
        id: 'ra-1',
        type: '建物表題登記',
        targetBuildingIds: ['b1'],
        applicantPersonIds: ['p1'],
        documents: { [documentName]: 1 },
        documentInstances: [{
          id: `doc-${key}`,
          templateKey: key,
          documentName,
          copyIndex: 1,
          printEnabled: true,
          selectionOverrides: {},
          contentOverrides: { blocks: {}, fields: {} },
          layoutOverrides: { fontScale: 92 },
          editMode: 'linked',
          detachedHtml: null,
        }],
      }],
      docPick: { [instanceKey]: { fontScale: 92, printOn: true } },
    };
    const reconciled = reconcileSiteDocumentCompatibility(site);
    const instance = reconciled.registrationApplications[0].documentInstances[0];
    // 値を削除・migrationせず、そのまま保持する。
    assert.equal(instance.layoutOverrides.fontScale, 92, documentName);
    assert.equal(reconciled.docPick[instanceKey].fontScale, 92, documentName);
  });
});

test('「編集を終了」は押下時に本文からフォーカスを移さず、入力途中の本文はeditable切替で保存する', () => {
  const docsSource = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');
  const endLabelIndex = docsSource.search(/>\s*編集を終了\s*</);
  assert.notEqual(endLabelIndex, -1);
  const endButton = docsSource.slice(docsSource.lastIndexOf('<button', endLabelIndex), endLabelIndex);
  assert.match(endButton, /onMouseDown=\{e => e\.preventDefault\(\)\}/);
  assert.match(endButton, /onClick=\{\(\) => setTextEditInstanceId\(""\)\}/);
});

test('9. EditableDocBodyは同一instanceでeditableをfalse→true→falseに切り替えてもHook順序が変わらない', () => {
  const { EditableDocBody, createInstance, renderInstance, unmountInstance } = hookHarness;
  for (const customHtml of [null, '<p>固定本文</p>']) {
    const saved = [];
    const instance = createInstance();
    const props = (editable) => ({ editable, customHtml, onCustomHtmlChange: html => saved.push(html), children: 'body' });
    assert.doesNotThrow(() => renderInstance(instance, EditableDocBody, props(false)));
    const tree = renderInstance(instance, EditableDocBody, props(true));
    const editable = editableElement(tree);
    assert.ok(editable);
    attachFakeDom(editable, '<p>入力途中</p>');
    editable.props.onFocus();
    editable.props.onInput();
    // blurせずに編集不可へ戻しても入力途中の本文を失わない。
    assert.doesNotThrow(() => renderInstance(instance, EditableDocBody, props(false)));
    assert.deepEqual(saved, ['<p>入力途中</p>']);
    assert.doesNotThrow(() => renderInstance(instance, EditableDocBody, props(true)));
    unmountInstance(instance);
    assert.deepEqual(saved, ['<p>入力途中</p>']);
  }
});

test('10. 印刷用DocTemplateは編集UI状態に関係なく保存済みlinked/detached本文を描画する', () => {
  const fixed = '<p>印刷される固定本文</p>';
  for (const documentName of TARGET_DOCUMENTS) {
    const linkedPrint = renderDoc({ documentName, isPrint: true });
    assert.equal(renderDoc({ documentName, isPrint: true, textEditingEnabled: true }), linkedPrint, documentName);
    assert.doesNotMatch(linkedPrint, /contenteditable="true"/, documentName);
    assert.match(linkedPrint, /架空県架空市一丁目1番地/, documentName);

    const detachedPrint = renderDoc({ documentName, isPrint: true, pick: { customText: fixed } });
    assert.equal(renderDoc({ documentName, isPrint: true, pick: { customText: fixed }, textEditingEnabled: true }), detachedPrint, documentName);
    assert.ok(detachedPrint.includes(fixed), documentName);
    assert.doesNotMatch(detachedPrint, /contenteditable="true"/, documentName);
  }
});
