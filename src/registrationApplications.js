import { APPLICATION_TYPES, APPLICATION_TO_DOCS } from './constants.js';
import { generateId, stableSortKeys } from './utils.js';
import {
  countDocumentsFromInstances,
  createApplicationSubjectFromLegacy,
  createStableDocumentInstanceId,
  getDocumentNameFromTemplateKey,
  getDocumentTemplateKey,
  normalizeApplicationSubject,
  normalizeCompatibilityRecord,
  normalizeDocumentCount,
  normalizeDocumentInstance,
  normalizeLegacyDocumentCounts,
  synchronizeSubjectFromLegacyPatch,
} from './v8Compatibility.js';

export const LAND_APPLICATION_TYPES = ["土地地目変更登記"];

export const isLandApplicationType = (type) => LAND_APPLICATION_TYPES.includes(type);

export const createRegistrationApplication = (type, id = generateId()) => {
  const application = {
    id,
    type,
    targetBuildingIds: [],
    targetLandIds: [],
    applicantPersonIds: [],
    documents: {},
  };

  return {
    ...application,
    // v8互換shadow。外部JSONのschemaVersionを8へ上げるまではlegacy項目が正本。
    subject: createApplicationSubjectFromLegacy(type),
    details: {},
    documentInstances: [],
  };
};

const stringList = (value) =>
  Array.isArray(value) ? value.filter(v => typeof v === "string") : [];

/** 共通Coreとして受理する登記申請の形へ整える（未知フィールドは保持しない）。 */
export const normalizeRegistrationApplication = (ra = {}) => {
  const raw = ra && typeof ra === "object" && !Array.isArray(ra) ? ra : {};
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId();
  const rawInstances = Array.isArray(raw.documentInstances) ? raw.documentInstances : [];
  const reservedInstanceIds = new Set(
    rawInstances
      .map(instance => instance?.id)
      .filter(instanceId => typeof instanceId === "string" && instanceId)
  );
  const usedCopyIndexes = new Map();
  const usedInstanceIds = new Set();
  let documentInstances = rawInstances.map(instance => {
    const safeInstance = instance && typeof instance === "object" && !Array.isArray(instance)
      ? instance
      : {};
    const documentName = getDocumentNameFromTemplateKey(safeInstance.templateKey) ||
      (typeof safeInstance.documentName === "string" ? safeInstance.documentName : "");
    const templateKey = typeof safeInstance.templateKey === "string" && safeInstance.templateKey
      ? safeInstance.templateKey
      : getDocumentTemplateKey(documentName);
    const usedForTemplate = usedCopyIndexes.get(templateKey) || new Set();
    const requestedIndex = Number(safeInstance.copyIndex);
    let copyIndex = Number.isInteger(requestedIndex) && requestedIndex > 0 &&
      !usedForTemplate.has(requestedIndex)
      ? requestedIndex
      : 1;
    while (usedForTemplate.has(copyIndex)) copyIndex += 1;
    usedForTemplate.add(copyIndex);
    usedCopyIndexes.set(templateKey, usedForTemplate);

    let normalized = normalizeDocumentInstance({ ...safeInstance, copyIndex }, {
      applicationId: id,
      documentName,
      copyIndex,
    });
    if (usedInstanceIds.has(normalized.id)) {
      const baseId = createStableDocumentInstanceId(id, templateKey, copyIndex);
      let candidate = baseId;
      let suffix = 2;
      while (usedInstanceIds.has(candidate) || reservedInstanceIds.has(candidate)) {
        candidate = `${baseId}~${suffix++}`;
      }
      normalized = { ...normalized, id: candidate };
    }
    usedInstanceIds.add(normalized.id);
    return normalized;
  });
  const hasLegacyDocuments = raw.documents &&
    typeof raw.documents === "object" &&
    !Array.isArray(raw.documents);
  if (!hasLegacyDocuments) {
    const activeTotals = new Map();
    documentInstances.forEach(instance => {
      if (instance.active === false) return;
      activeTotals.set(instance.templateKey, (activeTotals.get(instance.templateKey) || 0) + 1);
    });
    const activeCounts = new Map();
    const inactiveCounts = new Map();
    documentInstances = documentInstances.map(instance => {
      let copyIndex;
      if (instance.active === false) {
        const inactiveIndex = (inactiveCounts.get(instance.templateKey) || 0) + 1;
        inactiveCounts.set(instance.templateKey, inactiveIndex);
        copyIndex = (activeTotals.get(instance.templateKey) || 0) + inactiveIndex;
      } else {
        copyIndex = (activeCounts.get(instance.templateKey) || 0) + 1;
        activeCounts.set(instance.templateKey, copyIndex);
      }
      return { ...instance, copyIndex };
    });
  }
  const documents = hasLegacyDocuments
    ? normalizeLegacyDocumentCounts(raw.documents)
    : countDocumentsFromInstances(documentInstances);
  const application = {
    id,
    type: typeof raw.type === "string" ? raw.type : "",
    targetBuildingIds: stringList(raw.targetBuildingIds),
    // 登記申請そのものの対象土地。docPick.targetLandIds（書類へ印字する土地の
    // 選択）とは別概念であり、相互に流用しない。
    targetLandIds: stringList(raw.targetLandIds),
    applicantPersonIds: stringList(raw.applicantPersonIds),
    documents: stableSortKeys(documents),
  };

  return {
    ...application,
    subject: raw.subject && typeof raw.subject === "object" && !Array.isArray(raw.subject)
      ? normalizeApplicationSubject({ ...application, subject: raw.subject })
      : createApplicationSubjectFromLegacy(
          application.type,
          application.targetBuildingIds,
          application.targetLandIds
        ),
    details: normalizeCompatibilityRecord(raw.details),
    documentInstances,
  };
};

