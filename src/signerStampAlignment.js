// 署名者印影の自動配置（仕様書v1.3 / Pilot + 委任状8種 + 証明書4種 + 申述書2種展開）。
//
// 目的:
//   署名者情報として実際に描画された全表示行のうち、最も右まで伸びる行の右端を求め、
//   そこへ通常本文サイズの2em相当の余白を足した位置を、その書類の全署名者印影の
//   共通の初期X（印影枠の左端）とする。
//
// 本モジュールの責務は「判定」と「計算」だけで、業務データ（本文 / customText /
// selectionOverrides / 確認済み状態 / 人物・建物）には一切触れない。
// 描画側との接続は useSignerStampAlignment.js が行う。
//
// 座標系:
//   すべて「印影列を配置する position:relative コンテナ（originEl）の左端」を原点とした
//   px で扱う。行頭のインデントが違っても同じ原点で比較されるため、幅の最大値ではなく
//   実際の右端で比較できる。
//   保存時だけはコンテナ幅に対する比率へ正規化し、表示倍率に依存しないようにする。

import { getDocumentTemplateKey } from './v8Compatibility.js';

// 自動配置を有効化する帳票。
// 名称の前方一致や「委任状すべて」による暗黙の展開はしない（完全一致のみ）。
// 委任状10帳票は renderDelegationCommon、証明書4帳票は個別branchから呼ぶ局所helper、
// 申述書2帳票は renderStatementCommon を共有しており、署名欄の目印・原点ref・
// 印影列refはそこで付ける。計測・配置・fallbackのロジックを帳票ごとに複製しない。
export const SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS = Object.freeze([
  // 先行実装（Pilot）で本番反映済み。
  '委任状（表題）',
  '委任状（保存）',
  // 段階展開（2026-09-16）。委任状（住所変更）は renderSignerMultiLine の複数行型、
  // 残り7帳票は通常の署名者行に加えて renderOwnerWithDecedent の
  // 被相続人/相続人2行になり得る。どちらも表示行をすべて比較する。
  '委任状（住所変更）',
  '委任状（地目変更）',
  '委任状（滅失）',
  '委任状（表題部変更）',
  '委任状（表題部更正）',
  '委任状（合併）',
  '委任状（分割）',
  '委任状（合体）',
  // 証明書展開（2026-09-16）。いずれも単独工事人1名の署名欄で、
  // 住所 / 氏名 / 代表者の3行を同じ署名欄の候補行として比較する。
  // 通常本文は12ptだが、余白Gはcomputed font-sizeから算出するのでここでは扱わない。
  '工事完了引渡証明書（表題）',
  '工事完了引渡証明書（表題部変更）',
  '滅失証明書（滅失）',
  '滅失証明書（表題部変更）',
  // 申述書展開（2026-09-17）。共通の renderStatementCommon を使い、申述人1人が
  // 「住所＋表示中の持分＋氏名」の同一行1本になる。行全体を1つの候補行として比較する。
  '申述書（共有）',
  '申述書（単独）',
]);

const AUTO_ALIGN_DOCUMENT_SET = new Set(SIGNER_STAMP_AUTO_ALIGN_DOCUMENTS);

export const isSignerStampAutoAlignDocument = (documentName) =>
  AUTO_ALIGN_DOCUMENT_SET.has(documentName);

// 署名欄の内部的な目印。利用者に見える文言・行構成・ページ数は変えない。
// 値に帳票のtemplateKeyを入れ、別帳票のHTMLを貼り付けた場合に取り違えないようにする。
export const SIGNER_BLOCK_ATTR = 'data-signer-block';
export const SIGNER_ROW_ATTR = 'data-signer-row';
// EditableDocBodyが持つ非表示のcapture用DOM。計測対象から除外する目印。
export const DOC_CAPTURE_ATTR = 'data-doc-capture';

// 文字右端と印影左端の間隔G（全角スペース2つ分 = 通常本文サイズの2em相当）。
export const SIGNER_STAMP_GAP_EM = 2;

export const SIGNER_STAMP_NOTICE_UNIDENTIFIED =
  '署名欄の構成が変わったため、印影位置を確認してください。';
export const SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE =
  '文字と印影が横幅に収まりません。位置や本文を調整してください。';

// 0.5px未満の差は描画誤差として横幅不足にしない。
const WIDTH_TOLERANCE_PX = 0.5;
// 保存する基準比率の丸め桁。サブピクセルのゆらぎで保存が繰り返されるのを防ぐ。
const BASE_RATIO_DECIMALS = 5;

export const getSignerBlockKey = (documentName) =>
  getDocumentTemplateKey(documentName) || '';

