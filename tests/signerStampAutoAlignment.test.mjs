import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

import {
  buildSignerBlockAttributes,
  buildSignerRowAttributes,
  buildSignerStampNotices,
  DOC_CAPTURE_ATTR,
  getSignerBlockKey,
  isSignerStampAutoAlignDocument,
  isSignerStampAutoAligned,
  measureSignerBlock,
  resolveSignerStampPlacement,
  SIGNER_BLOCK_ATTR,
  SIGNER_ROW_ATTR,
  SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS,
  SIGNER_STAMP_GAP_EM,
  SIGNER_STAMP_NOTICE_UNIDENTIFIED,
  SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE,
} from '../src/signerStampAlignment.js';
import {
  getDocumentTemplateKey,
  LEGACY_DOCUMENT_PICK_DEFAULTS,
  reconcileSiteDocumentCompatibility,
} from '../src/v8Compatibility.js';
import { buildStampPositionResetPatch } from '../src/documentLayoutUi.js';
import { isDocumentBodyEditable, isExplicitTextEditDocument } from '../src/documentTextEditing.js';

// 署名者印影の自動配置 先行実装（仕様書v1.3 / Task Packet 2026-09-16）。
// 実ブラウザ描画での確認は別途headless Chromeで行い、ここでは
// 対象帳票のガード・計測アルゴリズム・配置決定・保存経路を固定する。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'signer-stamp-tests');
mkdirSync(CACHE_DIR, { recursive: true });
const DOC_TEMPLATE_SOURCE = readFileSync(path.join(ROOT, 'src/components/DocTemplate/DocTemplate.jsx'), 'utf8');
const DOCS_SOURCE = readFileSync(path.join(ROOT, 'src/components/Docs/Docs.jsx'), 'utf8');

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
      sourcefile: 'signer-stamp-real-react.jsx',
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
  const file = path.join(CACHE_DIR, 'signer-stamp-real-react.mjs');
  writeFileSync(file, result.outputFiles[0].text);
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
})();

// ---------------------------------------------------------------------------
// 最小のDOM代替。measureSignerBlockが実際に使うAPIだけを備える。
// 「非表示capture用DOMを読まない」「別行を合算しない」「空白だけの行を基準にしない」
// といった規則をNode側で固定するためのもので、実描画確認の代わりではない。
// ---------------------------------------------------------------------------
const rect = (left, right, top = 0) => ({
  left, right, top, bottom: top + 12, width: right - left, height: 12,
});

class FakeText {
  constructor(value, rects = []) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.rects = rects;
    this.parentElement = null;
  }
}

class FakeElement {
  constructor({ attrs = {}, box = rect(0, 0), fontSize = '14.6667px', children = [] } = {}) {
    this.nodeType = 1;
    this.attrs = attrs;
    this.box = box;
    this.fontSize = fontSize;
    this.children = children;
    this.parentElement = null;
    for (const child of children) child.parentElement = this;
    this.ownerDocument = null;
  }
  getBoundingClientRect() { return this.box; }
  matches(selector) {
    const exact = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (exact) return this.attrs[exact[1]] === exact[2];
    const present = /^\[([\w-]+)\]$/.exec(selector);
    if (present) return Object.prototype.hasOwnProperty.call(this.attrs, present[1]);
    return false;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) found.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return found;
  }
}

const textNodesOf = (root) => {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.nodeType === 3) out.push(child);
      else walk(child);
    }
  };
  walk(root);
  return out;
};

const makeFakeDocument = (root, { fontSize } = {}) => {
  const doc = {
    createTreeWalker(start) {
      const nodes = textNodesOf(start);
      let i = 0;
      return { nextNode: () => (i < nodes.length ? nodes[i++] : null) };
    },
    createRange() {
      let current = null;
      return {
        selectNodeContents(node) { current = node; },
        getClientRects() { return current?.rects || []; },
      };
    },
    defaultView: {
      getComputedStyle: (el) => ({ fontSize: fontSize || el.fontSize }),
    },
  };
  const attach = (node) => {
    node.ownerDocument = doc;
    for (const child of node.children || []) {
      if (child.nodeType === 1) attach(child);
      else child.ownerDocument = doc;
    }
  };
  attach(root);
  return doc;
};

// 原点コンテナ(左端0/幅654px)に署名欄を1つ置いた既定構成。
const buildOrigin = ({ blocks, containerWidth = 654 }) => {
  const origin = new FakeElement({ box: rect(0, containerWidth), children: blocks });
  makeFakeDocument(origin);
  return origin;
};

const signerRow = (index, textNodes) => new FakeElement({
  attrs: { [SIGNER_ROW_ATTR]: String(index) },
  box: rect(0, 500),
  children: textNodes,
});

const signerBlock = (key, rows, extraAttrs = {}) => new FakeElement({
  attrs: { [SIGNER_BLOCK_ATTR]: key, ...extraAttrs },
  box: rect(0, 600),
  fontSize: '14.6667px', // 11pt
  children: rows,
});

const TITLE_KEY = getDocumentTemplateKey('委任状（表題）');
const SAVE_KEY = getDocumentTemplateKey('委任状（保存）');
const ADDRESS_KEY = getDocumentTemplateKey('委任状（住所変更）');
const LOSS_KEY = getDocumentTemplateKey('委任状（滅失）');
const LAND_CATEGORY_KEY = getDocumentTemplateKey('委任状（地目変更）');
const GAP_11PT = 14.6667 * SIGNER_STAMP_GAP_EM;
const STAMP_WIDTH = 100; // 26.6mm相当の代表値

// Pilotで本番反映済みの2帳票。
const PILOT_DOCUMENTS = ['委任状（表題）', '委任状（保存）'];
// 今回auto-alignを有効化する8帳票。
// 住所変更だけが renderSignerMultiLine の複数行型で、残り7帳票は通常の署名者行＋
// renderOwnerWithDecedent による被相続人/相続人2行になり得る。
const ROLLOUT_MULTILINE_DOCUMENTS = ['委任状（住所変更）'];
const ROLLOUT_DECEDENT_DOCUMENTS = [
  '委任状（地目変更）', '委任状（滅失）', '委任状（表題部変更）',
  '委任状（表題部更正）', '委任状（合併）', '委任状（分割）', '委任状（合体）',
];
const ROLLOUT_DOCUMENTS = [...ROLLOUT_MULTILINE_DOCUMENTS, ...ROLLOUT_DECEDENT_DOCUMENTS];
const DELEGATION_DOCUMENTS = [...PILOT_DOCUMENTS, ...ROLLOUT_DOCUMENTS];
// 証明書展開（2026-09-16）で有効化する4帳票。
// いずれも単独工事人1名・住所/氏名/代表者の3行で、renderDelegationCommonは使わない。
const CERTIFICATE_DOCUMENTS = [
  '工事完了引渡証明書（表題）', '工事完了引渡証明書（表題部変更）',
  '滅失証明書（滅失）', '滅失証明書（表題部変更）',
];
// 申述書展開（2026-09-17）で有効化する2帳票。共通の renderStatementCommon を使い、
// 申述人1人が「住所＋表示中の持分＋氏名」の同一行1本になる。
const STATEMENT_DOCUMENTS = ['申述書（共有）', '申述書（単独）'];
// 売渡証明書展開（2026-09-18）。売主1人につき住所行・氏名行の2行が候補になる。
const SALE_DOCUMENTS = ['売渡証明書'];
// 今回も自動配置を有効化しない帳票（署名者印影を持たない）。
const NON_TARGET_DOCUMENTS = ['非登載証明書'];

// ---------------------------------------------------------------------------
// 1. 対象帳票のガード（R-AC01）
// ---------------------------------------------------------------------------

test('1. 自動配置の対象は委任状10＋証明書4＋申述書2＋売渡証明書＝17帳票だけ', () => {
  // 一覧そのものを完全一致で固定する。追加・順序変更はここが落ちる。
  assert.deepEqual([...SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS], [
    '委任状（表題）',
    '委任状（保存）',
    '委任状（住所変更）',
    '委任状（地目変更）',
    '委任状（滅失）',
    '委任状（表題部変更）',
    '委任状（表題部更正）',
    '委任状（合併）',
    '委任状（分割）',
    '委任状（合体）',
    '工事完了引渡証明書（表題）',
    '工事完了引渡証明書（表題部変更）',
    '滅失証明書（滅失）',
    '滅失証明書（表題部変更）',
    '申述書（共有）',
    '申述書（単独）',
    '売渡証明書',
  ]);
  assert.equal(SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS.length, 17);
  assert.equal(new Set(SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS).size, 17, '重複なし');
  assert.deepEqual(
    [...SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS].slice().sort(),
    [...DELEGATION_DOCUMENTS, ...CERTIFICATE_DOCUMENTS, ...STATEMENT_DOCUMENTS, ...SALE_DOCUMENTS].slice().sort()
  );
  assert.equal(DELEGATION_DOCUMENTS.length, 10);
  assert.equal(CERTIFICATE_DOCUMENTS.length, 4);
  assert.equal(STATEMENT_DOCUMENTS.length, 2);
  assert.equal(SALE_DOCUMENTS.length, 1);

  for (const name of [...DELEGATION_DOCUMENTS, ...CERTIFICATE_DOCUMENTS, ...STATEMENT_DOCUMENTS, ...SALE_DOCUMENTS]) {
    assert.equal(isSignerStampAutoAlignDocument(name), true, name);
  }
  for (const other of NON_TARGET_DOCUMENTS) {
    assert.equal(isSignerStampAutoAlignDocument(other), false, other);
  }
});

test('1b. 対象17帳票はいずれも既知のtemplateKeyを持ち、署名欄keyが重複しない', () => {
  const keys = SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS.map(getSignerBlockKey);
  for (const [i, key] of keys.entries()) {
    assert.ok(key, SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS[i]);
    assert.ok(!key.startsWith('legacy:'), `${SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS[i]}は既知のtemplateKeyを持つ`);
  }
  assert.equal(new Set(keys).size, keys.length, '帳票ごとに別のkeyになる');
});

test('2. 名称の前方一致や「委任状」全般への暗黙の展開をしない', () => {
  // 「委任状なら全部」ではなく、列挙した完全一致だけを対象にする。
  assert.equal(isSignerStampAutoAlignDocument('委任状'), false);
  assert.equal(isSignerStampAutoAlignDocument('委任状（表題）2'), false);
  assert.equal(isSignerStampAutoAlignDocument('委任状（表題部変更）2'), false);
  assert.equal(isSignerStampAutoAlignDocument('委任状（住所変更'), false);
  assert.equal(isSignerStampAutoAlignDocument('（委任状（滅失）'), false);
  assert.equal(isSignerStampAutoAlignDocument('委任状（敷地権）'), false, '未知の委任状は対象にしない');
  assert.equal(isSignerStampAutoAlignDocument(''), false);
  assert.equal(isSignerStampAutoAlignDocument(undefined), false);
  // 「証明書なら全部」への暗黙の展開もしない。
  assert.equal(isSignerStampAutoAlignDocument('証明書'), false);
  assert.equal(isSignerStampAutoAlignDocument('工事完了引渡証明書'), false);
  assert.equal(isSignerStampAutoAlignDocument('工事完了引渡証明書（表題）2'), false);
  assert.equal(isSignerStampAutoAlignDocument('滅失証明書'), false);
  assert.equal(isSignerStampAutoAlignDocument('非登載証明書'), false, '署名者印影を持たない証明書は対象外');
  assert.equal(isSignerStampAutoAlignDocument('売渡証明書'), true);
  assert.equal(isSignerStampAutoAlignDocument('売渡証明書2'), false, '前方一致では広げない');
  assert.equal(isSignerStampAutoAlignDocument('売渡'), false);
  // 「申述書なら全部」への暗黙の展開もしない。
  assert.equal(isSignerStampAutoAlignDocument('申述書'), false);
  assert.equal(isSignerStampAutoAlignDocument('申述書（共有）2'), false);
  assert.equal(isSignerStampAutoAlignDocument('申述書（相続）'), false);

  assert.equal(buildSignerBlockAttributes('非登載証明書'), null);
  assert.equal(buildSignerRowAttributes('非登載証明書', 0), null);
  assert.deepEqual(buildSignerBlockAttributes('委任状（表題）'), { [SIGNER_BLOCK_ATTR]: TITLE_KEY });
  assert.deepEqual(buildSignerRowAttributes('委任状（保存）', 2), { [SIGNER_ROW_ATTR]: '2' });
  assert.deepEqual(buildSignerBlockAttributes('委任状（住所変更）'), { [SIGNER_BLOCK_ATTR]: ADDRESS_KEY });
  assert.deepEqual(buildSignerBlockAttributes('委任状（滅失）'), { [SIGNER_BLOCK_ATTR]: LOSS_KEY });
  assert.deepEqual(buildSignerRowAttributes('委任状（合体）', 1), { [SIGNER_ROW_ATTR]: '1' });
});

// ---------------------------------------------------------------------------
// 2. 実表示行の計測（P-AC02 / P-AC03 / P-AC05）
// ---------------------------------------------------------------------------

test('3. 表題: 住所＋持分＋氏名の同一行全体の右端を基準にする', () => {
  // 1行に住所・持分・氏名が並ぶ。行全体で1つのテキストノード。
  const origin = buildOrigin({
    blocks: [signerBlock(TITLE_KEY, [signerRow(0, [new FakeText('住所　持分２分の１　架空 太郎', [rect(0, 320)])])])],
  });
  const measured = measureSignerBlock(origin, TITLE_KEY);
  assert.equal(measured.found, true);
  assert.equal(measured.rowCount, 1);
  assert.equal(measured.maxRight, 320);
  assert.ok(Math.abs(measured.baseX - (320 + GAP_11PT)) < 0.01);
});

test('4. 表題: 法人追加行が通常行より長ければ追加行を基準にする', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(TITLE_KEY, [signerRow(0, [
      new FakeText('住所　持分２分の１　架空建設株式会社', [rect(0, 240)]),
      new FakeText('代表取締役　架空 一郎', [rect(0, 310, 20)]),
    ])])],
  });
  const measured = measureSignerBlock(origin, TITLE_KEY);
  assert.equal(measured.maxRight, 310);
});

test('5. 表題: 通常行が法人追加行より長ければ通常行を基準にする', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(TITLE_KEY, [signerRow(0, [
      new FakeText('住所　持分２分の１　架空建設株式会社', [rect(0, 400)]),
      new FakeText('代表取締役　架空 一郎', [rect(0, 310, 20)]),
    ])])],
  });
  assert.equal(measureSignerBlock(origin, TITLE_KEY).maxRight, 400);
});

test('6. 保存: 住所行が最長／氏名行が最長／ふりがな行が最長のいずれも表示右端で決まる', () => {
  const rows = (addressRight, kanaRight, nameRight) => [signerBlock(SAVE_KEY, [signerRow(0, [
    new FakeText('住　　所　', [rect(0, 70)]),
    new FakeText('架空県架空市架空町一丁目1番1号', [rect(70, addressRight)]),
    new FakeText('ふりがな　', [rect(0, 70, 20)]),
    new FakeText('かくう たろう', [rect(70, kanaRight, 20)]),
    new FakeText('氏　　名　', [rect(0, 70, 40)]),
    new FakeText('架空 太郎', [rect(70, nameRight, 40)]),
  ])])];
  assert.equal(measureSignerBlock(buildOrigin({ blocks: rows(300, 200, 220) }), SAVE_KEY).maxRight, 300);
  assert.equal(measureSignerBlock(buildOrigin({ blocks: rows(200, 210, 340) }), SAVE_KEY).maxRight, 340);
  assert.equal(measureSignerBlock(buildOrigin({ blocks: rows(200, 360, 220) }), SAVE_KEY).maxRight, 360);
});

test('7. 別々の行の幅を合算しない', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(SAVE_KEY, [signerRow(0, [
      new FakeText('住　　所　架空県架空市', [rect(0, 180)]),
      new FakeText('氏　　名　架空 太郎', [rect(0, 150, 20)]),
    ])])],
  });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).maxRight, 180);
});

test('8. 行頭のインデントを含む同一座標系の右端で比較する', () => {
  // 幅は短いが行頭が右にある行のほうが、実際には右まで伸びる。
  const origin = buildOrigin({
    blocks: [signerBlock(SAVE_KEY, [signerRow(0, [
      new FakeText('左端から長い行', [rect(0, 300)]),
      new FakeText('インデント行', [rect(240, 330, 20)]),
    ])])],
  });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).maxRight, 330);
});

test('9. 折返しで生じた各行を個別の行として扱う', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(SAVE_KEY, [signerRow(0, [
      // 1つのテキストノードが2行に折り返された場合。
      new FakeText('とても長い住所', [rect(0, 520), rect(0, 180, 20)]),
    ])])],
  });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).maxRight, 520);
});

test('10. 空白だけの行と0幅の矩形は基準にしない', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(SAVE_KEY, [signerRow(0, [
      new FakeText('氏　　名　架空 太郎', [rect(0, 200)]),
      new FakeText('　', [rect(0, 480, 20)]),
      new FakeText('\n   ', [rect(0, 600, 40)]),
      new FakeText('持　　分', [rect(0, 0, 60)]),
    ])])],
  });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).maxRight, 200);
});

test('11. 余白Gは署名欄の通常本文サイズの2em相当で、内部の拡縮文字で変えない', () => {
  const block = signerBlock(SAVE_KEY, [signerRow(0, [new FakeText('氏名', [rect(0, 200)])])]);
  const origin = new FakeElement({ box: rect(0, 654), children: [block] });
  // 署名欄コンテナ自体は11pt、内部に24pxのspanがある想定でも基準は11pt。
  makeFakeDocument(origin);
  const measured = measureSignerBlock(origin, SAVE_KEY);
  assert.ok(Math.abs(measured.gap - 14.6667 * 2) < 0.01);
  assert.ok(Math.abs(measured.baseX - (200 + 14.6667 * 2)) < 0.01);
});

test('12. 非表示のcapture用DOMを計測対象にしない', () => {
  const hidden = new FakeElement({
    attrs: { [DOC_CAPTURE_ATTR]: '1' },
    box: rect(0, 0),
    children: [signerBlock(SAVE_KEY, [signerRow(0, [new FakeText('capture側の長い行', [rect(0, 640)])])])],
  });
  const visible = signerBlock(SAVE_KEY, [signerRow(0, [new FakeText('表示中の行', [rect(0, 210)])])]);
  const origin = buildOrigin({ blocks: [hidden, visible] });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).maxRight, 210);
});

test('13. レイアウトを持たない署名欄（幅0）は判別済みにしない', () => {
  const block = signerBlock(SAVE_KEY, [signerRow(0, [new FakeText('氏名', [rect(0, 200)])])]);
  block.box = rect(0, 0);
  const origin = buildOrigin({ blocks: [block] });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).found, false);
});

test('14. 別帳票の署名欄keyは自帳票の計測に使わない', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(TITLE_KEY, [signerRow(0, [new FakeText('表題の行', [rect(0, 500)])])])],
  });
  assert.equal(measureSignerBlock(origin, SAVE_KEY).found, false);
  assert.equal(measureSignerBlock(origin, TITLE_KEY).found, true);
});