/** legacy対象項目を更新するとき、v8 subject shadowも同じ操作内で更新する。 */
export const applyRegistrationApplicationPatch = (application, patch = {}) =>
  synchronizeSubjectFromLegacyPatch(application, patch);

/**
 * schemaVersion 6 では土地系申請の land.id が targetBuildingIds に入っていた。
 * 「土地系の種別」「targetLandIds が空」「targetBuildingIds が全て land[] に実在」
 * を満たす場合だけ targetLandIds へ移し、判定できない場合は元の値を触らない。
 */
export const migrateLegacyLandTargets = (regApps, landIds) => {
  const known = landIds instanceof Set ? landIds : new Set(landIds || []);
  return (Array.isArray(regApps) ? regApps : []).map(ra => {
    if (!ra || typeof ra !== "object" || Array.isArray(ra)) return ra;
    if (!isLandApplicationType(ra.type)) return ra;
    const existingLandIds = stringList(ra.targetLandIds);
    if (existingLandIds.length > 0) return ra;
    const ids = stringList(ra.targetBuildingIds);
    if (ids.length === 0 || !ids.every(id => known.has(id))) return ra;
    return { ...ra, targetLandIds: [...ids], targetBuildingIds: [] };
  });
};

/**
 * applications{} の件数へ registrationApplications[] を追随させる。
 * 件数が変わっていない種別の既存オブジェクトは作り直さず、対象IDや申請人を保持する。
 * 増加分は末尾へ追加し、減少分は同種別の末尾から取り除く。
 */
export const syncRegistrationApplications = (
  applications = {},
  registrationApplications = [],
  applicationTypes = APPLICATION_TYPES
) => {
  let changed = false;
  let next = [...registrationApplications];

  for (const type of applicationTypes) {
    const desired = Number(applications[type] || 0);
    const current = next.filter(ra => ra.type === type);
    if (current.length < desired) {
      for (let i = current.length; i < desired; i++) {
        next.push(createRegistrationApplication(type));
        changed = true;
      }
    } else if (current.length > desired) {
      let toRemove = current.length - desired;
      next = [...next].reverse().filter(ra => {
        if (ra.type === type && toRemove > 0) { toRemove--; return false; }
        return true;
      }).reverse();
      changed = true;
    }
  }

  const validTypes = new Set(applicationTypes);
  const filtered = next.filter(ra => validTypes.has(ra.type));
  if (filtered.length !== next.length) { next = filtered; changed = true; }

  return { next, changed };
};

export const ensureRequiredRegistrationDocuments = (
  registrationApplications = [],
  definitions = APPLICATION_TO_DOCS
) => {
  let changed = false;
  const next = (Array.isArray(registrationApplications) ? registrationApplications : [])
    .map(application => {
      const definition = application && Object.prototype.hasOwnProperty.call(definitions, application.type)
        ? definitions[application.type]
        : null;
      if (!definition?.required?.length) return application;
      const documents = { ...(application.documents || {}) };
      let applicationChanged = false;
      definition.required.forEach(documentName => {
        if (normalizeDocumentCount(documents[documentName]) < 1) {
          documents[documentName] = 1;
          applicationChanged = true;
        }
      });
      if (!applicationChanged) return application;
      changed = true;
      return { ...application, documents };
    });
  return { next, changed };
};
