import {
  CONTRACTOR_SELECTION_ISSUE_CODES,
  SOLE_APPLICANT_SELECTION_ISSUE_CODES,
} from './documentSelectionUi.js';

// Step3 P3: documentContext.js が出す既存issueを「どこで確認すればよいか」へ分類する。
// validation/severityは変更せず、分類だけを行う純関数群。
//
// 分類はcode名の推測ではなく、documentContext.js の実 scope / path を根拠にする。
// resolvePeople 経由のissueは code も path も動的に決まるため、path前置を主軸にしている。

export const GUIDANCE_KINDS = Object.freeze({
  STEP1: 'step1',
  CASE_INFO: 'case-info',
  DETAIL_SETTINGS: 'detail-settings',
  FULLTEXT: 'fulltext',
  STEP3_SELECT: 'step3-select',
  NONE: 'none',
});

// Step3内の既存selectで確認できるissue。P2の表示条件と同じcodeを正本にする。
// ただし *_DUPLICATE_ID は「同じ人物IDが複数存在する」データ不整合で、
// Step3のselectでは解決できないため案件情報側へ回す。
const CONTRACTOR_SELECT_CODES = Object.freeze(
  CONTRACTOR_SELECTION_ISSUE_CODES.filter(code => code !== 'CONTRACTOR_DUPLICATE_ID')
);
const SOLE_APPLICANT_SELECT_CODES = Object.freeze(
  SOLE_APPLICANT_SELECTION_ISSUE_CODES.filter(code => code !== 'SOLE_APPLICANT_DUPLICATE_ID')
);

// 人物IDの重複が原因のissue。確認先は常に案件情報（関係人）。
const PERSON_DUPLICATE_CODES = Object.freeze([
  'PERSON_ID_DUPLICATE',
  'APPLICANT_DUPLICATE_ID',
  'APPLICATION_APPLICANT_DUPLICATE_ID',
  'OWNER_DUPLICATE_ID',
  'STATEMENT_SIGNER_DUPLICATE_ID',
  'CONFIRMATION_APPLICANT_DUPLICATE_ID',
  'CONTRACTOR_DUPLICATE_ID',
  'SOLE_APPLICANT_DUPLICATE_ID',
]);

// 持分はpersonのshare / shareOverridesで、関係人タブで編集する。
// pathは application.* / building.* / document.* と散らばるためcodeで判定する。
const SHARE_CODES = Object.freeze(['SHARE_REQUIRED', 'SHARE_INVALID', 'SHARE_TOTAL_MISMATCH']);

// Editorのタブ名。activeTabはEditorのlocal stateでdeep-link手段がないため、
// 遷移は案件情報画面までとし、タブ名は文言ヒントとしてのみ使う。
const CASE_INFO_TAB_HINTS = Object.freeze([
  { prefix: 'people.', tab: '関係人' },
  { prefix: 'site.people', tab: '関係人' },
  { prefix: 'building.', tab: '申請建物' },
  { prefix: 'site.proposedBuildings', tab: '申請建物' },
]);

const startsWith = (value, prefix) => typeof value === 'string' && value.startsWith(prefix);

const caseInfoTabHint = (path) =>
  (CASE_INFO_TAB_HINTS.find(entry => startsWith(path, entry.prefix)) || {}).tab || '';

const guidance = (kind, extra = {}) => ({ kind, ...extra });

// issue 1件の確認先を決める。actionは「確認箇所を見せる」だけで、値は変更しない。
export const classifyIssueGuidance = (issue) => {
  if (!issue || typeof issue !== 'object') return guidance(GUIDANCE_KINDS.NONE);
  const { code = '', scope = 'source', path = '' } = issue;

  // 個別設定(P2)のoverrideに関するissue。
  if (scope === 'selection-override') return guidance(GUIDANCE_KINDS.DETAIL_SETTINGS);
  // 全文固定(P1)に関するissue。
  if (scope === 'detached') return guidance(GUIDANCE_KINDS.FULLTEXT);
  if (scope === 'override') {
    if (startsWith(path, 'document.selectionOverrides.')) return guidance(GUIDANCE_KINDS.DETAIL_SETTINGS);
    // contentOverridesは対応するUIが無い（v7保存の制約通知）。導線を付けない。
    return guidance(GUIDANCE_KINDS.NONE);
  }

  // 人物IDの重複・持分は案件情報側でしか直せない。
  if (PERSON_DUPLICATE_CODES.includes(code) || SHARE_CODES.includes(code)) {
    return guidance(GUIDANCE_KINDS.CASE_INFO, { tab: '関係人' });
  }

  // Step3の既存selectで確認できるもの。
  if (CONTRACTOR_SELECT_CODES.includes(code)) {
    return guidance(GUIDANCE_KINDS.STEP3_SELECT, { targetTestId: 'contractor-select' });
  }
  if (SOLE_APPLICANT_SELECT_CODES.includes(code)) {
    return guidance(GUIDANCE_KINDS.STEP3_SELECT, { targetTestId: 'sole-applicant-select' });
  }

  // 個別設定の値そのものを指しているissue。
  if (startsWith(path, 'document.selectionOverrides.')) return guidance(GUIDANCE_KINDS.DETAIL_SETTINGS);

  // Step1（申請内容）が正本のissue。
  if (startsWith(path, 'application')) return guidance(GUIDANCE_KINDS.STEP1);

  // 案件情報（関係人・申請建物）が正本のissue。
  const tab = caseInfoTabHint(path);
  if (tab) return guidance(GUIDANCE_KINDS.CASE_INFO, { tab });

  // 安全な確認先を特定できないものは、messageだけ表示する。
  return guidance(GUIDANCE_KINDS.NONE);
};

// 表示用にissueを整形する。同じ文言が複数人物分で重複しないよう1件にまとめる。
export const buildIssueGuidanceList = (context) => {
  const issues = Array.isArray(context?.issues) ? context.issues : [];
  const seen = new Set();
  const list = [];
  issues.forEach(issue => {
    if (!issue) return;
    const info = classifyIssueGuidance(issue);
    const key = `${issue.severity || 'blocking'}|${info.kind}|${info.targetTestId || ''}|${issue.message || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      code: issue.code || '',
      severity: issue.severity === 'warning' ? 'warning' : 'blocking',
      message: issue.message || '',
      guidance: info,
    });
  });
  return list;
};

export const countIssuesBySeverity = (context) => {
  const issues = Array.isArray(context?.issues) ? context.issues : [];
  let blocking = 0;
  let warning = 0;
  issues.forEach(issue => {
    if (issue?.severity === 'warning') warning += 1;
    else blocking += 1;
  });
  return { blocking, warning, total: issues.length };
};

export const hasNoIssues = (context) =>
  !!context?.supported && (Array.isArray(context?.issues) ? context.issues.length : 0) === 0;
