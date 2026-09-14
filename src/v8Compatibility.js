import { APPLICATION_TO_DOCS } from './constants.js';

export const INTERNAL_SCHEMA_VERSION = 8;

export const DOCUMENT_TEMPLATE_KEYS = Object.freeze({
  "委任状（表題）": "delegation.title",
  "委任状（保存）": "delegation.preservation",
  "委任状（住所変更）": "delegation.address-change",
  "委任状（地目変更）": "delegation.land-category-change",
  "委任状（滅失）": "delegation.building-loss",
  "委任状（表題部変更）": "delegation.building-description-change",
  "委任状（表題部更正）": "delegation.building-description-correction",
  "委任状（合併）": "delegation.building-merger",
  "委任状（分割）": "delegation.building-division",
  "委任状（合体）": "delegation.building-combination",
  "工事完了引渡証明書（表題）": "certificate.completion-title",
  "工事完了引渡証明書（表題部変更）": "certificate.completion-change",
  "滅失証明書（滅失）": "certificate.loss",
  "滅失証明書（表題部変更）": "certificate.loss-change",
  "非登載証明書": "certificate.non-listing",
  "申述書（共有）": "statement.shared-ownership",
  "申述書（単独）": "statement.sole-contribution",
  "売渡証明書": "certificate.sale",
});

// 現行Step3とv8移行が同じ既定値を参照し、既定値を手修正扱いしないための定義。
export const LEGACY_DOCUMENT_PICK_DEFAULTS = Object.freeze({
  applicantPersonIds: [],
  showMain: true,
  showAnnex: true,
  reg: { ids: [] },
  prop: { ids: [] },
  customText: null,
  stampPositions: null,
  signerStampPositions: null,
  printOn: true,
  targetPropBuildingId: "",
  targetBeforeBuildingId: "",
  lossBuildingIds: [],
  targetContractorPersonId: "",
  targetLandIds: [],
  statementPersonIds: [],
  statementApplicantPersonId: "",
  statementConfirmApplicantPersonId: "",
  confirmApplicantPersonIds: [],
  selectedCauseIds: null,
  mergeBeforeBuildingIds: [],
  splitAfterBuildingIds: [],
  combineBeforeBuildingIds: [],
  combinePurpose: "combineOnly",
  saleBuildingSource: "proposed",
  saleSellerPersonIds: [],
  fontScale: 100,
});

const DOCUMENT_NAMES_BY_TEMPLATE_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(DOCUMENT_TEMPLATE_KEYS).map(([name, key]) => [key, name])
  )
);
const KNOWN_DOCUMENT_TEMPLATE_KEYS = new Set(Object.values(DOCUMENT_TEMPLATE_KEYS));

const BUILDING_TITLE_TYPES = new Set(["建物表題登記"]);
const LAND_TYPES = new Set(["土地地目変更登記"]);

const LAYOUT_OVERRIDE_KEYS = new Set([
  "showMain",
  "showAnnex",
  "stampPositions",
  "signerStampPositions",
  "itemOffsets",
  "fontScale",
]);

const LEGACY_PICK_META_KEYS = new Set([
  "customText",
  "printOn",
  "_raApplied",
]);

const EDIT_MODES = new Set(["linked", "detached", "legacy-detached"]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const cloneJsonValue = (value) => {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(child => {
      const cloned = cloneJsonValue(child);
      return cloned === undefined ? null : cloned;
    });
  }
  if (!isRecord(value)) return undefined;

  const entries = [];
  for (const [key, child] of Object.entries(value)) {
    const cloned = cloneJsonValue(child);
    if (cloned !== undefined) entries.push([key, cloned]);
  }
  return Object.fromEntries(entries);
};

const cloneRecord = (value) => {
  const cloned = cloneJsonValue(value);
  return isRecord(cloned) ? cloned : {};
};

export const normalizeCompatibilityRecord = (value) => cloneRecord(value);

const jsonValuesEqual = (left, right) => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every(key => hasOwn(right, key) && jsonValuesEqual(left[key], right[key]));
};

const stringList = (value) =>
  Array.isArray(value) ? value.filter(item => typeof item === "string") : [];

const positiveInteger = (value, fallback = 1) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_DOCUMENT_COPIES_PER_APPLICATION = 100;