test('15. 目印が消えた貼替え後HTMLは判別不能になる', () => {
  const origin = buildOrigin({
    blocks: [new FakeElement({ box: rect(0, 600), children: [new FakeText('貼り付けられた本文', [rect(0, 500)])] })],
  });
  assert.equal(measureSignerBlock(origin, TITLE_KEY).found, false);
});

// ---------------------------------------------------------------------------
// 3. 配置決定（P-AC04 / P-AC07 / P-AC09）
// ---------------------------------------------------------------------------

const placementFor = (maxRight, { storedBaseRatio = null, containerWidth = 654 } = {}) =>
  resolveSignerStampPlacement({
    measurement: measureSignerBlock(buildOrigin({
      containerWidth,
      blocks: [signerBlock(SAVE_KEY, [signerRow(0, [new FakeText('行', [rect(0, maxRight)])])])],
    }), SAVE_KEY),
    storedBaseRatio,
    stampWidth: STAMP_WIDTH,
  });

test('16. 判別できた場合は実表示右端＋2emを基準Xにする', () => {
  const placement = placementFor(300);
  assert.equal(placement.identified, true);
  assert.equal(placement.source, 'measured');
  assert.ok(Math.abs(placement.baseX - (300 + GAP_11PT)) < 0.01);
  assert.equal(placement.widthShortage, false);
  assert.equal(isSignerStampAutoAligned(placement), true);
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

test('17. 同じ書類の全署名者は手動補正なしで同一の基準Xを共有する', () => {
  // 署名者A(通常行が短い)・B(長い)が同じ署名欄にある場合、基準は最も右の行で1つに決まる。
  const origin = buildOrigin({
    blocks: [signerBlock(TITLE_KEY, [
      signerRow(0, [new FakeText('A 住所　持分　氏名', [rect(0, 240)])]),
      signerRow(1, [new FakeText('B 住所　持分　氏名', [rect(0, 275)])]),
      signerRow(2, [new FakeText('C 法人追加行', [rect(0, 310, 20)])]),
    ])],
  });
  const placement = resolveSignerStampPlacement({
    measurement: measureSignerBlock(origin, TITLE_KEY),
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(measureSignerBlock(origin, TITLE_KEY).rowCount, 3);
  assert.ok(Math.abs(placement.baseX - (310 + GAP_11PT)) < 0.01);
  // 基準Xは1つだけなので、印影列（=全署名者共通）の左端も1つ。
  assert.equal(placement.renderX, placement.baseX);
});

test('18. 横幅不足は非阻害の注意を出し、自動整列成功とは扱わない', () => {
  const placement = placementFor(600); // 600 + 2em + 100 > 654
  assert.equal(placement.identified, true);
  assert.equal(placement.widthShortage, true);
  assert.equal(isSignerStampAutoAligned(placement), false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE]);
  // 印影が紙面外へ出て操作不能にならないよう、描画位置だけ紙面内に留める。
  assert.equal(placement.renderX, 654 - STAMP_WIDTH);
  assert.ok(placement.baseX > placement.renderX);
});

test('19. 判別不能かつ最後の有効基準ありは保持基準へ戻す', () => {
  const placement = resolveSignerStampPlacement({
    measurement: { found: false, containerWidth: 654 },
    storedBaseRatio: 0.5,
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.identified, false);
  assert.equal(placement.source, 'stored');
  assert.equal(placement.baseX, 327);
  assert.equal(placement.renderX, 327);
  assert.equal(placement.baseRatio, null, '判別不能中は基準を上書き保存しない');
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);
});

test('20. 判別不能かつ有効基準なしは従来の右端へ仮配置する', () => {
  const placement = resolveSignerStampPlacement({
    measurement: { found: false, containerWidth: 654 },
    storedBaseRatio: null,
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.identified, false);
  assert.equal(placement.source, 'legacy-right');
  assert.equal(placement.renderX, 654 - STAMP_WIDTH, '従来の署名欄右端と同じ位置');
  assert.equal(isSignerStampAutoAligned(placement), false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);
});

test('21. 判別不能と横幅不足は別の状態として両方示せる', () => {
  const placement = resolveSignerStampPlacement({
    measurement: { found: false, containerWidth: 654 },
    storedBaseRatio: 0.95,
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.identified, false);
  assert.equal(placement.widthShortage, true);
  assert.deepEqual(buildSignerStampNotices(placement), [
    SIGNER_STAMP_NOTICE_UNIDENTIFIED,
    SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE,
  ]);
  assert.notEqual(SIGNER_STAMP_NOTICE_UNIDENTIFIED, SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE);
});

test('22. 保存する基準は表示倍率に依存しない比率で、同じ内容なら同じ値になる', () => {
  const wide = placementFor(300, { containerWidth: 654 });
  assert.ok(Math.abs(wide.baseRatio - wide.baseX / 654) < 1e-5);
  const again = placementFor(300, { containerWidth: 654 });
  assert.equal(wide.baseRatio, again.baseRatio, '同じ測定結果なら同じ値（保存ループを起こさない）');
});

test('23a. 署名者0名は「判別不能」ではなく、注意を出さず従来位置のまま', () => {
  // 目印はあるが署名者行が1つも無い状態（申請人未選択など）。
  const emptyBlock = signerBlock(TITLE_KEY, []);
  emptyBlock.box = rect(0, 0); // 行が無いのでレイアウトを持たない
  const origin = buildOrigin({ blocks: [emptyBlock] });
  const measured = measureSignerBlock(origin, TITLE_KEY);
  assert.equal(measured.found, false);
  assert.equal(measured.empty, true);

  const placement = resolveSignerStampPlacement({ measurement: measured, stampWidth: STAMP_WIDTH });
  assert.equal(placement.source, 'empty');
  assert.equal(placement.identified, true, '判別不能扱いにしない');
  assert.equal(placement.widthShortage, false);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH, '従来の右端位置のまま');
  assert.deepEqual(buildSignerStampNotices(placement), [], '誤解を招く注意を出さない');
  assert.equal(placement.baseRatio, null, '意味のない基準を保存しない');
  assert.equal(isSignerStampAutoAligned(placement), false);
});

test('23b. 署名者0名では保存済みの基準を上書きしない', () => {
  const emptyBlock = signerBlock(SAVE_KEY, []);
  emptyBlock.box = rect(0, 0);
  const origin = buildOrigin({ blocks: [emptyBlock] });
  const placement = resolveSignerStampPlacement({
    measurement: measureSignerBlock(origin, SAVE_KEY),
    storedBaseRatio: 0.44,
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.source, 'empty');
  assert.equal(placement.baseRatio, null);
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

test('23c. 署名者行はあるのに計測できない場合は判別不能として扱う', () => {
  // 行の目印は残っているが本文が消えた状態は、0名とは区別して注意を出す。
  const block = signerBlock(TITLE_KEY, [signerRow(0, [new FakeText('　', [rect(0, 20)])])]);
  const origin = buildOrigin({ blocks: [block] });
  const measured = measureSignerBlock(origin, TITLE_KEY);
  assert.equal(measured.found, false);
  assert.equal(measured.empty, false);
  assert.equal(measured.rowCount, 1);
  const placement = resolveSignerStampPlacement({ measurement: measured, stampWidth: STAMP_WIDTH });
  assert.equal(placement.identified, false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);
});

test('23. コンテナ幅が取れない間は配置を確定しない', () => {
  assert.equal(resolveSignerStampPlacement({ measurement: null, stampWidth: STAMP_WIDTH }), null);
  assert.equal(resolveSignerStampPlacement({
    measurement: { found: false, containerWidth: 0 }, stampWidth: STAMP_WIDTH,
  }), null);
});

// ---------------------------------------------------------------------------
// 4. 描画への反映（SSR）— P-AC13 / P-AC15
// ---------------------------------------------------------------------------

const RA_ID = 'ra-1';
const person = (id, name, roles, share = '1/2', extra = {}) => ({
  id, name, address: `架空県架空市${name}町1番`, roles, share, shareOverrides: {}, ...extra,
});
const site = reconcileSiteDocumentCompatibility({
  id: 'site-1',
  people: [
    person('p1', '架空 太郎', ['申請人'], '1/2', { nameKana: 'かくう たろう' }),
    person('p2', '架空 花子', ['申請人']),
    person('c1', '架空工務店', ['工事人'], ''),
  ],
  proposedBuildings: [{
    id: 'b1', address: '架空県架空市一丁目1番地', houseNum: '101番1', kind: '居宅',
    struct: '木造２階建', floorAreas: [{ id: 'f1', floor: '１階', area: '50.00' }],
    registrationCause: '新築', registrationDate: { era: '令和', year: '8', month: '1', day: '2' },
    additionalCauses: [], annexes: [], ownerPersonIds: ['p1', 'p2'], contractorPersonIds: ['c1'],
    confirmApplicantPersonIds: ['p1'], confirmApplicantNames: [],
  }],
  land: [], buildings: [],
  registrationApplications: [{
    id: RA_ID, type: '建物表題登記', targetBuildingIds: ['b1'], targetLandIds: [],
    applicantPersonIds: ['p1', 'p2'],
    subject: { beforeBuildingIds: [], afterBuildingIds: ['b1'], landIds: [], primaryBuildingId: null },
    documents: {
      '委任状（表題）': 1, '委任状（保存）': 1, '委任状（住所変更）': 1,
      '申述書（共有）': 1, '工事完了引渡証明書（表題）': 1,
    },
  }],
  docPick: {},
});

const renderDoc = (name, { pick = {}, isPrint = false } = {}) => realReact.renderToStaticMarkup(
  realReact.React.createElement(realReact.DocTemplate, {
    name, siteData: site, instanceKey: `${name}__1`, instanceIndex: 1,
    pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...pick },
    isPrint, scriveners: [], documentContext: null,
  })
);

test('24. 先行2帳票の署名欄には内部的な目印が入り、表示文言は変わらない', () => {
  const title = renderDoc('委任状（表題）');
  assert.ok(title.includes(`${SIGNER_BLOCK_ATTR}="${TITLE_KEY}"`));
  assert.ok(title.includes(`${SIGNER_ROW_ATTR}="0"`));
  assert.ok(title.includes(`${SIGNER_ROW_ATTR}="1"`));
  assert.ok(title.includes('委任者'), '見出し文言は維持する');
  assert.ok(title.includes('架空 太郎'));

  const save = renderDoc('委任状（保存）');
  assert.ok(save.includes(`${SIGNER_BLOCK_ATTR}="${SAVE_KEY}"`));
  // 保存の署名欄は住所・持分・ふりがな・氏名の各行のまま。
  assert.ok(save.includes('住　　所'));
  assert.ok(save.includes('持　　分'));
  assert.ok(save.includes('ふりがな'));
  assert.ok(save.includes('氏　　名'));
});

test('25. 対象外帳票には目印を付けず、印影列も従来の右端固定のまま', () => {
  for (const name of ['非登載証明書']) {
    const html = renderDoc(name);
    assert.ok(!html.includes(SIGNER_BLOCK_ATTR), `${name}に署名欄目印を付けない`);
    assert.ok(!html.includes(SIGNER_ROW_ATTR), `${name}に署名者行目印を付けない`);
  }
});

test('26. 計測前の初回描画では従来の右端に置き、印刷用DOMも同じ経路で描画する', () => {
  // SSRでは計測できないため、fallbackとして従来位置になる（印刷時に0幅の暫定値を使わない）。
  for (const isPrint of [false, true]) {
    const html = renderDoc('委任状（表題）', { isPrint });
    assert.ok(html.includes('right:0'));
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${TITLE_KEY}"`));
  }
});

test('27. 印影のドラッグ補正は自動基準からのdx/dyとして描画される', () => {
  const html = renderDoc('委任状（表題）', { pick: { signerStampPositions: [{ i: 1, dx: 14, dy: -7 }] } });
  assert.ok(html.includes('left:14px'), '補正dxは印影自身のleftとして加算される');
  assert.ok(html.includes('top:-7px'));
});

test('28. 帳票上部の印影とEditableDocBodyのcapture用DOMの扱いを変えていない', () => {
  const html = renderDoc('委任状（表題）');
  // 上部印影は right: calc(20mm - 0px) 基準のまま。
  assert.ok(/right:calc\(20mm - 0px\)/.test(html), '上部印影の初期配置は変更しない');
  assert.ok(DOC_TEMPLATE_SOURCE.includes('baseRightMm') === false);
});

// ---------------------------------------------------------------------------
// 5. 保存・リセット・他書類への非波及（P-AC08 / P-AC10 / P-AC11）
// ---------------------------------------------------------------------------

const applyPick = (baseSite, documentName, patch) => {
  const instanceKey = `${documentName}__1`;
  const current = { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...(baseSite.docPick?.[instanceKey] || {}) };
  return reconcileSiteDocumentCompatibility(
    { ...baseSite, docPick: { ...baseSite.docPick, [instanceKey]: { ...current, ...patch } } },
    { legacyPickIntentFields: { [instanceKey]: Object.keys(patch) } }
  );
};
const pickOf = (baseSite, documentName) => baseSite.docPick?.[`${documentName}__1`] || {};
const layoutOf = (baseSite, documentName) => {
  const application = (baseSite.registrationApplications || []).find(ra => ra.id === RA_ID);
  const templateKey = getDocumentTemplateKey(documentName);
  const instance = (application?.documentInstances || [])
    .find(i => i.templateKey === templateKey && i.copyIndex === 1);
  return instance?.layoutOverrides || {};
};

test('29. fallback基準はレイアウト情報として保存され、再読込で復元する', () => {
  const saved = applyPick(site, '委任状（保存）', { signerStampBaseRatio: 0.63 });
  assert.equal(pickOf(saved, '委任状（保存）').signerStampBaseRatio, 0.63);
  assert.equal(layoutOf(saved, '委任状（保存）').signerStampBaseRatio, 0.63);
  // 個別設定(selectionOverrides)側へは入れない。
  const application = (saved.registrationApplications || []).find(ra => ra.id === RA_ID);
  const instance = (application?.documentInstances || [])
    .find(i => i.templateKey === SAVE_KEY && i.copyIndex === 1);
  assert.equal(Object.prototype.hasOwnProperty.call(instance.selectionOverrides, 'signerStampBaseRatio'), false);

  // 保存済みsiteを再度正規化しても値が失われない（再読込相当）。
  const reloaded = reconcileSiteDocumentCompatibility(saved);
  assert.equal(pickOf(reloaded, '委任状（保存）').signerStampBaseRatio, 0.63);
});

test('30. 既定値(null)のときはレイアウト情報を作らない', () => {
  assert.equal(LEGACY_DOCUMENT_PICK_DEFAULTS.signerStampBaseRatio, null);
  const untouched = applyPick(site, '委任状（表題）', { signerStampBaseRatio: null });
  assert.equal(
    Object.prototype.hasOwnProperty.call(layoutOf(untouched, '委任状（表題）'), 'signerStampBaseRatio'),
    false
  );
});

test('31. 位置リセットは補正だけを初期化し、fallback基準と本文・確認状態を残す', () => {
  let saved = applyPick(site, '委任状（表題）', { signerStampBaseRatio: 0.42 });
  saved = applyPick(saved, '委任状（表題）', { signerStampPositions: [{ i: 0, dx: 21, dy: 7 }] });
  saved = applyPick(saved, '委任状（表題）', { customText: '<div>固定本文</div>' });

  const patch = buildStampPositionResetPatch();
  assert.deepEqual(Object.keys(patch).sort(), ['signerStampPositions', 'stampPositions']);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'signerStampBaseRatio'), false);

  const afterReset = applyPick(saved, '委任状（表題）', patch);
  const pick = pickOf(afterReset, '委任状（表題）');
  assert.equal(pick.signerStampPositions, null, '補正は初期化する');
  assert.equal(pick.signerStampBaseRatio, 0.42, 'fallback基準は失わない');
  assert.equal(pick.customText, '<div>固定本文</div>', '本文は保全する');
});

test('32. fallback基準は書類ごとに独立し、他帳票・別インスタンスへ漏れない', () => {
  const saved = applyPick(site, '委任状（表題）', { signerStampBaseRatio: 0.71 });
  assert.equal(pickOf(saved, '委任状（表題）').signerStampBaseRatio, 0.71);
  for (const other of ['委任状（保存）', '委任状（住所変更）', '申述書（共有）']) {
    assert.equal(pickOf(saved, other).signerStampBaseRatio ?? null, null, other);
    assert.equal(layoutOf(saved, other).signerStampBaseRatio ?? null, null, other);
  }
});

test('33. 自動計測の保存はレイアウト情報だけで、本文・人物・確認状態を変えない', () => {
  const before = applyPick(site, '委任状（保存）', { customText: '<div>固定</div>' });
  const after = applyPick(before, '委任状（保存）', { signerStampBaseRatio: 0.55 });
  assert.equal(pickOf(after, '委任状（保存）').customText, '<div>固定</div>');
  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.proposedBuildings, before.proposedBuildings);
  const beforeApp = (before.registrationApplications || []).find(ra => ra.id === RA_ID);
  const afterApp = (after.registrationApplications || []).find(ra => ra.id === RA_ID);
  const pickInstance = (app) => (app?.documentInstances || [])
    .find(i => i.templateKey === SAVE_KEY && i.copyIndex === 1);
  assert.deepEqual(pickInstance(afterApp).selectionOverrides, pickInstance(beforeApp).selectionOverrides);
  assert.equal(pickInstance(afterApp).editMode, pickInstance(beforeApp).editMode);
  assert.equal(pickInstance(afterApp).detachedHtml, pickInstance(beforeApp).detachedHtml);
});

// ---------------------------------------------------------------------------
// 6. 配線の保全（P-AC12 / P-AC14 / P-AC15）
// ---------------------------------------------------------------------------

test('34. 計測の保存と注意表示はプレビュー側だけに接続する', () => {
  // 印刷用DocTemplateへは保存・通知のcallbackを渡さない（旧書類や印刷DOMが書き込まない）。
  const printTemplate = DOCS_SOURCE.slice(
    DOCS_SOURCE.indexOf('id="print-area"'),
    DOCS_SOURCE.indexOf('<header')
  );
  assert.ok(printTemplate.includes('<DocTemplate'));
  assert.ok(!printTemplate.includes('onSignerStampBaselineChange'));
  assert.ok(!printTemplate.includes('onSignerStampNoticeChange'));
  assert.ok(DOCS_SOURCE.includes('onSignerStampBaselineChange={handleSignerStampBaselineChange}'));
  assert.ok(DOCS_SOURCE.includes('onSignerStampNoticeChange={handleSignerStampNoticeChange}'));
  // 書類切替後に前の書類の計測が書き込まれないようinstanceKeyで照合する。
  assert.ok(DOCS_SOURCE.includes("instanceKey !== activeInstanceKeyRef.current"));
});

test('34b. 注意は書類instanceに紐づけて描画し、前の書類の注意を残さない', () => {
  // 書類切替時のeffect順序に依存せず、キー照合で前書類の注意を描画しない。
  assert.ok(DOCS_SOURCE.includes('const [signerStampNotice, setSignerStampNotice] = useState({ key: '));
  assert.ok(DOCS_SOURCE.includes("signerStampNotice.key === activeInstanceKey"));
  assert.ok(DOCS_SOURCE.includes('activeSignerStampNotices.length > 0'));
  assert.ok(!/setSignerStampNotice\(\[\]\)/.test(DOCS_SOURCE));
});

test('35. 注意はプレビュー本文ではなく左パネルに出し、印刷本文へ混入させない', () => {
  assert.ok(DOCS_SOURCE.includes('data-testid="signer-stamp-notice"'));
  assert.ok(!DOC_TEMPLATE_SOURCE.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED));
  assert.ok(!DOC_TEMPLATE_SOURCE.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE));
  const title = renderDoc('委任状（表題）', { pick: { signerStampBaseRatio: 0.9 } });
  assert.ok(!title.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED));
  assert.ok(!title.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE));
  assert.ok(!title.includes('data-testid'));
});

