import { APPLICATION_TYPES } from './constants.js';
import { generateId, stableSortKeys } from './utils.js';

export const LAND_APPLICATION_TYPES = ["土地地目変更登記"];

export const isLandApplicationType = (type) => LAND_APPLICATION_TYPES.includes(type);

export const createRegistrationApplication = (type, id = generateId()) => ({
  id,
  type,
  targetBuildingIds: [],
  targetLandIds: [],
  applicantPersonIds: [],
  documents: {},
});

const stringList = (value) =>
  Array.isArray(value) ? value.filter(v => typeof v === "string") : [];

/** 共通Coreとして受理する登記申請の形へ整える（未知フィールドは保持しない）。 */
export const normalizeRegistrationApplication = (ra = {}) => ({
  id: ra.id || generateId(),
  type: ra.type || "",
  targetBuildingIds: stringList(ra.targetBuildingIds),
  // 登記申請そのものの対象土地。docPick.targetLandIds（書類へ印字する土地の
  // 選択）とは別概念であり、相互に流用しない。
  targetLandIds: stringList(ra.targetLandIds),
  applicantPersonIds: stringList(ra.applicantPersonIds),
  documents: stableSortKeys(typeof ra.documents === "object" && ra.documents ? ra.documents : {}),
});

/**
 * schemaVersion 6 では土地系申請の land.id が targetBuildingIds に入っていた。
 * 「土地系の種別」「targetLandIds が空」「targetBuildingIds が全て land[] に実在」
 * を満たす場合だけ targetLandIds へ移し、判定できない場合は元の値を触らない。
 */
export const migrateLegacyLandTargets = (regApps, landIds) => {
  const known = landIds instanceof Set ? landIds : new Set(landIds || []);
  return (regApps || []).map(ra => {
    if (!isLandApplicationType(ra.type)) return ra;
    if ((ra.targetLandIds || []).length > 0) return ra;
    const ids = ra.targetBuildingIds || [];
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
