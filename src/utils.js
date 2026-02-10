import { APPLICATION_TYPES, APPLICATION_TO_DOCS } from './constants.js';

export const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + Math.random()).toString(36);

export const toHalfWidth = (str) => str.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

export const toFullWidthDigits = (str) =>
  (str ?? "").toString().replace(/[0-9]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0xFEE0));

export const naturalSortList = (list, key) => {
  const parseNum = (str) => {
    const hw = toHalfWidth(str || "");
    const matches = hw.match(/\d+/g);
    return matches ? matches.map(Number) : [];
  };
  return [...(list || [])].sort((a, b) => {
    const valA = a[key] || "";
    const valB = b[key] || "";
    if (!valA && valB) return 1;
    if (valA && !valB) return -1;
    const na = parseNum(valA);
    const nb = parseNum(valB);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      if (na[i] === undefined) return -1;
      if (nb[i] === undefined) return 1;
      if (na[i] !== nb[i]) return na[i] - nb[i];
    }
    return valA.localeCompare(valB, 'ja');
  });
};

export const stableSortKeys = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {});
};

export const getOrderedDocs = (applications = {}) => {
  const map = new Map();
  let order = 0;
  const add = (docName, appType, isRequired) => {
    if (!docName) return;
    const existing = map.get(docName);
    if (!existing) {
      map.set(docName, { name: docName, isRequired: !!isRequired, sources: [appType], order: order++ });
      return;
    }
    if (isRequired) existing.isRequired = true;
    if (!existing.sources.includes(appType)) existing.sources.push(appType);
  };
  APPLICATION_TYPES.forEach((appType) => {
    const cnt = Number(applications?.[appType] || 0);
    if (cnt <= 0) return;
    const def = APPLICATION_TO_DOCS?.[appType];
    if (!def) return;
    (def.required || []).forEach((d) => add(d, appType, true));
    (def.optional || []).forEach((d) => add(d, appType, false));
  });
  return Array.from(map.values()).sort((a, b) => a.order - b.order).map(({ order, ...rest }) => rest);
};

export const parseStructureToFloors = (struct) => {
  const hwStruct = toHalfWidth(struct || "");
  let groundCount = 1; let basementCount = 0;
  const groundMatch = hwStruct.match(/(\d+)階建/);
  if (groundMatch) groundCount = parseInt(groundMatch[1], 10);
  else if (hwStruct.includes("平家建")) groundCount = 1;
  const basementMatch = hwStruct.match(/地下(\d+)階付/);
  if (basementMatch) basementCount = parseInt(basementMatch[1], 10);
  const floors = [];
  for (let i = 1; i <= groundCount; i++) floors.push(toFullWidthDigits(`${i}階`));
  for (let i = 1; i <= basementCount; i++) floors.push(toFullWidthDigits(`地下${i}階`));
  return floors;
};

export const parseAnnexStructureToFloors = (struct) => {
  const hwStruct = toHalfWidth(struct || "");
  let groundCount = 1;
  const groundMatch = hwStruct.match(/(\d+)階建/);
  if (groundMatch) groundCount = parseInt(groundMatch[1], 10);
  else if (hwStruct.includes("平家建")) groundCount = 1;
  const floors = [];
  for (let i = 1; i <= groundCount; i++) floors.push(toFullWidthDigits(`${i}階`));
  return floors;
};

export const parseStructParts = (struct) => {
  const s = struct || "";
  const hw = toHalfWidth(s);
  const floorPattern = /(地下\d+階付)?(平家建|\d+階建)$/;
  const match = hw.match(floorPattern);
  if (match) {
    const matchIdx = hw.lastIndexOf(match[0]);
    return { structMaterial: s.slice(0, matchIdx), structFloor: s.slice(matchIdx) };
  }
  return { structMaterial: s, structFloor: "" };
};

export const computeStructFloor = (floorAreas) => {
  const areas = floorAreas || [];
  const isFilled = (a) => (a || "").replace(/[\s\u3000\u00A0]/g, "").length > 0;
  let maxGround = 0;
  let maxBasement = 0;
  areas.forEach(fa => {
    if (!isFilled(fa.area)) return;
    const hw = toHalfWidth(fa.floor);
    const bm = hw.match(/地下(\d+)階/);
    if (bm) { maxBasement = Math.max(maxBasement, parseInt(bm[1], 10)); return; }
    const gm = hw.match(/(\d+)階/);
    if (gm) maxGround = Math.max(maxGround, parseInt(gm[1], 10));
  });
  let result = "";
  if (maxBasement > 0) result += `地下${toFullWidthDigits(String(maxBasement))}階付`;
  if (maxGround === 0) return result;
  if (maxGround === 1) result += "平家建";
  else result += `${toFullWidthDigits(String(maxGround))}階建`;
  return result;
};