test('36. 要確認・横幅不足・判別不能を印刷の禁止条件にしない', () => {
  // 印刷対象はprintOnだけで決まり、印影の注意状態は関与しない。
  assert.ok(DOCS_SOURCE.includes('allInstances.filter(inst => (siteData?.docPick?.[inst.key]?.printOn ?? true))'));
  const printBlock = DOCS_SOURCE.slice(DOCS_SOURCE.indexOf('const printSingleDoc'), DOCS_SOURCE.indexOf('const applicantsInPeople'));
  assert.ok(!printBlock.includes('signerStamp'));
});

test('37. 委任状（保存）の既存編集方式とP1対象4帳票の判定を変えていない', () => {
  // 保存はP1の明示全文編集対象ではない＝従来どおり常時編集可能のまま。
  assert.equal(isExplicitTextEditDocument('委任状（保存）'), false);
  assert.equal(isExplicitTextEditDocument('委任状（表題）'), true);
  // 本件でP1〜P4のUIを保存委任状へ横展開していない。
  assert.ok(DOCS_SOURCE.includes('usesSelectionCleanupUi({'));
});

// ---------------------------------------------------------------------------
// 7. 委任状8帳票への展開（R-AC01〜R-AC17）
//
// 今回追加する8帳票は、すでにPilotで受入済みの共通処理（renderDelegationCommon /
// measureSignerBlock / resolveSignerStampPlacement）をそのまま使う。
// ここで固定するのは「帳票ごとの実表示行の構成が、共通処理の比較対象として
// 正しく拾われること」で、共通処理そのものの再定義ではない。
// ---------------------------------------------------------------------------

// --- A. 複数行型（委任状（住所変更） / renderSignerMultiLine） --------------

// 住所・持分・ふりがな・氏名の4行を、行頭70pxそろえで作る。
// 各行の右端だけを差し替えて、基準行が正しく切り替わることを見る。
const addressChangeRows = ({ addressRight, shareRight, kanaRight, nameRight }, rowIndex = 0) =>
  signerRow(rowIndex, [
    new FakeText('住　　所　', [rect(0, 70)]),
    new FakeText('架空県架空市架空町一丁目1番1号', [rect(70, addressRight)]),
    new FakeText('持　　分　', [rect(0, 70, 20)]),
    new FakeText('２分の１', [rect(70, shareRight, 20)]),
    new FakeText('ふりがな　', [rect(0, 70, 40)]),
    new FakeText('かくう たろう', [rect(70, kanaRight, 40)]),
    new FakeText('氏　　名　', [rect(0, 70, 60)]),
    new FakeText('架空 太郎', [rect(70, nameRight, 60)]),
  ]);

const measureAddressChange = (rights) =>
  measureSignerBlock(
    buildOrigin({ blocks: [signerBlock(ADDRESS_KEY, [addressChangeRows(rights)])] }),
    ADDRESS_KEY
  );

test('38. 住所変更: 住所行が最長ならその実表示右端＋2emを基準にする', () => {
  const measured = measureAddressChange({ addressRight: 420, shareRight: 150, kanaRight: 240, nameRight: 260 });
  assert.equal(measured.found, true);
  assert.equal(measured.rowCount, 1);
  assert.equal(measured.maxRight, 420);
  assert.ok(Math.abs(measured.baseX - (420 + GAP_11PT)) < 0.01);
});

test('39. 住所変更: 氏名行が最長なら氏名行を基準にする（住所固定にしない）', () => {
  const measured = measureAddressChange({ addressRight: 240, shareRight: 150, kanaRight: 230, nameRight: 390 });
  assert.equal(measured.maxRight, 390);
  assert.ok(Math.abs(measured.baseX - (390 + GAP_11PT)) < 0.01);
});

test('40. 住所変更: ふりがな行が最長ならふりがな行を基準にする', () => {
  const measured = measureAddressChange({ addressRight: 240, shareRight: 150, kanaRight: 410, nameRight: 260 });
  assert.equal(measured.maxRight, 410);
  // 余白Gは署名欄の通常本文(11pt)基準のまま。ふりがなの文字サイズへ切り替えない。
  assert.ok(Math.abs(measured.gap - GAP_11PT) < 0.01);
});

test('41. 住所変更: 持分行が最長でも同じ原則で扱い、別行の幅を合算しない', () => {
  const measured = measureAddressChange({ addressRight: 240, shareRight: 430, kanaRight: 230, nameRight: 260 });
  assert.equal(measured.maxRight, 430);
  assert.notEqual(measured.maxRight, 240 + 430, '別行を足し合わせない');
});

test('42. 住所変更: 持分行が非表示の構成でも残りの行だけで基準が決まる', () => {
  // 単独申請人で持分を表示しない場合（renderSignerMultiLineのshowShare=false相当）。
  const block = signerBlock(ADDRESS_KEY, [signerRow(0, [
    new FakeText('住　　所　', [rect(0, 70)]),
    new FakeText('架空県架空市架空町一丁目1番1号', [rect(70, 300)]),
    new FakeText('氏　　名　', [rect(0, 70, 20)]),
    new FakeText('架空 太郎', [rect(70, 340, 20)]),
  ])]);
  const measured = measureSignerBlock(buildOrigin({ blocks: [block] }), ADDRESS_KEY);
  assert.equal(measured.maxRight, 340);
});

test('43. 住所変更: 2名の全表示行を比較し、全員共通の基準Xを1つに決める', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(ADDRESS_KEY, [
      addressChangeRows({ addressRight: 300, shareRight: 150, kanaRight: 230, nameRight: 250 }, 0),
      // 2人目は住所が短いが氏名が最も右まで伸びる。
      addressChangeRows({ addressRight: 260, shareRight: 150, kanaRight: 230, nameRight: 445 }, 1),
    ])],
  });
  const measured = measureSignerBlock(origin, ADDRESS_KEY);
  assert.equal(measured.rowCount, 2);
  assert.equal(measured.maxRight, 445, '署名者をまたいだ全表示行の最大right');
  const placement = resolveSignerStampPlacement({ measurement: measured, stampWidth: STAMP_WIDTH });
  assert.ok(Math.abs(placement.baseX - (445 + GAP_11PT)) < 0.01);
  // 印影列は全署名者共通の1コンテナなので、基準Xが1つ＝全員のXが揃う。
  assert.equal(placement.renderX, placement.baseX);
});

// --- B. 通常行＋被相続人/相続人の追加行（その他7帳票） ---------------------

// renderOwnerWithDecedent は「被相続人◯◯」「相続人　通常行」の2行を
// 同じ署名者行(data-signer-row)の中に縦積みで描く。
const decedentRow = ({ decedentRight, normalRight }, rowIndex = 0) =>
  signerRow(rowIndex, [
    new FakeText('被相続人　', [rect(0, 70)]),
    new FakeText('架空 先代', [rect(70, decedentRight)]),
    new FakeText('相続人　　', [rect(0, 70, 20)]),
    new FakeText('架空県架空市架空町1番　持分２分の１　架空 太郎', [rect(70, normalRight, 20)]),
  ]);

test('44. 2行型: 通常行（相続人行）が最長ならその行を基準にする', () => {
  const origin = buildOrigin({ blocks: [signerBlock(LOSS_KEY, [decedentRow({ decedentRight: 200, normalRight: 380 })])] });
  const measured = measureSignerBlock(origin, LOSS_KEY);
  assert.equal(measured.found, true);
  assert.equal(measured.rowCount, 1, '2行でも署名者行は1つ');
  assert.equal(measured.maxRight, 380);
  assert.ok(Math.abs(measured.baseX - (380 + GAP_11PT)) < 0.01);
});

test('45. 2行型: 被相続人の追加行が最長なら追加行を基準にする', () => {
  const origin = buildOrigin({ blocks: [signerBlock(LOSS_KEY, [decedentRow({ decedentRight: 465, normalRight: 380 })])] });
  const measured = measureSignerBlock(origin, LOSS_KEY);
  assert.equal(measured.maxRight, 465, '追加行も同じ署名欄の表示行として比較する');
  assert.ok(Math.abs(measured.baseX - (465 + GAP_11PT)) < 0.01);
});

test('46. 2行型: 通常1行の署名者と2行の署名者が混在しても全行から最大を取る', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(LAND_CATEGORY_KEY, [
      // 1人目は被相続人なしの通常1行。
      signerRow(0, [new FakeText('架空県架空市架空町1番　持分２分の１　架空 太郎', [rect(0, 350)])]),
      // 2人目は被相続人ありで2行。追加行が最長。
      decedentRow({ decedentRight: 470, normalRight: 360 }, 1),
    ])],
  });
  const measured = measureSignerBlock(origin, LAND_CATEGORY_KEY);
  assert.equal(measured.rowCount, 2);
  assert.equal(measured.maxRight, 470);
  const placement = resolveSignerStampPlacement({ measurement: measured, stampWidth: STAMP_WIDTH });
  assert.equal(placement.renderX, placement.baseX, '手動補正なしなら全員同じX');
  assert.ok(Math.abs(placement.baseX - (470 + GAP_11PT)) < 0.01);
});

test('47. 2行型: 署名者3名でも全署名者・全表示行の最大rightで1つに揃う', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(LOSS_KEY, [
      signerRow(0, [new FakeText('A 通常行', [rect(0, 240)])]),
      decedentRow({ decedentRight: 310, normalRight: 275 }, 1),
      signerRow(2, [new FakeText('C 通常行', [rect(0, 288)])]),
    ])],
  });
  const measured = measureSignerBlock(origin, LOSS_KEY);
  assert.equal(measured.rowCount, 3);
  assert.equal(measured.maxRight, 310);
});

test('48. 2行型: 1名でもその署名者の全表示行の最長right＋2emを使う', () => {
  const origin = buildOrigin({ blocks: [signerBlock(LOSS_KEY, [decedentRow({ decedentRight: 402, normalRight: 260 })])] });
  const placement = resolveSignerStampPlacement({
    measurement: measureSignerBlock(origin, LOSS_KEY),
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.source, 'measured');
  assert.ok(Math.abs(placement.baseX - (402 + GAP_11PT)) < 0.01);
});

test('49. 今回対象帳票の署名欄keyは相互に混ざらない', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(LOSS_KEY, [signerRow(0, [new FakeText('滅失の行', [rect(0, 500)])])])],
  });
  assert.equal(measureSignerBlock(origin, LOSS_KEY).found, true);
  for (const key of [ADDRESS_KEY, LAND_CATEGORY_KEY, TITLE_KEY, SAVE_KEY]) {
    assert.equal(measureSignerBlock(origin, key).found, false, key);
  }
});

test('50. 今回対象帳票でも全文編集後の再計測は編集後DOMの実表示に従う', () => {
  const before = measureSignerBlock(
    buildOrigin({ blocks: [signerBlock(LOSS_KEY, [decedentRow({ decedentRight: 200, normalRight: 300 })])] }),
    LOSS_KEY
  );
  assert.equal(before.maxRight, 300);
  // 署名欄内で追記して行が増え、追加行が最長になった編集後DOM。
  const afterOrigin = buildOrigin({
    blocks: [signerBlock(LOSS_KEY, [signerRow(0, [
      new FakeText('被相続人　架空 先代', [rect(0, 200)]),
      new FakeText('相続人　　架空県架空市架空町1番　架空 太郎', [rect(0, 300, 20)]),
      new FakeText('（編集で追記された長い行）', [rect(0, 455, 40)]),
    ])])],
  });
  const after = measureSignerBlock(afterOrigin, LOSS_KEY);
  assert.equal(after.maxRight, 455, '編集後の表示行を含めて再計測する');
  assert.notEqual(after.baseX, before.baseX);
});

// --- C. 実描画（SSR）での8帳票有効化 ---------------------------------------

const ROLLOUT_RA = {
  '委任状（住所変更）': { id: 'ra-change', type: '建物表題部変更登記' },
  '委任状（表題部変更）': { id: 'ra-change', type: '建物表題部変更登記' },
  '委任状（地目変更）': { id: 'ra-land', type: '土地地目変更登記' },
  '委任状（滅失）': { id: 'ra-loss', type: '建物滅失登記' },
  '委任状（表題部更正）': { id: 'ra-correct', type: '建物表題部更正登記' },
  '委任状（合併）': { id: 'ra-merge', type: '建物合併登記' },
  '委任状（分割）': { id: 'ra-split', type: '建物分割登記' },
  '委任状（合体）': { id: 'ra-combine', type: '建物合体登記' },
};

// 今回対象の8帳票を実際に描画するための架空案件。
// 委任状（地目変更）は土地所有者、委任状（滅失）は建物所有者を署名者に使うため、
// 同一人物へ複数roleを与えて全帳票が同じ2名を署名者にできるようにする。
// 2人目に decedentName を入れて renderOwnerWithDecedent の2行を実描画で作る。
const rolloutPerson = (id, name, extra = {}) => ({
  id, name, address: `架空県架空市${name}町1番1号`,
  roles: ['申請人', '建物所有者', '土地所有者'],
  share: '1/2', shareOverrides: {}, ...extra,
});
const rolloutLand = {
  id: 'rl1', address: '架空県架空市二丁目', lotNumber: '2番2',
  category: '畑', newCategory: '宅地', categoryChangeEnabled: true, area: '120.00',
};
const rolloutBuilding = {
  id: 'rb1', address: '架空県架空市二丁目2番地', houseNum: '202番2', kind: '居宅', struct: '木造平家建',
  floorAreas: [{ id: 'rfa1', floor: '１階', area: '60.00' }], annexes: [], additionalCauses: [],
};
const rolloutProposed = {
  ...rolloutBuilding, id: 'rp1',
  registrationCause: '取壊し', registrationDate: { era: '令和', year: '8', month: '2', day: '3' },
  ownerPersonIds: ['r1', 'r2'], contractorPersonIds: [],
  confirmApplicantPersonIds: [], confirmApplicantNames: [],
};
const rolloutSite = reconcileSiteDocumentCompatibility({
  id: 'site-rollout',
  people: [
    rolloutPerson('r1', '架空 一郎', { nameKana: 'かくう いちろう' }),
    rolloutPerson('r2', '架空 二郎', { nameKana: 'かくう じろう', decedentName: '架空 先代' }),
  ],
  land: [rolloutLand],
  buildings: [rolloutBuilding],
  proposedBuildings: [rolloutProposed],
  registrationApplications: Object.entries(
    ROLLOUT_DOCUMENTS.reduce((acc, documentName) => {
      const ra = ROLLOUT_RA[documentName];
      acc[ra.id] = acc[ra.id] || { type: ra.type, documents: {} };
      acc[ra.id].documents[documentName] = 1;
      return acc;
    }, {})
  ).map(([id, { type, documents }]) => ({
    id, type,
    targetBuildingIds: type === '土地地目変更登記' ? [] : [rolloutBuilding.id],
    targetLandIds: type === '土地地目変更登記' ? [rolloutLand.id] : [],
    applicantPersonIds: ['r1', 'r2'],
    subject: {
      beforeBuildingIds: type === '土地地目変更登記' ? [] : [rolloutBuilding.id],
      afterBuildingIds: type === '土地地目変更登記' ? [] : [rolloutProposed.id],
      landIds: type === '土地地目変更登記' ? [rolloutLand.id] : [],
      primaryBuildingId: null,
    },
    documents,
  })),
  docPick: {},
});

const renderRolloutDoc = (name, { pick = {}, isPrint = false } = {}) => realReact.renderToStaticMarkup(
  realReact.React.createElement(realReact.DocTemplate, {
    name, siteData: rolloutSite, instanceKey: `${name}__1`, instanceIndex: 1,
    pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...pick },
    isPrint, scriveners: [], documentContext: null,
  })
);

test('51. 今回の8帳票すべてで署名欄・署名者行の目印が実描画に入る', () => {
  for (const name of ROLLOUT_DOCUMENTS) {
    const html = renderRolloutDoc(name);
    const key = getDocumentTemplateKey(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${key}"`), `${name}の署名欄目印`);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`), `${name}の署名者行0`);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="1"`), `${name}の署名者行1`);
    assert.ok(html.includes('委任者'), `${name}の見出し文言は維持する`);
    assert.ok(html.includes('架空 一郎'), `${name}の署名者表示は維持する`);
    assert.ok(html.includes('架空 二郎'), `${name}の署名者表示は維持する`);
  }
});

test('52. 委任状（住所変更）の署名欄は住所・持分・ふりがな・氏名の各行のまま', () => {
  const html = renderRolloutDoc('委任状（住所変更）');
  assert.ok(html.includes('住　　所'));
  assert.ok(html.includes('持　　分'));
  assert.ok(html.includes('ふりがな'));
  assert.ok(html.includes('氏　　名'));
  assert.ok(html.includes('かくう いちろう'));
  // 住所変更は被相続人の追加行を持つ帳票ではない（行構成を変えていない）。
  assert.ok(!html.includes('被相続人'));
});

test('53. 2行型帳票では被相続人/相続人の2行が同じ署名者行の中に描かれる', () => {
  for (const name of ROLLOUT_DECEDENT_DOCUMENTS) {
    const html = renderRolloutDoc(name);
    assert.ok(html.includes('被相続人'), `${name}に被相続人行がある`);
    assert.ok(html.includes('架空 先代'), `${name}に被相続人名がある`);
    assert.ok(html.includes('相続人'), `${name}に相続人行がある`);
    // 2行は data-signer-row="1" の中にあるので、署名者行の総数は2名分のまま。
    const rowMarkers = html.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || [];
    assert.equal(rowMarkers.length, 2, `${name}の署名者行は2名分`);
  }
});

test('54. 今回対象帳票の印影列も計測前は従来の右端で、印刷用DOMも同じ経路で描画する', () => {
  for (const name of ['委任状（住所変更）', '委任状（滅失）']) {
    for (const isPrint of [false, true]) {
      const html = renderRolloutDoc(name, { isPrint });
      assert.ok(html.includes('right:0'), `${name} isPrint=${isPrint}`);
      assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${getDocumentTemplateKey(name)}"`));
    }
    // 注意文・data-testidは本文へ入れない。
    const html = renderRolloutDoc(name, { pick: { signerStampBaseRatio: 0.9 } });
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED));
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE));
    assert.ok(!html.includes('data-testid'));
  }
});

