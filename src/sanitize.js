import { APPLICATION_TYPES } from './constants.js';
import {
  generateId, toHalfWidth, toFullWidthDigits, stableSortKeys,
  parseStructureToFloors, parseAnnexStructureToFloors, sanitizeConfirmationCert
} from './utils.js';

export const sanitizeSiteData = (raw = {}) => {
  const sanitizeLand = (l = {}) => ({
    id: l.id || generateId(),
    address: l.address || "",
    lotNumber: l.lotNumber || "",
    category: l.category || "",
    area: l.area || "",
    owner: l.owner || "",
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
    const struct = a.struct || "";
    const includeBasement = !!a.includeBasement;
    const baseFloors = parseAnnexStructureToFloors(struct);
    const basementFloors = includeBasement ? ["地下1階"] : [];
    const labels = [...baseFloors, ...basementFloors];
    const map = new Map((a.floorAreas || []).map(f => [f.floor, f]));
    const floorAreas = labels.map(floor => {
      const ex = map.get(floor);
      return { id: ex?.id || generateId(), floor, area: ex?.area || "" };
    });
    return {
      id: a.id || generateId(),
      symbol: a.symbol || "",
      kind: a.kind || "",
      struct,
      includeBasement,
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
    const struct = b.struct || "";
    const labels = parseStructureToFloors(struct);
    const map = new Map((b.floorAreas || []).map(f => [f.floor, f]));
    const floorAreas = labels.map(floor => {
      const ex = map.get(floor);
      return { id: ex?.id || generateId(), floor, area: ex?.area || "" };
    });
    return {
      id: b.id || generateId(),
      address: b.address || "",
      symbol: b.symbol || "",
      houseNum: b.houseNum || "",
      kind: b.kind || "",
      struct,
      owner: b.owner || "",
      floorAreas,
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
      confirmationCert: sanitizeConfirmationCert(b.confirmationCert)
    };
  };

  const baseApplications = APPLICATION_TYPES.reduce((acc, t) => {
    acc[t] = 0;
    return acc;
  }, {});

  return {
    id: raw.id || generateId(),
    name: raw.name || "新規現場",
    address: raw.address || "",
    land: Array.isArray(raw.land) ? raw.land.map(sanitizeLand) : [],
    buildings: Array.isArray(raw.buildings) ? raw.buildings.map(sanitizeBuilding) : [],
    proposedBuildings: Array.isArray(raw.proposedBuildings) ? raw.proposedBuildings.map(sanitizeBuilding) : [],
    people: Array.isArray(raw.people)
      ? raw.people.map(p => ({
          ...p,
          id: p.id || generateId(),
          roles: Array.isArray(p.roles) ? p.roles : (p.role ? p.role.split(/[、,]/).map(x => x.trim()).filter(Boolean) : []),
          contractorMasterId: p.contractorMasterId || ""
        }))
      : [],
    applications: stableSortKeys({ ...baseApplications, ...(raw.applications || {}) }),
    documents: stableSortKeys(typeof raw.documents === "object" && raw.documents ? raw.documents : {}),
    docPick: stableSortKeys(typeof raw.docPick === "object" && raw.docPick ? raw.docPick : {}),
    contractorId: raw.contractorId || "",
    scrivenerId: raw.scrivenerId || ""
  };
};

export const sanitizeContractors = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(c => ({
    id: c.id || generateId(),
    address: c.address || "",
    tradeName: c.tradeName || c.name || "",
    representative: c.representative || ""
  }));
};

export const sanitizeScriveners = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(s => ({
    id: s.id || generateId(),
    address: s.address || "",
    name: s.name || ""
  }));
};
