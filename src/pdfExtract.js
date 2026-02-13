import { generateId, toFullWidthDigits, toHalfWidth } from './utils.js';

export const extractTextFromPdf = async (pdfDoc) => {
  if (!pdfDoc) return "";
  const pages = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const lineMap = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      const bucket = Math.round(y / 3) * 3;
      if (!lineMap.has(bucket)) lineMap.set(bucket, []);
      lineMap.get(bucket).push({ x: item.transform ? item.transform[4] : 0, str: item.str });
    }
    const sortedKeys = [...lineMap.keys()].sort((a, b) => b - a);
    const lines = sortedKeys.map(k => {
      const items = lineMap.get(k).sort((a, b) => a.x - b.x);
      return items.map(it => it.str).join("");
    });
    pages.push(lines.join("\n"));
  }
  return pages.join("\n");
};

const hw = (s) => toHalfWidth(s || "");

const BORDER_RE = /[┏┓┗┛┠┨┯┷┬┴┼├┤─━┃│┐┌└┘╂┝┥┰┸┮┶┾╀╁╃╄╅╆╇╈╉╊┱┲┳┵┺┻┽╋╌╍╎╏═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬▏▎▍▌▋▊▉█]/g;

const stripBorders = (s) => (s || "").replace(BORDER_RE, "");

const clean = (s) => stripBorders(s).replace(/[\s\u3000\u00A0]+/g, "").replace(/余白/g, "").trim();

const splitSections = (text) => {
  const lines = text.split("\n");
  const sections = { header: [], hyodai: [], kouku: [], otsuku: [] };
  let current = "header";
  for (const line of lines) {
    if (line.includes("表") && line.includes("題") && line.includes("部")) {
      current = "hyodai";
    } else if (line.includes("権") && line.includes("利") && line.includes("部") && line.includes("甲") && line.includes("区")) {
      current = "kouku";
    } else if (line.includes("権") && line.includes("利") && line.includes("部") && line.includes("乙") && line.includes("区")) {
      current = "otsuku";
    }
    sections[current].push(line);
  }
  return sections;
};

const isRowSeparator = (line) => {
  const stripped = line.replace(/[\s\u3000]/g, "");
  if (!stripped) return false;
  const borderCount = (stripped.match(BORDER_RE) || []).length;
  const nonBorder = stripped.replace(BORDER_RE, "").replace(/[\s\u3000\u00A0]/g, "");
  return borderCount > 5 && nonBorder.length < 3;
};

const splitColumns = (line) => {
  const stripped = line.replace(/^[\s\u3000]*[┃│]/, "").replace(/[┃│][\s\u3000]*$/, "");
  return stripped.split(/[│┃]/).map(c => c.replace(BORDER_RE, "").replace(/[\s\u3000]+/g, " ").trim());
};

const HAS_KANJI_RE = /[\u4E00-\u9FFF\u30A0-\u30FF\u3040-\u309F]/;