test('55. 今回対象帳票でも上部印影の初期配置を変えていない', () => {
  for (const name of ROLLOUT_DOCUMENTS) {
    const html = renderRolloutDoc(name);
    assert.ok(/right:calc\(20mm - 0px\)/.test(html), `${name}の上部印影`);
  }
});

test('56. 今回対象帳票の署名者0名は「判別不能」にせず注意も出さない', () => {
  // 土地所有者・申請人が居ない案件の委任状（地目変更）＝署名者0名。
  const noOwnerSite = reconcileSiteDocumentCompatibility({
    ...rolloutSite,
    people: (rolloutSite.people || []).map(p => ({ ...p, roles: ['その他'] })),
    docPick: {},
  });
  const html = realReact.renderToStaticMarkup(
    realReact.React.createElement(realReact.DocTemplate, {
      name: '委任状（地目変更）', siteData: noOwnerSite, instanceKey: '委任状（地目変更）__1', instanceIndex: 1,
      pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, applicantPersonIds: [] },
      isPrint: false, scriveners: [], documentContext: null,
    })
  );
  assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${LAND_CATEGORY_KEY}"`), '目印自体は残る');
  assert.ok(!html.includes(`${SIGNER_ROW_ATTR}=`), '署名者行は無い');

  // 目印はあるが署名者行0の状態は empty として扱い、注意を出さない。
  const emptyBlock = signerBlock(LAND_CATEGORY_KEY, []);
  emptyBlock.box = rect(0, 0);
  const placement = resolveSignerStampPlacement({
    measurement: measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), LAND_CATEGORY_KEY),
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.source, 'empty');
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

// --- D. fallback / 横幅不足 / drag・reset / データ保全 ----------------------

test('57. 今回対象帳票のfallback: 目印が消えたら保持基準、基準なしは従来右端', () => {
  // 本文の丸ごと貼替えで目印が消えた編集後DOM。
  const pasted = buildOrigin({
    blocks: [new FakeElement({ box: rect(0, 600), children: [new FakeText('貼り付けられた本文', [rect(0, 500)])] })],
  });
  const lost = measureSignerBlock(pasted, LOSS_KEY);
  assert.equal(lost.found, false);

  const stored = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: 0.58, stampWidth: STAMP_WIDTH });
  assert.equal(stored.source, 'stored');
  assert.ok(Math.abs(stored.baseX - 0.58 * 654) < 0.01);
  assert.equal(stored.baseRatio, null, 'fallback中は基準を上書き保存しない');
  assert.deepEqual(buildSignerStampNotices(stored), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);

  const legacy = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: null, stampWidth: STAMP_WIDTH });
  assert.equal(legacy.source, 'legacy-right');
  assert.equal(legacy.renderX, 654 - STAMP_WIDTH);
  assert.equal(isSignerStampAutoAligned(legacy), false);
});

test('58. 今回対象帳票の横幅不足は非阻害の注意だけで、印影を紙面内に留める', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(ADDRESS_KEY, [signerRow(0, [
      new FakeText('住　　所　架空県架空市架空町一丁目1番1号架空マンション101号室', [rect(0, 610)]),
    ])])],
  });
  const placement = resolveSignerStampPlacement({
    measurement: measureSignerBlock(origin, ADDRESS_KEY),
    stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.identified, true, '署名欄は判別できている（U2でありU3ではない）');
  assert.equal(placement.widthShortage, true);
  assert.equal(isSignerStampAutoAligned(placement), false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE]);
  // 自動縮小・余白圧縮をしないので基準X自体は収まらないままで、描画だけ紙面内に留める。
  assert.ok(placement.baseX > placement.containerWidth - STAMP_WIDTH);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH);
});

test('59. 今回対象帳票のdrag補正は自動基準からのdx/dyとして描画される', () => {
  const html = renderRolloutDoc('委任状（滅失）', { pick: { signerStampPositions: [{ i: 1, dx: 18, dy: -6 }] } });
  assert.ok(html.includes('left:18px'));
  assert.ok(html.includes('top:-6px'));
});

test('60. 今回対象帳票のresetは補正だけ初期化し、fallback基準と本文を残す', () => {
  let saved = applyPick(rolloutSite, '委任状（滅失）', { signerStampBaseRatio: 0.47 });
  saved = applyPick(saved, '委任状（滅失）', { signerStampPositions: [{ i: 0, dx: 24, dy: 9 }] });
  saved = applyPick(saved, '委任状（滅失）', { customText: '<div>滅失の固定本文</div>' });

  const afterReset = applyPick(saved, '委任状（滅失）', buildStampPositionResetPatch());
  const pick = afterReset.docPick?.['委任状（滅失）__1'] || {};
  assert.equal(pick.signerStampPositions, null, '補正は初期化する');
  assert.equal(pick.stampPositions, null);
  assert.equal(pick.signerStampBaseRatio, 0.47, 'fallback基準は失わない');
  assert.equal(pick.customText, '<div>滅失の固定本文</div>', '本文は保全する');
});

test('61. 今回対象帳票のfallback基準はレイアウト情報として保存し、再読込で復元する', () => {
  const saved = applyPick(rolloutSite, '委任状（住所変更）', { signerStampBaseRatio: 0.66 });
  const instanceOf = (siteObj, documentName) => {
    const templateKey = getDocumentTemplateKey(documentName);
    for (const app of siteObj.registrationApplications || []) {
      const hit = (app.documentInstances || []).find(i => i.templateKey === templateKey && i.copyIndex === 1);
      if (hit) return hit;
    }
    return null;
  };
  assert.equal(saved.docPick?.['委任状（住所変更）__1']?.signerStampBaseRatio, 0.66);
  assert.equal(instanceOf(saved, '委任状（住所変更）').layoutOverrides.signerStampBaseRatio, 0.66);
  assert.equal(
    Object.prototype.hasOwnProperty.call(instanceOf(saved, '委任状（住所変更）').selectionOverrides, 'signerStampBaseRatio'),
    false,
    '個別設定へは入れない'
  );
  const reloaded = reconcileSiteDocumentCompatibility(saved);
  assert.equal(reloaded.docPick?.['委任状（住所変更）__1']?.signerStampBaseRatio, 0.66);
});

test('62. 今回対象帳票の自動計測は本文・個別設定・業務データを変更しない', () => {
  const before = applyPick(rolloutSite, '委任状（合体）', { customText: '<div>合体の固定本文</div>' });
  const after = applyPick(before, '委任状（合体）', { signerStampBaseRatio: 0.52 });
  assert.equal(after.docPick?.['委任状（合体）__1']?.customText, '<div>合体の固定本文</div>');
  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.land, before.land);
  assert.deepEqual(after.buildings, before.buildings);
  assert.deepEqual(after.proposedBuildings, before.proposedBuildings);
  const instancesOf = (siteObj) => (siteObj.registrationApplications || [])
    .flatMap(app => (app.documentInstances || []).map(i => [
      i.templateKey, i.copyIndex, i.selectionOverrides, i.editMode, i.detachedHtml, i.active, i.printEnabled,
    ]));
  assert.deepEqual(instancesOf(after), instancesOf(before), 'レイアウト以外の書類状態を変えない');
});

test('63. 今回対象帳票のfallback基準は他帳票・別案件へ漏れない', () => {
  const saved = applyPick(rolloutSite, '委任状（分割）', { signerStampBaseRatio: 0.73 });
  assert.equal(saved.docPick?.['委任状（分割）__1']?.signerStampBaseRatio, 0.73);
  for (const other of ROLLOUT_DOCUMENTS.filter(n => n !== '委任状（分割）')) {
    assert.equal(saved.docPick?.[`${other}__1`]?.signerStampBaseRatio ?? null, null, other);
  }
  // 別案件（Pilot fixtureのsite）には一切影響しない。
  assert.equal(site.docPick?.['委任状（表題）__1']?.signerStampBaseRatio ?? null, null);
});

// --- E. Pilot2帳票・対象外帳票の回帰 ----------------------------------------

test('64. Pilot2帳票は今回の展開後も同じ経路・同じ目印のまま', () => {
  for (const name of PILOT_DOCUMENTS) {
    const html = renderDoc(name);
    const key = getDocumentTemplateKey(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${key}"`), name);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`), name);
    assert.ok(html.includes('right:0'), `${name}は計測前は従来の右端`);
    assert.ok(!html.includes('被相続人'), `${name}の行構成は変えていない`);
  }
  // 表題は同一行、保存は複数行という行構成の違いも維持する。
  assert.ok(renderDoc('委任状（保存）').includes('ふりがな'));
  assert.ok(!renderDoc('委任状（表題）').includes('ふりがな'));
});

test('65. 対象外帳票には今回も目印・baseline保存・注意が出ない', () => {
  for (const name of ['非登載証明書']) {
    assert.equal(isSignerStampAutoAlignDocument(name), false, name);
    assert.equal(buildSignerBlockAttributes(name), null, name);
    assert.equal(buildSignerRowAttributes(name, 0), null, name);
  }
  for (const name of ['非登載証明書']) {
    const html = renderDoc(name);
    assert.ok(!html.includes(SIGNER_BLOCK_ATTR), `${name}に署名欄目印を付けない`);
    assert.ok(!html.includes(SIGNER_ROW_ATTR), `${name}に署名者行目印を付けない`);
    // 非登載証明書はそもそも署名者印影列を持たない従来構成のまま。
    assert.ok(!html.includes('stamp-drag-handle') || !html.includes(SIGNER_BLOCK_ATTR), name);
  }
  // 注意の描画自体が対象帳票ガードの内側にある。
  assert.ok(DOCS_SOURCE.includes('isSignerStampAutoAlignDocument(activeInstance.name) && activeSignerStampNotices.length > 0'));
});

// ---------------------------------------------------------------------------
// 8. 証明書4帳票への展開（C-AC01〜C-AC18）
//
// 4帳票は renderDelegationCommon を使わず、DocTemplate の個別branchで描画される。
// 共通の計測・配置・fallback・保存coreは委任状と同じものを再利用しているので、
// ここで固定するのは「個別branchへの接続」と「工事人3行の候補行の扱い」。
// ---------------------------------------------------------------------------

const COMPLETION_TITLE_KEY = getDocumentTemplateKey('工事完了引渡証明書（表題）');
const COMPLETION_CHANGE_KEY = getDocumentTemplateKey('工事完了引渡証明書（表題部変更）');
const LOSS_CERT_KEY = getDocumentTemplateKey('滅失証明書（滅失）');
const LOSS_CERT_CHANGE_KEY = getDocumentTemplateKey('滅失証明書（表題部変更）');
// 工事人署名欄の通常本文は12pt。余白Gはこのブロックのcomputed font-sizeから算出される。
const CERT_FONT_PX = 16; // 12pt
const GAP_12PT = CERT_FONT_PX * SIGNER_STAMP_GAP_EM;

// 12pt の署名欄ブロック。委任状（11pt）と別サイズであることを明示する。
const certBlock = (key, rows) => new FakeElement({
  attrs: { [SIGNER_BLOCK_ATTR]: key },
  box: rect(0, 600),
  fontSize: `${CERT_FONT_PX}px`,
  children: rows,
});

// 実DOMと同じ行構成:
//   <p>住所　{address}</p> / <p>氏名　{name}</p> / <p>　　　{representative}</p>
// 見出し「住所　」等とその値は別テキストノードになる。
// representative未入力時は "　　　" + "　" ＝ 全角空白だけの行になる。
const contractorRow = ({ addressRight, nameRight, repRight, rep = true }) =>
  signerRow(0, [
    new FakeText('住所　', [rect(0, 64)]),
    new FakeText('架空県架空市工町三丁目3番3号', [rect(64, addressRight)]),
    new FakeText('氏名　', [rect(0, 64, 22)]),
    new FakeText('架空工務店株式会社', [rect(64, nameRight, 22)]),
    new FakeText('　　　', [rect(0, 64, 44)]),
    rep
      ? new FakeText('代表取締役　架空 工太郎', [rect(64, repRight, 44)])
      // 未入力時のフォールバック。全角空白なので基準行にしない。
      : new FakeText('　', [rect(64, repRight, 44)]),
  ]);

const measureContractor = (opts, key = COMPLETION_TITLE_KEY) =>
  measureSignerBlock(buildOrigin({ blocks: [certBlock(key, [contractorRow(opts)])] }), key);

test('66. 証明書: 住所行が最長ならその実表示右端＋2emを基準にする', () => {
  const m = measureContractor({ addressRight: 430, nameRight: 300, repRight: 320 });
  assert.equal(m.found, true);
  assert.equal(m.rowCount, 1, '単独工事人なので署名者行は1つ');
  assert.equal(m.maxRight, 430);
  assert.ok(Math.abs(m.baseX - (430 + GAP_12PT)) < 0.01);
});

test('67. 証明書: 氏名行が最長なら氏名行を基準にする', () => {
  const m = measureContractor({ addressRight: 280, nameRight: 415, repRight: 300 });
  assert.equal(m.maxRight, 415);
  assert.ok(Math.abs(m.baseX - (415 + GAP_12PT)) < 0.01);
});

test('68. 証明書: 代表者行が最長なら代表者行を基準にする', () => {
  const m = measureContractor({ addressRight: 280, nameRight: 300, repRight: 468 });
  assert.equal(m.maxRight, 468);
  assert.ok(Math.abs(m.baseX - (468 + GAP_12PT)) < 0.01);
});

test('69. 証明書: 代表者が未入力なら空白行を最長判定に使わない', () => {
  // 代表者行の矩形は右まで伸びていても、中身が全角空白なら基準にしない。
  const m = measureContractor({ addressRight: 330, nameRight: 300, repRight: 560, rep: false });
  assert.equal(m.maxRight, 330, '空白行ではなく住所行が基準');
  assert.ok(Math.abs(m.baseX - (330 + GAP_12PT)) < 0.01);
  // 見出しの「　　　」も空白なので候補に入らない（住所/氏名の値2本＋見出し2本）。
  assert.equal(m.lineCount, 4);
});

test('70. 証明書: 余白は署名欄の12ptから算出し、委任状の11pt値を流用しない', () => {
  const m = measureContractor({ addressRight: 430, nameRight: 300, repRight: 320 });
  assert.ok(Math.abs(m.gap - GAP_12PT) < 0.01);
  assert.notEqual(Math.round(m.gap), Math.round(GAP_11PT), '11ptの余白とは異なる');
  // 11ptの委任状ブロックは従来どおり11pt基準のまま。
  const deleg = measureSignerBlock(
    buildOrigin({ blocks: [signerBlock(TITLE_KEY, [signerRow(0, [new FakeText('行', [rect(0, 300)])])])] }),
    TITLE_KEY
  );
  assert.ok(Math.abs(deleg.gap - GAP_11PT) < 0.01);
});

test('71. 証明書: 単独署名者でも3行すべてが同じ署名欄の候補行になる', () => {
  const m = measureContractor({ addressRight: 300, nameRight: 310, repRight: 305 });
  assert.equal(m.rowCount, 1);
  // 住所/氏名の見出し2本＋値3本＝5本。代表者行の行頭「　　　」は全角空白なので候補にしない。
  assert.equal(m.lineCount, 5);
  assert.equal(m.maxRight, 310);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.source, 'measured');
  assert.equal(placement.renderX, placement.baseX);
  assert.equal(isSignerStampAutoAligned(placement), true);
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

test('72. 証明書: 工事人なしは署名者行0件のemptyとして扱い、注意も保存もしない', () => {
  // 目印は残すが署名者行を作らない構造（空欄表示のまま）。
  const emptyBlock = new FakeElement({
    attrs: { [SIGNER_BLOCK_ATTR]: LOSS_CERT_KEY },
    box: rect(0, 600),
    fontSize: `${CERT_FONT_PX}px`,
    children: [new FakeText('　', [rect(0, 20)])],
  });
  const measured = measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), LOSS_CERT_KEY);
  assert.equal(measured.found, false);
  assert.equal(measured.empty, true, '判別不能ではなくempty');
  assert.equal(measured.rowCount, 0);

  const placement = resolveSignerStampPlacement({
    measurement: measured, storedBaseRatio: null, stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.source, 'empty');
  assert.equal(placement.identified, true);
  assert.equal(placement.widthShortage, false);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH, '従来の右端位置のまま');
  assert.equal(placement.baseRatio, null, '基準を新規保存しない');
  assert.deepEqual(buildSignerStampNotices(placement), [], '不要な注意を出さない');
});

test('72b. 証明書: 工事人なしでも保存済みの基準を上書きしない', () => {
  const emptyBlock = new FakeElement({
    attrs: { [SIGNER_BLOCK_ATTR]: COMPLETION_CHANGE_KEY },
    box: rect(0, 600), fontSize: `${CERT_FONT_PX}px`,
    children: [new FakeText('　', [rect(0, 20)])],
  });
  const placement = resolveSignerStampPlacement({
    measurement: measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), COMPLETION_CHANGE_KEY),
    storedBaseRatio: 0.51, stampWidth: STAMP_WIDTH,
  });
  assert.equal(placement.source, 'empty');
  assert.equal(placement.baseRatio, null);
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

test('73. 証明書: 目印が消えたら保持基準、基準なしは従来右端へ仮配置する', () => {
  const pasted = buildOrigin({
    blocks: [new FakeElement({ box: rect(0, 600), children: [new FakeText('貼り付けられた本文', [rect(0, 500)])] })],
  });
  const lost = measureSignerBlock(pasted, COMPLETION_TITLE_KEY);
  assert.equal(lost.found, false);
  assert.equal(lost.empty, false);

  const stored = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: 0.61, stampWidth: STAMP_WIDTH });
  assert.equal(stored.source, 'stored');
  assert.ok(Math.abs(stored.baseX - 0.61 * 654) < 0.01);
  assert.equal(stored.baseRatio, null, 'fallback中は基準を上書き保存しない');
  assert.deepEqual(buildSignerStampNotices(stored), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);

  const legacy = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: null, stampWidth: STAMP_WIDTH });
  assert.equal(legacy.source, 'legacy-right');
  assert.equal(legacy.renderX, 654 - STAMP_WIDTH);
  assert.equal(isSignerStampAutoAligned(legacy), false);
});

test('74. 証明書: 横幅不足は非阻害の注意だけで、印影を紙面内に留める', () => {
  const m = measureContractor({ addressRight: 615, nameRight: 300, repRight: 320 });
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.identified, true, '署名欄は判別できている');
  assert.equal(placement.widthShortage, true);
  assert.equal(isSignerStampAutoAligned(placement), false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE]);
  // 自動縮小・余白圧縮をしないので基準Xは収まらないまま、描画だけ紙面内に留める。
  assert.ok(placement.baseX > placement.containerWidth - STAMP_WIDTH);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH);
});

