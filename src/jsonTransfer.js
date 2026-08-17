import { sanitizeSiteData } from './sanitize.js';

// 共通Core schemaVersion。7 で siteLandIds / targetLandIds / variant を正式化した。
export const EXPORT_SCHEMA_VERSION = 7;
export const EXPORT_APP = "document-builder-building";
// 通常版 / 石友版を JSON 上で判別するための識別子。
export const VARIANT = "standard";
export const SUPPORTED_IMPORT_SCHEMA_VERSIONS = [6, 7];

/** JSON 保存用のペイロードを組み立てる（DOM に依存しない純粋関数）。 */
export const buildExportPayload = (
  { activeSiteId, sites, contractors, scriveners } = {},
  { exportedAt = new Date().toISOString() } = {}
) => ({
  schemaVersion: EXPORT_SCHEMA_VERSION,
  exportedAt,
  app: EXPORT_APP,
  variant: VARIANT,
  activeSiteId: activeSiteId ?? null,
  sites: Array.isArray(sites) ? sites : [],
  contractors: Array.isArray(contractors) ? contractors : [],
  scriveners: Array.isArray(scriveners) ? scriveners : [],
});

/**
 * JSON 読込用に検証・整形する（DOM に依存しない純粋関数）。
 * schemaVersion 6 / 7 を受理し、未知の新しい version は警告を返した上で
 * 既知の範囲だけ読み込む（黙って正常扱いにはしない）。
 */
export const parseImportPayload = (data) => {
  if (!data || !Array.isArray(data.sites)) throw new Error("JSON形式不正");
  const sites = data.sites.map(sanitizeSiteData);
  if (sites.length === 0) throw new Error("JSON形式不正");

  const warnings = [];
  const version = Number(data.schemaVersion);
  if (!Number.isFinite(version)) {
    warnings.push("schemaVersion が不明なJSONです。読み込める範囲のみ取り込みます。");
  } else if (version > EXPORT_SCHEMA_VERSION) {
    warnings.push(
      `このJSONは新しい形式（schemaVersion ${version}）です。` +
      `本アプリは ${EXPORT_SCHEMA_VERSION} までに対応しており、未対応の情報は失われます。`
    );
  } else if (!SUPPORTED_IMPORT_SCHEMA_VERSIONS.includes(version)) {
    warnings.push(`schemaVersion ${version} は旧形式です。読み込める範囲のみ取り込みます。`);
  }

  return {
    sites,
    activeSiteId: sites.some(s => s.id === data.activeSiteId) ? data.activeSiteId : sites[0].id,
    contractors: Array.isArray(data.contractors) ? data.contractors : null,
    scriveners: Array.isArray(data.scriveners) ? data.scriveners : null,
    schemaVersion: Number.isFinite(version) ? version : null,
    variant: typeof data.variant === "string" ? data.variant : null,
    warnings,
  };
};
