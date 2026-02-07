export const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
export const PDFJS_WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export const CONTRACTORS_STORAGE_KEY = "building_app_contractors_v1";
export const SCRIVENERS_STORAGE_KEY = "building_app_scriveners_v1";
export const SITES_STORAGE_KEY = "building_app_sites_v1";
export const APP_STATE_STORAGE_KEY = "building_app_state_v1";

export const DEFAULT_DELEGATION_TEXT = "私は上記の者を代理人と定め、下記に記載の登記を管轄法務局へ申請の全権及び登記識別情報の暗号化、復号化並びに登記識別情報通知書代理受領の件、原本還付請求並びに受領の件、申請の補正又は取下に関する件、復代理人選任の件を委任する。";
export const DEFAULT_DELEGATION_TEXT_SAVE = "私は上記の者を代理人と定め、下記に記載の登記を管轄法務局へ申請の全権及び登記識別情報代理受領の件、原本還付請求並びに受領の件、申請の補正又は取下に関する件、復代理人選任の件を委任する。";
export const DEFAULT_DELEGATION_TEXT_ADDRESS_CHANGE = "私は上記の者を代理人と定め、下記に記載の登記を管轄法務局へ申請の全権及び登記識別情報代理受領の件、原本還付請求並びに受領の件、申請の補正又は取下に関する件、復代理人選任の件を委任する。";

export const DOC_PAGE_PADDING = "25mm 15mm 15mm 15mm";

export const ROLE_OPTIONS = ["申請人", "土地所有者", "建物所有者", "建築申請人", "工事人", "その他"];

export const APPLICATION_TYPES = [
  "建物表題登記", "土地地目変更登記", "建物滅失登記",
  "建物表題部変更登記", "建物表題部更正登記",
  "建物合併登記", "建物分割登記", "建物合体登記"
];

export const APPLICATION_TO_DOCS = {
  "建物表題登記": { required: ["委任状（表題）"], optional: ["委任状（保存）", '委任状（住所変更）', "工事完了引渡証明書（表題）", "申述書（共有）", "申述書（単独）", "売渡証明書"] },
  "土地地目変更登記": { required: ["委任状（地目変更）"], optional: [] },
  "建物滅失登記": { required: ["委任状（滅失）"], optional: ["滅失証明書（滅失）", "非登載証明書"] },
  "建物表題部変更登記": { required: ["委任状（表題部変更）"], optional: ["委任状（住所変更）", "工事完了引渡証明書（表題部変更）", "売渡証明書", "滅失証明書（表題部変更）", "非登載証明書"] },
  "建物表題部更正登記": { required: ["委任状（表題部更正）"], optional: [] },
  "建物合併登記": { required: ["委任状（合併）"], optional: [] },
  "建物分割登記": { required: ["委任状（分割）"], optional: [] },
  "建物合体登記": { required: ["委任状（合体）"], optional: ["工事完了引渡証明書（表題部変更）"] }
};

export const STATEMENT_CONFIRM_LABEL_COL_MM = 60;
