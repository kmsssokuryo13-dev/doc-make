// Step3 P4: 対象4帳票の二次操作（印影位置・文言リセット）を通常フローから退避する。
// 保存形式・座標モデル・fontScaleの扱いは変更しない。判定だけを行う純関数群。
//
// 実データ形状（src/components/Docs/Docs.jsx / DocTemplate.jsx を確認）:
//   stampPositions       : null | Array<{ i: number, dx: number, dy: number }>
//   signerStampPositions : null | Array<{ i: number, dx: number, dy: number }>
// どちらも既定値は null（LEGACY_DOCUMENT_PICK_DEFAULTS）。
// `i` は署名者配列のindexで、人物IDではない（順序基準）。P4では方式を変更しない。

const hasOffset = (entry) => {
  if (!entry || typeof entry !== 'object') return false;
  const dx = Number(entry.dx);
  const dy = Number(entry.dy);
  return (Number.isFinite(dx) && dx !== 0) || (Number.isFinite(dy) && dy !== 0);
};

// 実際にドラッグで動かされた位置があるか。
// 原点へ戻した結果 {dx:0,dy:0} が残っている場合は「調整なし」と扱い、
// 意味のないリセットボタンを出さない。
export const hasStampPositionAdjustment = (positions) =>
  Array.isArray(positions) && positions.some(hasOffset);

export const hasAnyStampAdjustment = (pick) =>
  hasStampPositionAdjustment(pick?.stampPositions) ||
  hasStampPositionAdjustment(pick?.signerStampPositions);

// 位置リセットのpatch。既存実装と同じく印影位置2キーだけをnullへ戻す。
// customText / selectionOverrides / acknowledgement / Step1データには触れない。
export const buildStampPositionResetPatch = () => ({
  stampPositions: null,
  signerStampPositions: null,
});

// 対象4帳票で「文言をリセット」を出すか。
// linked かつ customText なしでは戻す対象が無いため常時表示しない。
// detached / legacy-detached では「最新データ連動へ切替」として維持する。
export const canRelinkDocumentText = ({ editMode, hasCustomText = false } = {}) =>
  (typeof editMode === 'string' && editMode !== 'linked') || hasCustomText === true;