test('75. 証明書: 全文編集後も目印が残る限り編集後DOMの実表示で再計測する', () => {
  const before = measureContractor({ addressRight: 300, nameRight: 310, repRight: 305 });
  assert.equal(before.maxRight, 310);
  const afterOrigin = buildOrigin({
    blocks: [certBlock(COMPLETION_TITLE_KEY, [signerRow(0, [
      new FakeText('住所　架空県架空市工町三丁目3番3号', [rect(0, 300)]),
      new FakeText('氏名　架空工務店株式会社', [rect(0, 310, 22)]),
      new FakeText('　　　代表取締役　架空 工太郎', [rect(0, 305, 44)]),
      new FakeText('（編集で追記された長い行）', [rect(0, 470, 66)]),
    ])])],
  });
  const after = measureSignerBlock(afterOrigin, COMPLETION_TITLE_KEY);
  assert.equal(after.maxRight, 470, '編集後の表示行を含めて再計測する');
  assert.ok(Math.abs(after.baseX - (470 + GAP_12PT)) < 0.01);
});

test('76. 証明書の署名欄keyは相互にも委任状とも混ざらない', () => {
  const origin = buildOrigin({
    blocks: [certBlock(LOSS_CERT_KEY, [signerRow(0, [new FakeText('滅失証明書の行', [rect(0, 400)])])])],
  });
  assert.equal(measureSignerBlock(origin, LOSS_CERT_KEY).found, true);
  for (const key of [COMPLETION_TITLE_KEY, COMPLETION_CHANGE_KEY, LOSS_CERT_CHANGE_KEY, TITLE_KEY, SAVE_KEY]) {
    assert.equal(measureSignerBlock(origin, key).found, false, key);
  }
});

// --- 実描画（SSR）での4帳票接続 -------------------------------------------

const CERT_RA = {
  '工事完了引渡証明書（表題）': { id: 'rac1', type: '建物表題登記' },
  '工事完了引渡証明書（表題部変更）': { id: 'rac2', type: '建物表題部変更登記' },
  '滅失証明書（表題部変更）': { id: 'rac2', type: '建物表題部変更登記' },
  '滅失証明書（滅失）': { id: 'rac3', type: '建物滅失登記' },
};

// 証明書4帳票を描画するための架空案件。工事人1名に代表者を入れる。
const certPerson = (id, name, roles, extra = {}) => ({
  id, name, address: `架空県架空市${name}町1番`, roles, share: '1/1', shareOverrides: {}, ...extra,
});
const certRegBuilding = {
  id: 'cb1', address: '架空県架空市三丁目3番地', houseNum: '303番3', kind: '居宅', struct: '木造平家建',
  floorAreas: [{ id: 'cfa1', floor: '１階', area: '55.00' }], annexes: [], additionalCauses: [],
};
const certProposed = {
  ...certRegBuilding, id: 'cp1',
  registrationCause: '取壊し', registrationDate: { era: '令和', year: '8', month: '3', day: '4' },
  ownerPersonIds: ['co1'], contractorPersonIds: ['cc1'],
  confirmApplicantPersonIds: [], confirmApplicantNames: [],
};
const buildCertSite = ({ withContractor = true } = {}) => reconcileSiteDocumentCompatibility({
  id: 'site-cert',
  people: [
    certPerson('co1', '架空 施主', ['申請人', '建物所有者']),
    ...(withContractor
      ? [certPerson('cc1', '架空工務店株式会社', ['工事人'], {
          address: '架空県架空市工町三丁目3番3号', share: '',
          representative: '代表取締役　架空 工太郎',
        })]
      : []),
  ],
  land: [], buildings: [certRegBuilding], proposedBuildings: [certProposed],
  registrationApplications: Object.entries(
    CERTIFICATE_DOCUMENTS.reduce((acc, documentName) => {
      const ra = CERT_RA[documentName];
      acc[ra.id] = acc[ra.id] || { type: ra.type, documents: {} };
      acc[ra.id].documents[documentName] = 1;
      return acc;
    }, {})
  ).map(([id, { type, documents }]) => ({
    id, type,
    targetBuildingIds: type === '建物表題登記' ? [certProposed.id] : [certRegBuilding.id],
    targetLandIds: [],
    applicantPersonIds: ['co1'],
    subject: {
      beforeBuildingIds: type === '建物表題登記' ? [] : [certRegBuilding.id],
      afterBuildingIds: [certProposed.id],
      landIds: [],
      primaryBuildingId: type === '建物表題登記' ? certProposed.id : null,
    },
    documents,
  })),
  docPick: {},
});
const certSite = buildCertSite();
const certSiteNoContractor = buildCertSite({ withContractor: false });

const renderCertDoc = (name, { pick = {}, isPrint = false, siteData = certSite } = {}) =>
  realReact.renderToStaticMarkup(
    realReact.React.createElement(realReact.DocTemplate, {
      name, siteData, instanceKey: `${name}__1`, instanceIndex: 1,
      pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...pick },
      isPrint, scriveners: [], documentContext: null,
    })
  );

test('77. 証明書4帳票すべてで署名欄・署名者行の目印が実描画に入る', () => {
  for (const name of CERTIFICATE_DOCUMENTS) {
    const html = renderCertDoc(name);
    const key = getDocumentTemplateKey(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${key}"`), `${name}の署名欄目印`);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`), `${name}の署名者行0`);
    // 単独工事人なので署名者行は1つだけ。
    const rows = html.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || [];
    assert.equal(rows.length, 1, `${name}の署名者行は1つ`);
    assert.ok(!html.includes(`${SIGNER_ROW_ATTR}="1"`), name);
  }
});

test('78. 証明書4帳票の工事人3行の文言・行順・font-sizeを変えていない', () => {
  for (const name of CERTIFICATE_DOCUMENTS) {
    const html = renderCertDoc(name);
    assert.ok(html.includes('工事人'), `${name}の見出し`);
    const addrAt = html.indexOf('住所　架空県架空市工町三丁目3番3号');
    const nameAt = html.indexOf('氏名　架空工務店株式会社');
    const repAt = html.indexOf('代表取締役　架空 工太郎');
    assert.ok(addrAt > 0 && nameAt > 0 && repAt > 0, `${name}の3行がある`);
    assert.ok(addrAt < nameAt && nameAt < repAt, `${name}の行順は住所→氏名→代表者`);
    assert.ok(html.includes('font-size:12pt'), `${name}の署名欄は12ptのまま`);
  }
});

test('79. 証明書4帳票の個別branchにorigin/block/row/印影列のrefが接続されている', () => {
  // 4帳票は共通rendererを使わないため、接続はソース上でも固定しておく。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const renderContractorSignerBlock = (contractor) =>'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const renderContractorSignerStampColumn = () =>'));
  assert.equal(
    (DOC_TEMPLATE_SOURCE.match(/\{renderContractorSignerBlock\(targetContractor\)\}/g) || []).length, 4);
  assert.equal(
    (DOC_TEMPLATE_SOURCE.match(/\{renderContractorSignerStampColumn\(\)\}/g) || []).length, 4);
  // originは委任状(1)＋証明書4帳票(4)＋申述書共通renderer(1)＋売渡証明書(1)＝7箇所だけ。対象外帳票には付けない。
  assert.equal(
    (DOC_TEMPLATE_SOURCE.match(/ref=\{signerAutoAlignEnabled \? signerAlignOriginRef : undefined\}/g) || []).length, 7);
  assert.equal(
    (DOC_TEMPLATE_SOURCE.match(/ref=\{signerAutoAlignEnabled \? signerStampColumnRef : undefined\}/g) || []).length, 4,
    '委任状共通renderer＋証明書共通helper＋申述書共通renderer＋売渡証明書の4箇所');
  // 署名者印影を持つ帳票のoriginはすべて接続済みで、未接続のoriginは残っていない。
  assert.equal(
    (DOC_TEMPLATE_SOURCE.match(/<div style=\{\{ position: 'relative' \}\}>/g) || []).length, 0);
  // 対象外の非登載証明書には署名者印影そのものが無い（refを付ける場所が無い）。
  const nonListedBranch = DOC_TEMPLATE_SOURCE.slice(
    DOC_TEMPLATE_SOURCE.indexOf('if (name === "非登載証明書")'),
    DOC_TEMPLATE_SOURCE.indexOf('// ---- 委任状系（書類ごとにテンプレ分割） ----')
  );
  assert.ok(nonListedBranch.length > 0);
  assert.ok(!nonListedBranch.includes('DraggableSignerStamp'), '非登載証明書に署名者印影は無い');
  assert.ok(!nonListedBranch.includes('signerAlignOriginRef'), '非登載証明書にoriginを接続しない');
  assert.ok(!nonListedBranch.includes('signerBlockAttributes'), '非登載証明書に署名欄目印を付けない');
});

test('80. 証明書の印影は1個・index 0で、既存のsignerStampPositions?.[0]参照を変えていない', () => {
  // 参照方式の統一は今回のnon-goal。既存のindex 0直接参照を維持する。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('dx={(pick.signerStampPositions?.[0]?.dx || 0)}'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('dy={(pick.signerStampPositions?.[0]?.dy || 0)}'));
  // 委任状側の getSignerPos は従来どおり残っている（片方へ寄せていない）。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const getSignerPos = (idx) => {'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('list.find(p => p?.i === idx)'));

  for (const name of CERTIFICATE_DOCUMENTS) {
    const html = renderCertDoc(name, { pick: { signerStampPositions: [{ i: 0, dx: 17, dy: -9 }] } });
    assert.ok(html.includes('left:17px'), `${name}の手動dx`);
    assert.ok(html.includes('top:-9px'), `${name}の手動dy`);
  }
});

test('81. 証明書: 工事人なしでは署名者行を作らず、署名欄の目印だけ残す', () => {
  for (const name of CERTIFICATE_DOCUMENTS) {
    const html = renderCertDoc(name, { siteData: certSiteNoContractor });
    const key = getDocumentTemplateKey(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${key}"`), `${name}: emptyと判定させるため目印は残す`);
    assert.ok(!html.includes(SIGNER_ROW_ATTR), `${name}: 署名者行は作らない`);
    // 既存の空欄表示（工事人見出し＋空行）に回帰がない。
    assert.ok(html.includes('工事人'), name);
    assert.ok(!html.includes('架空工務店株式会社'), `${name}: 工事人を自動追加しない`);
    // 印影自体は従来どおり描画される。
    assert.ok(html.includes('right:0'), `${name}: 計測前は従来の右端`);
  }
});

test('82. 証明書: 計測前の初回描画は従来の右端で、印刷用DOMも同じ経路で描画する', () => {
  for (const name of CERTIFICATE_DOCUMENTS) {
    for (const isPrint of [false, true]) {
      const html = renderCertDoc(name, { isPrint });
      assert.ok(html.includes('right:0'), `${name} isPrint=${isPrint}`);
      assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${getDocumentTemplateKey(name)}"`), name);
    }
    // 注意文・計測用のtestidは本文へ入れない。
    const html = renderCertDoc(name, { pick: { signerStampBaseRatio: 0.92 } });
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED), name);
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE), name);
    assert.ok(!html.includes('data-testid'), name);
  }
});

test('83. 証明書: 帳票上部のDraggableStampの初期配置・保存方式を変えていない', () => {
  for (const name of CERTIFICATE_DOCUMENTS) {
    const html = renderCertDoc(name);
    assert.ok(/right:calc\(20mm - 0px\)/.test(html), `${name}の上部印影`);
    // 上部印影は従来どおり stampPositions 側（find(p => p.i === 0)）で読む。
    const moved = renderCertDoc(name, { pick: { stampPositions: [{ i: 0, dx: 12, dy: 5 }] } });
    assert.ok(/right:calc\(20mm - 12px\)/.test(moved), `${name}の上部印影dx`);
  }
});

// --- drag / reset / 保存境界 / 独立性 --------------------------------------

const certInstanceOf = (siteObj, documentName) => {
  const templateKey = getDocumentTemplateKey(documentName);
  for (const app of siteObj.registrationApplications || []) {
    const hit = (app.documentInstances || []).find(i => i.templateKey === templateKey && i.copyIndex === 1);
    if (hit) return hit;
  }
  return null;
};

test('84. 証明書: fallback基準はレイアウト情報として保存し、再読込で復元する', () => {
  const saved = applyPick(certSite, '工事完了引渡証明書（表題）', { signerStampBaseRatio: 0.58 });
  assert.equal(saved.docPick?.['工事完了引渡証明書（表題）__1']?.signerStampBaseRatio, 0.58);
  const inst = certInstanceOf(saved, '工事完了引渡証明書（表題）');
  assert.equal(inst.layoutOverrides.signerStampBaseRatio, 0.58);
  assert.equal(
    Object.prototype.hasOwnProperty.call(inst.selectionOverrides, 'signerStampBaseRatio'), false,
    '個別設定へは入れない');
  const reloaded = reconcileSiteDocumentCompatibility(saved);
  assert.equal(reloaded.docPick?.['工事完了引渡証明書（表題）__1']?.signerStampBaseRatio, 0.58);
});

test('85. 証明書: resetは印影位置キーだけ初期化し、fallback基準と本文を残す', () => {
  let saved = applyPick(certSite, '滅失証明書（滅失）', { signerStampBaseRatio: 0.49 });
  saved = applyPick(saved, '滅失証明書（滅失）', { signerStampPositions: [{ i: 0, dx: 21, dy: -7 }] });
  saved = applyPick(saved, '滅失証明書（滅失）', { stampPositions: [{ i: 0, dx: 4, dy: 4 }] });
  saved = applyPick(saved, '滅失証明書（滅失）', { customText: '<div>滅失証明書の固定本文</div>' });

  const patch = buildStampPositionResetPatch();
  assert.deepEqual(Object.keys(patch).sort(), ['signerStampPositions', 'stampPositions']);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'signerStampBaseRatio'), false);

  const after = applyPick(saved, '滅失証明書（滅失）', patch);
  const pick = after.docPick?.['滅失証明書（滅失）__1'] || {};
  assert.equal(pick.signerStampPositions, null);
  assert.equal(pick.stampPositions, null);
  assert.equal(pick.signerStampBaseRatio, 0.49, 'fallback基準は失わない');
  assert.equal(pick.customText, '<div>滅失証明書の固定本文</div>', '本文は保全する');
});

test('86. 証明書: 自動計測の保存は本文・個別設定・業務データを変更しない', () => {
  const before = applyPick(certSite, '滅失証明書（表題部変更）', { customText: '<div>固定本文</div>' });
  const after = applyPick(before, '滅失証明書（表題部変更）', { signerStampBaseRatio: 0.44 });
  assert.equal(after.docPick?.['滅失証明書（表題部変更）__1']?.customText, '<div>固定本文</div>');
  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.buildings, before.buildings);
  assert.deepEqual(after.proposedBuildings, before.proposedBuildings);
  const shape = (siteObj) => (siteObj.registrationApplications || [])
    .flatMap(app => (app.documentInstances || []).map(i => [
      i.templateKey, i.copyIndex, i.selectionOverrides, i.editMode, i.detachedHtml, i.active, i.printEnabled,
    ]));
  assert.deepEqual(shape(after), shape(before), 'レイアウト以外の書類状態を変えない');
});

test('87. 証明書: fallback基準は他帳票・別インスタンス・別案件へ漏れない', () => {
  const saved = applyPick(certSite, '工事完了引渡証明書（表題部変更）', { signerStampBaseRatio: 0.77 });
  assert.equal(saved.docPick?.['工事完了引渡証明書（表題部変更）__1']?.signerStampBaseRatio, 0.77);
  for (const other of CERTIFICATE_DOCUMENTS.filter(n => n !== '工事完了引渡証明書（表題部変更）')) {
    assert.equal(saved.docPick?.[`${other}__1`]?.signerStampBaseRatio ?? null, null, other);
    assert.equal(certInstanceOf(saved, other)?.layoutOverrides?.signerStampBaseRatio ?? null, null, other);
  }
  // 別案件（委任状fixtureのsite）には一切影響しない。
  assert.equal(site.docPick?.['委任状（表題）__1']?.signerStampBaseRatio ?? null, null);
  assert.equal(site.docPick?.['工事完了引渡証明書（表題）__1']?.signerStampBaseRatio ?? null, null);
});

// --- 回帰 -------------------------------------------------------------------