const parseHyodaiLand = (lines) => {
  const result = { address: "", lotNumber: "", category: "", area: "" };

  let dataHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const cleanedLine = stripBorders(lines[i]).replace(/[\s\u3000]+/g, "");
    if (cleanedLine.includes("①") && cleanedLine.includes("地") && cleanedLine.includes("番")) {
      dataHeaderIdx = i;
      break;
    }
  }

  let addressLines = [];
  let foundShozai = false;
  const addrEnd = dataHeaderIdx > 0 ? dataHeaderIdx : lines.length;
  for (let i = 0; i < addrEnd; i++) {
    const line = lines[i];
    const cleanedLine = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (cleanedLine.includes("所在") && !cleanedLine.includes("所有")) {
      foundShozai = true;
    }
    if (!foundShozai) continue;
    if (isRowSeparator(line)) continue;
    const cols = splitColumns(line);
    if (cols.length >= 2) {
      const firstCol = clean(cols[0]);
      if (firstCol && firstCol !== "所在" && HAS_KANJI_RE.test(firstCol)) continue;
      const val = clean(cols[1] || "");
      if (val && HAS_KANJI_RE.test(val) && !val.includes("平成") && !val.includes("令和") && !val.includes("昭和") && !val.includes("登記") && !val.includes("変更")) {
        addressLines.push(val);
      }
    }
  }

  if (addressLines.length > 0) {
    result.address = addressLines[addressLines.length - 1];
  }

  if (dataHeaderIdx < 0) return result;

  let lotNumbers = [];
  let categories = [];
  let areas = [];

  for (let i = dataHeaderIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isRowSeparator(line)) continue;
    const stripped = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (!stripped) continue;

    const cols = splitColumns(line);
    if (cols.length >= 3) {
      const col0 = clean(cols[0]);
      const col1 = clean(cols[1]);
      const col2raw = cols[2] || "";
      const col2 = clean(col2raw.replace(/：/g, ".").replace(/:/g, "."));

      if (col0 && col0 !== "余白" && /[０-９\d番]/.test(col0)) lotNumbers.push(col0);
      if (col1 && col1 !== "余白" && HAS_KANJI_RE.test(col1)) categories.push(col1);

      const hwCol2 = hw(col2);
      const areaMatch = hwCol2.match(/(\d[\d.]*\d|\d+)/);
      if (areaMatch) areas.push(areaMatch[1]);
    }
  }

  if (lotNumbers.length > 0) result.lotNumber = lotNumbers[lotNumbers.length - 1];
  if (categories.length > 0) result.category = categories[categories.length - 1];
  if (areas.length > 0) result.area = areas[areas.length - 1];

  return result;
};

const parseFloorAreaCol = (rawCol) => {
  const processed = stripBorders(rawCol || "").replace(/：/g, ".").replace(/:/g, ".").replace(/余白/g, "").trim();
  if (!processed) return null;
  const hwVal = hw(processed);
  const floorMatch = hwVal.match(/(?:地下)?(\d+)階\s*([\d.]+)/);
  if (floorMatch) {
    const isBasement = hwVal.trimStart().startsWith("地下");
    const floorLabel = isBasement
      ? toFullWidthDigits(`地下${floorMatch[1]}階`)
      : toFullWidthDigits(`${floorMatch[1]}階`);
    return { id: generateId(), floor: floorLabel, area: toFullWidthDigits(floorMatch[2]) };
  }
  const simpleMatch = hwVal.match(/(\d[\d.]*\d|\d+)/);
  if (simpleMatch) {
    return { id: generateId(), floor: "１階", area: toFullWidthDigits(simpleMatch[1]) };
  }
  return null;
};

const parseAnnexSection = (lines) => {
  const annexes = [];
  let dataHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const cl = stripBorders(lines[i]).replace(/[\s\u3000]+/g, "");
    if (cl.includes("符号") && cl.includes("①")) {
      dataHeaderIdx = i;
      break;
    }
  }
  if (dataHeaderIdx < 0) return annexes;

  let current = null;
  for (let i = dataHeaderIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isRowSeparator(line)) {
      if (current) { annexes.push(current); current = null; }
      continue;
    }
    const stripped = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (!stripped) continue;

    const cols = splitColumns(line);
    if (cols.length < 4) continue;

    const col0 = clean(cols[0]);
    const col1 = clean(cols[1]);
    const col2 = clean(cols[2]);
    const col3raw = cols[3] || "";

    if (col0 && /[０-９\d]/.test(col0)) {
      if (current) annexes.push(current);
      current = {
        id: generateId(), symbol: toFullWidthDigits(col0), kind: "",
        structMaterial: "", structFloor: "", struct: "",
        hasBasement: false, floorAreas: [],
        registrationCause: "",
        registrationDate: { era: "令和", year: "", month: "", day: "", unknown: false },
        additionalCauses: [],
      };
    }
    if (!current) {
      current = {
        id: generateId(), symbol: "", kind: "",
        structMaterial: "", structFloor: "", struct: "",
        hasBasement: false, floorAreas: [],
        registrationCause: "",
        registrationDate: { era: "令和", year: "", month: "", day: "", unknown: false },
        additionalCauses: [],
      };
    }

    if (col1 && col1 !== "余白" && HAS_KANJI_RE.test(col1)) current.kind = col1;
    if (col2 && col2 !== "余白" && HAS_KANJI_RE.test(col2)) {
      const hwS = hw(col2);
      const fm = hwS.match(/(地下\d+階付)?(平家建|\d+階建)$/);
      if (fm) {
        const idx = hwS.lastIndexOf(fm[0]);
        current.structMaterial = col2.slice(0, idx);
        current.structFloor = col2.slice(idx);
      } else {
        current.structMaterial = col2;
      }
      current.struct = current.structMaterial + current.structFloor;
    }
    const fa = parseFloorAreaCol(col3raw);
    if (fa) {
      current.floorAreas.push(fa);
      current.hasBasement = current.floorAreas.some(f => f.floor.includes("地下"));
    }
  }
  if (current) annexes.push(current);

  for (const a of annexes) {
    if (a.floorAreas.length === 0) {
      a.floorAreas.push({ id: generateId(), floor: "１階", area: "" });
    }
  }
  return annexes;
};

