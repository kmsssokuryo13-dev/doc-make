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
import { isExplicitTextEditDocument } from '../src/documentTextEditing.js';

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
const GAP_11PT = 14.6667 * SIGNER_STAMP_GAP_EM;
const STAMP_WIDTH = 100; // 26.6mm相当の代表値

// ---------------------------------------------------------------------------
// 1. 対象帳票のガード（P-AC01）
// ---------------------------------------------------------------------------

test('1. 自動配置を有効化するのは委任状（表題）・委任状（保存）だけ', () => {
  assert.deepEqual([...SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS], ['委任状（表題）', '委任状（保存）']);
  assert.equal(isSignerStampAutoAlignDocument('委任状（表題）'), true);
  assert.equal(isSignerStampAutoAlignDocument('委任状（保存）'), true);
  for (const other of [
    '委任状（住所変更）', '委任状（地目変更）', '委任状（滅失）', '委任状（表題部変更）',
    '委任状（表題部更正）', '委任状（合併）', '委任状（分割）', '委任状（合体）',
    '工事完了引渡証明書（表題）', '工事完了引渡証明書（表題部変更）',
    '滅失証明書（滅失）', '滅失証明書（表題部変更）', '非登載証明書',
    '申述書（共有）', '申述書（単独）', '売渡証明書',
  ]) {
    assert.equal(isSignerStampAutoAlignDocument(other), false, other);
  }
});

test('2. 名称の前方一致や「委任状」全般への暗黙の展開をしない', () => {
  assert.equal(isSignerStampAutoAlignDocument('委任状'), false);
  assert.equal(isSignerStampAutoAlignDocument('委任状（表題）2'), false);
  assert.equal(isSignerStampAutoAlignDocument('委任状（表題部変更）'), false);
  assert.equal(buildSignerBlockAttributes('委任状（滅失）'), null);
  assert.equal(buildSignerRowAttributes('申述書（共有）', 0), null);
  assert.deepEqual(buildSignerBlockAttributes('委任状（表題）'), { [SIGNER_BLOCK_ATTR]: TITLE_KEY });
  assert.deepEqual(buildSignerRowAttributes('委任状（保存）', 2), { [SIGNER_ROW_ATTR]: '2' });
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
  for (const name of ['委任状（住所変更）', '申述書（共有）', '工事完了引渡証明書（表題）']) {
    const html = renderDoc(name);
    assert.ok(!html.includes(SIGNER_BLOCK_ATTR), `${name}に署名欄目印を付けない`);
    assert.ok(!html.includes(SIGNER_ROW_ATTR), `${name}に署名者行目印を付けない`);
    assert.ok(html.includes('right:0'), `${name}の印影列は従来どおり右端固定`);
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