test('88. 委任状10帳票の対象判定と署名欄目印に回帰がない', () => {
  for (const name of DELEGATION_DOCUMENTS) {
    assert.equal(isSignerStampAutoAlignDocument(name), true, name);
    assert.deepEqual(buildSignerBlockAttributes(name), { [SIGNER_BLOCK_ATTR]: getDocumentTemplateKey(name) }, name);
  }
  // 代表としてPilot2帳票＋rollout1帳票を実描画で確認する。
  for (const name of ['委任状（表題）', '委任状（保存）']) {
    const html = renderDoc(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${getDocumentTemplateKey(name)}"`), name);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`), name);
    assert.ok(html.includes('right:0'), `${name}は計測前は従来の右端`);
  }
  const addressChange = renderDoc('委任状（住所変更）');
  assert.ok(addressChange.includes(`${SIGNER_BLOCK_ATTR}="${ADDRESS_KEY}"`));
  assert.ok(addressChange.includes('ふりがな'), '複数行型の行構成は維持');
  // 委任状の署名欄は11ptのまま（証明書の12ptを持ち込んでいない）。
  assert.ok(renderDoc('委任状（表題）').includes('font-size:11pt'));
});

test('89. 対象外帳票には今回も目印・ref・注意が出ない', () => {
  for (const name of NON_TARGET_DOCUMENTS) {
    assert.equal(isSignerStampAutoAlignDocument(name), false, name);
    assert.equal(buildSignerBlockAttributes(name), null, name);
    assert.equal(buildSignerRowAttributes(name, 0), null, name);
  }
  for (const name of ['非登載証明書']) {
    const html = renderDoc(name);
    assert.ok(!html.includes(SIGNER_BLOCK_ATTR), `${name}に署名欄目印を付けない`);
    assert.ok(!html.includes(SIGNER_ROW_ATTR), `${name}に署名者行目印を付けない`);
  }
});

// ---------------------------------------------------------------------------
// 9. 申述書2帳票への展開（S-AC01〜S-AC20）
//
// 2帳票は共通の renderStatementCommon を使い、申述人1人が
// 「住所＋表示中の持分＋氏名」の同一行1本になる。共通の計測・配置・fallback・
// 保存coreは委任状/証明書と同じものを再利用しているので、ここで固定するのは
// 「行全体を1候補行として拾うこと」と「P1〜P4を壊していないこと」。
// ---------------------------------------------------------------------------

const STATEMENT_SHARED_KEY = getDocumentTemplateKey('申述書（共有）');
const STATEMENT_SOLE_KEY = getDocumentTemplateKey('申述書（単独）');

// 署名欄ブロックだけを切り出す。確認済証記載の建築主名義など、本文の別箇所にも
// 同じ人物名が出るため、申述人行の検証は必ずこの範囲で行う。
const signerBlockHtml = (html, key) => {
  const start = html.indexOf(`${SIGNER_BLOCK_ATTR}="${key}"`);
  if (start < 0) return '';
  const end = html.indexOf('position:absolute;bottom:0', start);
  return html.slice(start, end < 0 ? html.length : end);
};

// 申述人行。住所・持分・氏名は parts.join("　") で1行に並ぶため、
// 実DOMでも1つのテキストノード＝1つの矩形になる。
const statementRow = (index, right, text = '架空県架空市架空町1番　持分２分の１　架空 太郎') =>
  signerRow(index, [new FakeText(text, [rect(0, right)])]);

const measureStatement = (rights, key = STATEMENT_SHARED_KEY) =>
  measureSignerBlock(
    buildOrigin({ blocks: [signerBlock(key, rights.map((r, i) => statementRow(i, r)))] }),
    key
  );

test('90. 申述書: 申述人行は住所＋持分＋氏名の同一行全体を1候補行として測る', () => {
  const m = measureStatement([348]);
  assert.equal(m.found, true);
  assert.equal(m.rowCount, 1);
  assert.equal(m.lineCount, 1, '住所/持分/氏名を別行に分けない');
  assert.equal(m.maxRight, 348);
  assert.ok(Math.abs(m.baseX - (348 + GAP_11PT)) < 0.01);
});

test('91. 申述書: 各項目を別々に測って合成しない', () => {
  // 住所200 / 持分90 / 氏名110 が1行に並んで右端348、という実描画を想定。
  const block = signerBlock(STATEMENT_SHARED_KEY, [
    signerRow(0, [new FakeText('架空県架空市架空町1番　持分２分の１　架空 太郎', [rect(0, 348)])]),
  ]);
  const m = measureSignerBlock(buildOrigin({ blocks: [block] }), STATEMENT_SHARED_KEY);
  assert.equal(m.maxRight, 348);
  assert.notEqual(m.maxRight, 200 + 90 + 110, '項目幅の合算にしない');
});

test('92. 申述書（共有）: 2名の全表示行を比較し、全印影を共通Xへ揃える', () => {
  const m = measureStatement([300, 412]);
  assert.equal(m.rowCount, 2);
  assert.equal(m.maxRight, 412);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.ok(Math.abs(placement.baseX - (412 + GAP_11PT)) < 0.01);
  // 印影列は全申述人共通の1コンテナなので、基準Xが1つ＝全員のXが揃う。
  assert.equal(placement.renderX, placement.baseX);
  assert.equal(isSignerStampAutoAligned(placement), true);
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

test('93. 申述書（共有）: 人物Aが最長／人物Bが最長で基準が切り替わる', () => {
  assert.equal(measureStatement([430, 300]).maxRight, 430, 'A最長');
  assert.equal(measureStatement([300, 430]).maxRight, 430, 'B最長');
  const a = measureStatement([430, 300]);
  const b = measureStatement([300, 430]);
  assert.ok(Math.abs(a.baseX - b.baseX) < 0.01, 'どちらが最長でも同じ基準Xになる');
});

test('94. 申述書（共有）: 3名でも全申述人・全行の最大rightで1つに揃う', () => {
  const m = measureStatement([288, 455, 361]);
  assert.equal(m.rowCount, 3);
  assert.equal(m.lineCount, 3);
  assert.equal(m.maxRight, 455);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.renderX, placement.baseX);
});

test('95. 申述書（単独）: 1名でもその申述人行right＋11pt基準2emを使う', () => {
  const m = measureStatement([322], STATEMENT_SOLE_KEY);
  assert.equal(m.rowCount, 1);
  assert.ok(Math.abs(m.gap - GAP_11PT) < 0.01, '余白は11pt基準の2em');
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.source, 'measured');
  assert.ok(Math.abs(placement.baseX - (322 + GAP_11PT)) < 0.01);
});

test('96. 申述書: 申述人0名は署名者行0件のemptyとして扱い、注意も保存もしない', () => {
  const emptyBlock = signerBlock(STATEMENT_SHARED_KEY, []);
  emptyBlock.box = rect(0, 0); // 行が無いのでレイアウトを持たない
  const measured = measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), STATEMENT_SHARED_KEY);
  assert.equal(measured.found, false);
  assert.equal(measured.empty, true, '判別不能ではなくempty');
  assert.equal(measured.rowCount, 0);

  const placement = resolveSignerStampPlacement({ measurement: measured, stampWidth: STAMP_WIDTH });
  assert.equal(placement.source, 'empty');
  assert.equal(placement.identified, true);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH, '従来の右端位置のまま');
  assert.equal(placement.baseRatio, null, '基準を新規保存しない');
  assert.deepEqual(buildSignerStampNotices(placement), [], '不要な注意を出さない');

  // 保存済み基準があっても上書きしない。
  const withStored = resolveSignerStampPlacement({
    measurement: measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), STATEMENT_SHARED_KEY),
    storedBaseRatio: 0.53, stampWidth: STAMP_WIDTH,
  });
  assert.equal(withStored.source, 'empty');
  assert.equal(withStored.baseRatio, null);
  assert.deepEqual(buildSignerStampNotices(withStored), []);
});

test('97. 申述書: 目印が消えたら保持基準、基準なしは従来右端へ仮配置する', () => {
  const pasted = buildOrigin({
    blocks: [new FakeElement({ box: rect(0, 600), children: [new FakeText('貼り付けられた本文', [rect(0, 500)])] })],
  });
  const lost = measureSignerBlock(pasted, STATEMENT_SHARED_KEY);
  assert.equal(lost.found, false);
  assert.equal(lost.empty, false);

  const stored = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: 0.62, stampWidth: STAMP_WIDTH });
  assert.equal(stored.source, 'stored');
  assert.ok(Math.abs(stored.baseX - 0.62 * 654) < 0.01);
  assert.equal(stored.baseRatio, null, 'fallback中は基準を上書き保存しない');
  assert.deepEqual(buildSignerStampNotices(stored), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);

  const legacy = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: null, stampWidth: STAMP_WIDTH });
  assert.equal(legacy.source, 'legacy-right');
  assert.equal(legacy.renderX, 654 - STAMP_WIDTH);
  assert.equal(isSignerStampAutoAligned(legacy), false);
});

test('98. 申述書: 横幅不足は非阻害の注意だけで、印影を紙面内に留める', () => {
  const m = measureStatement([600]);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.identified, true, '署名欄は判別できている');
  assert.equal(placement.widthShortage, true);
  assert.equal(isSignerStampAutoAligned(placement), false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE]);
  // 自動縮小・gap圧縮をしないので基準Xは収まらないまま、描画だけ紙面内に留める。
  assert.ok(placement.baseX > placement.containerWidth - STAMP_WIDTH);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH);
});

test('99. 申述書: 目印を保てる全文編集は編集後DOMの実表示で再計測する', () => {
  const before = measureStatement([300, 340]);
  assert.equal(before.maxRight, 340);
  // 申述人行の文字を直し、行が伸びた編集後DOM。
  const after = measureSignerBlock(buildOrigin({
    blocks: [signerBlock(STATEMENT_SHARED_KEY, [
      statementRow(0, 300),
      statementRow(1, 486, '架空県架空市架空町2番2号　持分２分の１　架空 花子（編集後）'),
    ])],
  }), STATEMENT_SHARED_KEY);
  assert.equal(after.maxRight, 486, '編集後の表示行で再計測する');
  assert.notEqual(after.baseX, before.baseX);
});

test('100. 申述書の署名欄keyは相互にも既存14帳票とも混ざらない', () => {
  const origin = buildOrigin({
    blocks: [signerBlock(STATEMENT_SHARED_KEY, [statementRow(0, 400)])],
  });
  assert.equal(measureSignerBlock(origin, STATEMENT_SHARED_KEY).found, true);
  for (const key of [STATEMENT_SOLE_KEY, TITLE_KEY, SAVE_KEY, ADDRESS_KEY, COMPLETION_TITLE_KEY, LOSS_CERT_KEY]) {
    assert.equal(measureSignerBlock(origin, key).found, false, key);
  }
});

// --- 実描画（SSR）での接続 ---------------------------------------------------

const statementPerson = (id, name, address, extra = {}) => ({
  id, name, address, roles: ['申請人'], share: '1/2', shareOverrides: {}, ...extra,
});
const statementBuilding = {
  id: 'sb1', address: '架空県架空市四丁目4番地', houseNum: '404番4', kind: '居宅', struct: '木造２階建',
  floorAreas: [{ id: 'sfa1', floor: '１階', area: '70.00' }], annexes: [], additionalCauses: [],
  registrationCause: '新築', registrationDate: { era: '令和', year: '8', month: '4', day: '5' },
  ownerPersonIds: ['s1', 's2'], contractorPersonIds: [],
  confirmApplicantPersonIds: ['s1'], confirmApplicantNames: [],
};
const buildStatementSite = (people) => reconcileSiteDocumentCompatibility({
  id: 'site-statement',
  people,
  land: [], buildings: [], proposedBuildings: [statementBuilding],
  registrationApplications: [{
    id: 'ras1', type: '建物表題登記',
    targetBuildingIds: [statementBuilding.id], targetLandIds: [],
    applicantPersonIds: people.map(p => p.id),
    subject: { beforeBuildingIds: [], afterBuildingIds: [statementBuilding.id], landIds: [], primaryBuildingId: statementBuilding.id },
    documents: { '申述書（共有）': 1, '申述書（単独）': 1, '売渡証明書': 1 },
  }],
  docPick: {},
});
const statementSite = buildStatementSite([
  statementPerson('s1', '架空 太郎', '架空県架空市架空町一丁目1番1号'),
  statementPerson('s2', '架空 花子', '架空県架空市架空町二丁目2番2号'),
]);
// 単独出資者1名（明示持分なし）。
const statementSoleSite = buildStatementSite([
  statementPerson('s1', '架空 太郎', '架空県架空市架空町一丁目1番1号', { share: '' }),
]);
// 申述人0名（申請人roleなし）。
const statementEmptySite = buildStatementSite([
  { ...statementPerson('s1', '架空 太郎', '架空県架空市架空町一丁目1番1号'), roles: ['その他'] },
]);

const renderStatementDoc = (name, { pick = {}, isPrint = false, siteData = statementSite, textEditingEnabled } = {}) =>
  realReact.renderToStaticMarkup(
    realReact.React.createElement(realReact.DocTemplate, {
      name, siteData, instanceKey: `${name}__1`, instanceIndex: 1,
      pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...pick },
      isPrint, scriveners: [], documentContext: null,
      ...(textEditingEnabled === undefined ? {} : { textEditingEnabled }),
    })
  );

test('101. 申述書2帳票の署名欄・申述人行に目印が入り、行数は申述人数と一致する', () => {
  for (const name of STATEMENT_DOCUMENTS) {
    const html = renderStatementDoc(name);
    const key = getDocumentTemplateKey(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${key}"`), `${name}の署名欄目印`);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`), `${name}の申述人行0`);
    assert.ok(html.includes(`${SIGNER_ROW_ATTR}="1"`), `${name}の申述人行1`);
    const rows = html.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || [];
    assert.equal(rows.length, 2, `${name}の申述人行は2名分`);
    assert.ok(html.includes('申述人'), `${name}の見出し文言は維持する`);
    assert.ok(html.includes('font-size:11pt'), `${name}の署名欄は11ptのまま`);
  }
});

test('102. 申述書: 住所・持分・氏名が同一行に並ぶ既存表示を変えていない', () => {
  const html = renderStatementDoc('申述書（共有）');
  // 1つの行divの中に住所・持分・氏名が連結されて入る。
  const rowRe = new RegExp(`${SIGNER_ROW_ATTR}="0"[^>]*>([^<]*)<`);
  const hit = rowRe.exec(html);
  assert.ok(hit, '申述人行のテキストを取得できる');
  const line = hit[1];
  assert.ok(line.includes('架空県架空市架空町一丁目1番1号'), '住所');
  assert.ok(line.includes('持分'), '持分');
  assert.ok(line.includes('架空 太郎'), '氏名');
  assert.ok(line.indexOf('架空県') < line.indexOf('持分'), '住所→持分の順');
  assert.ok(line.indexOf('持分') < line.indexOf('架空 太郎'), '持分→氏名の順');
  // 1つの行divに収まっている＝別行に分かれていない。
  assert.ok(!line.includes('<'), '住所・持分・氏名の間に要素を挟まない');
});

test('103. 申述書: shareの既存表示条件を変えていない（複数人／明示持分）', () => {
  // 2名なので持分を表示する。
  const shared = renderStatementDoc('申述書（共有）');
  assert.ok(shared.includes('持分'), '複数人では持分を表示');

  // 1名かつ明示持分なしでは持分を表示しない（既存条件）。
  const sole = renderStatementDoc('申述書（単独）', { siteData: statementSoleSite });
  const rowRe = new RegExp(`${SIGNER_ROW_ATTR}="0"[^>]*>([^<]*)<`);
  const line = rowRe.exec(sole)[1];
  assert.ok(!line.includes('持分'), '1名・明示持分なしでは持分を出さない');
  assert.ok(line.includes('架空 太郎'));

  // 1名でも明示持分があれば表示する。
  const soleWithShare = buildStatementSite([
    statementPerson('s1', '架空 太郎', '架空県架空市架空町一丁目1番1号', { share: '1/1' }),
  ]);
  const withShare = renderStatementDoc('申述書（単独）', { siteData: soleWithShare });
  assert.ok(rowRe.exec(withShare)[1].includes('持分'), '1名・明示持分ありでは持分を出す');
});

test('104. 申述書（単独）: 申述人1名で行は1つ、本文の単独出資者文言は従来どおり', () => {
  const html = renderStatementDoc('申述書（単独）', {
    siteData: statementSoleSite, pick: { statementApplicantPersonId: 's1' },
  });
  const rows = html.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || [];
  assert.equal(rows.length, 1);
  assert.ok(html.includes('単独で全額出資'), '単独出資者の本文を変えていない');
  assert.ok(html.includes('架空 太郎'));
});

test('105. 申述書: 申述人0名では申述人行を作らず、署名欄の目印だけ残す', () => {
  for (const name of STATEMENT_DOCUMENTS) {
    const html = renderStatementDoc(name, { siteData: statementEmptySite });
    const key = getDocumentTemplateKey(name);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${key}"`), `${name}: emptyと判定させるため目印は残す`);
    assert.ok(!html.includes(SIGNER_ROW_ATTR), `${name}: 申述人行は作らない`);
    // 人物名は確認済証記載の建築主名義など本文の別箇所にも出るため、署名欄内で確認する。
    assert.ok(!signerBlockHtml(html, key).includes('架空 太郎'), `${name}: 署名欄へ人物を自動追加しない`);
    assert.ok(html.includes('申述人'), `${name}: 既存の見出し表示は残る`);
    assert.ok(html.includes('right:0'), `${name}: 計測前は従来の右端`);
  }
});

test('106. 申述書: manual dx/dyは既存のgetSignerPos(i) index方式のまま加算される', () => {
  // 参照方式の統一・人物ID化は今回のnon-goal。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const getSignerPos = (idx) => {'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('list.find(p => p?.i === idx)'));
  for (const name of STATEMENT_DOCUMENTS) {
    const html = renderStatementDoc(name, { pick: { signerStampPositions: [{ i: 1, dx: 23, dy: -11 }] } });
    assert.ok(html.includes('left:23px'), `${name}の手動dx`);
    assert.ok(html.includes('top:-11px'), `${name}の手動dy`);
  }
});

test('107. 申述書: 帳票上部のDraggableStampは申述人ごとに従来どおり描画・保存する', () => {
  for (const name of STATEMENT_DOCUMENTS) {
    const html = renderStatementDoc(name);
    // 上部印影は index ごとに 20mm / 48.6mm と段違いに並ぶ既存配置のまま。
    assert.ok(/right:calc\(20mm - 0px\)/.test(html), `${name}の上部印影0`);
    assert.ok(/right:calc\(48\.6mm - 0px\)/.test(html), `${name}の上部印影1`);
    // 上部印影は従来どおり stampPositions 側（find(p => p.i === i)）で読む。
    const moved = renderStatementDoc(name, { pick: { stampPositions: [{ i: 1, dx: 9, dy: 3 }] } });
    assert.ok(/right:calc\(48\.6mm - 9px\)/.test(moved), `${name}のindex1上部印影dx`);
    assert.ok(/right:calc\(20mm - 0px\)/.test(moved), `${name}のindex0は動かない`);
  }
});

test('108. 申述書: 計測前の初回描画は従来の右端で、印刷用DOMも同じ経路で描画する', () => {
  for (const name of STATEMENT_DOCUMENTS) {
    for (const isPrint of [false, true]) {
      const html = renderStatementDoc(name, { isPrint });
      assert.ok(html.includes('right:0'), `${name} isPrint=${isPrint}`);
      assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${getDocumentTemplateKey(name)}"`), name);
    }
    const html = renderStatementDoc(name, { pick: { signerStampBaseRatio: 0.88 } });
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED), name);
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE), name);
    assert.ok(!html.includes('data-testid'), name);
  }
});

// --- P1〜P4の保全 -----------------------------------------------------------

test('109. P1: 申述書2帳票の通常本文はread-onlyのまま、明示全文編集でだけ編集可になる', () => {
  for (const name of STATEMENT_DOCUMENTS) {
    assert.equal(isExplicitTextEditDocument(name), true, `${name}はP1対象`);
    assert.equal(isDocumentBodyEditable({ documentName: name, isPrint: false, textEditingEnabled: false }), false,
      `${name}は通常read-only`);
    assert.equal(isDocumentBodyEditable({ documentName: name, isPrint: false, textEditingEnabled: true }), true,
      `${name}は明示全文編集中だけ編集可`);
    assert.equal(isDocumentBodyEditable({ documentName: name, isPrint: true, textEditingEnabled: true }), false,
      `${name}の印刷用DOMは編集不可`);

    // read-onlyでは本文を編集可能にしない。
    // 印影ハンドルは常に contenteditable="false" を持つので、true だけを見る。
    const readOnly = renderStatementDoc(name, { textEditingEnabled: false });
    assert.ok(!readOnly.includes('contenteditable="true"'), `${name}: 通常は本文を編集可能にしない`);
    assert.ok(readOnly.includes(`${SIGNER_BLOCK_ATTR}="${getDocumentTemplateKey(name)}"`), name);
    assert.ok(readOnly.includes(`${SIGNER_ROW_ATTR}="0"`), name);

    // 明示全文編集中も目印は維持される（編集後DOMで再計測できる）。
    const editing = renderStatementDoc(name, { textEditingEnabled: true });
    assert.ok(editing.includes('contenteditable="true"'), `${name}: 明示編集中は編集可`);
    assert.ok(editing.includes(`${SIGNER_BLOCK_ATTR}="${getDocumentTemplateKey(name)}"`), name);
    assert.ok(editing.includes(`${SIGNER_ROW_ATTR}="0"`), name);
  }
});

