import React, { useMemo } from 'react';
import {
  toFullWidthDigits, naturalSortList, formatWareki, getSelectedScrivener,
  formatConfirmationCertLine
} from '../../utils.js';
import {
  DOC_PAGE_PADDING, DEFAULT_DELEGATION_TEXT, DEFAULT_DELEGATION_TEXT_SAVE,
  DEFAULT_DELEGATION_TEXT_ADDRESS_CHANGE
} from '../../constants.js';
import { EditableDocBody } from './EditableDocBody.jsx';
import { DraggableStamp } from './DraggableStamp.jsx';
import { DraggableSignerStamp } from './DraggableSignerStamp.jsx';

export const DocTemplate = ({
  name, siteData, instanceKey, pick, onPickChange,
  onStampPosChange, onSignerStampPosChange, isPrint, instanceIndex, scriveners
}) => {
  const allApplicants = useMemo(
    () => (siteData.people || []).filter(p => (p.roles || []).includes("申請人")),
    [siteData.people]
  );

  const applicants = useMemo(() => {
    const ids = Array.isArray(pick?.applicantPersonIds) ? pick.applicantPersonIds : [];
    if (!ids.length) return allApplicants;
    const set = new Set(ids);
    const filtered = allApplicants.filter(p => set.has(p.id));
    return filtered.length ? filtered : allApplicants;
  }, [allApplicants, pick?.applicantPersonIds]);

  const statementCandidates = useMemo(() => {
    const people = siteData.people || [];
    const buildingApplicants = people.filter(p => (p.roles || []).includes("建築申請人"));
    if (buildingApplicants.length) return buildingApplicants;
    return people.filter(p => (p.roles || []).includes("申請人"));
  }, [siteData.people]);

  const statementPeople = useMemo(() => {
    const ids = Array.isArray(pick?.statementPersonIds) ? pick.statementPersonIds : [];
    if (!ids.length) return statementCandidates;
    const set = new Set(ids);
    const filtered = statementCandidates.filter(p => set.has(p.id));
    return filtered.length ? filtered : statementCandidates;
  }, [statementCandidates, pick?.statementPersonIds]);

  const linkedScrivener = useMemo(
    () => getSelectedScrivener(siteData, scriveners),
    [siteData?.scrivenerId, scriveners]
  );

  const getLinkedScrivenerLines = () => {
    if (!linkedScrivener) return ["　", "　"];
    return [linkedScrivener.address || "　", linkedScrivener.name || "　"];
  };

  const useLinkedScrivenerOnTopRight =
    name === "委任状（保存）" || name === "委任状（住所変更）";

  const [linkedScrivenerAddrLine, linkedScrivenerNameLine] = getLinkedScrivenerLines();

  if (name === "委任状（保存）") {
    const p = pick || {};
    pick = { ...p, showAnnex: false };
  }

  const getSignerPos = (idx) => {
    const list = Array.isArray(pick?.signerStampPositions) ? pick.signerStampPositions : [];
    const hit = list.find(p => p?.i === idx);
    return { dx: hit?.dx || 0, dy: hit?.dy || 0 };
  };

  const sortedProp = useMemo(() => naturalSortList(siteData.proposedBuildings || [], 'houseNum'), [siteData.proposedBuildings]);

  const sortedLand = useMemo(() => naturalSortList(siteData.land || [], "lotNumber"), [siteData.land]);

  const selectedLand = useMemo(() => {
    const all = sortedLand || [];
    const ids = Array.isArray(pick?.targetLandIds) ? pick.targetLandIds : [];
    if (!ids.length) return all;
    const set = new Set(ids);
    const filtered = all.filter(l => set.has(l.id));
    return filtered.length ? filtered : all;
  }, [sortedLand, pick?.targetLandIds]);

  const getWarekiNow = () => {
    const y = new Date().getFullYear();
    if (y >= 2019) return { era: "令和", year: String(y - 2018) };
    if (y >= 1989) return { era: "平成", year: String(y - 1988) };
    if (y >= 1926) return { era: "昭和", year: String(y - 1925) };
    if (y >= 1912) return { era: "大正", year: String(y - 1911) };
    if (y >= 1868) return { era: "明治", year: String(y - 1867) };
    return { era: "", year: String(y) };
  };

  const formatTodayDateBlock = () => {
    const w = getWarekiNow();
    return toFullWidthDigits(`${w.era}${w.year}年　　月　　日`);
  };

  const formatDateBlock = (d) => {
    if (!d) return "令和年　　月　　日";
    if (d.unknown) return "不詳";
    const stripWS = (s) =>
      (s ?? "").toString().replace(/[\s\u3000\u00A0\u2000-\u200B\u202F\u205F\uFEFF]/g, "");
    const era = stripWS(d.era);
    const year = stripWS(d.year);
    const y = year || "　";
    return toFullWidthDigits(`${era}${y}年　　月　　日`);
  };

  const floorLine = (floorAreas) => {
    if (name === "委任状（保存）") return "";
    const arr = Array.isArray(floorAreas) ? floorAreas : [];
    const t = arr.map(fa => `${fa.floor} ${fa.area || "　"}㎡`).join("  ");
    return t || "　";
  };

  const stripAllWS = (s) =>
    (s ?? "").toString().replace(/[\s\u3000\u00A0\u2000-\u200B\u202F\u205F\uFEFF]/g, "");

  const formatSymbolPrefix = (rawSymbol) => {
    const sym = stripAllWS(rawSymbol);
    if (!sym) return "";
    if (sym === "主") return `主　　`;
    if (sym.startsWith("符")) return `${sym}　　`;
    return `符${sym}　　`;
  };

  const getMainSymbolPrefix = (b) => {
    const explicit = stripAllWS(b?.symbol);
    const sym = explicit || (((b?.annexes || []).length > 0) ? "主" : "");
    return formatSymbolPrefix(sym);
  };

  const floorLineInline = (floorAreas) => {
    const arr = Array.isArray(floorAreas) ? floorAreas : [];
    const t = arr.map(fa => `${fa.floor} ${fa.area || "　"}㎡`).join("　");
    return t || "　";
  };

  const buildKindStructAreaLine = (symbolPrefix, kind, struct, floorAreas) => {
    if (name === "委任状（保存）") {
      const sym = symbolPrefix || "";
      return sym ? `${sym}` : "　";
    }
    const k = kind || "　";
    const st = struct || "　";
    const areas = floorLineInline(floorAreas);
    return `${symbolPrefix}${k}　${st}　${areas}`;
  };

  const renderMainValuesInline = (b, { showHouseNum } = { showHouseNum: true }) => {
    if (!b) return null;
    const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
        <div>{b.address || "　"}</div>
        {showHouseNum && b.houseNum ? (
          <div style={{ fontWeight: 'bold' }}>
            {name === "委任状（保存）" ? `家屋番号　${b.houseNum}　の建物` : b.houseNum}
          </div>
        ) : null}
        <div>{line}</div>
      </div>
    );
  };

  const renderAnnexValuesInline = (a) => {
    if (!a) return null;
    const line = buildKindStructAreaLine(formatSymbolPrefix(a.symbol), a.kind, a.struct, a.floorAreas);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', marginTop: '2mm' }}>
        <div>{line}</div>
      </div>
    );
  };

  const renderAnnexValuesPlain = (a) => renderAnnexValuesInline(a);

  const renderMainValues = (b, { showHouseNum } = { showHouseNum: true }) => {
    if (!b) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
        <div>{b.address || "　"}</div>
        {showHouseNum && b.houseNum ? (
          <div style={{ fontWeight: 'bold' }}>
            {name === "委任状（保存）" ? `家屋番号 ${b.houseNum}の建物` : b.houseNum}
          </div>
        ) : null}
        {name === "委任状（保存）" ? null : (
          <div>{(b.kind || "　")}{b.struct ? `　${b.struct}` : ""}</div>
        )}
        <div>{floorLine(b.floorAreas)}</div>
      </div>
    );
  };

  const renderAnnexValues = (a) => {
    if (!a) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', marginTop: '2mm' }}>
        <div style={{ fontWeight: 'bold' }}>{a.symbol || "無符号"}</div>
        {name === "委任状（保存）" ? null : (
          <div>{(a.kind || "　")}{a.struct ? `　${a.struct}` : ""}</div>
        )}
        <div>{floorLine(a.floorAreas)}</div>
      </div>
    );
  };

  const renderReasonLine = (b) => {
    if (!b) return "　";
    const hn = b.houseNum ? `${b.houseNum} ` : "";
    const cause = b.registrationCause || "　";
    const date = formatWareki(b.registrationDate);
    return `${hn}${cause}　${date}`;
  };

  const targetContractor = useMemo(() => {
    const list = (siteData?.people || []).filter(p => (p.roles || []).includes("工事人"));
    if (pick.targetContractorPersonId) {
      return list.find(p => p.id === pick.targetContractorPersonId) || list[0] || null;
    }
    return list[0] || null;
  }, [siteData.people, pick.targetContractorPersonId]);

  const targetProp = useMemo(() => {
    if (!pick.targetPropBuildingId) return sortedProp[0] || null;
    return sortedProp.find(b => b.id === pick.targetPropBuildingId) || sortedProp[0] || null;
  }, [sortedProp, pick.targetPropBuildingId]);

  const hasMultipleApplicants = (applicants || []).length >= 2;

  const formatApplicantLine = (p) => {
    const parts = [];
    parts.push(p?.address || "　");
    if (hasMultipleApplicants) parts.push(p?.share || "　");
    parts.push(p?.name || "　");
    return parts.join("　");
  };

  // ---- 工事完了引渡証明書（表題） ----
  if (name === "工事完了引渡証明書（表題）") {
    if (!targetProp) return <div className="p-10 text-center font-bold text-black">申請建物データがありません</div>;
    const currentYearReiwa = String(new Date().getFullYear() - 2018);

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif', padding: DOC_PAGE_PADDING }}>
        <div className="stamp-area">
          {(applicants || []).map((_, i) => {
            const pos = (pick.stampPositions || []).find(p => p.i === i) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-${i}`} index={i} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })}
        </div>

        <h1 style={{ fontSize: '20pt', fontWeight: 'bold', textAlign: 'center', marginBottom: '10mm' }}>
          工事完了引渡証明書
        </h1>

        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {(pick.showMain ?? true) && renderMainValuesInline(targetProp, { showHouseNum: false })}
            {(pick.showAnnex ?? true) && (targetProp.annexes || []).map(a => (
              <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
            ))}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            <p style={{ margin: '0' }}>{formatWareki(targetProp.registrationDate)}　{targetProp.registrationCause || "　"}</p>
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {(applicants || []).map(p => (
              <p key={p.id} style={{ margin: '0 0 2mm 0' }}>
                {formatApplicantLine(p)}
              </p>
            ))}
          </div>

          <p style={{ fontSize: '11pt', marginBottom: '10mm', textIndent: '1em' }}>
            上記のとおり工事を完了して引渡したものであることを証明します。
          </p>

          <div style={{ textAlign: 'left', fontSize: '12pt', marginBottom: '10mm' }}>
            <p>令和{currentYearReiwa}年　　月　　日</p>
          </div>
          <h2 style={{ fontSize: '11pt', margin: '0 0 2mm 0', fontWeight: 'bold' }}>工事人</h2>

          <div style={{ marginTop: '5mm', position: 'relative' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 26.6mm', alignItems: 'center' }}>
              <div style={{ fontSize: '12pt' }}>
                <p style={{ margin: '0 0 2mm 0' }}>{targetContractor?.address || "　"}</p>
                <p style={{ margin: '0 0 2mm 0' }}>{targetContractor?.name || "　"}</p>
                <p style={{ margin: '0' }}>{targetContractor?.representative || "　"}</p>
              </div>
              <div style={{ position: 'relative', width: '26.6mm', height: '26.6mm' }}>
                <DraggableSignerStamp
                  index={0}
                  dx={(pick.signerStampPositions?.[0]?.dx || 0)}
                  dy={(pick.signerStampPositions?.[0]?.dy || 0)}
                  editable={!isPrint}
                  onChange={onSignerStampPosChange}
                />
              </div>
            </div>
          </div>
        </EditableDocBody>
      </div>
    );
  }

  // ---- 委任状系（書類ごとにテンプレ分割） ----
  const getLegacyWorkText = () => {
    return (siteData?.name || "").includes("登記") ? siteData.name : "建物表題登記";
  };

  const renderDelegationCommon = ({
    docNoBold = false,
    workText,
    buildingTitle = "建物の表示",
    buildingBlock,
    dateBlock,
    topRightBlock,
  }) => {
    return (
      <div
        className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold"
        style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}
      >
        <div className="stamp-area">
          {(applicants || []).map((_, i) => {
            const pos = (pick.stampPositions || []).find(p => p.i === i) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-${i}`} index={i} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })}
        </div>

        <h1
          style={{
            fontSize: '24pt', fontWeight: 'bold', textAlign: 'center',
            letterSpacing: '10mm', margin: '0', position: 'absolute',
            left: '0', right: '0', top: '40mm'
          }}
        >
          委任状
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box' }}>
          <EditableDocBody
            editable={!isPrint}
            customHtml={pick.customText}
            onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
          >
            <div style={{ textAlign: 'right', fontSize: '11pt', marginTop: '36mm', marginBottom: '5mm' }}>
              {topRightBlock ?? (
                useLinkedScrivenerOnTopRight ? (
                  <>
                    <p style={{ margin: '0' }}>{linkedScrivenerAddrLine}</p>
                    <p style={{ margin: '0' }}>{linkedScrivenerNameLine}</p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: '0' }}>射水市善光寺27番1号　土地家屋調査士　塩谷信泰</p>
                    <p style={{ margin: '0' }}>射水市善光寺27番1号　土地家屋調査士　塩谷一真</p>
                  </>
                )
              )}
            </div>

            <p style={{ fontSize: '11pt', marginBottom: '10mm', textIndent: '1em' }}>
              {name === "委任状（保存）"
                ? DEFAULT_DELEGATION_TEXT_SAVE
                : name === "委任状（住所変更）"
                  ? DEFAULT_DELEGATION_TEXT_ADDRESS_CHANGE
                  : DEFAULT_DELEGATION_TEXT}
            </p>

            <div style={{ fontSize: '11pt', marginBottom: '10mm', fontWeight: 'bold' }}>
              {workText}
            </div>

            <div style={{ marginTop: '-5mm' }}>
              <h2 style={{ fontSize: '11pt', margin: '0', fontWeight: 'bold' }}>{buildingTitle}</h2>
              <div style={{ fontSize: '11pt', marginBottom: '10mm' }}>
                {buildingBlock}
              </div>
            </div>

            <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
              {dateBlock ?? formatTodayDateBlock()}
            </div>

            <h2 style={{ fontSize: '11pt', margin: '2mm 0 1mm 0', fontWeight: 'bold' }}>委任者</h2>

            <div style={{ fontSize: '11pt', marginTop: '0mm' }}>
              {(applicants || []).map((p, i) => {
                const pos = getSignerPos(i);
                return (
                  <div
                    key={p.id || i}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 26.6mm',
                      alignItems: 'center', margin: '0 0 2mm 0'
                    }}
                  >
                    <div>{formatApplicantLine(p)}</div>
                    <div style={{ position: 'relative', width: '26.6mm', height: '26.6mm' }}>
                      <DraggableSignerStamp
                        index={i} dx={pos.dx} dy={pos.dy}
                        editable={!isPrint} onChange={onSignerStampPosChange}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </EditableDocBody>
        </div>
      </div>
    );
  };

  // ---- 各テンプレ（独立した形のまま） ----

  const DelegationTitleTemplate = () => {
    const workText =
      (targetProp)
        ? `${formatWareki(targetProp.registrationDate)}${targetProp.registrationCause || ""}したので建物表題登記`
        : getLegacyWorkText();

    const buildingBlock = targetProp ? (
      <div style={{ marginBottom: '6mm' }}>
        {(pick.showMain ?? true) && renderMainValuesInline(targetProp, { showHouseNum: false })}
        {(pick.showAnnex ?? true) && (targetProp.annexes || []).map(a => (
          <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
        ))}
      </div>
    ) : (
      <div>　</div>
    );

    const dateBlock = (
      <p style={{ margin: '0 0 1mm 0' }}>
        {formatTodayDateBlock()}
      </p>
    );

    return renderDelegationCommon({ docNoBold: true, workText, buildingBlock, dateBlock });
  };

  const buildCommonBuildingBlock = () => {
    return (sortedProp || []).map(b => (
      <div key={b.id} style={{ marginBottom: '6mm' }}>
        {(pick.showMain ?? true) && renderMainValues(b, { showHouseNum: true })}
        {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
          <div key={a.id}>{renderAnnexValues(a)}</div>
        ))}
      </div>
    ));
  };

  const buildCommonDateBlock = () => (
    <>
      {formatTodayDateBlock()}
    </>
  );

  const DelegationSaveTemplate = () => {
    const b = (typeof targetProp !== "undefined" && targetProp) ? targetProp : (sortedProp?.[0] || null);
    const workText = "登記の目的　所有権保存登記";

    const buildingBlock = b ? (
      <div style={{ marginBottom: '6mm' }}>
        {(pick.showMain ?? true) && renderMainValues(b, { showHouseNum: true })}
        {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
          <div key={a.id}>{renderAnnexValues(a)}</div>
        ))}
      </div>
    ) : (
      <div>　</div>
    );

    return renderDelegationCommon({ docNoBold: false, workText, buildingBlock });
  };

  const DelegationLandCategoryChangeTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DelegationLossTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DelegationTitleChangeTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DelegationAddressChangeTemplate = () => {
    const workText = (
      <>
        <div style={{ whiteSpace: 'pre-wrap' }}>
             登 記 の 目 的　　　所有権登記名義人住所変更
        </div>
        <div>原　　　　　因</div>
        <div>変更すべき事項</div>
        <div>　</div>
        <div>　</div>
      </>
    );

    const landBlock = (selectedLand || []).length ? (
      <div style={{ marginBottom: '6mm' }}>
        {(selectedLand || []).map((l, idx) => (
          <div key={l.id || idx} style={{ marginBottom: '4mm', whiteSpace: 'pre-wrap' }}>
            <div>
              {(l.address || "　")}
              {""}
              {(l.lotNumber || "　")}
              {"　"}
              {(l.category || "　")}
              {"　"}
              {`${l.area || "　"}㎡`}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div>　</div>
    );

    return renderDelegationCommon({
      docNoBold: false, workText,
      buildingTitle: "物件の表示", buildingBlock: landBlock,
      dateBlock: buildCommonDateBlock(),
    });
  };

  const DelegationTitleCorrectionTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DelegationMergeTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DelegationSplitTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DelegationCombineTemplate = () =>
    renderDelegationCommon({
      docNoBold: false, workText: getLegacyWorkText(),
      buildingBlock: buildCommonBuildingBlock(), dateBlock: buildCommonDateBlock(),
    });

  const DELEGATION_TEMPLATES = {
    "委任状（表題）": DelegationTitleTemplate,
    "委任状（保存）": DelegationSaveTemplate,
    "委任状（地目変更）": DelegationLandCategoryChangeTemplate,
    "委任状（滅失）": DelegationLossTemplate,
    "委任状（表題部変更）": DelegationTitleChangeTemplate,
    "委任状（住所変更）": DelegationAddressChangeTemplate,
    "委任状（表題部更正）": DelegationTitleCorrectionTemplate,
    "委任状（合併）": DelegationMergeTemplate,
    "委任状（分割）": DelegationSplitTemplate,
    "委任状（合体）": DelegationCombineTemplate,
  };

  if (DELEGATION_TEMPLATES[name]) {
    return DELEGATION_TEMPLATES[name]();
  }

  // ==========================
  // 申述書系（共有 / 単独）
  // ==========================

  const renderStatementCommon = ({ titleText, defaultBody }) => {
    const hasMultipleStatementPeople = (statementPeople || []).length >= 2;
    const formatStatementLine = (p) => {
      const parts = [];
      parts.push(p?.address || "　");
      if (hasMultipleStatementPeople) parts.push(p?.share || "　");
      parts.push(p?.name || "　");
      return parts.join("　");
    };

    const buildingBlock = targetProp ? (
      <div style={{ marginBottom: "6mm" }}>
        {(pick.showMain ?? true) && renderMainValuesInline(targetProp, { showHouseNum: false })}
        {(pick.showAnnex ?? true) &&
          (targetProp.annexes || []).map((a) => <div key={a.id}>{renderAnnexValuesPlain(a)}</div>)}
      </div>
    ) : (
      <div>　</div>
    );

    return (
      <div
        className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold"
        style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif', padding: DOC_PAGE_PADDING }}
      >
        <h1 style={{ fontSize: "24pt", fontWeight: "bold", textAlign: "center", margin: "0 0 8mm 0" }}>
          {titleText}
        </h1>

        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <div style={{ textAlign: "right", fontSize: "11pt", margin: "0 0 6mm 0" }}>
            {formatTodayDateBlock()}
          </div>

          <h2 style={{ fontSize: "11pt", margin: "0 0 2mm 0", fontWeight: "bold" }}>建物の表示</h2>
          <div style={{ fontSize: "11pt", marginBottom: "8mm" }}>{buildingBlock}</div>

          <div style={{ fontSize: "11pt", marginBottom: "8mm" }}>
            <div>確認済証の番号{"\u3000\u3000\u3000\u3000\u3000\u3000\u3000"}{targetProp?.confirmationCert ? formatConfirmationCertLine(targetProp.confirmationCert) : "\u3000"}</div>
            <div>確認済証記載の建築主名義</div>
            {((siteData.people || []).filter(p => (p.roles || []).includes("建築申請人")).length > 0)
              ? (siteData.people || []).filter(p => (p.roles || []).includes("建築申請人")).map(p => (
                  <div key={p.id} style={{ paddingLeft: "14em" }}>{p.name || "\u3000"}</div>
                ))
              : <div style={{ paddingLeft: "14em" }}>{"\u3000"}</div>
            }
          </div>

          <div style={{ fontSize: "11pt", marginBottom: "8mm", whiteSpace: "pre-wrap" }}>
            {defaultBody}
          </div>

          <h2 style={{ fontSize: "11pt", margin: "2mm 0 1mm 0", fontWeight: "bold" }}>申述人</h2>

          <div style={{ fontSize: "11pt", marginTop: "0mm" }}>
            {(statementPeople || []).map((p, i) => {
              const pos = getSignerPos(i);
              return (
                <div
                  key={p.id || i}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr 26.6mm",
                    alignItems: "center", margin: "0 0 2mm 0",
                  }}
                >
                  <div>{formatStatementLine(p)}</div>
                  <div style={{ position: "relative", width: "26.6mm", height: "26.6mm" }}>
                    <DraggableSignerStamp
                      index={i} dx={pos.dx} dy={pos.dy}
                      editable={!isPrint} onChange={onSignerStampPosChange}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </EditableDocBody>
      </div>
    );
  };

  if (name === "申述書（共有）") {
    return renderStatementCommon({
      titleText: "申　述　書",
      defaultBody: "上記の建物は下記の通りの持分であることを証明します。",
    });
  }

  if (name === "申述書（単独）") {
    const selected = (allApplicants || []).find(p => p.id === (pick?.statementApplicantPersonId || "")) || null;
    const who = selected?.name || "［申請人］";
    const body =
      `上記の建物は${who}が単独で全額出資したものです。\n` +
      `従って${who}の単独名義での表題登記を申請することに対し異議ありません。`;

    return renderStatementCommon({
      titleText: "申　述　書",
      defaultBody: body,
    });
  }

  return (
    <div className="p-10 text-center font-bold text-black">
      未対応の書類テンプレです：{name}
    </div>
  );
};
