import { DEFAULT_DELEGATION_TEXT } from './constants.js';
import { getDocumentTemplateKey } from './v8Compatibility.js';

export const DOCUMENT_CONTEXT_VERSION = 1;

export const BUILDING_TITLE_DOCUMENTS = Object.freeze([
  '委任状（表題）',
  '工事完了引渡証明書（表題）',
  '申述書（共有）',
  '申述書（単独）',
]);

const BUILDING_TITLE_DOCUMENT_SET = new Set(BUILDING_TITLE_DOCUMENTS);
const STATEMENT_DOCUMENTS = new Set(['申述書（共有）', '申述書（単独）']);

const hasOwn = (value, key) =>
  !!value && Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const uniqueStrings = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(item => typeof item === 'string' && item)));
};

const sameStringList = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameStringSet = (left, right) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && Array.from(leftSet).every(value => rightSet.has(value));
};

const nonBlank = (value) => String(value ?? '').trim().length > 0;

const indexById = (items) => {
  const index = new Map();
  const duplicateIds = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id) continue;
    if (index.has(id)) duplicateIds.add(id);
    else index.set(id, item);
  }
  return { index, duplicateIds };
};

const createIssueCollector = () => {
  const issues = [];
  const seen = new Set();
  const add = ({ code, severity = 'blocking', scope = 'source', path = '', message, relatedIds = [] }) => {
    const safeIds = uniqueStrings(relatedIds);
    const key = `${code}:${scope}:${path}:${safeIds.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ code, severity, scope, path, message, relatedIds: safeIds });
  };
  return { issues, add };
};

const resolvePeople = ({
  ids,
  peopleIndex,
  duplicatePersonIds,
  addIssue,
  requiredCode,
  missingCode,
  duplicateCode = 'PERSON_ID_DUPLICATE',
  path,
  requiredMessage,
  missingMessage,
}) => {
  const selectedIds = uniqueStrings(ids);
  if (selectedIds.length === 0) {
    addIssue({ code: requiredCode, path, message: requiredMessage });
    return [];
  }

  const result = [];
  const missingIds = [];
  const ambiguousIds = [];
  for (const id of selectedIds) {
    if (duplicatePersonIds.has(id)) {
      ambiguousIds.push(id);
      continue;
    }
    const person = peopleIndex.get(id);
    if (person) result.push(person);
    else missingIds.push(id);
  }
  if (ambiguousIds.length > 0) {
    addIssue({
      code: duplicateCode,
      path,
      relatedIds: ambiguousIds,
      message: '同じ人物IDが複数存在するため、人物を特定できません。',
    });
  }
  if (missingIds.length > 0) {
    addIssue({ code: missingCode, path, relatedIds: missingIds, message: missingMessage });
  }
  return result;
};

const hasCompleteDate = (date) =>
  isRecord(date) && ['era', 'year', 'month', 'day'].every(key => nonBlank(date[key]));

const hasUsableFloorArea = (building) =>
  (Array.isArray(building?.floorAreas) ? building.floorAreas : []).some(area => {
    const normalized = String(area?.area ?? '')
      .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xFEE0))
      .replace(/[．，]/g, character => character === '．' ? '.' : ',')
      .replace(/,/g, '')
      .trim();
    const value = Number(normalized);
    return normalized !== '' && Number.isFinite(value) && value > 0;
  });

const getOwnCauseEntries = (owner, path) => {
  const entries = [];
  if (nonBlank(owner?.registrationCause)) {
    entries.push({
      cause: owner.registrationCause,
      date: owner.registrationDate,
      unknownDate: owner.additionalUnknownDate === true,
      path,
    });
  }
  (Array.isArray(owner?.additionalCauses) ? owner.additionalCauses : []).forEach((cause, index) => {
    if (nonBlank(cause?.cause)) {
      entries.push({
        cause: cause.cause,
        date: cause.date,
        unknownDate: cause.unknown === true,
        path: `${path}.additionalCauses.${index}`,
      });
    }
  });
  return entries;
};

const getCauseEntries = (building) => {
  const entries = getOwnCauseEntries(building, 'building');
  (Array.isArray(building?.annexes) ? building.annexes : []).forEach((annex, index) => {
    entries.push(...getOwnCauseEntries(annex, `building.annexes.${index}`));
  });
  return entries;
};

const hasSemanticAnnexContent = (annex) =>
  nonBlank(annex?.symbol) ||
  nonBlank(annex?.kind) ||
  nonBlank(annex?.struct) ||
  hasUsableFloorArea(annex) ||
  getCauseEntries(annex).length > 0;

const toHalfWidthNumberText = (value) => String(value ?? '')
  .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xFEE0))
  .replace(/／/g, '/')
  .replace(/[\s\u3000]/g, '')
  .replace(/^持分/, '');

const parseShare = (value) => {
  const normalized = toHalfWidthNumberText(value);
  if (!normalized) return null;
  if (normalized === '1' || normalized === '全部') return 1;
  const slash = normalized.match(/^(\d+)\/(\d+)$/);
  if (slash) {
    const numerator = Number(slash[1]);
    const denominator = Number(slash[2]);
    return denominator > 0 && numerator > 0 ? numerator / denominator : null;
  }
  const bunno = normalized.match(/^(\d+)分の(\d+)$/);
  if (bunno) {
    const denominator = Number(bunno[1]);
    const numerator = Number(bunno[2]);
    return denominator > 0 && numerator > 0 ? numerator / denominator : null;
  }
  return null;
};

const getPersonShare = (person, buildingId) => {
  const override = buildingId && isRecord(person?.shareOverrides)
    ? person.shareOverrides[buildingId]
    : null;
  return nonBlank(override) ? override : person?.share;
};

const validateShares = ({ people, buildingId, addIssue, path }) => {
  if (!buildingId || !Array.isArray(people) || people.length === 0) return;
  const requiresExplicitShares = people.length >= 2;
  const values = [];
  let valid = true;
  for (const person of people) {
    const raw = getPersonShare(person, buildingId);
    if (!nonBlank(raw)) {
      if (requiresExplicitShares) {
        valid = false;
        addIssue({
          code: 'SHARE_REQUIRED',
          path: `${path}.${person.id}`,
          relatedIds: [person.id],
          message: '複数名の書類には、各人の持分を入力してください。',
        });
      } else {
        values.push(1);
      }
      continue;
    }
    const parsed = parseShare(raw);
    if (parsed === null || parsed > 1) {
      valid = false;
      addIssue({
        code: 'SHARE_INVALID',
        path: `${path}.${person.id}`,
        relatedIds: [person.id],
        message: '持分は「1/2」または「2分の1」の形式で入力してください。',
      });
      continue;
    }
    values.push(parsed);
  }
  if (valid && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-10) {
    addIssue({
      code: 'SHARE_TOTAL_MISMATCH',
      path,
      relatedIds: people.map(person => person.id),
      message: '持分の合計が1になっていません。',
    });
  }
};

const snapshotPerson = (person) => person ? {
  id: person.id || '',
  address: person.address || '',
  name: person.name || '',
  nameKana: person.nameKana || '',
  representative: person.representative || '',
  share: person.share || '',
  shareOverrides: isRecord(person.shareOverrides) ? person.shareOverrides : {},
  decedentName: person.decedentName || '',
} : null;

const snapshotBuilding = (building) => building ? {
  id: building.id || '',
  address: building.address || '',
  houseNum: building.houseNum || '',
  symbol: building.symbol || '',
  kind: building.kind || '',
  struct: building.struct || '',
  floorAreas: Array.isArray(building.floorAreas) ? building.floorAreas : [],
  registrationCause: building.registrationCause || '',
  registrationDate: building.registrationDate || null,
  additionalUnknownDate: building.additionalUnknownDate === true,
  additionalCauses: Array.isArray(building.additionalCauses) ? building.additionalCauses : [],
  annexes: Array.isArray(building.annexes) ? building.annexes : [],
  ownerPersonIds: uniqueStrings(building.ownerPersonIds),
  contractorPersonIds: uniqueStrings(building.contractorPersonIds),
  confirmationCert: building.confirmationCert || null,
  confirmApplicantPersonIds: uniqueStrings(building.confirmApplicantPersonIds),
  confirmApplicantNames: Array.isArray(building.confirmApplicantNames)
    ? building.confirmApplicantNames
    : [],
} : null;

const snapshotsEqual = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const buildDefaultBlocks = (documentName, soleApplicant) => {
  if (documentName === '委任状（表題）') {
    return { 'delegation.body': DEFAULT_DELEGATION_TEXT };
  }
  if (documentName === '工事完了引渡証明書（表題）') {
    return {
      'certificate.body': '上記のとおり工事を完了して引渡したものであることを証明します。',
    };
  }
  if (documentName === '申述書（共有）') {
    return { 'statement.body': '上記の建物は下記の通りの持分であることを証明します。' };
  }
  if (documentName === '申述書（単独）') {
    const who = soleApplicant?.name || '［申請人］';
    return {
      'statement.body':
        `上記の建物は${who}が単独で全額出資したものです。\n` +
        `従って${who}の単独名義での表題登記を申請することに対し異議ありません。`,
    };
  }
  return {};
};

export const isBuildingTitleDocumentContextSupported = (applicationType, documentName) =>
  applicationType === '建物表題登記' && BUILDING_TITLE_DOCUMENT_SET.has(documentName);

/**
 * 建物表題登記の帳票データを、JSXやHTMLを含めずに解決する。
 * 現行v7互換期間はcontentOverridesを適用せず、selectionOverridesだけを扱う。
 */
export const buildDocumentContext = ({
  site = {},
  application = null,
  documentInstance = null,
  documentName = '',
  scriveners = [],
  now = null,
} = {}) => {
  const resolvedDocumentName = documentName || documentInstance?.documentName || '';
  const templateKey = documentInstance?.templateKey || getDocumentTemplateKey(resolvedDocumentName);
  const applicationType = typeof application?.type === 'string' ? application.type : '';
  const supported = BUILDING_TITLE_DOCUMENT_SET.has(resolvedDocumentName) &&
    (!application || applicationType === '建物表題登記');
  const { issues, add } = createIssueCollector();
  const editMode = typeof documentInstance?.editMode === 'string'
    ? documentInstance.editMode
    : 'linked';

  const emptyResolution = {
    version: DOCUMENT_CONTEXT_VERSION,
    supported,
    meta: {
      applicationId: typeof application?.id === 'string' ? application.id : '',
      instanceId: typeof documentInstance?.id === 'string' ? documentInstance.id : '',
      templateKey,
      documentName: resolvedDocumentName,
      copyIndex: Number(documentInstance?.copyIndex) || 1,
      resolvedAt: now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : null,
    },
    canonicalSelection: { targetBuildingId: null, applicantPersonIds: [] },
    selection: {
      targetBuildingId: null,
      applicantPersonIds: [],
      contractorPersonId: null,
      statementPersonIds: [],
      soleApplicantPersonId: null,
    },
    data: {
      building: null,
      applicants: [],
      owners: [],
      contractor: null,
      statementPeople: [],
      soleApplicant: null,
      confirmation: { certificate: null, applicants: [] },
      scrivener: null,
    },
    blocks: {},
    sourceValues: {},
    selectionOverrideSources: {},
    sourceSnapshot: null,
    layout: isRecord(documentInstance?.layoutOverrides) ? documentInstance.layoutOverrides : {},
    editMode,
    detachedHtml: typeof documentInstance?.detachedHtml === 'string'
      ? documentInstance.detachedHtml
      : null,
    issues,
    status: supported ? 'current' : 'unsupported',
    canPrint: documentInstance?.printEnabled !== false,
  };

  if (!supported) return emptyResolution;
  if (!isRecord(application)) {
    add({
      code: 'APPLICATION_NOT_FOUND',
      path: 'application',
      message: 'この書類に対応する登記申請が見つかりません。',
    });
    return {
      ...emptyResolution,
      issues,
      status: 'review-required',
      canPrint: false,
    };
  }

  const people = Array.isArray(site?.people) ? site.people : [];
  const buildings = Array.isArray(site?.proposedBuildings) ? site.proposedBuildings : [];
  const { index: peopleIndex, duplicateIds: duplicatePersonIds } = indexById(people);
  const { index: buildingIndex, duplicateIds: duplicateBuildingIds } = indexById(buildings);
  const selectionOverrides = isRecord(documentInstance?.selectionOverrides)
    ? documentInstance.selectionOverrides
    : {};
  const selectionOverrideBaselines = isRecord(documentInstance?.selectionOverrideBaselines)
    ? documentInstance.selectionOverrideBaselines
    : {};

  const legacyTargetIds = uniqueStrings(application.targetBuildingIds);
  const subjectHasAfterIds = Array.isArray(application?.subject?.afterBuildingIds);
  const subjectTargetIds = subjectHasAfterIds
    ? uniqueStrings(application.subject.afterBuildingIds)
    : legacyTargetIds;
  const primaryBuildingId = typeof application?.subject?.primaryBuildingId === 'string'
    ? application.subject.primaryBuildingId
    : '';

  if (subjectHasAfterIds && !sameStringList(subjectTargetIds, legacyTargetIds)) {
    add({
      code: 'SUBJECT_LEGACY_MISMATCH',
      path: 'application.subject.afterBuildingIds',
      relatedIds: [...subjectTargetIds, ...legacyTargetIds],
      message: 'Step1の対象建物と内部の申請対象が一致していません。',
    });
  }

  let canonicalTargetBuildingId = null;
  if (primaryBuildingId && subjectTargetIds.includes(primaryBuildingId)) {
    canonicalTargetBuildingId = primaryBuildingId;
  } else if (subjectTargetIds.length === 1) {
    canonicalTargetBuildingId = subjectTargetIds[0];
  }

  const hasBuildingOverride = hasOwn(selectionOverrides, 'targetPropBuildingId');
  const overrideBuildingId = typeof selectionOverrides.targetPropBuildingId === 'string'
    ? selectionOverrides.targetPropBuildingId
    : '';
  let targetBuildingId = hasBuildingOverride ? overrideBuildingId : canonicalTargetBuildingId;
  let building = null;

  if (subjectTargetIds.length === 0) {
    add({
      code: 'TARGET_BUILDING_REQUIRED',
      path: 'application.subject.afterBuildingIds',
      message: 'Step1で対象建物を選択してください。',
    });
  } else if (subjectTargetIds.length > 1 && !canonicalTargetBuildingId) {
    add({
      code: 'TARGET_BUILDING_AMBIGUOUS',
      path: 'application.subject.primaryBuildingId',
      relatedIds: subjectTargetIds,
      message: '対象建物が複数あるため、主たる建物を特定できません。',
    });
  }

  if (hasBuildingOverride && !targetBuildingId) {
    add({
      code: 'TARGET_BUILDING_REQUIRED',
      scope: 'override',
      path: 'document.selectionOverrides.targetPropBuildingId',
      message: 'この書類の対象建物を選択してください。',
    });
  } else if (targetBuildingId && duplicateBuildingIds.has(targetBuildingId)) {
    add({
      code: 'TARGET_BUILDING_DUPLICATE_ID',
      path: 'site.proposedBuildings',
      relatedIds: [targetBuildingId],
      message: '同じ建物IDが複数存在するため、対象建物を特定できません。',
    });
  } else if (targetBuildingId) {
    building = buildingIndex.get(targetBuildingId) || null;
    if (!building) {
      add({
        code: 'TARGET_BUILDING_NOT_FOUND',
        scope: hasBuildingOverride ? 'override' : 'source',
        path: hasBuildingOverride
          ? 'document.selectionOverrides.targetPropBuildingId'
          : 'application.subject.afterBuildingIds',
        relatedIds: [targetBuildingId],
        message: '選択された対象建物が案件内に見つかりません。',
      });
    }
  }

  if (hasBuildingOverride && canonicalTargetBuildingId) {
    if (duplicateBuildingIds.has(canonicalTargetBuildingId)) {
      add({
        code: 'APPLICATION_TARGET_BUILDING_DUPLICATE_ID',
        path: 'site.proposedBuildings',
        relatedIds: [canonicalTargetBuildingId],
        message: 'Step1の対象建物IDが重複しているため、正本を特定できません。',
      });
    } else if (!buildingIndex.has(canonicalTargetBuildingId)) {
      add({
        code: 'APPLICATION_TARGET_BUILDING_NOT_FOUND',
        path: 'application.subject.afterBuildingIds',
        relatedIds: [canonicalTargetBuildingId],
        message: 'Step1の対象建物が案件内に見つかりません。',
      });
    }
  }

  if (building) {
    if (!nonBlank(building.address)) {
      add({ code: 'BUILDING_ADDRESS_REQUIRED', path: 'building.address', message: '対象建物の所在が未入力です。' });
    }
    if (!nonBlank(building.kind)) {
      add({ code: 'BUILDING_KIND_REQUIRED', path: 'building.kind', message: '対象建物の種類が未入力です。' });
    }
    if (!nonBlank(building.struct)) {
      add({ code: 'BUILDING_STRUCTURE_REQUIRED', path: 'building.struct', message: '対象建物の構造が未入力です。' });
    }
    if (!hasUsableFloorArea(building)) {
      add({ code: 'BUILDING_FLOOR_AREA_REQUIRED', path: 'building.floorAreas', message: '対象建物に正の床面積を入力してください。' });
    }
    const annexes = (Array.isArray(building.annexes) ? building.annexes : [])
      .map((annex, index) => ({ annex, index }))
      .filter(({ annex }) => hasSemanticAnnexContent(annex));
    const usedAnnexSymbols = new Set();
    annexes.forEach(({ annex, index }) => {
      const annexPath = `building.annexes.${index}`;
      const symbol = String(annex?.symbol ?? '').trim();
      if (!symbol) {
        add({ code: 'ANNEX_SYMBOL_REQUIRED', path: `${annexPath}.symbol`, message: '附属建物の符号が未入力です。' });
      } else if (usedAnnexSymbols.has(symbol)) {
        add({ code: 'ANNEX_SYMBOL_DUPLICATE', path: `${annexPath}.symbol`, message: '附属建物の符号が重複しています。' });
      } else {
        usedAnnexSymbols.add(symbol);
      }
      if (!nonBlank(annex?.kind)) {
        add({ code: 'ANNEX_KIND_REQUIRED', path: `${annexPath}.kind`, message: '附属建物の種類が未入力です。' });
      }
      if (!nonBlank(annex?.struct)) {
        add({ code: 'ANNEX_STRUCTURE_REQUIRED', path: `${annexPath}.struct`, message: '附属建物の構造が未入力です。' });
      }
      if (!hasUsableFloorArea(annex)) {
        add({ code: 'ANNEX_FLOOR_AREA_REQUIRED', path: `${annexPath}.floorAreas`, message: '附属建物に正の床面積を入力してください。' });
      }
      if (!STATEMENT_DOCUMENTS.has(resolvedDocumentName)) {
        const annexCauses = getOwnCauseEntries(annex, annexPath);
        if (annexCauses.length === 0) {
          add({ code: 'ANNEX_REGISTRATION_CAUSE_REQUIRED', path: `${annexPath}.registrationCause`, message: '附属建物の登記原因を入力してください。' });
        } else {
          const incomplete = annexCauses.find(entry => !entry.unknownDate && !hasCompleteDate(entry.date));
          if (incomplete) {
            add({
              code: 'ANNEX_REGISTRATION_CAUSE_DATE_REQUIRED',
              path: incomplete.path,
              message: '附属建物の登記原因の日付を年月日まで入力してください。',
            });
          }
        }
      }
    });
    if (!STATEMENT_DOCUMENTS.has(resolvedDocumentName)) {
      const causes = getOwnCauseEntries(building, 'building');
      if (causes.length === 0) {
        add({ code: 'REGISTRATION_CAUSE_REQUIRED', path: 'building.registrationCause', message: '登記原因を入力してください。' });
      } else {
        const incomplete = causes.filter(entry => !entry.unknownDate && !hasCompleteDate(entry.date));
        if (incomplete.length > 0) {
          add({
            code: 'REGISTRATION_CAUSE_DATE_REQUIRED',
            path: incomplete[0].path,
            message: '登記原因の日付を年月日まで入力してください。',
          });
        }
      }
    }
  }

  const canonicalApplicantIds = uniqueStrings(application.applicantPersonIds);
  const hasApplicantOverride = hasOwn(selectionOverrides, 'applicantPersonIds');
  const applicantIds = hasApplicantOverride
    ? uniqueStrings(selectionOverrides.applicantPersonIds)
    : canonicalApplicantIds;
  if (hasApplicantOverride && canonicalApplicantIds.length === 0) {
    add({
      code: 'APPLICATION_APPLICANT_REQUIRED',
      path: 'application.applicantPersonIds',
      message: 'Step1で申請人を1名以上選択してください。',
    });
  } else if (hasApplicantOverride) {
    const missingCanonicalApplicantIds = canonicalApplicantIds.filter(id =>
      !duplicatePersonIds.has(id) && !peopleIndex.has(id)
    );
    const duplicateCanonicalApplicantIds = canonicalApplicantIds.filter(id => duplicatePersonIds.has(id));
    if (duplicateCanonicalApplicantIds.length > 0) {
      add({
        code: 'APPLICATION_APPLICANT_DUPLICATE_ID',
        path: 'application.applicantPersonIds',
        relatedIds: duplicateCanonicalApplicantIds,
        message: 'Step1の申請人IDが重複しているため、正本を特定できません。',
      });
    }
    if (missingCanonicalApplicantIds.length > 0) {
      add({
        code: 'APPLICATION_APPLICANT_NOT_FOUND',
        path: 'application.applicantPersonIds',
        relatedIds: missingCanonicalApplicantIds,
        message: 'Step1の申請人が案件内に見つかりません。',
      });
    }
  }
  const applicants = resolvePeople({
    ids: applicantIds,
    peopleIndex,
    duplicatePersonIds,
    addIssue: add,
    requiredCode: 'APPLICANT_REQUIRED',
    missingCode: 'APPLICANT_NOT_FOUND',
    duplicateCode: 'APPLICANT_DUPLICATE_ID',
    path: hasApplicantOverride
      ? 'document.selectionOverrides.applicantPersonIds'
      : 'application.applicantPersonIds',
    requiredMessage: 'Step1で申請人を1名以上選択してください。',
    missingMessage: '選択された申請人が案件内に見つかりません。',
  });
  applicants.forEach(person => {
    if (!nonBlank(person.name)) {
      add({ code: 'PERSON_NAME_REQUIRED', path: `people.${person.id}.name`, relatedIds: [person.id], message: '申請人の氏名が未入力です。' });
    }
    if (!nonBlank(person.address)) {
      add({ code: 'PERSON_ADDRESS_REQUIRED', path: `people.${person.id}.address`, relatedIds: [person.id], message: '申請人の住所が未入力です。' });
    }
  });

  if (resolvedDocumentName === '委任状（表題）') {
    validateShares({
      people: applicants,
      buildingId: building?.id,
      addIssue: add,
      path: 'application.applicantPersonIds.share',
    });
  }

  let owners = [];
  let contractor = null;
  let contractorPersonId = null;
  let linkedContractorIds = [];
  if (resolvedDocumentName === '工事完了引渡証明書（表題）') {
    const ownerIds = uniqueStrings(building?.ownerPersonIds);
    owners = resolvePeople({
      ids: ownerIds,
      peopleIndex,
      duplicatePersonIds,
      addIssue: add,
      requiredCode: 'OWNER_REQUIRED',
      missingCode: 'OWNER_NOT_FOUND',
      duplicateCode: 'OWNER_DUPLICATE_ID',
      path: 'building.ownerPersonIds',
      requiredMessage: '対象建物の所有者を1名以上設定してください。',
      missingMessage: '対象建物に設定された所有者が案件内に見つかりません。',
    });
    owners.forEach(owner => {
      if (!nonBlank(owner.name)) {
        add({ code: 'OWNER_NAME_REQUIRED', path: `people.${owner.id}.name`, relatedIds: [owner.id], message: '所有者の氏名・名称が未入力です。' });
      }
      if (!nonBlank(owner.address)) {
        add({ code: 'OWNER_ADDRESS_REQUIRED', path: `people.${owner.id}.address`, relatedIds: [owner.id], message: '所有者の住所・所在地が未入力です。' });
      }
    });
    validateShares({
      people: owners,
      buildingId: building?.id,
      addIssue: add,
      path: 'building.ownerPersonIds.share',
    });
    if (owners.length > 0 && applicants.length > 0 &&
        !sameStringSet(owners.map(owner => owner.id), applicants.map(applicant => applicant.id))) {
      add({
        code: 'OWNER_APPLICANT_MISMATCH',
        severity: 'warning',
        path: 'building.ownerPersonIds',
        relatedIds: [...owners.map(owner => owner.id), ...applicants.map(applicant => applicant.id)],
        message: '建物所有者と登記申請人が一致していません。内容を確認してください。',
      });
    }

    const hasContractorOverride = hasOwn(selectionOverrides, 'targetContractorPersonId');
    const contractorOverrideId = typeof selectionOverrides.targetContractorPersonId === 'string'
      ? selectionOverrides.targetContractorPersonId
      : '';
    linkedContractorIds = uniqueStrings(building?.contractorPersonIds);

    if (hasContractorOverride && contractorOverrideId) {
      contractorPersonId = contractorOverrideId;
    } else if (linkedContractorIds.length === 1) {
      contractorPersonId = linkedContractorIds[0];
    } else if (linkedContractorIds.length > 1) {
      add({
        code: 'CONTRACTOR_AMBIGUOUS',
        path: 'building.contractorPersonIds',
        relatedIds: linkedContractorIds,
        message: '対象建物に工事人が複数紐づいています。この書類で使用する工事人を選択してください。',
      });
    } else {
      const legacyContractors = people.filter(person => (person?.roles || []).includes('工事人'));
      if (legacyContractors.length === 1) {
        contractorPersonId = legacyContractors[0].id;
        add({
          code: 'LEGACY_CONTRACTOR_FALLBACK',
          severity: 'warning',
          path: 'site.people',
          relatedIds: [legacyContractors[0].id],
          message: '建物との紐付けがないため、案件内で唯一の工事人を暫定使用しています。',
        });
      } else if (legacyContractors.length > 1) {
        add({
          code: 'CONTRACTOR_AMBIGUOUS',
          path: 'building.contractorPersonIds',
          relatedIds: legacyContractors.map(person => person.id),
          message: '工事人を自動特定できません。この書類で使用する工事人を選択してください。',
        });
      } else {
        add({
          code: 'CONTRACTOR_REQUIRED',
          path: 'building.contractorPersonIds',
          message: '対象建物の工事人を設定してください。',
        });
      }
    }

    if (contractorPersonId) {
      if (duplicatePersonIds.has(contractorPersonId)) {
        add({
          code: 'CONTRACTOR_DUPLICATE_ID',
          path: 'site.people',
          relatedIds: [contractorPersonId],
          message: '同じ人物IDが複数存在するため、工事人を特定できません。',
        });
      } else {
        contractor = peopleIndex.get(contractorPersonId) || null;
        if (!contractor) {
          add({
            code: 'CONTRACTOR_NOT_FOUND',
            path: hasOwn(selectionOverrides, 'targetContractorPersonId')
              ? 'document.selectionOverrides.targetContractorPersonId'
              : 'building.contractorPersonIds',
            relatedIds: [contractorPersonId],
            message: '選択された工事人が案件内に見つかりません。',
          });
        }
      }
    }
    if (contractor) {
      if (!nonBlank(contractor.name)) {
        add({ code: 'CONTRACTOR_NAME_REQUIRED', path: `people.${contractor.id}.name`, relatedIds: [contractor.id], message: '工事人の氏名・名称が未入力です。' });
      }
      if (!nonBlank(contractor.address)) {
        add({ code: 'CONTRACTOR_ADDRESS_REQUIRED', path: `people.${contractor.id}.address`, relatedIds: [contractor.id], message: '工事人の住所・所在地が未入力です。' });
      }
    }
  }

  let statementPeople = [];
  let statementPersonIds = [];
  let soleApplicant = null;
  let soleApplicantPersonId = null;
  const confirmationApplicants = [];
  if (STATEMENT_DOCUMENTS.has(resolvedDocumentName)) {
    const hasStatementPeopleOverride = hasOwn(selectionOverrides, 'statementPersonIds');
    statementPersonIds = hasStatementPeopleOverride
      ? uniqueStrings(selectionOverrides.statementPersonIds)
      : applicantIds;
    statementPeople = resolvePeople({
      ids: statementPersonIds,
      peopleIndex,
      duplicatePersonIds,
      addIssue: add,
      requiredCode: 'STATEMENT_SIGNER_REQUIRED',
      missingCode: 'STATEMENT_SIGNER_NOT_FOUND',
      duplicateCode: 'STATEMENT_SIGNER_DUPLICATE_ID',
      path: hasStatementPeopleOverride
        ? 'document.selectionOverrides.statementPersonIds'
        : 'application.applicantPersonIds',
      requiredMessage: '申述人を1名以上選択してください。',
      missingMessage: '選択された申述人が案件内に見つかりません。',
    });
    statementPeople.forEach(person => {
      if (!nonBlank(person.name)) {
        add({
          code: 'STATEMENT_SIGNER_NAME_REQUIRED',
          path: `people.${person.id}.name`,
          relatedIds: [person.id],
          message: '申述人の氏名・名称が未入力です。',
        });
      }
      if (!nonBlank(person.address)) {
        add({
          code: 'STATEMENT_SIGNER_ADDRESS_REQUIRED',
          path: `people.${person.id}.address`,
          relatedIds: [person.id],
          message: '申述人の住所・所在地が未入力です。',
        });
      }
    });
    validateShares({
      people: statementPeople,
      buildingId: building?.id,
      addIssue: add,
      path: 'document.statementPersonIds.share',
    });

    const confirmationCert = building?.confirmationCert || null;
    if (!confirmationCert) {
      add({
        code: 'CONFIRMATION_CERT_REQUIRED',
        path: 'building.confirmationCert',
        message: '対象建物の確認済証情報を入力してください。',
      });
    } else if (!nonBlank(confirmationCert.number) || !hasCompleteDate(confirmationCert.date)) {
      add({
        code: 'CONFIRMATION_CERT_INCOMPLETE',
        path: 'building.confirmationCert',
        message: '確認済証の番号と年月日を入力してください。',
      });
    }

    const confirmPersonIds = uniqueStrings(building?.confirmApplicantPersonIds);
    const missingConfirmIds = [];
    for (const id of confirmPersonIds) {
      if (duplicatePersonIds.has(id)) {
        add({
          code: 'CONFIRMATION_APPLICANT_DUPLICATE_ID',
          path: 'building.confirmApplicantPersonIds',
          relatedIds: [id],
          message: '同じ人物IDが複数存在するため、建築主を特定できません。',
        });
        continue;
      }
      const person = peopleIndex.get(id);
      if (person) {
        confirmationApplicants.push({ key: `person:${id}`, name: person.name || '', person });
        if (!nonBlank(person.name)) {
          add({
            code: 'CONFIRMATION_APPLICANT_NAME_REQUIRED',
            path: `people.${id}.name`,
            relatedIds: [id],
            message: '確認済証記載の建築主の氏名・名称が未入力です。',
          });
        }
      } else missingConfirmIds.push(id);
    }
    if (missingConfirmIds.length > 0) {
      add({
        code: 'CONFIRMATION_APPLICANT_NOT_FOUND',
        path: 'building.confirmApplicantPersonIds',
        relatedIds: missingConfirmIds,
        message: '確認済証に設定された建築主が案件内に見つかりません。',
      });
    }
    (Array.isArray(building?.confirmApplicantNames) ? building.confirmApplicantNames : [])
      .filter(name => typeof name === 'string' && nonBlank(name))
      .forEach((name, index) => {
        confirmationApplicants.push({ key: `manual:${index}`, name: String(name).trim(), person: null });
      });
    if (confirmationApplicants.length === 0) {
      add({
        code: 'CONFIRMATION_APPLICANT_REQUIRED',
        path: 'building.confirmApplicantPersonIds',
        message: '確認済証記載の建築主を1名以上設定してください。',
      });
    }

    if (resolvedDocumentName === '申述書（共有）' && applicants.length < 2) {
      add({
        code: 'SHARED_STATEMENT_REQUIRES_MULTIPLE_APPLICANTS',
        path: 'application.applicantPersonIds',
        message: '共有の申述書には申請人を2名以上設定してください。',
      });
    }

    if (resolvedDocumentName === '申述書（単独）') {
      const hasSoleOverride = hasOwn(selectionOverrides, 'statementApplicantPersonId');
      const soleOverrideId = typeof selectionOverrides.statementApplicantPersonId === 'string'
        ? selectionOverrides.statementApplicantPersonId
        : '';
      soleApplicantPersonId = hasSoleOverride
        ? soleOverrideId
        : (applicantIds.length === 1 ? applicantIds[0] : null);
      if (!soleApplicantPersonId) {
        add({
          code: 'SOLE_APPLICANT_REQUIRED',
          path: hasSoleOverride
            ? 'document.selectionOverrides.statementApplicantPersonId'
            : 'application.applicantPersonIds',
          message: '単独出資者を特定できません。申請人を選択してください。',
        });
      } else if (!applicantIds.includes(soleApplicantPersonId)) {
        add({
          code: 'SOLE_APPLICANT_NOT_APPLICANT',
          path: 'document.selectionOverrides.statementApplicantPersonId',
          relatedIds: [soleApplicantPersonId],
          message: '単独出資者は、この登記申請の申請人から選択してください。',
        });
      } else if (duplicatePersonIds.has(soleApplicantPersonId)) {
        add({
          code: 'SOLE_APPLICANT_DUPLICATE_ID',
          path: 'site.people',
          relatedIds: [soleApplicantPersonId],
          message: '同じ人物IDが複数存在するため、単独出資者を特定できません。',
        });
      } else {
        soleApplicant = peopleIndex.get(soleApplicantPersonId) || null;
        if (!soleApplicant) {
          add({
            code: 'SOLE_APPLICANT_NOT_FOUND',
            path: 'document.selectionOverrides.statementApplicantPersonId',
            relatedIds: [soleApplicantPersonId],
            message: '選択された単独出資者が案件内に見つかりません。',
          });
        }
      }
    }
  }

  const scrivener = (Array.isArray(scriveners) ? scriveners : [])
    .find(item => item?.id === site?.scrivenerId) || null;
  const defaultBlocks = buildDefaultBlocks(resolvedDocumentName, soleApplicant);
  const hasSelectionOverrides = Object.keys(selectionOverrides).length > 0;
  const hasLayoutOverrides = isRecord(documentInstance?.layoutOverrides) &&
    Object.keys(documentInstance.layoutOverrides).length > 0;
  const hasContentOverrides = isRecord(documentInstance?.contentOverrides) && (
    Object.keys(documentInstance.contentOverrides?.blocks || {}).length > 0 ||
    Object.keys(documentInstance.contentOverrides?.fields || {}).length > 0
  );
  const selectionOverrideSources = {
    targetPropBuildingId: {
      afterBuildingIds: [...subjectTargetIds],
      primaryBuildingId: primaryBuildingId || null,
      resolvedTargetBuildingId: canonicalTargetBuildingId,
    },
    applicantPersonIds: [...canonicalApplicantIds],
  };
  if (resolvedDocumentName === '工事完了引渡証明書（表題）') {
    selectionOverrideSources.targetContractorPersonId = {
      targetBuildingId: targetBuildingId || null,
      contractorPersonIds: [...linkedContractorIds],
    };
  }
  if (STATEMENT_DOCUMENTS.has(resolvedDocumentName)) {
    selectionOverrideSources.statementPersonIds = [...applicantIds];
    selectionOverrideSources.statementApplicantPersonId = [...applicantIds];
  }
  const sourceSnapshot = {
    version: DOCUMENT_CONTEXT_VERSION,
    documentYear: now instanceof Date && !Number.isNaN(now.getTime())
      ? now.getFullYear()
      : null,
    canonicalSelection: {
      targetBuildingId: canonicalTargetBuildingId,
      applicantPersonIds: canonicalApplicantIds,
    },
    selection: {
      targetBuildingId: targetBuildingId || null,
      applicantPersonIds: applicantIds,
      contractorPersonId: contractorPersonId || null,
      statementPersonIds,
      soleApplicantPersonId: soleApplicantPersonId || null,
    },
    data: {
      building: snapshotBuilding(building),
      applicants: applicants.map(snapshotPerson),
      owners: owners.map(snapshotPerson),
      contractor: snapshotPerson(contractor),
      statementPeople: statementPeople.map(snapshotPerson),
      soleApplicant: snapshotPerson(soleApplicant),
      confirmationApplicants: confirmationApplicants.map(item => ({
        key: item.key,
        name: item.name || '',
        personId: item.person?.id || null,
      })),
    },
    blocks: defaultBlocks,
  };
  const overrideLabels = {
    targetPropBuildingId: '対象建物',
    applicantPersonIds: '申請人',
    targetContractorPersonId: '工事人',
    statementPersonIds: '申述人',
    statementApplicantPersonId: '単独出資者',
  };
  Object.keys(selectionOverrides).forEach(key => {
    if (!hasOwn(selectionOverrideSources, key)) return;
    const label = overrideLabels[key] || '個別設定';
    if (!hasOwn(selectionOverrideBaselines, key)) {
      add({
        code: 'SELECTION_OVERRIDE_BASELINE_UNKNOWN',
        scope: 'selection-override',
        path: `document.selectionOverrides.${key}`,
        message: `${label}の個別設定について、設定時のStep1情報を確認できません。`,
      });
    } else if (!snapshotsEqual(selectionOverrideBaselines[key], selectionOverrideSources[key])) {
      add({
        code: 'SELECTION_OVERRIDE_SOURCE_CHANGED',
        scope: 'selection-override',
        path: `document.selectionOverrides.${key}`,
        message: `${label}を個別設定した後に、元のStep1情報が変更されています。`,
      });
    }
  });
  const isDetached = editMode === 'detached' || editMode === 'legacy-detached';
  if (hasContentOverrides) {
    add({
      code: 'CONTENT_OVERRIDES_NOT_APPLIED',
      scope: 'override',
      path: 'document.contentOverrides',
      message: 'この個別文言は現行v7保存では安全に保持できないため、まだ適用できません。',
    });
  }
  if (editMode === 'legacy-detached') {
    add({
      code: 'LEGACY_DETACHED_BASELINE_UNKNOWN',
      scope: 'detached',
      path: 'document.detachedHtml',
      message: '旧形式の全文編集です。最新データとの一致を自動確認できません。',
    });
  } else if (editMode === 'detached') {
    const baseline = isRecord(documentInstance?.detachedSourceSnapshot)
      ? documentInstance.detachedSourceSnapshot
      : null;
    if (!baseline) {
      add({
        code: 'DETACHED_BASELINE_UNKNOWN',
        scope: 'detached',
        path: 'document.detachedSourceSnapshot',
        message: '全文固定時点の元データがないため、最新データとの一致を自動確認できません。',
      });
    } else if (!snapshotsEqual(baseline, sourceSnapshot)) {
      add({
        code: 'DETACHED_SOURCE_CHANGED',
        scope: 'detached',
        path: 'document.detachedSourceSnapshot',
        message: '全文固定後に案件データが変更されています。',
      });
    }
  }

  const hasBlockingIssue = issues.some(issue => issue.severity === 'blocking');
  const hasWarning = issues.some(issue => issue.severity === 'warning');
  const status = hasBlockingIssue
    ? 'review-required'
    : hasWarning
      ? 'warning'
      : isDetached
        ? 'detached'
        : (hasSelectionOverrides || hasLayoutOverrides || hasContentOverrides)
          ? 'modified'
          : 'current';

  return {
    ...emptyResolution,
    canonicalSelection: {
      targetBuildingId: canonicalTargetBuildingId,
      applicantPersonIds: canonicalApplicantIds,
    },
    selection: {
      targetBuildingId: targetBuildingId || null,
      applicantPersonIds: applicantIds,
      contractorPersonId: contractorPersonId || null,
      statementPersonIds,
      soleApplicantPersonId: soleApplicantPersonId || null,
    },
    data: {
      building,
      applicants,
      owners,
      contractor,
      statementPeople,
      soleApplicant,
      confirmation: {
        certificate: building?.confirmationCert || null,
        applicants: confirmationApplicants,
      },
      scrivener,
    },
    blocks: defaultBlocks,
    sourceValues: {
      'application.subject.afterBuildingIds': subjectTargetIds,
      'application.targetBuildingIds': legacyTargetIds,
      'application.applicantPersonIds': canonicalApplicantIds,
    },
    selectionOverrideSources,
    sourceSnapshot,
    issues,
    status,
    canPrint: documentInstance?.printEnabled !== false && !hasBlockingIssue,
  };
};

export const buildDocumentContextsForInstances = ({
  site = {},
  instances = [],
  scriveners = [],
  now = null,
} = {}) => {
  const applications = Array.isArray(site?.registrationApplications)
    ? site.registrationApplications
    : [];
  const contexts = {};

  for (const instance of Array.isArray(instances) ? instances : []) {
    if (!instance?.raId || !instance?.identity) continue;
    const application = applications.find(item => item?.id === instance.raId);
    if (!application) continue;
    const templateKey = getDocumentTemplateKey(instance.name);
    const shadowInstance = (Array.isArray(application.documentInstances)
      ? application.documentInstances
      : []).find(item =>
        item?.active !== false &&
        item?.templateKey === templateKey &&
        item?.documentName === instance.name &&
        Number(item?.copyIndex) === Number(instance.copyIndex)
      );
    const legacyPick = isRecord(site?.docPick?.[instance.key])
      ? site.docPick[instance.key]
      : {};
    const hasLegacyDetachedHtml = nonBlank(legacyPick.customText);
    const documentInstance = shadowInstance || {
      id: instance.documentInstanceId || '',
      templateKey,
      documentName: instance.name,
      copyIndex: instance.copyIndex,
      printEnabled: legacyPick.printOn !== false,
      selectionOverrides: {},
      contentOverrides: { blocks: {}, fields: {} },
      layoutOverrides: {},
      editMode: hasLegacyDetachedHtml ? 'legacy-detached' : 'linked',
      detachedHtml: hasLegacyDetachedHtml ? legacyPick.customText : null,
      detachedSourceSnapshot: null,
    };
    const context = buildDocumentContext({
      site,
      application,
      documentInstance,
      documentName: instance.name,
      scriveners,
      now,
    });
    if (context.supported) contexts[instance.identity] = context;
  }

  return contexts;
};

export const getDocumentContextPrintBlockers = ({
  instances = [],
  contextsByIdentity = {},
  docPick = {},
} = {}) => (Array.isArray(instances) ? instances : []).filter(instance => {
  if ((docPick?.[instance?.key]?.printOn ?? true) === false) return false;
  const context = contextsByIdentity?.[instance?.identity];
  return context?.supported === true && context.canPrint === false;
});