test('110. P1: 自動配置は編集開始だけでcustomText/detachedを作らない', () => {
  // 描画・計測の経路からcustomTextを生成しない。保存はレイアウト情報だけ。
  const before = statementSite;
  const after = applyPick(before, '申述書（共有）', { signerStampBaseRatio: 0.57 });
  const pick = after.docPick?.['申述書（共有）__1'] || {};
  assert.equal(pick.customText ?? null, null, 'customTextを作らない');
  const inst = (() => {
    for (const app of after.registrationApplications || []) {
      const hit = (app.documentInstances || []).find(i => i.templateKey === STATEMENT_SHARED_KEY && i.copyIndex === 1);
      if (hit) return hit;
    }
    return null;
  })();
  assert.equal(inst.editMode, 'linked', 'linkedのまま');
  assert.equal(inst.detachedHtml, null, 'detachedへ移行しない');
  assert.equal(inst.layoutOverrides.signerStampBaseRatio, 0.57);
});

test('111. P2: 申述人選択・単独出資者・個別設定のロジックを変えていない', () => {
  // statementPeople の解決は statementPersonIds / statementDefaultPeople のまま。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const ids = Array.isArray(pick?.statementPersonIds) ? pick.statementPersonIds : [];'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('return filtered.length ? filtered : statementDefaultPeople;'));
  // 単独出資者は soleApplicant / statementApplicantPersonId のまま。
  assert.ok(DOC_TEMPLATE_SOURCE.includes("linkedDocumentContext?.data?.soleApplicant"));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('pick?.statementApplicantPersonId'));
  // statementPersonIds で選んだ申述人だけが行になる（並べ替えもしない）。
  const onlySecond = renderStatementDoc('申述書（共有）', { pick: { statementPersonIds: ['s2'] } });
  const rows = onlySecond.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || [];
  assert.equal(rows.length, 1);
  const block = signerBlockHtml(onlySecond, STATEMENT_SHARED_KEY);
  assert.ok(block.includes('架空 花子'), '選んだ申述人だけが署名欄に出る');
  assert.ok(!block.includes('架空 太郎'), '選ばれていない申述人は署名欄に出ない');
});

test('112. P2: 自動計測の保存は個別設定(selectionOverrides)へ入らない', () => {
  const saved = applyPick(statementSite, '申述書（単独）', { signerStampBaseRatio: 0.61 });
  const inst = (() => {
    for (const app of saved.registrationApplications || []) {
      const hit = (app.documentInstances || []).find(i => i.templateKey === STATEMENT_SOLE_KEY && i.copyIndex === 1);
      if (hit) return hit;
    }
    return null;
  })();
  assert.equal(inst.layoutOverrides.signerStampBaseRatio, 0.61);
  assert.equal(Object.prototype.hasOwnProperty.call(inst.selectionOverrides, 'signerStampBaseRatio'), false);
  assert.deepEqual(inst.selectionOverrides, {});
  assert.deepEqual(inst.selectionOverrideBaselines, {});
});

test('113. P3: auto-alignの注意はSummaryのissue導線と別系統のまま', () => {
  // 注意は左パネルで描画し、issue guidance側の分類には混ぜない。
  assert.ok(DOCS_SOURCE.includes('data-testid="signer-stamp-notice"'));
  assert.ok(DOCS_SOURCE.includes('isSignerStampAutoAlignDocument(activeInstance.name) && activeSignerStampNotices.length > 0'));
  // 印刷対象はprintOnだけで決まり、印影の注意状態は関与しない。
  assert.ok(DOCS_SOURCE.includes('allInstances.filter(inst => (siteData?.docPick?.[inst.key]?.printOn ?? true))'));
  // 注意文が本文・印刷DOMへ混入しない。
  for (const name of STATEMENT_DOCUMENTS) {
    const html = renderStatementDoc(name, { pick: { signerStampBaseRatio: 0.9 }, isPrint: true });
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED), name);
    assert.ok(!html.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE), name);
  }
});

test('114. P4: resetは印影位置キーだけ初期化し、fallback基準と本文・確認状態を残す', () => {
  let saved = applyPick(statementSite, '申述書（共有）', { signerStampBaseRatio: 0.46 });
  saved = applyPick(saved, '申述書（共有）', { signerStampPositions: [{ i: 0, dx: 28, dy: -7 }] });
  saved = applyPick(saved, '申述書（共有）', { stampPositions: [{ i: 1, dx: 5, dy: 5 }] });
  saved = applyPick(saved, '申述書（共有）', { customText: '<div>申述書の固定本文</div>' });

  const patch = buildStampPositionResetPatch();
  assert.deepEqual(Object.keys(patch).sort(), ['signerStampPositions', 'stampPositions']);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'signerStampBaseRatio'), false);

  const after = applyPick(saved, '申述書（共有）', patch);
  const pick = after.docPick?.['申述書（共有）__1'] || {};
  assert.equal(pick.signerStampPositions, null, '署名者印影の補正は初期化する');
  assert.equal(pick.stampPositions, null, '上部印影の補正も従来どおり初期化する');
  assert.equal(pick.signerStampBaseRatio, 0.46, 'fallback基準は失わない');
  assert.equal(pick.customText, '<div>申述書の固定本文</div>', '本文は保全する');
});

test('115. 申述書: 自動計測は本文・個別設定・業務データを変更しない', () => {
  const before = applyPick(statementSite, '申述書（単独）', { customText: '<div>固定</div>' });
  const after = applyPick(before, '申述書（単独）', { signerStampBaseRatio: 0.39 });
  assert.equal(after.docPick?.['申述書（単独）__1']?.customText, '<div>固定</div>');
  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.buildings, before.buildings);
  assert.deepEqual(after.proposedBuildings, before.proposedBuildings);
  const shape = (siteObj) => (siteObj.registrationApplications || [])
    .flatMap(app => (app.documentInstances || []).map(i => [
      i.templateKey, i.copyIndex, i.selectionOverrides, i.selectionOverrideBaselines,
      i.editMode, i.detachedHtml, i.active, i.printEnabled, i.contentOverrides,
    ]));
  assert.deepEqual(shape(after), shape(before), 'レイアウト以外の書類状態を変えない');
});

test('116. 申述書: fallback基準は保存・再読込で復元し、他帳票・別案件へ漏れない', () => {
  const saved = applyPick(statementSite, '申述書（共有）', { signerStampBaseRatio: 0.72 });
  assert.equal(saved.docPick?.['申述書（共有）__1']?.signerStampBaseRatio, 0.72);
  const reloaded = reconcileSiteDocumentCompatibility(saved);
  assert.equal(reloaded.docPick?.['申述書（共有）__1']?.signerStampBaseRatio, 0.72, '再読込で復元');

  assert.equal(saved.docPick?.['申述書（単独）__1']?.signerStampBaseRatio ?? null, null, '同案件の別帳票へ漏れない');
  assert.equal(saved.docPick?.['売渡証明書__1']?.signerStampBaseRatio ?? null, null, '対象外帳票へ漏れない');
  // 別案件（委任状/証明書fixture）には一切影響しない。
  assert.equal(site.docPick?.['委任状（表題）__1']?.signerStampBaseRatio ?? null, null);
  assert.equal(certSite.docPick?.['工事完了引渡証明書（表題）__1']?.signerStampBaseRatio ?? null, null);
});

// --- 既存14帳票・対象外の回帰 -----------------------------------------------

test('117. 既存14帳票の対象判定と代表描画に回帰がない', () => {
  for (const name of [...DELEGATION_DOCUMENTS, ...CERTIFICATE_DOCUMENTS]) {
    assert.equal(isSignerStampAutoAlignDocument(name), true, name);
    assert.deepEqual(buildSignerBlockAttributes(name), { [SIGNER_BLOCK_ATTR]: getDocumentTemplateKey(name) }, name);
  }
  // 委任状代表（11pt・複数署名者）と証明書代表（12pt・単独工事人）を実描画で確認。
  const title = renderDoc('委任状（表題）');
  assert.ok(title.includes(`${SIGNER_BLOCK_ATTR}="${TITLE_KEY}"`));
  assert.ok(title.includes('font-size:11pt'));
  const save = renderDoc('委任状（保存）');
  assert.ok(save.includes('ふりがな'), '複数行型の行構成は維持');
  const completion = renderCertDoc('工事完了引渡証明書（表題）');
  assert.ok(completion.includes(`${SIGNER_BLOCK_ATTR}="${COMPLETION_TITLE_KEY}"`));
  assert.ok(completion.includes('font-size:12pt'), '証明書の署名欄は12ptのまま');
  const lossCert = renderCertDoc('滅失証明書（滅失）');
  assert.ok(lossCert.includes(`${SIGNER_BLOCK_ATTR}="${LOSS_CERT_KEY}"`));
});

test('118. 対象外帳票（非登載証明書）へ目印・ref・注意が波及しない', () => {
  for (const name of NON_TARGET_DOCUMENTS) {
    assert.equal(isSignerStampAutoAlignDocument(name), false, name);
    assert.equal(buildSignerBlockAttributes(name), null, name);
    assert.equal(buildSignerRowAttributes(name, 0), null, name);
  }
  // 非登載証明書は署名者印影自体を持たない従来構成のまま。
  const nonListed = renderDoc('非登載証明書');
  assert.ok(!nonListed.includes(SIGNER_BLOCK_ATTR));
  assert.ok(!nonListed.includes(SIGNER_ROW_ATTR));
  assert.ok(!nonListed.includes('DraggableSignerStamp'));
});

// ---------------------------------------------------------------------------
// 10. 売渡証明書への展開（SALE-AC01〜SALE-AC20）
//
// 売渡証明書は自身のbranchで描画される。売主1人につき「住所行」「氏名行」の
// 2行が別々の候補行になり、署名欄の通常本文は12pt。
// 計測・配置・fallback・保存coreは既存のものをそのまま再利用しているので、
// ここで固定するのは接続・12pt基準・売主0名の既存挙動・legacy editingの保全。
// ---------------------------------------------------------------------------

const SALE_KEY = getDocumentTemplateKey('売渡証明書');
// 売主情報の通常本文は12pt。
const SALE_FONT_PX = 16;
const GAP_12PT_SALE = SALE_FONT_PX * SIGNER_STAMP_GAP_EM;

// 12ptの署名欄ブロック（委任状の11ptと別サイズであることを明示する）。
const saleBlock = (rows) => new FakeElement({
  attrs: { [SIGNER_BLOCK_ATTR]: SALE_KEY },
  box: rect(0, 600),
  fontSize: `${SALE_FONT_PX}px`,
  children: rows,
});

// 実DOMと同じ構成: 1売主rowの中に <p>住所</p><p>氏名</p> が別段落で入る。
const sellerRow = (index, { addressRight, nameRight, addressRects, nameRects }) =>
  signerRow(index, [
    new FakeText(`架空県架空市売町${index + 1}丁目${index + 1}番`,
      addressRects || [rect(0, addressRight)]),
    new FakeText(`架空 売主${index + 1}`,
      nameRects || [rect(0, nameRight, 22)]),
  ]);

const measureSale = (sellers) =>
  measureSignerBlock(
    buildOrigin({ blocks: [saleBlock(sellers.map((sp, i) => sellerRow(i, sp)))] }),
    SALE_KEY
  );

test('119. 売渡証明書: 1売主で住所行が最長ならその実表示右端＋12pt基準2emを使う', () => {
  const m = measureSale([{ addressRight: 430, nameRight: 260 }]);
  assert.equal(m.found, true);
  assert.equal(m.rowCount, 1, '売主1名なので署名者行は1つ');
  assert.equal(m.lineCount, 2, '住所行と氏名行の2候補');
  assert.equal(m.maxRight, 430);
  assert.ok(Math.abs(m.gap - GAP_12PT_SALE) < 0.01, '余白は12pt基準の2em');
  assert.ok(Math.abs(m.baseX - (430 + GAP_12PT_SALE)) < 0.01);
});

test('120. 売渡証明書: 1売主で氏名行が最長なら氏名行へ基準が切り替わる', () => {
  const m = measureSale([{ addressRight: 260, nameRight: 418 }]);
  assert.equal(m.maxRight, 418);
  assert.ok(Math.abs(m.baseX - (418 + GAP_12PT_SALE)) < 0.01);
  // 住所固定・氏名固定にしない。
  const other = measureSale([{ addressRight: 418, nameRight: 260 }]);
  assert.ok(Math.abs(m.baseX - other.baseX) < 0.01, 'どちらが最長でも同じ基準Xになる');
});

test('121. 売渡証明書: 住所行と氏名行を足し合わせない', () => {
  const m = measureSale([{ addressRight: 300, nameRight: 240 }]);
  assert.equal(m.maxRight, 300);
  assert.notEqual(m.maxRight, 300 + 240, '別行の幅を合算しない');
});

test('122. 売渡証明書: 折返しは各実表示rectを比較し、別行として扱う', () => {
  // 住所が2行に折り返された場合、返るrectそれぞれを候補にする。
  const m = measureSale([{
    addressRects: [rect(0, 520), rect(0, 180, 22)],
    nameRight: 260,
  }]);
  assert.equal(m.maxRight, 520);
  assert.notEqual(m.maxRight, 520 + 180);
});

test('123. 売渡証明書: 複数売主は全売主の住所/氏名行の最大rightを共通Xにする', () => {
  const m = measureSale([
    { addressRight: 300, nameRight: 250 },
    { addressRight: 280, nameRight: 452 },
  ]);
  assert.equal(m.rowCount, 2);
  assert.equal(m.lineCount, 4, '2売主×2行');
  assert.equal(m.maxRight, 452);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.ok(Math.abs(placement.baseX - (452 + GAP_12PT_SALE)) < 0.01);
  // 印影列は全売主共通の1コンテナなので、基準Xが1つ＝全員のXが揃う。
  assert.equal(placement.renderX, placement.baseX);
  assert.equal(isSignerStampAutoAligned(placement), true);
  assert.deepEqual(buildSignerStampNotices(placement), []);
});

test('124. 売渡証明書: 売主Aが最長／売主Bが最長で基準が切り替わる', () => {
  const a = measureSale([{ addressRight: 460, nameRight: 250 }, { addressRight: 280, nameRight: 300 }]);
  const b = measureSale([{ addressRight: 280, nameRight: 300 }, { addressRight: 460, nameRight: 250 }]);
  assert.equal(a.maxRight, 460, 'A最長');
  assert.equal(b.maxRight, 460, 'B最長');
  assert.ok(Math.abs(a.baseX - b.baseX) < 0.01);
});

test('125. 売渡証明書: 3名以上でも同じ原則で1つのXに揃う', () => {
  const m = measureSale([
    { addressRight: 300, nameRight: 250 },
    { addressRight: 410, nameRight: 260 },
    { addressRight: 288, nameRight: 355 },
  ]);
  assert.equal(m.rowCount, 3);
  assert.equal(m.lineCount, 6);
  assert.equal(m.maxRight, 410);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.renderX, placement.baseX);
});

test('126. 売渡証明書: 余白は12pt基準で、委任状の11pt値を流用しない', () => {
  const sale = measureSale([{ addressRight: 300, nameRight: 250 }]);
  assert.ok(Math.abs(sale.gap - GAP_12PT_SALE) < 0.01);
  assert.notEqual(Math.round(sale.gap), Math.round(GAP_11PT));
  // 委任状側は11pt基準のまま。
  const deleg = measureSignerBlock(
    buildOrigin({ blocks: [signerBlock(TITLE_KEY, [signerRow(0, [new FakeText('行', [rect(0, 300)])])])] }),
    TITLE_KEY
  );
  assert.ok(Math.abs(deleg.gap - GAP_11PT) < 0.01);
});

test('127. 売渡証明書: 売主0名は署名者行0件のemptyで、注意も保存もしない', () => {
  // 目印はあるが、空の住所/氏名行にはrow markerを付けない構造。
  const emptyBlock = new FakeElement({
    attrs: { [SIGNER_BLOCK_ATTR]: SALE_KEY },
    box: rect(0, 600),
    fontSize: `${SALE_FONT_PX}px`,
    children: [new FakeText('　', [rect(0, 20)]), new FakeText('　', [rect(0, 20, 22)])],
  });
  const measured = measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), SALE_KEY);
  assert.equal(measured.found, false);
  assert.equal(measured.empty, true, '判別不能ではなくempty');
  assert.equal(measured.rowCount, 0);

  const placement = resolveSignerStampPlacement({ measurement: measured, stampWidth: STAMP_WIDTH });
  assert.equal(placement.source, 'empty');
  assert.equal(placement.identified, true);
  assert.equal(placement.widthShortage, false);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH, '空印影は従来の右端位置のまま');
  assert.equal(placement.baseRatio, null, '基準を新規保存しない');
  assert.deepEqual(buildSignerStampNotices(placement), [], '不要な注意を出さない');

  // 保存済み基準があっても上書きしない。
  const withStored = resolveSignerStampPlacement({
    measurement: measureSignerBlock(buildOrigin({ blocks: [emptyBlock] }), SALE_KEY),
    storedBaseRatio: 0.49, stampWidth: STAMP_WIDTH,
  });
  assert.equal(withStored.source, 'empty');
  assert.equal(withStored.baseRatio, null);
  assert.deepEqual(buildSignerStampNotices(withStored), []);
});

test('128. 売渡証明書: 目印が消えたら保持基準、基準なしは従来右端へ仮配置する', () => {
  const pasted = buildOrigin({
    blocks: [new FakeElement({ box: rect(0, 600), children: [new FakeText('貼り付けられた本文', [rect(0, 500)])] })],
  });
  const lost = measureSignerBlock(pasted, SALE_KEY);
  assert.equal(lost.found, false);
  assert.equal(lost.empty, false);

  const stored = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: 0.64, stampWidth: STAMP_WIDTH });
  assert.equal(stored.source, 'stored');
  assert.ok(Math.abs(stored.baseX - 0.64 * 654) < 0.01);
  assert.equal(stored.baseRatio, null, 'fallback中は基準を上書き保存しない');
  assert.deepEqual(buildSignerStampNotices(stored), [SIGNER_STAMP_NOTICE_UNIDENTIFIED]);

  const legacy = resolveSignerStampPlacement({ measurement: lost, storedBaseRatio: null, stampWidth: STAMP_WIDTH });
  assert.equal(legacy.source, 'legacy-right');
  assert.equal(legacy.renderX, 654 - STAMP_WIDTH);
  assert.equal(isSignerStampAutoAligned(legacy), false);
});

test('129. 売渡証明書: 横幅不足は非阻害の注意だけで、印影を紙面内に留める', () => {
  const m = measureSale([{ addressRight: 610, nameRight: 260 }]);
  const placement = resolveSignerStampPlacement({ measurement: m, stampWidth: STAMP_WIDTH });
  assert.equal(placement.identified, true, '署名欄は判別できている');
  assert.equal(placement.widthShortage, true);
  assert.equal(isSignerStampAutoAligned(placement), false);
  assert.deepEqual(buildSignerStampNotices(placement), [SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE]);
  // 自動縮小・gap圧縮をしないので基準Xは収まらないまま、描画だけ紙面内に留める。
  assert.ok(placement.baseX > placement.containerWidth - STAMP_WIDTH);
  assert.equal(placement.renderX, 654 - STAMP_WIDTH);
});

