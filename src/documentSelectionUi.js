import { BUILDING_TITLE_DOCUMENTS } from './documentContext.js';

// Step3 P2: Step1を正本とし、建物表題4帳票の通常UIからStep1と重複する選択UIを外す。
// 書類固有の例外設定は「個別設定」へ集約し、既存overrideは隠さず解除導線を付ける。
const SELECTION_CLEANUP_DOCUMENT_SET = new Set(BUILDING_TITLE_DOCUMENTS);

export const isSelectionCleanupDocument = (documentName) =>
  SELECTION_CLEANUP_DOCUMENT_SET.has(documentName);

// Step3の個別設定として扱うselectionOverridesのキー。
export const SELECTION_OVERRIDE_KEYS = Object.freeze([
  'targetPropBuildingId',
  'applicantPersonIds',
  'targetContractorPersonId',
  'statementPersonIds',
  'statementApplicantPersonId',
]);

export const SELECTION_OVERRIDE_LABELS = Object.freeze({
  targetPropBuildingId: '対象建物',
  applicantPersonIds: '申請人',
  targetContractorPersonId: '工事人',
  statementPersonIds: '申述人',
  statementApplicantPersonId: '単独出資者',
});

// documentContext.js が実際に発行するissue codeだけを列挙する（名称を推測しない）。
// 工事人: 対象建物から1名に解決できる場合はissueが出ないため、通常時はselectを出さない。
export const CONTRACTOR_SELECTION_ISSUE_CODES = Object.freeze([
  'CONTRACTOR_AMBIGUOUS',
  'CONTRACTOR_REQUIRED',
  'CONTRACTOR_NOT_FOUND',
  'CONTRACTOR_DUPLICATE_ID',
  // 建物紐付けがなく案件内の唯一の工事人を暫定使用している状態。
  // 「対象建物から自動解決できた」状態ではないため、確認できるようselectを出す。
  'LEGACY_CONTRACTOR_FALLBACK',
]);

// 単独出資者: 申請人1名なら自動解決されissueが出ないため、通常時はselectを出さない。
export const SOLE_APPLICANT_SELECTION_ISSUE_CODES = Object.freeze([
  'SOLE_APPLICANT_REQUIRED',
  'SOLE_APPLICANT_NOT_APPLICANT',
  'SOLE_APPLICANT_NOT_FOUND',
  'SOLE_APPLICANT_DUPLICATE_ID',
]);

const hasOwn = (value, key) =>
  !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);

const hasIssueCode = (context, codes) =>
  (context?.issues || []).some(issue => codes.includes(issue?.code));

export const hasSelectionOverride = (documentInstance, key) =>
  hasOwn(documentInstance?.selectionOverrides, key);

// 保存済みの個別設定キー一覧。個別設定中バッジと解除導線の描画に使う。
export const getSelectionOverrideKeys = (documentInstance) => {
  const overrides = documentInstance?.selectionOverrides;
  if (!overrides || typeof overrides !== 'object') return [];
  return SELECTION_OVERRIDE_KEYS.filter(key => hasOwn(overrides, key));
};

// P2のUI整理を適用してよいのは、DocumentContextが効いている対象4帳票だけ。
// legacy案件（RAなし・context非対応）は従来UIのまま扱う。
export const usesSelectionCleanupUi = ({ documentName, context } = {}) =>
  isSelectionCleanupDocument(documentName) && context?.supported === true;

// 工事人selectを出す条件: override保存済み、または工事人選択を要する実issueがある場合。
export const shouldShowContractorSelect = ({ documentName, context, documentInstance } = {}) => {
  if (documentName !== '工事完了引渡証明書（表題）') return false;
  if (!usesSelectionCleanupUi({ documentName, context })) return true;
  if (hasSelectionOverride(documentInstance, 'targetContractorPersonId')) return true;
  return hasIssueCode(context, CONTRACTOR_SELECTION_ISSUE_CODES);
};

// 単独出資者selectを出す条件: override保存済み、または選択を要する実issueがある場合。
export const shouldShowSoleApplicantSelect = ({ documentName, context, documentInstance } = {}) => {
  if (documentName !== '申述書（単独）') return false;
  if (!usesSelectionCleanupUi({ documentName, context })) return true;
  if (hasSelectionOverride(documentInstance, 'statementApplicantPersonId')) return true;
  return hasIssueCode(context, SOLE_APPLICANT_SELECTION_ISSUE_CODES);
};

// 「Step1に戻す」用のpatch。
// v8CompatibilityのmergeLegacyPickは、書き込み値が
//   - application正本値と一致する（targetPropBuildingId / applicantPersonIds）
//   - もしくはLEGACY_DOCUMENT_PICK_DEFAULTSと一致する（工事人 / 申述人 / 単独出資者）
// 場合にoverrideを削除する。その既存ルールに乗せて解除する。
// targetPropBuildingIdへ安易に "" を書くと、canonicalが実IDの時に
// 「建物なし」overrideを新規作成しTARGET_BUILDING_REQUIREDを誘発するため、
// 必ずcanonical値を書き戻す。
export const buildSelectionResetPatch = (key, context) => {
  switch (key) {
    case 'targetPropBuildingId':
      return { targetPropBuildingId: context?.canonicalSelection?.targetBuildingId || '' };
    case 'applicantPersonIds':
      return { applicantPersonIds: [...(context?.canonicalSelection?.applicantPersonIds || [])] };
    case 'targetContractorPersonId':
      return { targetContractorPersonId: '' };
    case 'statementPersonIds':
      return { statementPersonIds: [] };
    case 'statementApplicantPersonId':
      return { statementApplicantPersonId: '' };
    default:
      return null;
  }
};
