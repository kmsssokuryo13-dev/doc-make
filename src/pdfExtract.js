import { generateId, toFullWidthDigits, toHalfWidth } from './utils.js';

export const extractTextFromPdf = async (pdfDoc) => {
  if (!pdfDoc) return "";
  const pages = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join("");
    pages.push(text);
  }
  return pages.join("\n");
};

const hw = (s) => toHalfWidth(s || "");

const trimAll = (s) => (s || "").replace(/[\s\u3000\u00A0]+/g, "").trim();

const extractBetween = (text, startLabel, endLabels) => {
  const idx = text.indexOf(startLabel);
  if (idx < 0) return "";
  const after = text.slice(idx + startLabel.length);
  let endIdx = after.length;
  for (const el of endLabels) {
    const ei = after.indexOf(el);
    if (ei >= 0 && ei < endIdx) endIdx = ei;
  }
  return after.slice(0, endIdx).trim();
};

const parseFloorAreas = (raw) => {
  const results = [];
  const hwRaw = hw(raw);
  const pattern = /(?:地下)?(\d+)階\s*([\d.]+)/g;
  let m;
  while ((m = pattern.exec(hwRaw)) !== null) {
    const fullMatch = m[0];
    const isBasement = fullMatch.startsWith("地下");
    const floorNum = m[1];
    const area = m[2];
    const floorLabel = isBasement
      ? toFullWidthDigits(`地下${floorNum}階`)
      : toFullWidthDigits(`${floorNum}階`);
    results.push({ id: generateId(), floor: floorLabel, area: toFullWidthDigits(area) });
  }
  if (results.length === 0) {
    const simpleMatch = hwRaw.match(/([\d.]+)/);
    if (simpleMatch) {
      results.push({ id: generateId(), floor: "１階", area: toFullWidthDigits(simpleMatch[1]) });
    }
  }
  return results;
};

const parseWarekiDate = (raw) => {
  const text = (raw || "").trim();
  const eraMatch = text.match(/(令和|平成|昭和|大正|明治)/);
  const era = eraMatch ? eraMatch[1] : "";
  const hwText = hw(text);
  const yMatch = hwText.match(/(\d+)\s*年/);
  const mMatch = hwText.match(/年\s*(\d+)\s*月/);
  const dMatch = hwText.match(/月\s*(\d+)\s*日/);
  return {
    era,
    year: yMatch ? toFullWidthDigits(yMatch[1]) : "",
    month: mMatch ? toFullWidthDigits(mMatch[1]) : "",
    day: dMatch ? toFullWidthDigits(dMatch[1]) : "",
  };
};

const parseCauseAndDate = (raw) => {
  const text = (raw || "").trim();
  const dateMatch = text.match(/(令和|平成|昭和|大正|明治)\s*\d+\s*年\s*\d+\s*月\s*\d+\s*日/);
  let cause = "";
  if (dateMatch) {
    const afterDate = text.slice(text.indexOf(dateMatch[0]) + dateMatch[0].length).trim();
    cause = afterDate || "";
  }
  const date = dateMatch ? parseWarekiDate(dateMatch[0]) : { era: "令和", year: "", month: "", day: "" };
  return { cause, date };
};

export const parseBuildingRegistration = (text) => {
  const buildings = [];

  const hasBuilding = text.includes("建物") || text.includes("家屋番号") || text.includes("種類") || text.includes("構造");
  if (!hasBuilding) return buildings;

  const addressRaw = extractBetween(text, "所在", ["家屋番号", "地番", "①", "種類"]);
  const houseNumRaw = extractBetween(text, "家屋番号", ["種類", "構造", "①", "床面積"]);

  const kindRaw = extractBetween(text, "種類", ["構造", "②", "床面積"]);
  if (!kindRaw && !addressRaw && !houseNumRaw) return buildings;

  const structRaw = extractBetween(text, "構造", ["床面積", "③", "原因"]);
  const floorAreaRaw = extractBetween(text, "床面積", ["原因", "所有者", "権利部", "㎡"]);

  let fullFloorAreaText = floorAreaRaw;
  const afterFloorLabel = text.indexOf("床面積");
  if (afterFloorLabel >= 0) {
    const chunk = text.slice(afterFloorLabel, afterFloorLabel + 300);
    const ownerIdx = chunk.indexOf("所有者");
    const causeIdx = chunk.indexOf("原因");
    const endIdx = Math.min(
      ownerIdx >= 0 ? ownerIdx : 300,
      causeIdx >= 0 ? causeIdx : 300
    );
    fullFloorAreaText = chunk.slice(0, endIdx);
  }

  const causeRaw = extractBetween(text, "原因及びその日付", ["所有者", "権利部", "共同担保"]);
  const { cause, date } = parseCauseAndDate(causeRaw);

  const address = trimAll(addressRaw);
  const houseNum = trimAll(houseNumRaw);
  const kind = trimAll(kindRaw);

  const structText = trimAll(structRaw);
  const floorPattern = /(地下\d+階付)?(平家建|\d+階建)$/;
  const hwStruct = hw(structText);
  const floorMatch = hwStruct.match(floorPattern);
  let structMaterial = structText;
  let structFloor = "";
  if (floorMatch) {
    const matchIdx = hwStruct.lastIndexOf(floorMatch[0]);
    structMaterial = structText.slice(0, matchIdx);
    structFloor = structText.slice(matchIdx);
  }

  const floorAreas = parseFloorAreas(fullFloorAreaText);
  const hasBasement = floorAreas.some(fa => fa.floor.includes("地下"));

  if (!floorAreas.length) {
    floorAreas.push({ id: generateId(), floor: "１階", area: "" });
  }

  const building = {
    id: generateId(),
    address,
    houseNum,
    kind,
    structMaterial,
    structFloor,
    struct: structMaterial + structFloor,
    owner: "",
    floorAreas,
    hasBasement,
    annexes: [],
    registrationCause: cause,
    registrationDate: date,
    additionalCauses: [],
    additionalUnknownDate: false,
    confirmationCert: null
  };

  buildings.push(building);
  return buildings;
};