// 署名欄コンテナへ付ける属性。対象外帳票では null を返し、DOMを一切変えない。
export const buildSignerBlockAttributes = (documentName) => {
  if (!isSignerStampAutoAlignDocument(documentName)) return null;
  const key = getSignerBlockKey(documentName);
  if (!key) return null;
  return { [SIGNER_BLOCK_ATTR]: key };
};

export const buildSignerRowAttributes = (documentName, index) => {
  if (!isSignerStampAutoAlignDocument(documentName)) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { [SIGNER_ROW_ATTR]: String(index) };
};

export const roundBaseRatio = (ratio) => {
  if (!Number.isFinite(ratio)) return null;
  const factor = 10 ** BASE_RATIO_DECIMALS;
  return Math.round(ratio * factor) / factor;
};

const isBlankText = (text) => !/\S/.test(text || '');

// 実際に描画された行ボックスを集める。
// - テキストノード単位のRangeを使うため、幅100%のブロックコンテナや
//   印影用に予約されたpadding領域を「文字の右端」と誤認しない。
// - 折返しがあればテキストノード1つから複数の行矩形が返るので、別行を合算しない。
// - 全角スペースだけ等の空行は基準にしない。
const collectRenderedLineRects = (blockEl, doc) => {
  const rects = [];
  if (!blockEl || !doc || typeof doc.createTreeWalker !== 'function') return rects;
  const walker = doc.createTreeWalker(blockEl, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue || '';
    if (!isBlankText(text)) {
      const parent = node.parentElement;
      // ドラッグハンドル等の非本文要素は署名欄内に置かないが、混入時も基準にしない。
      const isNonBody = parent && typeof parent.closest === 'function' &&
        parent.closest('[contenteditable="false"]');
      if (!isNonBody) {
        range.selectNodeContents(node);
        const list = range.getClientRects ? range.getClientRects() : [];
        for (let i = 0; i < list.length; i += 1) {
          const rect = list[i];
          if (rect && rect.width > 0) rects.push(rect);
        }
      }
    }
    node = walker.nextNode();
  }
  return rects;
};

// 現在描画中の署名欄の候補を集める。
// EditableDocBodyの非表示capture用DOMは計測対象から除外する。
const findSignerBlockCandidates = (originEl, blockKey) => {
  const found = [];
  if (!originEl || typeof originEl.querySelectorAll !== 'function') return found;
  const candidates = originEl.querySelectorAll(`[${SIGNER_BLOCK_ATTR}="${blockKey}"]`);
  for (let i = 0; i < candidates.length; i += 1) {
    const el = candidates[i];
    if (typeof el.closest === 'function' && el.closest(`[${DOC_CAPTURE_ATTR}]`)) continue;
    found.push(el);
  }
  return found;
};

const countSignerRows = (el) =>
  el && typeof el.querySelectorAll === 'function'
    ? el.querySelectorAll(`[${SIGNER_ROW_ATTR}]`).length
    : 0;

// 署名者が1人も表示されていない状態。
// 目印はあるので「判別不能」ではなく、注意も出さない。
const emptyResult = (containerWidth) => ({
  found: false, empty: true, containerWidth, rowCount: 0, lineCount: 0,
});

const unidentifiedResult = (containerWidth, rowCount = 0) => ({
  found: false, empty: false, containerWidth, rowCount, lineCount: 0,
});

/**
 * 現在のDOMから自動基準Xの素材を計測する。
 * originEl は印影列を配置している position:relative コンテナ。
 * 戻り値の baseX / containerWidth は originEl の左端を原点としたpx。
 */
export const measureSignerBlock = (originEl, blockKey) => {
  if (!originEl || typeof originEl.getBoundingClientRect !== 'function') return null;
  if (!blockKey) return null;
  const doc = originEl.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) return null;

  const originRect = originEl.getBoundingClientRect();
  if (!(originRect.width > 0)) return null;
  const containerWidth = originRect.width;

  const candidates = findSignerBlockCandidates(originEl, blockKey);
  const block = candidates.find(el => {
    const rect = el.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0;
  }) || null;
  if (!block) {
    // 目印はあるが署名者行が1つも無い＝そもそも並べる印影が無い状態。
    const hasEmptyBlock = candidates.some(el => countSignerRows(el) === 0);
    return hasEmptyBlock ? emptyResult(containerWidth) : unidentifiedResult(containerWidth);
  }

  const rowCount = countSignerRows(block);
  const rects = collectRenderedLineRects(block, doc);
  if (!rects.length) {
    return rowCount === 0 ? emptyResult(containerWidth) : unidentifiedResult(containerWidth, rowCount);
  }

  let maxRight = -Infinity;
  for (const rect of rects) {
    if (rect.right > maxRight) maxRight = rect.right;
  }
  if (!Number.isFinite(maxRight)) return unidentifiedResult(containerWidth, rowCount);

  // 余白Gは署名欄の通常本文サイズを基準にする。
  // 署名欄内の一部だけ拡縮された文字やふりがなで基準を切り替えない。
  const fontSize = parseFloat(view.getComputedStyle(block).fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return unidentifiedResult(containerWidth, rowCount);
  }

  return {
    found: true,
    empty: false,
    containerWidth,
    rowCount,
    lineCount: rects.length,
    maxRight: maxRight - originRect.left,
    gap: fontSize * SIGNER_STAMP_GAP_EM,
    baseX: (maxRight - originRect.left) + fontSize * SIGNER_STAMP_GAP_EM,
  };
};

