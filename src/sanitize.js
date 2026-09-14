import { APPLICATION_TYPES } from './constants.js';
import {
  generateId, toHalfWidth, toFullWidthDigits, stableSortKeys,
  parseStructureToFloors, parseAnnexStructureToFloors, parseStructParts,
  sanitizeConfirmationCert
} from './utils.js';
import {
  normalizeRegistrationApplication, migrateLegacyLandTargets
} from './registrationApplications.js';
import {
  normalizeLegacyDocumentCounts,
  rebindLegacyPickApplicationIds,
  reconcileSiteDocumentCompatibility,
} from './v8Compatibility.js';

export const sanitizeSiteData = (raw = {}) => {
  const sanitizeLand = (l = {}) => ({
    id: l.id || generateId(),
    address: toFullWidthDigits(l.address || ""),
    lotNumber: l.lotNumber || "",
    category: l.category || "",
    area: l.area || "",
    owner: l.owner || "",
    ownerPersonIds: Array.isArray(l.ownerPersonIds) ? l.ownerPersonIds : [],
    categoryChangeEnabled: !!l.categoryChangeEnabled,
    newCategory: l.newCategory ?? "",
    newArea: l.newArea ?? "",
  });

  const sanitizeCauseEntry = (c = {}) => ({
    id: c.id || generateId(),
    cause: c.cause || "",
    date: {
      era: c.date?.era ?? "令和",
      year: c.date?.year || "",
      month: c.date?.month || "",
      day: c.date?.day || "",
    }
  });

  const sanitizeAnnex = (a = {}) => {
    const hasNewFields = a.structMaterial !== undefined;
    let structMaterial, structFloor, floorAreas, hasBasement;
    if (hasNewFields) {
      structMaterial = a.structMaterial || "";
      structFloor = a.structFloor || "";
      floorAreas = Array.isArray(a.floorAreas) && a.floorAreas.length > 0
        ? a.floorAreas.map(fa => ({ id: fa.id || generateId(), floor: fa.floor, area: fa.area || "" }))
        : [{ id: generateId(), floor: "１階", area: "" }];
      hasBasement = !!a.hasBasement;
    } else {
      const parsed = parseStructParts(a.struct || "");
      structMaterial = parsed.structMaterial;
      structFloor = parsed.structFloor;
      const baseFloors = parseAnnexStructureToFloors(a.struct || "");
      const includeBasement = !!a.includeBasement;
      const basementFloors = includeBasement ? ["地下1階"] : [];
      const labels = [...baseFloors, ...basementFloors];
      const map = new Map((a.floorAreas || []).map(f => [f.floor, f]));
      floorAreas = labels.length > 0
        ? labels.map(floor => {
            const ex = map.get(floor);
            return { id: ex?.id || generateId(), floor, area: ex?.area || "" };
          })
        : [{ id: generateId(), floor: "１階", area: "" }];
      hasBasement = floorAreas.some(fa => fa.floor.includes("地下"));
    }
    if (!floorAreas.some(fa => toHalfWidth(fa.floor) === "1階")) {
      floorAreas.unshift({ id: generateId(), floor: "１階", area: "" });
    }
    const struct = structMaterial + structFloor;
    return {
      id: a.id || generateId(),
      symbol: a.symbol || "",
      kind: a.kind || "",
      structMaterial,
      structFloor,
      struct,
      hasBasement,
      floorAreas,
      registrationCause: a.registrationCause || "",
      registrationDate: {
        era: a.registrationDate?.era ?? "令和",
        year: a.registrationDate?.year || "",
        month: a.registrationDate?.month || "",
        day: a.registrationDate?.day || "",
      },
      additionalCauses: Array.isArray(a.additionalCauses) ? a.additionalCauses.map(sanitizeCauseEntry) : [],
      additionalUnknownDate: !!a.additionalUnknownDate,
    };
  };

  const sanitizeBuilding = (b = {}) => {
    const hasNewFields = b.structMaterial !== undefined;
    let structMaterial, structFloor, floorAreas, hasBasement;
    if (hasNewFields) {
      structMaterial = b.structMaterial || "";
      structFloor = b.structFloor || "";
      floorAreas = Array.isArray(b.floorAreas) && b.floorAreas.length > 0
        ? b.floorAreas.map(fa => ({ id: fa.id || generateId(), floor: fa.floor, area: fa.area || "" }))
        : [{ id: generateId(), floor: "１階", area: "" }];
      hasBasement = !!b.hasBasement;
    } else {
      const parsed = parseStructParts(b.struct || "");
      structMaterial = parsed.structMaterial;
      structFloor = parsed.structFloor;
      const labels = parseStructureToFloors(b.struct || "");
      const map = new Map((b.floorAreas || []).map(f => [f.floor, f]));
      floorAreas = labels.length > 0
        ? labels.map(floor => {
            const ex = map.get(floor);
            return { id: ex?.id || generateId(), floor, area: ex?.area || "" };
          })
        : [{ id: generateId(), floor: "１階", area: "" }];
      hasBasement = floorAreas.some(fa => fa.floor.includes("地下"));
    }
    if (!floorAreas.some(fa => toHalfWidth(fa.floor) === "1階")) {
      floorAreas.unshift({ id: generateId(), floor: "１階", area: "" });
    }
    const struct = structMaterial + structFloor;
    return {
      id: b.id || generateId(),
      address: toFullWidthDigits(b.address || ""),
      symbol: b.symbol || "",
      houseNum: b.houseNum || "",
      kind: b.kind || "",
      structMaterial,
      structFloor,
      struct,
      owner: b.owner || "",
      ownerPersonIds: Array.isArray(b.ownerPersonIds) ? b.ownerPersonIds : [],
      contractorPersonIds: Array.isArray(b.contractorPersonIds)
        ? b.contractorPersonIds.filter(v => typeof v === "string")
        : [],
      // この建物が所在する敷地土地（land[].id）。登記対象土地とは別概念。
      siteLandIds: Array.isArray(b.siteLandIds) ? b.siteLandIds.filter(v => typeof v === "string") : [],
      floorAreas,
      hasBasement,
      annexes: Array.isArray(b.annexes) ? b.annexes.map(sanitizeAnnex) : [],
      registrationCause: b.registrationCause || "",
      registrationDate: {
        era: b.registrationDate?.era ?? "令和",
        year: b.registrationDate?.year || "",
        month: b.registrationDate?.month || "",
        day: b.registrationDate?.day || "",
      },
      additionalCauses: Array.isArray(b.additionalCauses) ? b.additionalCauses.map(sanitizeCauseEntry) : [],
      additionalUnknownDate: !!b.additionalUnknownDate,
      confirmationCert: sanitizeConfirmationCert(b.confirmationCert),
      confirmApplicantPersonIds: Array.isArray(b.confirmApplicantPersonIds) ? b.confirmApplicantPersonIds : [],
      confirmApplicantNames: Array.isArray(b.confirmApplicantNames) ? b.confirmApplicantNames : []
    };
  };

  const baseApplications = APPLICATION_TYPES.reduce((acc, t) => {
    acc[t] = 0;
    return acc;
  }, {});

  const land = Array.isArray(raw.land) ? raw.land.map(sanitizeLand) : [];
  const landIds = new Set(land.map(l => l.id));
  const rawDocPick = stableSortKeys(
    raw.docPick && typeof raw.docPick === "object" && !Array.isArray(raw.docPick)
      ? raw.docPick
      : {}
  );
  // v6の土地対象補正を先に行うことで、明示済みsubjectは保持しつつ、
  // subject未導入データだけを補正後のlegacy値から正しく生成する。
  const migratedRawApplications = Array.isArray(raw.registrationApplications)
    ? migrateLegacyLandTargets(raw.registrationApplications, landIds)
    : [];
  const reservedApplicationIds = new Set(
    migratedRawApplications
      .map(application => application?.id)
      .filter(id => typeof id === "string" && id)
  );
  const usedApplicationIds = new Set();
  const originalApplicationIds = [];
  const migratedApplications = migratedRawApplications.map((application, applicationIndex) => {
    if (!application || typeof application !== "object" || Array.isArray(application)) {
      originalApplicationIds[applicationIndex] = "";
      return normalizeRegistrationApplication(application);
    }
    const originalId = typeof application.id === "string" ? application.id : "";
    originalApplicationIds[applicationIndex] = originalId;
    if (!originalId || !usedApplicationIds.has(originalId)) {
      if (originalId) usedApplicationIds.add(originalId);
      return normalizeRegistrationApplication(application);
    }
    let suffix = 2;
    let uniqueId = `${originalId}~${suffix}`;
    while (reservedApplicationIds.has(uniqueId) || usedApplicationIds.has(uniqueId)) {
      uniqueId = `${originalId}~${++suffix}`;
    }
    reservedApplicationIds.add(uniqueId);
    usedApplicationIds.add(uniqueId);
    return normalizeRegistrationApplication({ ...application, id: uniqueId });
  });
  const reboundDocPick = rebindLegacyPickApplicationIds({
    applications: migratedApplications,
    originalApplicationIds,
    docPick: rawDocPick,
  });
  const compatibility = reconcileSiteDocumentCompatibility({
    registrationApplications: migratedApplications,
    docPick: reboundDocPick,
  });
  const registrationApplications = compatibility.registrationApplications;
  const docPick = stableSortKeys(compatibility.docPick);

  return {
    id: raw.id || generateId(),
    name: raw.name || "新規現場",
    address: toFullWidthDigits(raw.address || ""),
    land,
    buildings: Array.isArray(raw.buildings) ? raw.buildings.map(sanitizeBuilding) : [],
    proposedBuildings: Array.isArray(raw.proposedBuildings) ? raw.proposedBuildings.map(sanitizeBuilding) : [],
    people: Array.isArray(raw.people)
      ? raw.people.map(p => ({
          ...p,
          id: p.id || generateId(),
          address: toFullWidthDigits(p.address || ""),
          roles: Array.isArray(p.roles) ? p.roles : (p.role ? p.role.split(/[、,]/).map(x => x.trim()).filter(Boolean) : []),
          share: p.share || "",
          shareOverrides: (p.shareOverrides && typeof p.shareOverrides === "object" && !Array.isArray(p.shareOverrides)) ? { ...p.shareOverrides } : {},
          nameKana: p.nameKana || "",
          contractorMasterId: p.contractorMasterId || "",
          decedentName: p.decedentName || ""
        }))
      : [],
    applications: stableSortKeys({ ...baseApplications, ...(raw.applications || {}) }),
    registrationApplications,
    documents: stableSortKeys(normalizeLegacyDocumentCounts(raw.documents)),
    docPick,
    contractorId: raw.contractorId || "",
    scrivenerId: raw.scrivenerId || ""
  };
};

export const sanitizeContractors = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(c => ({
    id: c.id || generateId(),
    address: toFullWidthDigits(c.address || ""),
    tradeName: c.tradeName || c.name || "",
    representative: c.representative || ""
  }));
};

export const sanitizeScriveners = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(s => ({
    id: s.id || generateId(),
    address: toFullWidthDigits(s.address || ""),
    name: s.name || ""
  }));
};