export const normalizeDocumentCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  // 現行Docs.jsxの `for (j = 0; j < count; j++)` と同じ件数になる。
  return Math.min(Math.ceil(parsed), MAX_DOCUMENT_COPIES_PER_APPLICATION);
};

export const normalizeLegacyDocumentCounts = (documents) => {
  if (!isRecord(documents)) return {};
  const entries = [];
  for (const [name, value] of Object.entries(documents)) {
    const normalized = hasOwn(DOCUMENT_TEMPLATE_KEYS, name)
      ? normalizeDocumentCount(value)
      : cloneJsonValue(value);
    if (normalized !== undefined) entries.push([name, normalized]);
  }
  return Object.fromEntries(entries);
};

const uniqueStrings = (values) => Array.from(new Set(stringList(values)));

export const isBlankDocumentHtml = (html) => {
  if (html === null || html === undefined) return true;
  const text = String(html)
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\s\u3000\u00A0\u2000-\u200B\u202F\u205F\uFEFF]/g, "");
  return text.length === 0;
};

export const getDocumentTemplateKey = (documentName = "") => {
  const name = typeof documentName === "string" ? documentName : "";
  return hasOwn(DOCUMENT_TEMPLATE_KEYS, name)
    ? DOCUMENT_TEMPLATE_KEYS[name]
    : `legacy:${encodeStableIdPart(name)}`;
};

export const getDocumentNameFromTemplateKey = (templateKey = "") =>
  hasOwn(DOCUMENT_NAMES_BY_TEMPLATE_KEY, templateKey)
    ? DOCUMENT_NAMES_BY_TEMPLATE_KEY[templateKey]
    : "";

