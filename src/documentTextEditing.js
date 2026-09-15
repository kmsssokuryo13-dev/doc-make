import { BUILDING_TITLE_DOCUMENTS } from './documentContext.js';

// Step3 P1: 建物表題4帳票だけ、本文編集を「全文編集を開始」の明示操作に限定する。
// 他帳票は現行どおりプレビュー本文を常時編集可能のまま扱う。
const EXPLICIT_TEXT_EDIT_DOCUMENT_SET = new Set(BUILDING_TITLE_DOCUMENTS);

export const isExplicitTextEditDocument = (documentName) =>
  EXPLICIT_TEXT_EDIT_DOCUMENT_SET.has(documentName);

export const isDocumentBodyEditable = ({ documentName, isPrint = false, textEditingEnabled = false } = {}) =>
  !isPrint && (!isExplicitTextEditDocument(documentName) || textEditingEnabled === true);

// 選択文字のHTMLを書き換える文字サイズ変更はcustomTextを生成するため、本文編集可能な時だけ許可する。
export const canApplySelectionFontSize = ({ documentName, textEditingEnabled = false } = {}) =>
  isDocumentBodyEditable({ documentName, isPrint: false, textEditingEnabled });

// P1: fontScaleはDocTemplateの描画処理から参照されないため、対象4帳票のread-only時は
// 効かない「帳票全体の文字サイズ」を出さず、選択文字サイズを実行できる時だけUIを表示する。
// 帳票全体スケーリングの正式仕様はP4で決定する。
export const shouldShowFontSizeControl = ({ documentName, textEditingEnabled = false } = {}) =>
  canApplySelectionFontSize({ documentName, textEditingEnabled });

// 選択文字がない場合のfontScaleフォールバック保存は、従来挙動を維持する非対象帳票だけに残す。
export const canFallbackToDocumentFontScale = (documentName) =>
  !isExplicitTextEditDocument(documentName);

// 文字サイズselect操作時に何を保存するかを決める。
// - applySelection: 選択文字へspan font-sizeを適用し、customTextとして全文固定保存する（現行P1挙動）。
// - saveFontScale : 非対象帳票の従来フォールバック。fontScaleだけ保存する。
// - none          : 何も保存しない。対象4帳票で選択文字がない場合はここに入る。
export const resolveFontSizeChange = ({
  documentName,
  textEditingEnabled = false,
  hasSelection = false,
  fontScale,
} = {}) => {
  if (!shouldShowFontSizeControl({ documentName, textEditingEnabled })) return { action: 'none', patch: null };
  if (hasSelection) return { action: 'applySelection', patch: { fontScale: 100 } };
  if (canFallbackToDocumentFontScale(documentName)) return { action: 'saveFontScale', patch: { fontScale } };
  return { action: 'none', patch: null };
};