const parseHyodaiBuilding = (lines) => {
  const result = { address: "", houseNum: "", kind: "", structMaterial: "", structFloor: "", floorAreas: [], annexBuildings: [] };

  let mainLines = [];
  let annexLines = [];
  let inAnnex = false;
  for (const line of lines) {
    const cl = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (cl.includes("附属建物") && cl.includes("表示")) inAnnex = true;
    if (inAnnex) annexLines.push(line); else mainLines.push(line);
  }

  let dataHeaderIdx = -1;
  for (let i = 0; i < mainLines.length; i++) {
    const cl = stripBorders(mainLines[i]).replace(/[\s\u3000]+/g, "");
    if (cl.includes("①") && cl.includes("種") && cl.includes("類")) {
      dataHeaderIdx = i;
      break;
    }
  }

  let houseNumIdx = -1;
  for (let i = 0; i < mainLines.length; i++) {
    const cl = stripBorders(mainLines[i]).replace(/[\s\u3000]+/g, "");
    if (cl.includes("家屋番号")) { houseNumIdx = i; break; }
  }

  let addressLines = [];
  let foundShozai = false;
  const addrEnd = houseNumIdx > 0 ? houseNumIdx : (dataHeaderIdx > 0 ? dataHeaderIdx : mainLines.length);
  for (let i = 0; i < addrEnd; i++) {
    const line = mainLines[i];
    const cl = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (cl.includes("所在") && !cl.includes("所有") && !cl.includes("所在図")) foundShozai = true;
    if (!foundShozai) continue;
    if (isRowSeparator(line)) continue;
    const cols = splitColumns(line);
    if (cols.length >= 2) {
      const firstCol = clean(cols[0]);
      if (firstCol && firstCol !== "所在" && HAS_KANJI_RE.test(firstCol)) continue;
      const val = clean(cols[1] || "");
      if (val && HAS_KANJI_RE.test(val) && !val.includes("平成") && !val.includes("令和") && !val.includes("昭和") && !val.includes("登記") && !val.includes("変更")) {
        addressLines.push(val);
      }
    }
  }
  if (addressLines.length > 0) result.address = addressLines[addressLines.length - 1];

  if (houseNumIdx >= 0) {
    let houseNumLines = [];
    const hnEnd = dataHeaderIdx > 0 ? dataHeaderIdx : mainLines.length;
    for (let i = houseNumIdx; i < hnEnd; i++) {
      const line = mainLines[i];
      if (isRowSeparator(line)) continue;
      const cols = splitColumns(line);
      if (cols.length >= 2) {
        const val = clean(cols[1] || "");
        if (val && /[０-９\d番]/.test(val)) houseNumLines.push(val);
      }
    }
    if (houseNumLines.length > 0) result.houseNum = houseNumLines[houseNumLines.length - 1];
  }

  if (dataHeaderIdx < 0) { result.annexBuildings = parseAnnexSection(annexLines); return result; }

  let kinds = [];
  let structs = [];
  let allFloorAreas = [];
  let currentRowKind = "";
  let currentRowStruct = "";

  for (let i = dataHeaderIdx + 1; i < mainLines.length; i++) {
    const line = mainLines[i];
    if (isRowSeparator(line)) {
      if (currentRowKind) kinds.push(currentRowKind);
      if (currentRowStruct) structs.push(currentRowStruct);
      currentRowKind = "";
      currentRowStruct = "";
      continue;
    }
    const stripped = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (!stripped) continue;

    const cols = splitColumns(line);
    if (cols.length >= 3) {
      const col0 = clean(cols[0]);
      const col1 = clean(cols[1]);

      if (col0 && col0 !== "余白" && HAS_KANJI_RE.test(col0)) currentRowKind += col0;
      if (col1 && col1 !== "余白" && HAS_KANJI_RE.test(col1)) currentRowStruct += col1;

      const fa = parseFloorAreaCol(cols[2] || "");
      if (fa) allFloorAreas.push(fa);
    }
  }
  if (currentRowKind) kinds.push(currentRowKind);
  if (currentRowStruct) structs.push(currentRowStruct);

  if (kinds.length > 0) result.kind = kinds[kinds.length - 1];
  if (structs.length > 0) {
    const structText = structs[structs.length - 1];
    const hwS = hw(structText);
    const floorMatch = hwS.match(/(地下\d+階付)?(平家建|\d+階建)$/);
    if (floorMatch) {
      const idx = hwS.lastIndexOf(floorMatch[0]);
      result.structMaterial = structText.slice(0, idx);
      result.structFloor = structText.slice(idx);
    } else {
      result.structMaterial = structText;
    }
  }

  const floorMap = new Map();
  for (const fa of allFloorAreas) floorMap.set(fa.floor, fa);
  result.floorAreas = [...floorMap.values()];

  result.annexBuildings = parseAnnexSection(annexLines);
  return result;
};