const encodeStableIdPart = (value) => {
  const text = String(value ?? "");
  let encoded = "";
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        encoded += encodeURIComponent(text.slice(index, index + 2));
        index += 1;
      } else {
        encoded += `%u${code.toString(16).toUpperCase().padStart(4, "0")}`;
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      encoded += `%u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    } else {
      encoded += encodeURIComponent(text[index]);
    }
  }
  return encoded;
};

/**
 * 全RA横断通番が変わったとき、別申請の旧pickを引き継がないための選択規則。
 * 保存済み旧キーがある場合はそれを優先し、現在キーは申請ID一致時だけ採用する。
 */
export const selectLegacyPickForApplication = ({
  docPick = {},
  currentInstanceKey = "",
  previousInstanceKey = "",
  applicationId = "",
} = {}) => {
  const current = isRecord(docPick?.[currentInstanceKey])
    ? docPick[currentInstanceKey]
    : null;
  if (previousInstanceKey && previousInstanceKey !== currentInstanceKey) {
    const previous = isRecord(docPick?.[previousInstanceKey])
      ? docPick[previousInstanceKey]
      : null;
    if (previous &&
        (typeof previous._raApplied !== "string" || previous._raApplied === applicationId)) {
      return previous;
    }
    return {};
  }

  if (current &&
      (typeof current._raApplied !== "string" || current._raApplied === applicationId)) {
    return current;
  }
  return {};
};

export const createStableDocumentInstanceId = (
  applicationId,
  templateKey,
  copyIndex
) => `doc:${encodeStableIdPart(applicationId || "unknown")}:${encodeStableIdPart(templateKey)}:${positiveInteger(copyIndex)}`;

export const createApplicationSubjectFromLegacy = (
  type,
  targetBuildingIds = [],
  targetLandIds = []
) => {
  const buildingIds = uniqueStrings(targetBuildingIds);
  const landIds = uniqueStrings(targetLandIds);

  if (LAND_TYPES.has(type)) {
    return {
      beforeBuildingIds: [],
      afterBuildingIds: [],
      landIds,
      primaryBuildingId: null,
    };
  }

  if (BUILDING_TITLE_TYPES.has(type)) {
    return {
      beforeBuildingIds: [],
      afterBuildingIds: buildingIds,
      landIds: [],
      // v7には「主たる建物」の確定情報がないため推測しない。
      primaryBuildingId: null,
    };
  }

  return {
    beforeBuildingIds: buildingIds,
    afterBuildingIds: [],
    landIds: [],
    primaryBuildingId: null,
  };
};

export const normalizeApplicationSubject = (application = {}) => {
  const raw = isRecord(application.subject) ? application.subject : null;
  if (!raw) {
    return createApplicationSubjectFromLegacy(
      application.type,
      application.targetBuildingIds,
      application.targetLandIds
    );
  }

  const beforeBuildingIds = uniqueStrings(raw.beforeBuildingIds);
  const afterBuildingIds = uniqueStrings(raw.afterBuildingIds);
  const landIds = uniqueStrings(raw.landIds);
  const buildingIds = new Set([...beforeBuildingIds, ...afterBuildingIds]);
  const requestedPrimary = typeof raw.primaryBuildingId === "string"
    ? raw.primaryBuildingId
    : null;
  return {
    beforeBuildingIds,
    afterBuildingIds,
    landIds,
    primaryBuildingId: requestedPrimary && buildingIds.has(requestedPrimary)
      ? requestedPrimary
      : null,
  };
};

export const synchronizeSubjectFromLegacyPatch = (application, patch = {}) => {
  const next = { ...application, ...patch };
  const subject = hasOwn(patch, "type") && !hasOwn(patch, "subject")
    ? createApplicationSubjectFromLegacy(
        next.type,
        next.targetBuildingIds,
        next.targetLandIds
      )
    : normalizeApplicationSubject(next);

  if (hasOwn(patch, "targetLandIds") && LAND_TYPES.has(next.type)) {
    subject.landIds = uniqueStrings(next.targetLandIds);
  }

  if (hasOwn(patch, "targetBuildingIds")) {
    const ids = uniqueStrings(next.targetBuildingIds);
    if (BUILDING_TITLE_TYPES.has(next.type)) {
      subject.afterBuildingIds = ids;
    } else if (!LAND_TYPES.has(next.type)) {
      subject.beforeBuildingIds = ids;
    }
    const subjectBuildingIds = new Set([
      ...subject.beforeBuildingIds,
      ...subject.afterBuildingIds,
    ]);
    if (subject.primaryBuildingId && !subjectBuildingIds.has(subject.primaryBuildingId)) {
      subject.primaryBuildingId = null;
    }
  }

  return { ...next, subject };
};

export const countDocumentsFromInstances = (instances) => {
  const counts = new Map();
  for (const raw of Array.isArray(instances) ? instances : []) {
    if (raw?.active === false) continue;
    const name = typeof raw?.documentName === "string" ? raw.documentName : "";
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Object.fromEntries(counts);
};

export const normalizeDocumentInstance = (
  raw = {},
  { applicationId = "", documentName = "", copyIndex = 1, legacyInstanceKey = "" } = {}
) => {
  const safeRaw = isRecord(raw) ? raw : {};
  const resolvedName = getDocumentNameFromTemplateKey(safeRaw.templateKey) ||
    (typeof safeRaw.documentName === "string" && safeRaw.documentName
      ? safeRaw.documentName
      : documentName);
  const resolvedCopyIndex = positiveInteger(safeRaw.copyIndex, positiveInteger(copyIndex));
  const templateKey = typeof safeRaw.templateKey === "string" && safeRaw.templateKey
    ? safeRaw.templateKey
    : getDocumentTemplateKey(resolvedName);
  const requestedDetachedHtml = typeof safeRaw.detachedHtml === "string"
    ? safeRaw.detachedHtml
    : null;
  const detachedHtml = isBlankDocumentHtml(requestedDetachedHtml)
    ? null
    : requestedDetachedHtml;
  const requestedMode = EDIT_MODES.has(safeRaw.editMode) ? safeRaw.editMode : null;
  const editMode = requestedMode && (requestedMode === "linked" || detachedHtml !== null)
    ? requestedMode
    : (detachedHtml !== null ? "detached" : "linked");
  const content = isRecord(safeRaw.contentOverrides) ? safeRaw.contentOverrides : {};

  return {
    id: typeof safeRaw.id === "string" && safeRaw.id
      ? safeRaw.id
      : createStableDocumentInstanceId(applicationId, templateKey, resolvedCopyIndex),
    templateKey,
    documentName: resolvedName,
    copyIndex: resolvedCopyIndex,
    active: typeof safeRaw.active === "boolean" ? safeRaw.active : true,
    printEnabled: typeof safeRaw.printEnabled === "boolean" ? safeRaw.printEnabled : true,
    selectionOverrides: cloneRecord(safeRaw.selectionOverrides),
    contentOverrides: {
      blocks: cloneRecord(content.blocks),
      fields: cloneRecord(content.fields),
    },
    layoutOverrides: cloneRecord(safeRaw.layoutOverrides),
    editMode,
    detachedHtml,
    detachedSourceSnapshot: isRecord(safeRaw.detachedSourceSnapshot)
      ? cloneRecord(safeRaw.detachedSourceSnapshot)
      : null,
    legacyInstanceKey: safeRaw.legacyInstanceKey === null
      ? null
      : (typeof safeRaw.legacyInstanceKey === "string" && safeRaw.legacyInstanceKey
          ? safeRaw.legacyInstanceKey
          : legacyInstanceKey),
  };
};

const DERIVED_BUILDING_BEFORE_TYPES = new Set([
  "建物表題部変更登記",
  "建物表題部更正登記",
  "建物合併登記",
  "建物分割登記",
  "建物合体登記",
]);

const legacySelectionMatchesApplication = (application, key, value) => {
  const firstBuildingId = application?.targetBuildingIds?.[0] || "";
  if (key === "applicantPersonIds") {
    return jsonValuesEqual(value, application?.applicantPersonIds || []);
  }
  if (key === "targetPropBuildingId" && BUILDING_TITLE_TYPES.has(application?.type)) {
    return value === firstBuildingId;
  }
  if (key === "targetBeforeBuildingId" && DERIVED_BUILDING_BEFORE_TYPES.has(application?.type)) {
    return value === firstBuildingId;
  }
  if (key === "lossBuildingIds" && application?.type === "建物滅失登記") {
    return jsonValuesEqual(value, firstBuildingId ? [firstBuildingId] : []);
  }
  return null;
};

const mergeLegacyPick = (
  instance,
  rawPick,
  application,
  {
    allowNewOverrides = true,
    allowDerivedOverrides = true,
    acceptCustomText = true,
    acceptDirectValues = true,
    intentionalFields = new Set(),
  } = {}
) => {
  if (!isRecord(rawPick)) return instance;

  const selectionOverrides = { ...instance.selectionOverrides };
  const layoutOverrides = { ...instance.layoutOverrides };

  for (const [key, value] of Object.entries(rawPick)) {
    if (LEGACY_PICK_META_KEYS.has(key)) continue;
    const cloned = cloneJsonValue(value);
    if (cloned === undefined) continue;
    const targetOverrides = LAYOUT_OVERRIDE_KEYS.has(key)
      ? layoutOverrides
      : selectionOverrides;
    const isIntentionalFieldEdit = intentionalFields.has(key);
    const alreadyOverridden = hasOwn(targetOverrides, key);
    const matchesApplication = legacySelectionMatchesApplication(application, key, cloned);
    if (matchesApplication === true) {
      if (!alreadyOverridden || isIntentionalFieldEdit) {
        delete targetOverrides[key];
      }
      continue;
    }
    if (!alreadyOverridden && !allowNewOverrides && !isIntentionalFieldEdit) continue;
    if (!alreadyOverridden &&
        matchesApplication === false &&
        !allowDerivedOverrides &&
        !isIntentionalFieldEdit) {
      continue;
    }
    if (matchesApplication === null &&
        hasOwn(LEGACY_DOCUMENT_PICK_DEFAULTS, key) &&
        jsonValuesEqual(cloned, LEGACY_DOCUMENT_PICK_DEFAULTS[key])) {
      if (!alreadyOverridden || isIntentionalFieldEdit) {
        delete targetOverrides[key];
      }
      continue;
    }
    targetOverrides[key] = cloned;
  }

  let editMode = instance.editMode;
  let detachedHtml = instance.detachedHtml;
  const isDetached = ["detached", "legacy-detached"].includes(instance.editMode);
  const isIntentionalTextEdit = intentionalFields.has("customText");
  if (hasOwn(rawPick, "customText") &&
      (acceptCustomText || isIntentionalTextEdit) &&
      (!isDetached || isIntentionalTextEdit)) {
    if (isBlankDocumentHtml(rawPick.customText)) {
      editMode = "linked";
      detachedHtml = null;
    } else {
      editMode = instance.editMode === "detached" ? "detached" : "legacy-detached";
      detachedHtml = String(rawPick.customText);
    }
  }

  return {
    ...instance,
    printEnabled: (acceptDirectValues || intentionalFields.has("printOn")) &&
      typeof rawPick.printOn === "boolean"
      ? rawPick.printOn
      : instance.printEnabled,
    selectionOverrides,
    layoutOverrides,
    editMode,
    detachedHtml,
  };
};

const getOrderedDocumentNames = (application) => {
  const definition = hasOwn(APPLICATION_TO_DOCS, application.type)
    ? APPLICATION_TO_DOCS[application.type]
    : null;
  return definition
    ? [...(definition.required || []), ...(definition.optional || [])]
    : [];
};

const findExistingInstance = (existing, usedIndexes, defaults) => {
  const stableId = createStableDocumentInstanceId(
    defaults.applicationId,
    defaults.templateKey,
    defaults.copyIndex
  );
  const matchesSlot = item =>
    item?.templateKey === defaults.templateKey &&
    item?.documentName === defaults.documentName &&
    positiveInteger(item?.copyIndex) === defaults.copyIndex;
  const matchers = [
    item => item?.active !== false && matchesSlot(item) && item?.id === stableId,
    item => item?.active !== false && matchesSlot(item),
    item => item?.active !== false &&
      item?.templateKey === defaults.templateKey &&
      item?.legacyInstanceKey === defaults.legacyInstanceKey,
    item => item?.active === false && matchesSlot(item) && item?.id === stableId,
    item => item?.active === false && matchesSlot(item),
    item => item?.active === false &&
      item?.templateKey === defaults.templateKey &&
      item?.legacyInstanceKey === defaults.legacyInstanceKey,
  ];

  for (const matches of matchers) {
    const index = existing.findIndex((item, at) => !usedIndexes.has(at) && matches(item));
    if (index >= 0) return index;
  }
  return -1;
};

/** 重複RA IDを修復したslotだけ、旧docPickの所有者markerも同じIDへ直す。 */
export const rebindLegacyPickApplicationIds = ({
  applications = [],
  originalApplicationIds = [],
  docPick = {},
} = {}) => {
  const rebound = cloneRecord(docPick);
  const globalIndexes = new Map();

  (Array.isArray(applications) ? applications : []).forEach((application, applicationIndex) => {
    const originalId = originalApplicationIds[applicationIndex];
    const repairedId = application?.id;
    for (const documentName of getOrderedDocumentNames(application || {})) {
      const count = normalizeDocumentCount(application?.documents?.[documentName]);
      for (let copyIndex = 1; copyIndex <= count; copyIndex++) {
        const globalIndex = (globalIndexes.get(documentName) || 0) + 1;
        globalIndexes.set(documentName, globalIndex);
        if (!originalId || originalId === repairedId) continue;
        const key = `${documentName}__${globalIndex}`;
        const pick = rebound[key];
        if (isRecord(pick) && pick._raApplied === originalId) {
          rebound[key] = { ...pick, _raApplied: repairedId };
        }
      }
    }
  });

  return rebound;
};

/**
 * 現行 Docs.jsx と同じ順序で、RAごとの書類を安定ID付きインスタンスへ投影する。
 * 既存v8インスタンスのoverrideは維持し、現行UIで変更可能なdocPickだけを同期する。
 */
export const hydrateDocumentInstances = (
  applications,
  docPick = {},
  { legacyPickIntentFields = {}, preferApplicationValues = false } = {}
) => {
  const globalIndexes = new Map();
  const applicationList = Array.isArray(applications) ? applications : [];
  const intentFieldsByPick = isRecord(legacyPickIntentFields)
    ? legacyPickIntentFields
    : {};
  const previousKeyOwners = new Map();
  applicationList.forEach((application, applicationIndex) => {
    (Array.isArray(application?.documentInstances) ? application.documentInstances : [])
      .forEach((instance, instanceIndex) => {
        if (typeof instance?.legacyInstanceKey !== "string" || !instance.legacyInstanceKey) return;
        const owners = previousKeyOwners.get(instance.legacyInstanceKey) || new Set();
        owners.add(`${applicationIndex}:${instanceIndex}`);
        previousKeyOwners.set(instance.legacyInstanceKey, owners);
      });
  });

  return applicationList.map((application, applicationIndex) => {
    const existing = Array.isArray(application.documentInstances)
      ? application.documentInstances
      : [];
    const usedIndexes = new Set();
    const hydrated = [];

    for (const documentName of getOrderedDocumentNames(application)) {
      const count = normalizeDocumentCount(application.documents?.[documentName]);
      for (let localIndex = 1; localIndex <= count; localIndex++) {
        const globalIndex = (globalIndexes.get(documentName) || 0) + 1;
        globalIndexes.set(documentName, globalIndex);
        const templateKey = getDocumentTemplateKey(documentName);
        const legacyInstanceKey = `${documentName}__${globalIndex}`;
        const defaults = {
          applicationId: application.id,
          documentName,
          templateKey,
          copyIndex: localIndex,
          legacyInstanceKey,
        };
        const existingIndex = findExistingInstance(existing, usedIndexes, defaults);
        const rawExisting = existingIndex >= 0 ? existing[existingIndex] : null;
        const previousLegacyKey = rawExisting?.legacyInstanceKey === null
          ? null
          : (typeof rawExisting?.legacyInstanceKey === "string"
              ? rawExisting.legacyInstanceKey
              : "");
        const current = normalizeDocumentInstance(
          existingIndex >= 0
            ? {
                ...existing[existingIndex],
                templateKey,
                documentName,
                copyIndex: localIndex,
              }
            : {},
          defaults
        );
        if (existingIndex >= 0) usedIndexes.add(existingIndex);
        const currentOwnerToken = existingIndex >= 0
          ? `${applicationIndex}:${existingIndex}`
          : null;
        const currentKeyIsClaimedByAnotherInstance =
          (previousKeyOwners.get(legacyInstanceKey) || new Set()).size > 0 &&
          Array.from(previousKeyOwners.get(legacyInstanceKey) || [])
            .some(ownerToken => ownerToken !== currentOwnerToken);
        let legacyPick = {};
        let nextLegacyInstanceKey = current.legacyInstanceKey;
        if (rawExisting?.active === false) {
          // 休止instanceの内容を正本として戻し、再利用された旧通番で上書きしない。
          nextLegacyInstanceKey = previousLegacyKey || null;
        } else if (previousLegacyKey === null) {
          nextLegacyInstanceKey = null;
        } else if (previousLegacyKey) {
          legacyPick = selectLegacyPickForApplication({
            docPick,
            currentInstanceKey: legacyInstanceKey,
            previousInstanceKey: previousLegacyKey,
            applicationId: application.id,
          });
          nextLegacyInstanceKey = previousLegacyKey;
        } else if (currentKeyIsClaimedByAnotherInstance) {
          nextLegacyInstanceKey = null;
        } else {
          legacyPick = selectLegacyPickForApplication({
            docPick,
            currentInstanceKey: legacyInstanceKey,
            previousInstanceKey: "",
            applicationId: application.id,
          });
          nextLegacyInstanceKey = legacyInstanceKey;
        }
        const intentionalFields = new Set();
        [legacyInstanceKey, previousLegacyKey].forEach(key => {
          if (typeof key !== "string" || !key || !hasOwn(intentFieldsByPick, key)) return;
          stringList(intentFieldsByPick[key]).forEach(field => intentionalFields.add(field));
        });
        const hasPriorLegacyBinding = !!rawExisting &&
          (rawExisting.legacyInstanceKey === null ||
            (typeof rawExisting.legacyInstanceKey === "string" &&
              rawExisting.legacyInstanceKey.length > 0));
        const legacyMarkerMatches = legacyPick?._raApplied === application.id;
        hydrated.push({
          ...mergeLegacyPick(current, legacyPick, application, {
            allowNewOverrides: !hasPriorLegacyBinding,
            allowDerivedOverrides: !preferApplicationValues && legacyMarkerMatches,
            acceptCustomText: !hasPriorLegacyBinding,
            acceptDirectValues: !hasPriorLegacyBinding,
            intentionalFields,
          }),
          active: true,
          legacyInstanceKey: nextLegacyInstanceKey,
        });
      }
    }

    // v8側にしか存在しないインスタンスを推測で削除・再割当しない。
    existing.forEach((item, index) => {
      if (usedIndexes.has(index)) return;
      const normalized = normalizeDocumentInstance(item, { applicationId: application.id });
      const isKnownInactiveInstance = KNOWN_DOCUMENT_TEMPLATE_KEYS.has(normalized.templateKey);
      hydrated.push({
        ...normalized,
        active: isKnownInactiveInstance ? false : normalized.active,
      });
    });

    return {
      ...application,
      // subjectが明示されている場合、空配列も利用者の意思として保持する。
      subject: normalizeApplicationSubject(application),
      documentInstances: hydrated,
    };
  });
};

/**
 * 安定instanceを、現行UIが読む「帳票名__全RA横断通番」へ再投影する。
 * 元docPickは複製して未知・未割当キーを残し、割当済みslotだけを上書きする。
 */
export const projectDocumentInstancesToLegacyDocPick = (site = {}) => {
  const projected = cloneRecord(site.docPick);
  const globalIndexes = new Map();
  const destinationKeys = new Set();
  const movedSourceKeys = new Set();

  for (const application of Array.isArray(site.registrationApplications)
    ? site.registrationApplications
    : []) {
    const instances = Array.isArray(application.documentInstances)
      ? application.documentInstances
      : [];
    for (const documentName of getOrderedDocumentNames(application)) {
      const count = normalizeDocumentCount(application.documents?.[documentName]);
      const templateKey = getDocumentTemplateKey(documentName);
      for (let copyIndex = 1; copyIndex <= count; copyIndex++) {
        const globalIndex = (globalIndexes.get(documentName) || 0) + 1;
        globalIndexes.set(documentName, globalIndex);
        const legacyInstanceKey = `${documentName}__${globalIndex}`;
        destinationKeys.add(legacyInstanceKey);
        const instance = instances.find(item =>
          item?.active !== false &&
          item?.templateKey === templateKey &&
          item?.documentName === documentName &&
          positiveInteger(item?.copyIndex) === copyIndex
        );
        if (!instance) continue;

        const basePick = cloneRecord(LEGACY_DOCUMENT_PICK_DEFAULTS);
        const firstBuildingId = application.targetBuildingIds?.[0] || "";
        if (BUILDING_TITLE_TYPES.has(application.type) && firstBuildingId) {
          basePick.targetPropBuildingId = firstBuildingId;
        }
        if (DERIVED_BUILDING_BEFORE_TYPES.has(application.type) && firstBuildingId) {
          basePick.targetBeforeBuildingId = firstBuildingId;
        }
        if (application.type === "建物滅失登記") {
          basePick.lossBuildingIds = firstBuildingId ? [firstBuildingId] : [];
        }
        if (Array.isArray(application.applicantPersonIds) &&
            application.applicantPersonIds.length > 0) {
          basePick.applicantPersonIds = [...application.applicantPersonIds];
        }
        const sourceKey = typeof instance.legacyInstanceKey === "string"
          ? instance.legacyInstanceKey
          : "";
        const hasUsableSourcePick = sourceKey &&
          isRecord(site.docPick?.[sourceKey]) &&
          (typeof site.docPick[sourceKey]._raApplied !== "string" ||
            site.docPick[sourceKey]._raApplied === application.id);
        const sourcePick = hasUsableSourcePick
          ? cloneRecord(site.docPick[sourceKey])
          : {};
        if (hasUsableSourcePick && sourceKey !== legacyInstanceKey) {
          movedSourceKeys.add(sourceKey);
        }
        const hasDetachedHtml = ["detached", "legacy-detached"].includes(instance.editMode) &&
          typeof instance.detachedHtml === "string";
        projected[legacyInstanceKey] = {
          ...sourcePick,
          ...basePick,
          ...cloneRecord(instance.selectionOverrides),
          ...cloneRecord(instance.layoutOverrides),
          customText: hasDetachedHtml ? instance.detachedHtml : null,
          printOn: typeof instance.printEnabled === "boolean" ? instance.printEnabled : true,
          _raApplied: application.id,
        };
      }
    }
  }

  movedSourceKeys.forEach(sourceKey => {
    if (!destinationKeys.has(sourceKey)) delete projected[sourceKey];
  });

  return projected;
};

const canonicalizeActiveLegacyInstanceKeys = (applications) => {
  const globalIndexes = new Map();
  return (Array.isArray(applications) ? applications : []).map(application => {
    const instances = Array.isArray(application.documentInstances)
      ? [...application.documentInstances]
      : [];
    for (const documentName of getOrderedDocumentNames(application)) {
      const count = normalizeDocumentCount(application.documents?.[documentName]);
      const templateKey = getDocumentTemplateKey(documentName);
      for (let copyIndex = 1; copyIndex <= count; copyIndex++) {
        const globalIndex = (globalIndexes.get(documentName) || 0) + 1;
        globalIndexes.set(documentName, globalIndex);
        const instanceIndex = instances.findIndex(item =>
          item?.active !== false &&
          item?.templateKey === templateKey &&
          item?.documentName === documentName &&
          positiveInteger(item?.copyIndex) === copyIndex
        );
        if (instanceIndex < 0) continue;
        instances[instanceIndex] = {
          ...instances[instanceIndex],
          legacyInstanceKey: `${documentName}__${globalIndex}`,
        };
      }
    }
    return { ...application, documentInstances: instances };
  });
};

const ensureUniqueDocumentInstanceIds = (applications) => {
  const reservedIds = new Set();
  (Array.isArray(applications) ? applications : []).forEach(application => {
    (Array.isArray(application?.documentInstances) ? application.documentInstances : [])
      .forEach(instance => {
        if (typeof instance?.id === "string" && instance.id) reservedIds.add(instance.id);
      });
  });
  const usedIds = new Set();
  return (Array.isArray(applications) ? applications : []).map(application => ({
    ...application,
    documentInstances: (Array.isArray(application.documentInstances)
      ? application.documentInstances
      : []).map(instance => {
        let id = instance.id;
        if (usedIds.has(id)) {
          const baseId = createStableDocumentInstanceId(
            application.id,
            instance.templateKey,
            instance.copyIndex
          );
          id = baseId;
          let suffix = 2;
          while (usedIds.has(id) || reservedIds.has(id)) id = `${baseId}~${suffix++}`;
        }
        usedIds.add(id);
        return id === instance.id ? instance : { ...instance, id };
      }),
  }));
};

/** local stateでlegacy UIとv8 shadowを安全に同じslotへそろえる。 */
export const reconcileSiteDocumentCompatibility = (site = {}, options = {}) => {
  const registrationApplications = ensureUniqueDocumentInstanceIds(
    hydrateDocumentInstances(site.registrationApplications, site.docPick, options)
  );
  const withHydratedInstances = { ...site, registrationApplications };
  const docPick = projectDocumentInstancesToLegacyDocPick(withHydratedInstances);
  return {
    ...site,
    docPick,
    registrationApplications: canonicalizeActiveLegacyInstanceKeys(registrationApplications),
  };
};

/** schemaVersion 7の外部JSONへv8内部フィールドを漏らさない。 */
export const stripV8CompatibilityForV7 = (site = {}) => {
  const stripBuilding = (building = {}) => {
    const { contractorPersonIds: _contractorPersonIds, ...legacy } = building;
    return legacy;
  };
  const stripApplication = (application = {}) => {
    const {
      subject: _subject,
      details: _details,
      documentInstances: _documentInstances,
      ...legacy
    } = application;
    return legacy;
  };

  return {
    ...site,
    // v7はactiveな位置指定しか表現できない。休止instanceや、元データと同値の
    // override意図は下流reader対応後のschemaVersion 8で初めて可搬にする。
    docPick: projectDocumentInstancesToLegacyDocPick(site),
    buildings: Array.isArray(site.buildings) ? site.buildings.map(stripBuilding) : site.buildings,
    proposedBuildings: Array.isArray(site.proposedBuildings)
      ? site.proposedBuildings.map(stripBuilding)
      : site.proposedBuildings,
    registrationApplications: Array.isArray(site.registrationApplications)
      ? site.registrationApplications.map(stripApplication)
      : site.registrationApplications,
  };
};