export const ensureNextFloors = (floorAreas, hasBasement) => {
  const newAreas = [...floorAreas];
  const isFilled = (a) => (a || "").replace(/[\s\u3000\u00A0]/g, "").length > 0;
  const groundAreas = newAreas.filter(fa => !fa.floor.includes("地下"));
  let maxGroundNum = 0;
  groundAreas.forEach(fa => {
    const hw = toHalfWidth(fa.floor);
    const m = hw.match(/(\d+)階/);
    if (m && isFilled(fa.area)) maxGroundNum = Math.max(maxGroundNum, parseInt(m[1], 10));
  });
  const nextGroundLabel = toFullWidthDigits(`${maxGroundNum + 1}階`);
  if (maxGroundNum > 0 && !newAreas.some(fa => toHalfWidth(fa.floor) === `${maxGroundNum + 1}階`)) {
    const insertIdx = newAreas.findIndex(fa => fa.floor.includes("地下"));
    const entry = { id: generateId(), floor: nextGroundLabel, area: "" };
    if (insertIdx >= 0) newAreas.splice(insertIdx, 0, entry);
    else newAreas.push(entry);
  }
  if (hasBasement) {
    const basementAreas = newAreas.filter(fa => fa.floor.includes("地下"));
    let maxBasementNum = 0;
    basementAreas.forEach(fa => {
      const hw = toHalfWidth(fa.floor);
      const m = hw.match(/地下(\d+)階/);
      if (m && isFilled(fa.area)) maxBasementNum = Math.max(maxBasementNum, parseInt(m[1], 10));
    });
    if (maxBasementNum > 0) {
      const nextLabel = toFullWidthDigits(`地下${maxBasementNum + 1}階`);
      if (!newAreas.some(fa => toHalfWidth(fa.floor) === `地下${maxBasementNum + 1}階`)) {
        newAreas.push({ id: generateId(), floor: nextLabel, area: "" });
      }
    }
  }
  return newAreas;
};

export const createNewSite = (name) => ({
  id: generateId(),
  name: name || '新規現場',
  address: '', land: [], buildings: [], proposedBuildings: [], people: [],
  applications: APPLICATION_TYPES.reduce((acc, type) => ({ ...acc, [type]: 0 }), {}),
  documents: {}, docPick: {},
  contractorId: "", scrivenerId: ""
});

export const createDefaultCauseDate = () => ({ era: "令和", year: "", month: "", day: "", unknown: false });

export const createNewBuilding = () => ({
  id: generateId(),
  address: '', symbol: '', houseNum: '', kind: '',
  structMaterial: '', structFloor: '', struct: '',
  owner: '',
  floorAreas: [{ id: generateId(), floor: '１階', area: '' }],
  hasBasement: false,
  annexes: [],
  registrationCause: "",
  registrationDate: { era: "令和", year: "", month: "", day: "", unknown: false },
  additionalCauses: [],
  confirmationCert: null
});

export const createNewAnnex = () => ({
  id: generateId(), symbol: '', kind: '',
  structMaterial: '', structFloor: '', struct: '',
  hasBasement: false,
  floorAreas: [{ id: generateId(), floor: '１階', area: '' }],
  registrationCause: "",
  registrationDate: { era: "令和", year: "", month: "", day: "", unknown: false },
  additionalCauses: [],
});

export const createNewPerson = (patch = {}) => {
  const base = {
    id: generateId(),
    address: "",
    name: "",
    representative: "",
    share: "",
    roles: ["申請人"],
    role: "申請人",
    contractorMasterId: ""
  };

  const merged = { ...base, ...(patch || {}) };

  let roles = [];
  if (Array.isArray(merged.roles)) roles = merged.roles;
  else if (merged.role) roles = String(merged.role).split(/[、,]/).map(x => x.trim()).filter(Boolean);

  if (!roles.length) roles = ["申請人"];

  return {
    ...merged,
    roles,
    role: roles.join("、")
  };
};

const compareYMD = (y, m, d, sy, sm, sd) => {
  if (y !== sy) return y - sy;
  if (m !== sm) return m - sm;
  return d - sd;
};

export const getTodayWarekiEraYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();

  const ERAS = [
    { era: "令和", start: [2019, 5, 1] },
    { era: "平成", start: [1989, 1, 8] },
    { era: "昭和", start: [1926, 12, 25] },
    { era: "大正", start: [1912, 7, 30] },
    { era: "明治", start: [1868, 1, 25] },
  ];

  for (const e of ERAS) {
    const [sy, sm, sd] = e.start;
    if (compareYMD(y, m, d, sy, sm, sd) >= 0) {
      const yearNum = y - sy + 1;
      return { era: e.era, year: toFullWidthDigits(String(yearNum)) };
    }
  }
  return { era: "令和", year: toFullWidthDigits("1") };
};