const parseCauseFromHyodai = (lines) => {
  let causeLines = [];
  let inCause = false;
  for (const line of lines) {
    const cleanedLine = stripBorders(line).replace(/[\s\u3000]+/g, "");
    if (cleanedLine.includes("原因及びその日付")) {
      inCause = true;
      continue;
    }
    if (inCause && !isRowSeparator(line)) {
      const cols = splitColumns(line);
      const lastCol = cols[cols.length - 1] || "";
      const val = clean(lastCol);
      if (val) causeLines.push(val);
    }
    if (inCause && isRowSeparator(line)) {
      if (causeLines.length > 0) break;
    }
  }
  const causeText = causeLines.join("");
  const hwCause = hw(causeText);
  const dateMatch = hwCause.match(/(令和|平成|昭和|大正|明治)\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  let cause = "";
  let date = { era: "令和", year: "", month: "", day: "" };
  if (dateMatch) {
    date = { era: dateMatch[1], year: toFullWidthDigits(dateMatch[2]), month: toFullWidthDigits(dateMatch[3]), day: toFullWidthDigits(dateMatch[4]) };
    const afterDate = hwCause.slice(hwCause.indexOf(dateMatch[0]) + dateMatch[0].length).trim();
    cause = afterDate || "";
  }
  return { cause, date };
};

const parseKoukuOwner = (lines) => {
  const entries = [];
  let currentEntry = null;
  let skipUntilSeparator = false;

  for (const line of lines) {
    if (isRowSeparator(line)) {
      if (currentEntry && currentEntry.rightsCol.length > 0) {
        entries.push(currentEntry);
      }
      currentEntry = null;
      skipUntilSeparator = false;
      continue;
    }

    const cols = splitColumns(line);
    if (cols.length < 4) continue;

    const seqCol = clean(cols[0]);
    const purposeCol = clean(cols[1]);

    if (seqCol && seqCol.includes("付記")) {
      skipUntilSeparator = true;
      continue;
    }
    if (skipUntilSeparator) continue;

    const rightsText = cols[3] || "";
    const rightsClean = clean(rightsText);

    if (seqCol && /^[０-９\d]+$/.test(hw(seqCol))) {
      const isOwnership = purposeCol.includes("所有権移転") && !purposeCol.includes("仮登記") && !purposeCol.includes("抹消");
      currentEntry = { seq: seqCol, rightsCol: [], isOwnershipTransfer: isOwnership };
    }

    if (currentEntry && rightsClean) {
      if (!rightsClean.includes("移記") && !rightsClean.includes("法務省令")) {
        currentEntry.rightsCol.push(rightsClean);
      }
    }
  }
  if (currentEntry && currentEntry.rightsCol.length > 0) {
    entries.push(currentEntry);
  }

  let ownerEntry = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].isOwnershipTransfer) {
      ownerEntry = entries[i];
      break;
    }
  }

  if (!ownerEntry) return [];

  const rightsText = ownerEntry.rightsCol.join(" ");
  const ownerMarkerIdx = rightsText.indexOf("所有者");
  if (ownerMarkerIdx < 0) return [];

  const afterOwner = rightsText.slice(ownerMarkerIdx + 3).trim();
  return parseOwnerFromRightsText(afterOwner);
};