export const parseLandRegistration = (text) => {
  const lands = [];

  const hasLand = text.includes("地番") || text.includes("地目") || text.includes("地積");
  if (!hasLand) return lands;

  const isLandDoc = text.includes("土地") || (text.includes("地番") && text.includes("地目"));
  if (!isLandDoc) return lands;

  const addressRaw = extractBetween(text, "所在", ["地番", "①"]);
  const address = trimAll(addressRaw);

  const lotSection = extractBetween(text, "地番", ["所有者", "権利部", "共同担保"]);

  const hwLot = hw(lotSection);
  const lotMatch = hwLot.match(/(\S+)/);
  const lotNumber = lotMatch ? lotMatch[1] : "";

  const categoryRaw = extractBetween(text, "地目", ["地積", "③"]);
  const category = trimAll(categoryRaw);

  const areaRaw = extractBetween(text, "地積", ["原因", "所有者", "権利部"]);
  const hwArea = hw(areaRaw);
  const areaMatch = hwArea.match(/([\d.]+)/);
  const area = areaMatch ? toFullWidthDigits(areaMatch[1]) : "";

  if (address || lotNumber || category || area) {
    lands.push({
      id: generateId(),
      address,
      lotNumber: toFullWidthDigits(lotNumber),
      category,
      area,
      owner: "",
      categoryChangeEnabled: false,
      newCategory: "",
      newArea: ""
    });
  }

  return lands;
};

export const parseOwnerInfo = (text) => {
  const owners = [];

  const ownerSections = [];
  const markers = ["所有者", "共有者"];
  for (const marker of markers) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(marker, searchFrom);
      if (idx < 0) break;
      ownerSections.push({ idx, marker });
      searchFrom = idx + marker.length;
    }
  }

  for (const section of ownerSections) {
    const after = text.slice(section.idx + section.marker.length, section.idx + section.marker.length + 200);

    const shareMatch = hw(after).match(/(\d+)分の(\d+)/);
    let share = "";
    if (shareMatch) {
      share = `${shareMatch[2]}/${shareMatch[1]}`;
    }

    const cleaned = after.replace(/[\s\u3000\u00A0]+/g, " ").trim();
    const parts = cleaned.split(/\s+/);

    let address = "";
    let name = "";
    if (parts.length >= 2) {
      const namePatterns = /^[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{1,10}[\s\u3000]?[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{1,10}$/;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (namePatterns.test(parts[i]) && !parts[i].includes("番") && !parts[i].includes("丁目")) {
          name = parts[i];
          address = parts.slice(0, i).join("");
          break;
        }
      }
      if (!name && parts.length >= 2) {
        name = parts[parts.length - 1];
        address = parts.slice(0, -1).join("");
      }
    }

    address = address.replace(/^\s+|\s+$/g, "").replace(/[\s\u3000]+/g, "");
    name = name.replace(/^\s+|\s+$/g, "");

    if (name || address) {
      owners.push({
        id: generateId(),
        address,
        name,
        representative: "",
        share,
        roles: ["申請人"],
        role: "申請人",
        contractorMasterId: ""
      });
    }
  }

  return owners;
};

export const parseRegistrationPdf = (text) => {
  const result = {
    buildings: [],
    land: [],
    people: [],
    rawText: text
  };

  result.buildings = parseBuildingRegistration(text);
  result.land = parseLandRegistration(text);
  result.people = parseOwnerInfo(text);

  return result;
};