export const createDefaultConfirmationCert = () => {
  const today = getTodayWarekiEraYear();
  return {
    rNo: "01",
    code: "確認建築富建セ",
    number: "",
    date: {
      era: today.era,
      year: today.year,
      month: "",
      day: ""
    }
  };
};

export const sanitizeConfirmationCert = (cc) => {
  if (!cc || typeof cc !== "object") return null;
  const today = getTodayWarekiEraYear();
  return {
    rNo: cc.rNo || "01",
    code: (cc.code ?? "確認建築富建セ"),
    number: (cc.number ?? ""),
    date: {
      era: (cc.date?.era ?? today.era) || "",
      year: toFullWidthDigits((cc.date?.year ?? today.year) || ""),
      month: (cc.date?.month ?? ""),
      day: (cc.date?.day ?? ""),
    }
  };
};

export const formatConfirmationCertNo = (cc) => {
  if (!cc) return "";
  const rNo = toFullWidthDigits(toHalfWidth(cc.rNo || "01"));
  const code = (cc.code || "").trim();
  const num = toFullWidthDigits(toHalfWidth(cc.number || ""));
  const parts = [];
  parts.push(`第Ｒ${rNo}`);
  if (code) parts.push(code);
  if (num) parts.push(num);
  return `${parts.join(" ")}号`.trim();
};

export const formatConfirmationCertDate = (d) => {
  if (!d) return "";
  const era = (d.era || "").trim();
  const y = toFullWidthDigits(toHalfWidth(d.year || ""));
  const m = toFullWidthDigits(toHalfWidth(d.month || ""));
  const day = toFullWidthDigits(toHalfWidth(d.day || ""));
  const yPart = era || y ? `${era}${y}年` : "";
  const mPart = m ? `${m}月` : "";
  const dPart = day ? `${day}日` : "";
  return `${yPart}${mPart}${dPart}`.trim();
};

export const formatConfirmationCertNumber = (cc) => {
  if (!cc) return "";
  const rNo = toFullWidthDigits(cc.rNo || "");
  const code = (cc.code ?? "");
  const num = toFullWidthDigits(cc.number || "");
  return `第Ｒ${rNo}${code}${num}号`;
};

export const formatWarekiYMD = (d) => {
  if (!d) return "";
  const era = d.era ?? "";
  const y = toFullWidthDigits(d.year ?? "");
  const m = toFullWidthDigits(d.month ?? "");
  const day = toFullWidthDigits(d.day ?? "");
  return `${era}${y}年${m}月${day}日`;
};

export const formatConfirmationCertLine = (cc) => {
  if (!cc) return "";
  const no = formatConfirmationCertNumber(cc);
  const dt = formatWarekiYMD(cc.date);
  return `${no}　${dt}`;
};

export const formatShare = (share) => {
  const raw = (share ?? "").toString().trim();
  if (!raw) return "持分\u3000\u3000分の\u3000\u3000";
  const hw = toHalfWidth(raw);
  const slashMatch = hw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slashMatch) {
    const numer = toFullWidthDigits(slashMatch[1]);
    const denom = toFullWidthDigits(slashMatch[2]);
    return `持分${denom}分の${numer}`;
  }
  const bunnoMatch = raw.match(/^(\S+?)分の(\S+)$/);
  if (bunnoMatch) {
    return raw.startsWith("持分") ? raw : `持分${raw}`;
  }
  return raw.startsWith("持分") ? raw : `持分${raw}`;
};

export const getSelectedContractor = (siteData, contractors) => (contractors || []).find(c => c.id === siteData.contractorId) || null;
export const getSelectedScrivener = (siteData, scriveners) => (scriveners || []).find(s => s.id === siteData.scrivenerId) || null;

export const formatWareki = (d, additionalUnknownDate = false) => {
  if (!d) return "　";

  const era = (d.era || "").trim();

  const y= (d.year ?? "").toString().trim();
  const m = (d.month ?? "").toString().trim();
  const day = (d.day ?? "").toString().trim();

  const yFull = y ? toFullWidthDigits(y) : "";
  const mFull = m ? toFullWidthDigits(m) : "";
  const dFull = day ? toFullWidthDigits(day) : "";

  if (additionalUnknownDate) {
    return `${era}${yFull}年${mFull}月${dFull}日不詳`;
  }

  return `${era}${yFull || "\u3000\u3000"}年${mFull || "\u3000\u3000"}月${dFull || "\u3000\u3000"}日`;
};
