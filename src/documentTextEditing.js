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