test('130. 売渡証明書: 目印を保てる編集後DOMの実表示で再計測する', () => {
  const before = measureSale([{ addressRight: 300, nameRight: 250 }]);
  assert.equal(before.maxRight, 300);
  const after = measureSignerBlock(buildOrigin({
    blocks: [saleBlock([signerRow(0, [
      new FakeText('架空県架空市売町一丁目1番（編集後）', [rect(0, 462)]),
      new FakeText('架空 売主一', [rect(0, 250, 22)]),
    ])])],
  }), SALE_KEY);
  assert.equal(after.maxRight, 462, '編集後の表示行で再計測する');
  assert.ok(Math.abs(after.baseX - (462 + GAP_12PT_SALE)) < 0.01);
});

test('131. 売渡証明書の署名欄keyは既存16帳票と混ざらない', () => {
  const origin = buildOrigin({ blocks: [saleBlock([sellerRow(0, { addressRight: 400, nameRight: 250 })])] });
  assert.equal(measureSignerBlock(origin, SALE_KEY).found, true);
  for (const key of [TITLE_KEY, SAVE_KEY, ADDRESS_KEY, COMPLETION_TITLE_KEY, LOSS_CERT_KEY, STATEMENT_SHARED_KEY, STATEMENT_SOLE_KEY]) {
    assert.equal(measureSignerBlock(origin, key).found, false, key);
  }
  assert.equal(SALE_KEY, 'certificate.sale');
});

// --- 実描画（SSR）での接続 ---------------------------------------------------

const salePerson = (id, name, address, roles = ['その他']) => ({
  id, name, address, roles, share: '', shareOverrides: {},
});
const saleBuilding = {
  id: 'slb1', address: '架空県架空市五丁目5番地', houseNum: '505番5', kind: '居宅', struct: '木造２階建',
  floorAreas: [{ id: 'slf1', floor: '１階', area: '80.00' }], annexes: [], additionalCauses: [],
  registrationCause: '新築', registrationDate: { era: '令和', year: '8', month: '5', day: '6' },
  ownerPersonIds: ['sl1'], contractorPersonIds: [],
  confirmApplicantPersonIds: [], confirmApplicantNames: [],
};
const buildSaleSite = (people) => reconcileSiteDocumentCompatibility({
  id: 'site-sale',
  people,
  land: [], buildings: [], proposedBuildings: [saleBuilding],
  registrationApplications: [{
    id: 'rsl1', type: '建物表題登記',
    targetBuildingIds: [saleBuilding.id], targetLandIds: [],
    applicantPersonIds: people.filter(p => (p.roles || []).includes('申請人')).map(p => p.id),
    subject: { beforeBuildingIds: [], afterBuildingIds: [saleBuilding.id], landIds: [], primaryBuildingId: saleBuilding.id },
    documents: { '売渡証明書': 1, '非登載証明書': 1 },
  }],
  docPick: {},
});
// 買主(申請人) 1名 + 売主(その他) 2名。
const saleSite = buildSaleSite([
  salePerson('sl1', '架空 買主', '架空県架空市買町1番', ['申請人']),
  salePerson('se1', '架空 売主一', '架空県架空市売町一丁目1番1号'),
  salePerson('se2', '架空 売主二', '架空県架空市売町二丁目2番2号'),
]);
// 売主候補0名（その他roleなし）。
const saleSiteNoSeller = buildSaleSite([
  salePerson('sl1', '架空 買主', '架空県架空市買町1番', ['申請人']),
]);

const renderSaleDoc = (name, { pick = {}, isPrint = false, siteData = saleSite } = {}) =>
  realReact.renderToStaticMarkup(
    realReact.React.createElement(realReact.DocTemplate, {
      name, siteData, instanceKey: `${name}__1`, instanceIndex: 1,
      pick: { ...LEGACY_DOCUMENT_PICK_DEFAULTS, ...pick },
      isPrint, scriveners: [], documentContext: null,
    })
  );

const saleBlockHtml = (html) => {
  const start = html.indexOf(`${SIGNER_BLOCK_ATTR}="${SALE_KEY}"`);
  if (start < 0) return '';
  const end = html.indexOf('position:absolute;bottom:0', start);
  return html.slice(start, end < 0 ? html.length : end);
};

test('132. 売渡証明書の署名欄・売主行に目印が入り、行数は売主数と一致する', () => {
  const html = renderSaleDoc('売渡証明書');
  assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${SALE_KEY}"`), '署名欄目印');
  assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`), '売主行0');
  assert.ok(html.includes(`${SIGNER_ROW_ATTR}="1"`), '売主行1');
  const rows = html.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || [];
  assert.equal(rows.length, 2, '売主2名分');
  const block = saleBlockHtml(html);
  assert.ok(block.includes('架空県架空市売町一丁目1番1号'), '売主1の住所');
  assert.ok(block.includes('架空 売主一'), '売主1の氏名');
  assert.ok(block.includes('架空 売主二'), '売主2の氏名');
  assert.ok(!block.includes('架空 買主'), '買主は署名欄へ含めない');
});

test('133. 売渡証明書: 署名欄は12pt、売主行の表示内容・順序・縦レイアウトを変えていない', () => {
  const html = renderSaleDoc('売渡証明書');
  const block = saleBlockHtml(html);
  // gap基準の12ptラッパー。
  assert.ok(block.startsWith(`${SIGNER_BLOCK_ATTR}="${SALE_KEY}"`));
  assert.ok(html.includes('font-size:12pt'), '売主情報は12ptのまま');
  // 住所→氏名の順。
  const addrAt = block.indexOf('架空県架空市売町一丁目1番1号');
  const nameAt = block.indexOf('架空 売主一');
  assert.ok(addrAt > 0 && nameAt > 0 && addrAt < nameAt, '住所→氏名の順');
  // 既存のvertical layout（minHeight / 売主間4mm / paddingRight）を維持する。
  assert.ok(block.includes('min-height:26.6mm'), '売主行のminHeight');
  assert.ok(block.includes('margin-top:4mm'), '2人目以降の売主間4mm');
  assert.ok(block.includes('padding-right:calc(1em + 26.6mm)'), '印影用の右余白');
  // ソース側でも縦方向の値を変更していない。
  assert.ok(DOC_TEMPLATE_SOURCE.includes("marginTop: i > 0 ? '4mm' : '0'"));
  assert.ok(DOC_TEMPLATE_SOURCE.includes("<div style={{ fontSize: '11pt', marginTop: '6mm' }}>"));
});

test('134. 売渡証明書: 売主0名でも空の住所/氏名行と印影1個を維持し、行目印は付けない', () => {
  const html = renderSaleDoc('売渡証明書', { siteData: saleSiteNoSeller });
  assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${SALE_KEY}"`), 'emptyと判定させるため目印は残す');
  assert.ok(!html.includes(SIGNER_ROW_ATTR), '空行には売主行目印を付けない');
  // 空の住所/氏名行（全角空白の段落2本）と印影1個が従来どおり残る。
  const block = saleBlockHtml(html);
  assert.equal((block.match(/min-height:26\.6mm/g) || []).length, 1, '空の売主行は1つ');
  assert.equal((html.match(/stamp-drag-handle/g) || []).length, 2, '上部印影1個＋空の署名者印影1個');
  assert.ok(html.includes('right:0'), '計測前は従来の右端');
  assert.ok(!html.includes('架空 売主'), '売主を自動追加しない');
});

test('135. 売渡証明書: 売主選択・並び順の既存ロジックを変えていない', () => {
  // saleSellerPersonIds が空なら候補全員（default-all semantics）。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const sellerIds = Array.isArray(pick?.saleSellerPersonIds) ? pick.saleSellerPersonIds : [];'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('? sellerIds.map(id => sellerCandidates.find(p => p.id === id)).filter(Boolean)'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes(': sellerCandidates;'));
  // 空配列＝全員表示のまま（0名と再解釈しない）。
  const all = renderSaleDoc('売渡証明書', { pick: { saleSellerPersonIds: [] } });
  assert.equal((all.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || []).length, 2);
  // 明示選択は選んだ売主だけ。
  const only2 = renderSaleDoc('売渡証明書', { pick: { saleSellerPersonIds: ['se2'] } });
  assert.equal((only2.match(new RegExp(`${SIGNER_ROW_ATTR}="\\d+"`, 'g')) || []).length, 1);
  const only2Block = saleBlockHtml(only2);
  assert.ok(only2Block.includes('架空 売主二'));
  assert.ok(!only2Block.includes('架空 売主一'));
  // 並び順は指定順のまま（auto-alignのために並べ替えない）。
  const reordered = saleBlockHtml(renderSaleDoc('売渡証明書', { pick: { saleSellerPersonIds: ['se2', 'se1'] } }));
  assert.ok(reordered.indexOf('架空 売主二') < reordered.indexOf('架空 売主一'), '指定順を維持する');
});

test('136. 売渡証明書: 印影はindex方式のまま、manual dx/dyが自動基準へ加算される', () => {
  assert.ok(DOC_TEMPLATE_SOURCE.includes('const getSignerPos = (idx) => {'));
  assert.ok(DOC_TEMPLATE_SOURCE.includes('list.find(p => p?.i === idx)'));
  // [null] fallbackも従来どおり。
  assert.ok(DOC_TEMPLATE_SOURCE.includes('(displaySellers.length > 0 ? displaySellers : [null]).map((p, i) => {'));
  const html = renderSaleDoc('売渡証明書', { pick: { signerStampPositions: [{ i: 1, dx: 19, dy: -8 }] } });
  assert.ok(html.includes('left:19px'), '手動dx');
  assert.ok(html.includes('top:-8px'), '手動dy');
});

test('137. 売渡証明書: 帳票上部のDraggableStampは売主数に関係なく1個のまま', () => {
  for (const siteData of [saleSite, saleSiteNoSeller]) {
    const html = renderSaleDoc('売渡証明書', { siteData });
    const tops = html.match(/right:calc\(20mm - 0px\)/g) || [];
    assert.equal(tops.length, 1, '上部印影は1個');
    assert.ok(!/right:calc\(48\.6mm/.test(html), '売主数に連動させない');
  }
  // 上部印影は従来どおり stampPositions 側（index 0）で読む。
  const moved = renderSaleDoc('売渡証明書', { pick: { stampPositions: [{ i: 0, dx: 11, dy: 4 }] } });
  assert.ok(/right:calc\(20mm - 11px\)/.test(moved));
});

test('138. 売渡証明書: 通常時から本文編集可能なlegacy editingを維持する', () => {
  // P1の明示全文編集対象へ追加しない。
  assert.equal(isExplicitTextEditDocument('売渡証明書'), false);
  assert.equal(isDocumentBodyEditable({ documentName: '売渡証明書', isPrint: false, textEditingEnabled: false }), true,
    '通常時から編集可能');
  assert.equal(isDocumentBodyEditable({ documentName: '売渡証明書', isPrint: true, textEditingEnabled: false }), false,
    '印刷用DOMは編集不可');
  // 売渡証明書branch内で editable={!isPrint}（P1の textEditingEnabled ではない）のまま。
  const saleBranch = DOC_TEMPLATE_SOURCE.slice(
    DOC_TEMPLATE_SOURCE.indexOf('if (name === "売渡証明書")'),
    DOC_TEMPLATE_SOURCE.indexOf('if (name === "申述書（共有）")')
  );
  assert.ok(saleBranch.length > 0);
  assert.ok(saleBranch.includes('editable={!isPrint}'), '売渡証明書は通常時から編集可能なまま');
  assert.ok(!saleBranch.includes('bodyEditable'), 'P1の明示全文編集フラグを使わない');
  // 通常描画では編集可能で、目印も入る（編集後DOMを再計測できる）。
  const html = renderSaleDoc('売渡証明書');
  assert.ok(html.includes('contenteditable="true"'), '通常時editable');
  assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${SALE_KEY}"`));
  assert.ok(html.includes(`${SIGNER_ROW_ATTR}="0"`));
});

test('139. 売渡証明書: 計測前の初回描画は従来の右端で、印刷用DOMも同じ経路で描画する', () => {
  for (const isPrint of [false, true]) {
    const html = renderSaleDoc('売渡証明書', { isPrint });
    assert.ok(html.includes('right:0'), `isPrint=${isPrint}`);
    assert.ok(html.includes(`${SIGNER_BLOCK_ATTR}="${SALE_KEY}"`));
  }
  const html = renderSaleDoc('売渡証明書', { pick: { signerStampBaseRatio: 0.9 } });
  assert.ok(!html.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED));
  assert.ok(!html.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE));
  assert.ok(!html.includes('data-testid'));
  // 印刷用DOMでは編集可能にしない。
  assert.ok(!renderSaleDoc('売渡証明書', { isPrint: true }).includes('contenteditable="true"'));
});

// --- 保存境界 / 独立性 -------------------------------------------------------

const saleInstanceOf = (siteObj) => {
  for (const app of siteObj.registrationApplications || []) {
    const hit = (app.documentInstances || []).find(i => i.templateKey === SALE_KEY && i.copyIndex === 1);
    if (hit) return hit;
  }
  return null;
};

test('140. 売渡証明書: fallback基準はレイアウト情報として保存し、再読込で復元する', () => {
  const saved = applyPick(saleSite, '売渡証明書', { signerStampBaseRatio: 0.59 });
  assert.equal(saved.docPick?.['売渡証明書__1']?.signerStampBaseRatio, 0.59);
  const inst = saleInstanceOf(saved);
  assert.equal(inst.layoutOverrides.signerStampBaseRatio, 0.59);
  assert.equal(Object.prototype.hasOwnProperty.call(inst.selectionOverrides, 'signerStampBaseRatio'), false);
  const reloaded = reconcileSiteDocumentCompatibility(saved);
  assert.equal(reloaded.docPick?.['売渡証明書__1']?.signerStampBaseRatio, 0.59);
});

test('141. 売渡証明書: resetは印影位置キーだけ初期化し、基準・本文・売主選択を残す', () => {
  let saved = applyPick(saleSite, '売渡証明書', { signerStampBaseRatio: 0.43 });
  saved = applyPick(saved, '売渡証明書', { signerStampPositions: [{ i: 0, dx: 26, dy: -9 }] });
  saved = applyPick(saved, '売渡証明書', { stampPositions: [{ i: 0, dx: 6, dy: 6 }] });
  saved = applyPick(saved, '売渡証明書', { customText: '<div>売渡証明書の固定本文</div>' });
  saved = applyPick(saved, '売渡証明書', { saleSellerPersonIds: ['se2'] });

  const patch = buildStampPositionResetPatch();
  assert.deepEqual(Object.keys(patch).sort(), ['signerStampPositions', 'stampPositions']);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'signerStampBaseRatio'), false);

  const after = applyPick(saved, '売渡証明書', patch);
  const pick = after.docPick?.['売渡証明書__1'] || {};
  assert.equal(pick.signerStampPositions, null);
  assert.equal(pick.stampPositions, null);
  assert.equal(pick.signerStampBaseRatio, 0.43, 'fallback基準は失わない');
  assert.equal(pick.customText, '<div>売渡証明書の固定本文</div>', '本文は保全する');
  assert.deepEqual(pick.saleSellerPersonIds, ['se2'], '売主選択は保全する');
});

test('142. 売渡証明書: 自動計測の保存は本文・売主選択・業務データを変更しない', () => {
  const before = applyPick(saleSite, '売渡証明書', { saleSellerPersonIds: ['se1'] });
  const after = applyPick(before, '売渡証明書', { signerStampBaseRatio: 0.37 });
  assert.deepEqual(after.docPick?.['売渡証明書__1']?.saleSellerPersonIds, ['se1']);
  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.buildings, before.buildings);
  assert.deepEqual(after.proposedBuildings, before.proposedBuildings);
  const shape = (siteObj) => (siteObj.registrationApplications || [])
    .flatMap(app => (app.documentInstances || []).map(i => [
      i.templateKey, i.copyIndex, i.selectionOverrides, i.selectionOverrideBaselines,
      i.editMode, i.detachedHtml, i.active, i.printEnabled, i.contentOverrides,
    ]));
  assert.deepEqual(shape(after), shape(before), 'レイアウト以外の書類状態を変えない');
});

test('143. 売渡証明書: fallback基準は他帳票・別案件へ漏れない', () => {
  const saved = applyPick(saleSite, '売渡証明書', { signerStampBaseRatio: 0.68 });
  assert.equal(saved.docPick?.['売渡証明書__1']?.signerStampBaseRatio, 0.68);
  assert.equal(saved.docPick?.['非登載証明書__1']?.signerStampBaseRatio ?? null, null, '対象外帳票へ漏れない');
  assert.equal(site.docPick?.['委任状（表題）__1']?.signerStampBaseRatio ?? null, null);
  assert.equal(certSite.docPick?.['工事完了引渡証明書（表題）__1']?.signerStampBaseRatio ?? null, null);
  assert.equal(statementSite.docPick?.['申述書（共有）__1']?.signerStampBaseRatio ?? null, null);
});

// --- 既存16帳票・対象外の回帰 ------------------------------------------------

test('144. 既存16帳票の対象判定と代表描画に回帰がない', () => {
  for (const name of [...DELEGATION_DOCUMENTS, ...CERTIFICATE_DOCUMENTS, ...STATEMENT_DOCUMENTS]) {
    assert.equal(isSignerStampAutoAlignDocument(name), true, name);
    assert.deepEqual(buildSignerBlockAttributes(name), { [SIGNER_BLOCK_ATTR]: getDocumentTemplateKey(name) }, name);
  }
  // 委任状（11pt）/ 証明書（12pt）/ 申述書（11pt）の代表を実描画で確認。
  assert.ok(renderDoc('委任状（表題）').includes(`${SIGNER_BLOCK_ATTR}="${TITLE_KEY}"`));
  assert.ok(renderDoc('委任状（表題）').includes('font-size:11pt'));
  assert.ok(renderDoc('委任状（保存）').includes('ふりがな'));
  assert.ok(renderCertDoc('工事完了引渡証明書（表題）').includes(`${SIGNER_BLOCK_ATTR}="${COMPLETION_TITLE_KEY}"`));
  assert.ok(renderCertDoc('工事完了引渡証明書（表題）').includes('font-size:12pt'));
  assert.ok(renderStatementDoc('申述書（共有）').includes(`${SIGNER_BLOCK_ATTR}="${STATEMENT_SHARED_KEY}"`));
  assert.ok(renderStatementDoc('申述書（単独）').includes(`${SIGNER_BLOCK_ATTR}="${STATEMENT_SOLE_KEY}"`));
});

test('145. 非登載証明書は対象外のまま（署名者印影を持たない）', () => {
  assert.equal(isSignerStampAutoAlignDocument('非登載証明書'), false);
  assert.equal(buildSignerBlockAttributes('非登載証明書'), null);
  assert.equal(buildSignerRowAttributes('非登載証明書', 0), null);
  const html = renderSaleDoc('非登載証明書');
  assert.ok(!html.includes(SIGNER_BLOCK_ATTR), '署名欄目印を付けない');
  assert.ok(!html.includes(SIGNER_ROW_ATTR), '署名者行目印を付けない');
  assert.ok(!html.includes(SIGNER_STAMP_NOTICE_UNIDENTIFIED));
  assert.ok(!html.includes(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE));
});