/**
 * 計測結果と保存済み基準から、今回描画する印影列の位置を決める純関数。
 *
 * source:
 *   'measured'     … 署名欄を判別できたので実表示から自動配置（正常）
 *   'empty'        … 署名欄はあるが署名者が0名。並べる印影が無いため従来位置のまま
 *   'stored'       … 判別不能だが最後の有効基準があるのでそこを基準に手動調整
 *   'legacy-right' … 判別不能かつ有効基準なし。従来の署名欄右端へ仮配置
 *
 * widthShortage は「判別できたが横幅に収まらない」U2と、fallback位置が収まらない場合の
 * 両方で立つ。判別不能(identified=false)とは別の状態として扱う。
 */
export const resolveSignerStampPlacement = ({
  measurement,
  storedBaseRatio = null,
  stampWidth = 0,
} = {}) => {
  const containerWidth = measurement?.containerWidth;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return null;

  const width = Number.isFinite(stampWidth) && stampWidth > 0 ? stampWidth : 0;
  // 従来の配置（コンテナ右端に印影の右端を合わせる）。仮配置とclampの上限に使う。
  const legacyX = Math.max(0, containerWidth - width);

  // 署名者が1人も表示されていない場合は並べる印影自体が無い。
  // 判別不能ではないので注意を出さず、従来位置のまま何も保存しない。
  if (measurement?.empty) {
    return {
      identified: true,
      source: 'empty',
      containerWidth,
      baseX: legacyX,
      renderX: legacyX,
      widthShortage: false,
      baseRatio: null,
    };
  }

  let identified = false;
  let source = 'legacy-right';
  let baseX = legacyX;

  if (measurement?.found && Number.isFinite(measurement.baseX)) {
    identified = true;
    source = 'measured';
    baseX = measurement.baseX;
  } else if (Number.isFinite(storedBaseRatio) && storedBaseRatio >= 0) {
    source = 'stored';
    baseX = storedBaseRatio * containerWidth;
  }

  const widthShortage = baseX + width > containerWidth + WIDTH_TOLERANCE_PX;
  // 横幅不足でも印影が画面外へ出て操作不能にならないよう、描画位置だけは紙面内に留める。
  // これは「自動で収めた成功状態」ではなく、手修正へ到達するための最低限の担保。
  const renderX = Math.min(Math.max(baseX, 0), legacyX);

  return {
    identified,
    source,
    containerWidth,
    baseX,
    renderX,
    widthShortage,
    // 保存するのは実表示から確定できた基準だけ。fallback中の値は上書き保存しない。
    baseRatio: source === 'measured' ? roundBaseRatio(baseX / containerWidth) : null,
  };
};

export const buildSignerStampNotices = (placement) => {
  if (!placement) return [];
  const notices = [];
  if (!placement.identified) notices.push(SIGNER_STAMP_NOTICE_UNIDENTIFIED);
  if (placement.widthShortage) notices.push(SIGNER_STAMP_NOTICE_WIDTH_SHORTAGE);
  return notices;
};

// 自動整列が成功している状態か。注意表示のある状態と混同しない。
export const isSignerStampAutoAligned = (placement) =>
  !!placement && placement.source === 'measured' && !placement.widthShortage;

export const isSamePlacement = (left, right) => {
  if (left === right) return true;
  if (!left || !right) return false;
  const near = (a, b) => Math.abs(a - b) < 0.01;
  return left.identified === right.identified &&
    left.source === right.source &&
    left.widthShortage === right.widthShortage &&
    near(left.baseX, right.baseX) &&
    near(left.renderX, right.renderX) &&
    near(left.containerWidth, right.containerWidth) &&
    left.baseRatio === right.baseRatio;
};