const parseOwnerFromRightsText = (text) => {
  const owners = [];

  const addrNameMatch = text.match(/(.+?(?:[番地号丁目]+[０-９\d]*)+)\s+(.+)/);
  let address = "";
  let name = "";

  if (addrNameMatch) {
    address = addrNameMatch[1].replace(/\s+/g, "");
    name = addrNameMatch[2].replace(/\s+/g, " ").trim();
  } else {
    const segments = text.split(/\s+/).filter(Boolean);
    if (segments.length >= 2) {
      name = segments[segments.length - 1];
      address = segments.slice(0, -1).join("");
    } else {
      name = text;
    }
  }

  if (name || address) {
    const hwText = hw(text);
    const shareMatch = hwText.match(/(\d+)分の(\d+)/);
    let share = "１/１";
    if (shareMatch) {
      share = `${toFullWidthDigits(shareMatch[2])}/${toFullWidthDigits(shareMatch[1])}`;
    }

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

  return owners;
};

export const parseBuildingRegistration = (text) => {
  const sections = splitSections(text);
  if (sections.hyodai.length === 0) return [];

  const isBuilding = text.includes("建物の表示") || text.includes("家屋番号");
  if (!isBuilding) return [];

  const bld = parseHyodaiBuilding(sections.hyodai);
  const { cause, date } = parseCauseFromHyodai(sections.hyodai);

  if (!bld.address && !bld.houseNum && !bld.kind) return [];

  if (bld.floorAreas.length === 0) {
    bld.floorAreas.push({ id: generateId(), floor: "１階", area: "" });
  }

  return [{
    id: generateId(),
    address: bld.address,
    houseNum: bld.houseNum,
    kind: bld.kind,
    structMaterial: bld.structMaterial,
    structFloor: bld.structFloor,
    struct: bld.structMaterial + bld.structFloor,
    owner: "",
    floorAreas: bld.floorAreas,
    hasBasement: bld.floorAreas.some(fa => fa.floor.includes("地下")),
    annexes: bld.annexBuildings || [],
    registrationCause: cause,
    registrationDate: date,
    additionalCauses: [],
    additionalUnknownDate: false,
    confirmationCert: null
  }];
};

export const parseLandRegistration = (text) => {
  const sections = splitSections(text);
  if (sections.hyodai.length === 0) return [];

  const isLand = text.includes("土地の表示") || (text.includes("地番") && text.includes("地目") && text.includes("地積"));
  if (!isLand) return [];

  const land = parseHyodaiLand(sections.hyodai);

  if (!land.address && !land.lotNumber && !land.category && !land.area) return [];

  return [{
    id: generateId(),
    address: land.address,
    lotNumber: toFullWidthDigits(land.lotNumber),
    category: land.category,
    area: toFullWidthDigits(land.area),
    owner: "",
    categoryChangeEnabled: false,
    newCategory: "",
    newArea: ""
  }];
};

export const parseOwnerInfo = (text) => {
  const sections = splitSections(text);
  if (sections.kouku.length === 0) return [];
  return parseKoukuOwner(sections.kouku);
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
