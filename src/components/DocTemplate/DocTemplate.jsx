import React, { useMemo } from 'react';
import {
  toFullWidthDigits, naturalSortList, formatWareki, getSelectedScrivener,
  formatConfirmationCertLine, formatShare
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
    const stripWS= (s) =>
      (s ?? "").toString().replace(/[\s\u3000\u00A0\u2000-\u200B\u202F\u205F\uFEFF]/g, "");
    const era = stripWS(d.era);
    const year = stripWS(d.year);
    const y = year || "　";
    return toFullWidthDigits(`${era}${y}年　　月　　日`);
  };

  const floorLine = (floorAreas) => {
    if (name === "委任状（保存）") return "";
    const arr = Array.isArray(floorAreas) ? floorAreas : [];
    const filtered = arr.filter(fa => stripAllWS(fa.area));
    if (filtered.length === 0) return "";
    const isSingleGround = filtered.length === 1 && (filtered[0].floor === "１階" || filtered[0].floor === "1階");
    if (isSingleGround) return `${filtered[0].area}㎡`;
    return filtered.map(fa => `${fa.floor} ${fa.area}㎡`).join("  ");
  };

  const stripAllWS = (s) =>
    (s ?? "").toString().replace(/[\s\u3000\u00A0\u2000-\u200B\u202F\u205F\uFEFF]/g, "");

  const formatSymbolPrefix = (rawSymbol) => {
    const sym = stripAllWS(rawSymbol);
    if (!sym) return "";
    if (sym === "主") return `主　　`;
    if (sym.startsWith("符")) return `${sym}　`;
    return `符${sym}　`;
  };

  const getMainSymbolPrefix = (b) => {
    const explicit = stripAllWS(b?.symbol);
    const hasAnnexWithContent = (b?.annexes || []).some(a => {
      const sym = stripAllWS(a?.symbol);
      const hasContent = stripAllWS(a?.kind) || stripAllWS(a?.struct) || (a?.floorAreas || []).some(fa => stripAllWS(fa?.area));
      return sym && hasContent;
    });
    const sym = explicit || (hasAnnexWithContent ? "主" : "");
    return formatSymbolPrefix(sym);
  };

  const floorLineInline = (floorAreas) => {
    const arr = Array.isArray(floorAreas) ? floorAreas : [];
    const filtered = arr.filter(fa => stripAllWS(fa.area));
    if (filtered.length === 0) return "";
    const isSingleGround = filtered.length === 1 && (filtered[0].floor === "１階" || filtered[0].floor === "1階");
    if (isSingleGround) return `${filtered[0].area}㎡`;
    return filtered.map(fa => `${fa.floor} ${fa.area}㎡`).join("　");
  };

  const buildKindStructAreaLine = (symbolPrefix, kind, struct, floorAreas) => {
    if (name === "委任状（保存）") {
      const sym = symbolPrefix || "";
      return sym ? `${sym}` : "　";
    }
    const k = kind || "　";
    const areas = floorLineInline(floorAreas);
    const parts = [symbolPrefix + k];
    if (stripAllWS(struct)) parts.push(struct);
    if (areas) parts.push(areas);
    return parts.join("　");
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

  const isAnnexEmpty = (a) => {
    if (!a) return true;
    const hasKind = stripAllWS(a.kind);
    const hasStruct = stripAllWS(a.struct);
    const hasArea = (a.floorAreas || []).some(fa => stripAllWS(fa.area));
    return !hasKind && !hasStruct && !hasArea;
  };

  const renderAnnexValuesInline = (a) => {
    if (!a || isAnnexEmpty(a)) return null;
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
    if (!a || isAnnexEmpty(a)) return null;
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
    const date = formatWareki(b.registrationDate, b.additionalUnknownDate);
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
    if (hasMultipleApplicants) parts.push(formatShare(p?.share));
    parts.push(p?.name || "　");
    return parts.join("　");
  };

  // ---- 工事完了引渡証明書（表題） ----
  if (name === "工事完了引渡証明書（表題）") {
    if (!targetProp) return <div className="p-10 text-center font-bold text-black">申請建物データがありません</div>;
    const currentYearReiwa = String(new Date().getFullYear() - 2018);

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}>
        <div className="stamp-area">
          {(() => {
            const pos = (pick.stampPositions || []).find(p => p.i === 0) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-0`} index={0} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })()}
        </div>

        <h1
          style={{
            fontSize: '20pt', fontWeight: 'bold', textAlign: 'center',
            margin: '0', position: 'absolute', left: '0', right: '0', top: '40mm'
          }}
        >
          工事完了引渡証明書
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal', marginTop: '36mm' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {(pick.showMain ?? true) && renderMainValuesInline(targetProp, { showHouseNum: false })}
            {(pick.showAnnex ?? true) && (targetProp.annexes || []).map(a => (
              <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
            ))}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            <p style={{ margin: '0' }}>{formatWareki(targetProp.registrationDate, targetProp.additionalUnknownDate)}　{targetProp.registrationCause || "　"}</p>
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {(applicants || []).map(p => (
              <p key={p.id} style={{ margin: '0 0 2mm 0' }}>
                {formatApplicantLine(p)}
              </p>
            ))}
          </div>

          <p style={{ fontSize: '11pt', marginBottom: '10mm' }}>
            上記のとおり工事を完了して引渡したものであることを証明します。
          </p>

          <div style={{ textAlign: 'left', fontSize: '12pt', marginBottom: '10mm' }}>
            <p>令和{toFullWidthDigits(currentYearReiwa)}年　　月　　日</p>
          </div>
          <h2 style={{ fontSize: '11pt', margin: '0 0 2mm 0', fontWeight: 'bold' }}>工事人</h2>

          {targetContractor ? (
          <div style={{ position: 'relative', width: 'fit-content', marginTop: '5mm' }}>
            <div style={{ fontSize: '12pt', paddingRight: 'calc(1em + 26.6mm)' }}>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.address || "　"}</p>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.name || "　"}</p>
              <p style={{ margin: '0' }}>{targetContractor.representative || "　"}</p>
            </div>
            <div contentEditable={false} style={{ position: 'absolute', top: 0, right: 0 }}>
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
          ) : (
          <div contentEditable={false} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5mm' }}>
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
          )}
        </EditableDocBody>
        </div>
      </div>
    );
  }

  // ---- 工事完了引渡証明書（表題部変更） ----
  if (name === "工事完了引渡証明書（表題部変更）") {
    const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
    const beforeBuildings = (() => {
      if (pick.targetBeforeBuildingId) {
        const found = sortedBuildings.find(b => b.id === pick.targetBeforeBuildingId);
        return found ? [found] : sortedBuildings;
      }
      return sortedBuildings;
    })();
    const propsToUse = targetProp ? [targetProp] : sortedProp;
    const currentYearReiwa = String(new Date().getFullYear() - 2018);

    const hasAnyAnnexes = beforeBuildings.some(b => (b.annexes || []).length > 0)
      || propsToUse.some(b => (b.annexes || []).length > 0);

    const allCauseEntries = [];
    propsToUse.forEach(b => {
      const mainPrefix = hasAnyAnnexes ? "主である建物" : "";
      if (b.registrationCause) {
        allCauseEntries.push({ id: `${b.id}_main`, date: formatWareki(b.registrationDate, b.additionalUnknownDate), cause: b.registrationCause, prefix: mainPrefix });
      }
      (b.additionalCauses || []).forEach(ac => {
        if (ac.cause) {
          allCauseEntries.push({ id: ac.id, date: formatWareki(ac.date), cause: ac.cause, prefix: mainPrefix });
        }
      });
      (b.annexes || []).forEach(a => {
        const sym = stripAllWS(a.symbol);
        const annexPrefix = sym ? `符号${sym}の附属建物` : "附属建物";
        if (a.registrationCause) {
          allCauseEntries.push({ id: `${a.id}_main`, date: formatWareki(a.registrationDate, a.additionalUnknownDate), cause: a.registrationCause, prefix: annexPrefix });
        }
        (a.additionalCauses || []).forEach(ac => {
          if (ac.cause) {
            allCauseEntries.push({ id: ac.id, date: formatWareki(ac.date), cause: ac.cause, prefix: annexPrefix });
          }
        });
      });
    });
    const selectedCauseIds = pick?.selectedCauseIds;
    const filteredCauses = selectedCauseIds == null
      ? allCauseEntries
      : allCauseEntries.filter(c => selectedCauseIds.includes(c.id));

    const renderBldgForChange = (b) => {
      if (!b) return null;
      const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
          <div>{b.address || "　"}</div>
          {b.houseNum ? <div>家屋番号　{b.houseNum}</div> : null}
          <div>{line}</div>
        </div>
      );
    };

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}>
        <div className="stamp-area">
          {(() => {
            const pos = (pick.stampPositions || []).find(p => p.i === 0) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-0`} index={0} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })()}
        </div>

        <h1
          style={{
            fontSize: '20pt', fontWeight: 'bold', textAlign: 'center',
            margin: '0', position: 'absolute', left: '0', right: '0', top: '40mm'
          }}
        >
          工事完了引渡証明書
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal', marginTop: '36mm' }}>建物の表示</h2>
          <h3 style={{ fontSize: '11pt', margin: '2mm 0 0 0', fontWeight: 'bold' }}>変更前</h3>
          <div style={{ fontSize: '11pt', marginBottom: '4mm' }}>
            {beforeBuildings.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                {(pick.showMain ?? true) && renderBldgForChange(b)}
                {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                  <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
                ))}
              </div>
            ))}
            {beforeBuildings.length === 0 && <div>　</div>}
          </div>
          <h3 style={{ fontSize: '11pt', margin: '0', fontWeight: 'bold' }}>変更後</h3>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {propsToUse.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                {(pick.showMain ?? true) && renderBldgForChange(b)}
                {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                  <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
                ))}
              </div>
            ))}
            {propsToUse.length === 0 && <div>　</div>}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>原因日付及び原因</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {filteredCauses.length > 0 ? filteredCauses.map(c => (
              <p key={c.id} style={{ margin: '0' }}>{c.date}{c.prefix}{c.cause}</p>
            )) : <p style={{ margin: '0' }}>　</p>}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>所有者の住所氏名</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {(applicants || []).map(p => (
              <p key={p.id} style={{ margin: '0 0 2mm 0' }}>
                {formatApplicantLine(p)}
              </p>
            ))}
          </div>

          <p style={{ fontSize: '11pt', marginBottom: '10mm' }}>
            上記のとおり工事を完了して引渡したものであることを証明します。
          </p>

          <div style={{ textAlign: 'left', fontSize: '12pt', marginBottom: '10mm' }}>
            <p>令和{toFullWidthDigits(currentYearReiwa)}年　　月　　日</p>
          </div>
          <h2 style={{ fontSize: '11pt', margin: '0 0 2mm 0', fontWeight: 'bold' }}>工事人</h2>

          {targetContractor ? (
          <div style={{ position: 'relative', width: 'fit-content', marginTop: '5mm' }}>
            <div style={{ fontSize: '12pt', paddingRight: 'calc(1em + 26.6mm)' }}>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.address || "　"}</p>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.name || "　"}</p>
              <p style={{ margin: '0' }}>{targetContractor.representative || "　"}</p>
            </div>
            <div contentEditable={false} style={{ position: 'absolute', top: 0, right: 0 }}>
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
          ) : (
          <div contentEditable={false} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5mm' }}>
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
          )}
        </EditableDocBody>
        </div>
      </div>
    );
  }

  // ---- 滅失証明書（滅失） ----
  if (name === "滅失証明書（滅失）") {
    const lossIds = Array.isArray(pick?.lossBuildingIds) ? pick.lossBuildingIds : [];
    const allLossBuildings = (sortedProp || []).filter(pb => { const c = pb.registrationCause || ""; return c.includes("取壊し") || c.includes("焼失") || c.includes("倒壊"); });
    const selectedLossBuildings = lossIds.length > 0
      ? allLossBuildings.filter(pb => new Set(lossIds).has(pb.id))
      : allLossBuildings;
    const buildings = selectedLossBuildings.length > 0 ? selectedLossBuildings : allLossBuildings;

    const ownerCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("建物所有者") || (p.roles || []).includes("申請人"));
    const ownerIds = Array.isArray(pick?.lossCertOwnerIds) ? pick.lossCertOwnerIds : [];
    const defaultOwners = ownerCandidates.filter(p => (p.roles || []).includes("建物所有者"));
    const owners = ownerIds.length > 0
      ? ownerCandidates.filter(p => new Set(ownerIds).has(p.id))
      : defaultOwners;
    const displayOwners = owners.length > 0 ? owners : defaultOwners;

    const dates = buildings.map(b => formatWareki(b.registrationDate, b.additionalUnknownDate)).filter(Boolean);
    const uniqueDates = [...new Set(dates)];
    const causeDate = uniqueDates[0] || formatWareki(targetProp?.registrationDate, targetProp?.additionalUnknownDate) || "令和　年　月　日";

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}>
        <div className="stamp-area">
          {(() => {
            const pos = (pick.stampPositions || []).find(p => p.i === 0) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-0`} index={0} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })()}
        </div>

        <h1
          style={{
            fontSize: '20pt', fontWeight: 'bold', textAlign: 'center',
            margin: '0', position: 'absolute', left: '0', right: '0', top: '40mm'
          }}
        >
          建物取壊し証明書
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal', marginTop: '36mm' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {buildings.length > 0 ? buildings.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
                  <div>{b.address || "　"}</div>
                  {b.houseNum ? (
                    <div style={{ fontWeight: 'bold' }}>家屋番号　{b.houseNum}</div>
                  ) : null}
                  <div>{buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas)}</div>
                </div>
                {(b.annexes || []).filter(a => !isAnnexEmpty(a)).map(a => (
                  <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', marginTop: '2mm' }}>
                                        <div>{buildKindStructAreaLine(formatSymbolPrefix(a.symbol), a.kind, a.struct, a.floorAreas)}</div>
                  </div>
                ))}
              </div>
            )) : <div>　</div>}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>取壊しの事由及び年月日</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            <p style={{ margin: '0' }}>{causeDate}取壊し</p>
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>所有者の住所氏名</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {displayOwners.length > 0 ? displayOwners.map(p => (
              <p key={p.id} style={{ margin: '0 0 2mm 0' }}>
                {p.address || "　"}　{p.name || "　"}
              </p>
            )) : <div>　</div>}
          </div>

          <p style={{ fontSize: '11pt', marginBottom: '10mm' }}>
            上記のとおり建物を滅失したことを証明します。
          </p>

          <div style={{ textAlign: 'left', fontSize: '12pt', marginBottom: '10mm' }}>
            <p>{formatTodayDateBlock()}</p>
          </div>

          <h2 style={{ fontSize: '11pt', margin: '0 0 2mm 0', fontWeight: 'bold' }}>工事人</h2>

          {targetContractor ? (
          <div style={{ position: 'relative', width: 'fit-content', marginTop: '5mm' }}>
            <div style={{ fontSize: '12pt', paddingRight: 'calc(1em + 26.6mm)' }}>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.address || "　"}</p>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.name || "　"}</p>
              <p style={{ margin: '0' }}>{targetContractor.representative || "　"}</p>
            </div>
            <div contentEditable={false} style={{ position: 'absolute', top: 0, right: 0 }}>
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
          ) : (
          <div contentEditable={false} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5mm' }}>
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
          )}
        </EditableDocBody>
        </div>
      </div>
    );
  }

  // ---- 滅失証明書（表題部変更） ----
  if (name === "滅失証明書（表題部変更）") {
    const sortedBuildings_loss = naturalSortList(siteData.buildings || [], 'houseNum');
    const beforeBuildings_loss = (() => {
      if (pick.targetBeforeBuildingId) {
        const found = sortedBuildings_loss.find(b => b.id === pick.targetBeforeBuildingId);
        return found ? [found] : sortedBuildings_loss;
      }
      return sortedBuildings_loss;
    })();
    const lossIds = Array.isArray(pick?.lossBuildingIds) ? pick.lossBuildingIds : [];
    const allLossBuildings = (sortedProp || []).filter(pb => { const c = pb.registrationCause || ""; return c.includes("取壊し") || c.includes("焼失") || c.includes("倒壊"); });
    const selectedLoss = lossIds.length > 0
      ? allLossBuildings.filter(pb => new Set(lossIds).has(pb.id))
      : allLossBuildings;
    const buildings = selectedLoss.length > 0 ? selectedLoss : allLossBuildings;

    const hasAnyAnnexes_loss= beforeBuildings_loss.some(b => (b.annexes || []).length > 0)
      || buildings.some(b => (b.annexes || []).length > 0);

    const ownerCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("建物所有者") || (p.roles || []).includes("申請人"));
    const ownerIds = Array.isArray(pick?.lossCertOwnerIds) ? pick.lossCertOwnerIds : [];
    const defaultOwners = ownerCandidates.filter(p => (p.roles || []).includes("建物所有者"));
    const owners = ownerIds.length > 0
      ? ownerCandidates.filter(p => new Set(ownerIds).has(p.id))
      : defaultOwners;
    const displayOwners = owners.length > 0 ? owners : defaultOwners;

    const lossCauseEntries = [];
    buildings.forEach(b => {
      const mainPrefix = hasAnyAnnexes_loss ? "主である建物" : "";
      if (b.registrationCause) {
        lossCauseEntries.push({ date: formatWareki(b.registrationDate, b.additionalUnknownDate), cause: b.registrationCause, prefix: mainPrefix });
      }
      (b.annexes || []).forEach(a => {
        const sym = stripAllWS(a.symbol);
        const annexPrefix = sym ? `符号${sym}の附属建物` : "附属建物";
        if (a.registrationCause) {
          lossCauseEntries.push({ date: formatWareki(a.registrationDate, a.additionalUnknownDate), cause: a.registrationCause, prefix: annexPrefix });
        }
      });
    });
    const fallbackDate = formatWareki(targetProp?.registrationDate, targetProp?.additionalUnknownDate) || "令和　年　月　日";

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}>
        <div className="stamp-area">
          {(() => {
            const pos = (pick.stampPositions || []).find(p => p.i === 0) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-0`} index={0} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })()}
        </div>

        <h1
          style={{
            fontSize: '20pt', fontWeight: 'bold', textAlign: 'center',
            margin: '0', position: 'absolute', left: '0', right: '0', top: '40mm'
          }}
        >
          建物取壊し証明書
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal', marginTop: '36mm' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {buildings.length > 0 ? buildings.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
                  <div>{b.address || "　"}</div>
                  {b.houseNum ? (
                    <div style={{ fontWeight: 'bold' }}>家屋番号　{b.houseNum}</div>
                  ) : null}
                  <div>{buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas)}</div>
                </div>
                {(b.annexes || []).filter(a => !isAnnexEmpty(a)).map(a => (
                  <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', marginTop: '2mm' }}>
                                        <div>{buildKindStructAreaLine(formatSymbolPrefix(a.symbol), a.kind, a.struct, a.floorAreas)}</div>
                  </div>
                ))}
              </div>
            )) : <div>　</div>}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>取壊しの事由及び年月日</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {lossCauseEntries.length > 0 ? lossCauseEntries.map((c, i) => (
              <p key={i} style={{ margin: '0' }}>{c.date}{c.prefix}{c.cause}</p>
            )) : <p style={{ margin: '0' }}>{fallbackDate}取壊し</p>}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>所有者の住所氏名</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            {displayOwners.length > 0 ? displayOwners.map(p => (
              <p key={p.id} style={{ margin: '0 0 2mm 0' }}>
                {p.address || "　"}　{p.name || "　"}
              </p>
            )) : <div>　</div>}
          </div>

          <p style={{ fontSize: '11pt', marginBottom: '10mm' }}>
            上記のとおり建物を滅失したことを証明します。
          </p>

          <div style={{ textAlign: 'left', fontSize: '12pt', marginBottom: '10mm' }}>
            <p>{formatTodayDateBlock()}</p>
          </div>

          <h2 style={{ fontSize: '11pt', margin: '0 0 2mm 0', fontWeight: 'bold' }}>工事人</h2>

          {targetContractor ? (
          <div style={{ position: 'relative', width: 'fit-content', marginTop: '5mm' }}>
            <div style={{ fontSize: '12pt', paddingRight: 'calc(1em + 26.6mm)' }}>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.address || "　"}</p>
              <p style={{ margin: '0 0 2mm 0' }}>{targetContractor.name || "　"}</p>
              <p style={{ margin: '0' }}>{targetContractor.representative || "　"}</p>
            </div>
            <div contentEditable={false} style={{ position: 'absolute', top: 0, right: 0 }}>
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
          ) : (
          <div contentEditable={false} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5mm' }}>
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
          )}
        </EditableDocBody>
        </div>
      </div>
    );
  }

  // ---- 非登載証明書 ----
  if (name === "非登載証明書") {
    const lossIds = Array.isArray(pick?.lossBuildingIds) ? pick.lossBuildingIds : [];
    const allLossBuildings = (sortedProp || []).filter(pb => { const c = pb.registrationCause || ""; return c.includes("取壊し") || c.includes("焼失") || c.includes("倒壊"); });
    const ntrSelectedBuildings= lossIds.length > 0
      ? allLossBuildings.filter(pb => new Set(lossIds).has(pb.id))
      : allLossBuildings;
    const ntrBuildings = ntrSelectedBuildings.length > 0 ? ntrSelectedBuildings : allLossBuildings;

    const ntrOwnerCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("建物所有者") || (p.roles || []).includes("申請人"));
    const ntrOwnerIds = Array.isArray(pick?.lossCertOwnerIds) ? pick.lossCertOwnerIds : [];
    const ntrDefaultOwners = ntrOwnerCandidates.filter(p => (p.roles || []).includes("建物所有者"));
    const ntrOwners = ntrOwnerIds.length > 0
      ? ntrOwnerCandidates.filter(p => new Set(ntrOwnerIds).has(p.id))
      : ntrDefaultOwners;
    const ntrDisplayOwners = ntrOwners.length > 0 ? ntrOwners : ntrDefaultOwners;

    const getMayorTitle = () => {
      const addr = ntrBuildings[0]?.address || siteData?.address || "";
      const noPref = addr.replace(/^.+?[都道府県]/, "");
      const cityMatch = noPref.match(/^(.+?市)/);
      if (cityMatch) return `${cityMatch[1]}長`;
      const gunMatch = noPref.match(/^.+?郡(.+?[町村])/);
      if (gunMatch) return `${gunMatch[1]}長`;
      const townMatch = noPref.match(/^(.+?[町村])/);
      if (townMatch) return `${townMatch[1]}長`;
      return "　　長";
    };

    const w = getWarekiNow();
    const currentYear = toFullWidthDigits(w.year);

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}>
        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h1
            style={{
              fontSize: '20pt', fontWeight: 'bold', textAlign: 'center',
              margin: '0 0 8mm 0', letterSpacing: '0.5em'
            }}
          >
            証　明　願
          </h1>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '12pt', marginBottom: '2mm' }}>
            <div>{getMayorTitle()}　殿</div>
            <div>{formatTodayDateBlock()}</div>
          </div>

          <p style={{ fontSize: '11pt', marginBottom: '8mm' }}>
            下記物件は令和{currentYear}年度の固定資産課税台帳に登載されていないことを証明願います。
          </p>

          <div style={{ fontSize: '11pt', marginBottom: '6mm' }}>
            <div style={{ display: 'flex', gap: '4mm' }}>
              <span>使用目的</span>
              <span>管轄法務局へ建物滅失登記申請のため</span>
            </div>
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm', minHeight: '30mm', paddingLeft: '4mm' }}>
            {ntrBuildings.length > 0 ? ntrBuildings.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
                  <div>{b.address || "　"}</div>
                  {b.houseNum ? (
                    <div style={{ fontWeight: 'bold' }}>家屋番号　{b.houseNum}</div>
                  ) : null}
                  <div>{buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas)}</div>
                </div>
                {(b.annexes || []).filter(a => !isAnnexEmpty(a)).map(a => (
                  <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', marginTop: '2mm' }}>
                    <div>{buildKindStructAreaLine(formatSymbolPrefix(a.symbol), a.kind, a.struct, a.floorAreas)}</div>
                  </div>
                ))}
              </div>
            )) : <div>　</div>}
          </div>

          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal' }}>所有者</h2>
          <div style={{ fontSize: '11pt', marginBottom: '8mm', paddingLeft: '4mm' }}>
            {ntrDisplayOwners.length > 0 ? ntrDisplayOwners.map(p => (
              <p key={p.id} style={{ margin: '0 0 2mm 0' }}>
                {p.address || "　"}　{p.name || "　"}
              </p>
            )) : <div>　</div>}
          </div>

          <div style={{ textAlign: 'right', fontSize: '12pt', marginTop: 'auto' }}>
            <p style={{ margin: '0 0 2mm 0' }}>{linkedScrivener?.address || "　"}</p>
            <p style={{ margin: '0' }}>土地家屋調査士　{linkedScrivener?.name || "　"}</p>
          </div>
        </EditableDocBody>
        </div>
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
    buildingSubTitle,
    buildingBlock,
    dateBlock,
    topRightBlock,
    signerList,
  }) => {
    const signers = signerList || applicants || [];
    return (
      <div
        className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold"
        style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}
      >
        <div className="stamp-area">
          {signers.map((_, i) => {
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

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
          <div style={{ position: 'relative' }}>
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
                {buildingSubTitle && <h3 style={{ fontSize: '11pt', margin: '2mm 0 0 0', fontWeight: 'bold' }}>{buildingSubTitle}</h3>}
                <div style={{ fontSize: '11pt', marginBottom: '10mm' }}>
                  {buildingBlock}
                </div>
              </div>

              <div style={{ fontSize: '11pt', marginBottom: '8mm' }}>
                {dateBlock ?? formatTodayDateBlock()}
              </div>

              <h2 style={{ fontSize: '11pt', margin: '2mm 0 1mm 0', fontWeight: 'bold' }}>委任者</h2>
              <div style={{ fontSize: '11pt' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2mm', paddingRight: 'calc(1em + 26.6mm)' }}>
                  {signers.map((p, i) => (
                    <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', minHeight: '26.6mm' }}>{formatApplicantLine(p)}</div>
                  ))}
                </div>
              </div>
            </EditableDocBody>
            <div style={{ position: 'absolute', bottom: 0, right: 0, display: 'flex', flexDirection: 'column', gap: '2mm', pointerEvents: 'auto' }}>
              {signers.map((p, i) => {
                const pos = getSignerPos(i);
                return (
                  <div key={p.id || i} style={{ position: 'relative', width: '26.6mm', height: '26.6mm' }}>
                    <DraggableSignerStamp
                      index={i} dx={pos.dx} dy={pos.dy}
                      editable={!isPrint} onChange={onSignerStampPosChange}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---- 各テンプレ（独立した形のまま） ----

  const DelegationTitleTemplate = () => {
    const workText =
      (targetProp)
        ? `${formatWareki(targetProp.registrationDate, targetProp.additionalUnknownDate)}${targetProp.registrationCause || ""}したので建物表題登記`
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

  const DelegationLandCategoryChangeTemplate = () => {
    const changedLands = (selectedLand || []).filter(l => l.categoryChangeEnabled);
    const newCategories = [...new Set(changedLands.map(l => l.newCategory || "").filter(Boolean))];
    const categoryText = newCategories.join("・") || "　";

    const workText = `${formatWareki(targetProp?.registrationDate, targetProp?.additionalUnknownDate)}${categoryText}に変更したので土地地目変更登記`;

    const beforeLands = changedLands.length > 0 ? changedLands : (selectedLand || []);
    const afterLands = changedLands;

    const buildingBlock = (
      <div>
        <div style={{ marginBottom: '4mm' }}>
          {beforeLands.map((l, idx) => (
            <div key={l.id || idx} style={{ whiteSpace: 'pre-wrap' }}>
              <div>
                {(l.address || "　")}
                {(l.lotNumber || "　")}
                {"　"}
                {(l.category || "　")}
                {"　"}
                {`${l.area || "　"}㎡`}
              </div>
            </div>
          ))}
        </div>

        {afterLands.length > 0 && (
          <>
            <h3 style={{ fontSize: '11pt', margin: '4mm 0 0 0', fontWeight: 'bold' }}>変更後</h3>
            <div style={{ marginBottom: '4mm' }}>
              {afterLands.map((l, idx) => (
                <div key={l.id || idx} style={{ whiteSpace: 'pre-wrap' }}>
                  <div>
                    {(l.address || "　")}
                    {(l.lotNumber || "　")}
                    {"　"}
                    {(l.newCategory || "　")}
                    {"　"}
                    {`${l.newArea || "　"}㎡`}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );

    const landCategorySigners = (() => {
      const allCandidates = (siteData?.people || []).filter(p => {
        const roles = p?.roles || [];
        return roles.includes("土地所有者") || roles.includes("申請人");
      });
      const ids = Array.isArray(pick?.applicantPersonIds) ? pick.applicantPersonIds : [];
      if (!ids.length) {
        return allCandidates.filter(p => (p.roles || []).includes("土地所有者"));
      }
      const set = new Set(ids);
      const filtered = allCandidates.filter(p => set.has(p.id));
      return filtered.length ? filtered : allCandidates.filter(p => (p.roles || []).includes("土地所有者"));
    })();

    return renderDelegationCommon({
      docNoBold: false, workText,
      buildingTitle: "土地の表示", buildingSubTitle: "変更前", buildingBlock,
      dateBlock: buildCommonDateBlock(),
      signerList: landCategorySigners,
    });
  };

  const DelegationLossTemplate = () => {
    const lossIds = Array.isArray(pick?.lossBuildingIds) ? pick.lossBuildingIds : [];
    const allLossBuildings = (sortedProp || []).filter(pb => { const c = pb.registrationCause || ""; return c.includes("取壊し") || c.includes("焼失") || c.includes("倒壊"); });
    const selectedLoss = lossIds.length > 0
      ? allLossBuildings.filter(pb => new Set(lossIds).has(pb.id))
      : allLossBuildings;
    const buildings = selectedLoss.length > 0 ? selectedLoss : allLossBuildings;

    const dates= buildings.map(b => formatWareki(b.registrationDate, b.additionalUnknownDate)).filter(Boolean);
    const uniqueDates = [...new Set(dates)];
    const dateText = uniqueDates.join("・") || formatWareki(targetProp?.registrationDate, targetProp?.additionalUnknownDate) || "";
    const workText = `${dateText}取壊したので建物滅失登記`;

    const buildingBlock = buildings.length > 0 ? buildings.map(b => (
      <div key={b.id} style={{ marginBottom: '6mm' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
          <div>{b.address || "　"}</div>
          {b.houseNum ? (
            <div style={{ fontWeight: 'bold' }}>家屋番号　{b.houseNum}</div>
          ) : null}
          <div>{buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas)}</div>
        </div>
        {(b.annexes || []).filter(a => !isAnnexEmpty(a)).map(a => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm', marginTop: '2mm' }}>
            <div>{buildKindStructAreaLine(formatSymbolPrefix(a.symbol), a.kind, a.struct, a.floorAreas)}</div>
          </div>
        ))}
      </div>
    )) : <div>　</div>;

    const lossSigners = (() => {
      const allCandidates = (siteData?.people || []).filter(p => {
        const roles = p?.roles || [];
        return roles.includes("建物所有者") || roles.includes("申請人");
      });
      const ids = Array.isArray(pick?.applicantPersonIds) ? pick.applicantPersonIds : [];
      if (!ids.length) {
        return allCandidates.filter(p => (p.roles || []).includes("建物所有者"));
      }
      const set = new Set(ids);
      const filtered = allCandidates.filter(p => set.has(p.id));
      return filtered.length ? filtered : allCandidates.filter(p => (p.roles || []).includes("建物所有者"));
    })();

    return renderDelegationCommon({
      docNoBold: false, workText,
      buildingBlock, dateBlock: buildCommonDateBlock(),
      signerList: lossSigners,
    });
  };

  const DelegationTitleChangeTemplate = () => {
    const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
    const beforeBuildings = (() => {
      if (pick.targetBeforeBuildingId) {
        const found = sortedBuildings.find(b => b.id === pick.targetBeforeBuildingId);
        return found ? [found] : sortedBuildings;
      }
      return sortedBuildings;
    })();
    const propsToUse = targetProp ? [targetProp] : sortedProp;

    const hasAnyAnnexes = beforeBuildings.some(b => (b.annexes || []).length > 0)
      || propsToUse.some(b => (b.annexes || []).length > 0);

    const causeEntries = [];
    for (const b of propsToUse) {
      const mainPrefix = hasAnyAnnexes ? "主である建物" : "";
      if (b.registrationCause) {
        causeEntries.push({
          date: formatWareki(b.registrationDate, b.additionalUnknownDate),
          cause: b.registrationCause,
          prefix: mainPrefix,
        });
      }
      for (const ac of (b.additionalCauses || [])) {
        if (ac.cause) {
          causeEntries.push({
            date: formatWareki(ac.date),
            cause: ac.cause,
            prefix: mainPrefix,
          });
        }
      }
      for (const a of (b.annexes || [])) {
        const sym = stripAllWS(a.symbol);
        const annexPrefix = sym ? `符号${sym}の附属建物` : "附属建物";
        if (a.registrationCause) {
          causeEntries.push({
            date: formatWareki(a.registrationDate, a.additionalUnknownDate),
            cause: a.registrationCause,
            prefix: annexPrefix,
          });
        }
        for (const ac of (a.additionalCauses || [])) {
          if (ac.cause) {
            causeEntries.push({
              date: formatWareki(ac.date),
              cause: ac.cause,
              prefix: annexPrefix,
            });
          }
        }
      }
    }

    const uniqueCauses = [];
    const seenKeys = new Set();
    for (const entry of causeEntries) {
      const key = `${entry.date}|${entry.prefix}|${entry.cause}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueCauses.push(entry);
      }
    }

    const workText = uniqueCauses.length > 0 ? (
      <>
        {uniqueCauses.map((cl, i) => (
          <div key={i}>
            {cl.date}{cl.prefix}{cl.cause}
            {i === uniqueCauses.length - 1 ? "したので建物表題部変更登記" : "、"}
          </div>
        ))}
      </>
    ) : "建物表題部変更登記";

    const renderBuildingForChange = (b) => {
      if (!b) return null;
      const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
          <div>{b.address || "　"}</div>
          {b.houseNum ? <div>家屋番号　{b.houseNum}</div> : null}
          <div>{line}</div>
        </div>
      );
    };

    const buildingBlock = (
      <div>
        <div style={{ marginBottom: '6mm' }}>
          {beforeBuildings.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {beforeBuildings.length === 0 && <div>　</div>}
        </div>
        <h3 style={{ fontSize: '11pt', margin: '4mm 0 0 0', fontWeight: 'bold' }}>変更後</h3>
        <div style={{ marginBottom: '6mm' }}>
          {propsToUse.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {propsToUse.length === 0 && <div>　</div>}
        </div>
      </div>
    );

    return renderDelegationCommon({
      docNoBold: false,
      workText,
      buildingTitle: "建物の表示",
      buildingSubTitle: "変更前",
      buildingBlock,
      dateBlock: buildCommonDateBlock(),
    });
  };

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

    const DelegationTitleCorrectionTemplate = () => {
      const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
      const beforeBuildings = (() => {
        if (pick.targetBeforeBuildingId) {
          const found = sortedBuildings.find(b => b.id === pick.targetBeforeBuildingId);
          return found ? [found] : sortedBuildings;
        }
        return sortedBuildings;
      })();
      const propsToUse = targetProp ? [targetProp] : sortedProp;

      const renderBuildingForChange = (b) => {
        if (!b) return null;
        const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
            <div>{b.address || "　"}</div>
            {b.houseNum ? <div>家屋番号　{b.houseNum}</div> : null}
            <div>{line}</div>
          </div>
        );
      };

      const buildingBlock = (
        <div>
          <div style={{ marginBottom: '6mm' }}>
            {beforeBuildings.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                {(pick.showMain ?? true) && renderBuildingForChange(b)}
                {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                  <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
                ))}
              </div>
            ))}
            {beforeBuildings.length === 0 && <div>　</div>}
          </div>
          <h3 style={{ fontSize: '11pt', margin: '4mm 0 0 0', fontWeight: 'bold' }}>更正後</h3>
          <div style={{ marginBottom: '6mm' }}>
            {propsToUse.map(b => (
              <div key={b.id} style={{ marginBottom: '4mm' }}>
                {(pick.showMain ?? true) && renderBuildingForChange(b)}
                {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                  <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
                ))}
              </div>
            ))}
            {propsToUse.length === 0 && <div>　</div>}
          </div>
        </div>
      );

      return renderDelegationCommon({
        docNoBold: false,
        workText: "錯誤により建物表題部更正登記",
        buildingTitle: "建物の表示",
        buildingSubTitle: "更正前",
        buildingBlock,
        dateBlock: buildCommonDateBlock(),
      });
  };

  const DelegationMergeTemplate = () => {
    const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
    const mergeIds = Array.isArray(pick.mergeBeforeBuildingIds) ? pick.mergeBeforeBuildingIds : [];
    const beforeBuildings = mergeIds.length > 0
      ? sortedBuildings.filter(b => mergeIds.includes(b.id))
      : sortedBuildings;
    const propsToUse = targetProp ? [targetProp] : sortedProp;

    const renderBuildingForChange = (b) => {
      if (!b) return null;
      const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
          <div>{b.address || "　"}</div>
          {b.houseNum ? <div>家屋番号　{b.houseNum}</div> : null}
          <div>{line}</div>
        </div>
      );
    };

    const buildingBlock = (
      <div>
        <div style={{ marginBottom: '6mm' }}>
          {beforeBuildings.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {beforeBuildings.length === 0 && <div>　</div>}
        </div>
        <h3 style={{ fontSize: '11pt', margin: '4mm 0 0 0', fontWeight: 'bold' }}>合併後</h3>
        <div style={{ marginBottom: '6mm' }}>
          {propsToUse.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {propsToUse.length === 0 && <div>　</div>}
        </div>
      </div>
    );

    return renderDelegationCommon({
      docNoBold: false,
      workText: "建物合併登記",
      buildingTitle: "建物の表示",
      buildingSubTitle: "合併前",
      buildingBlock,
      dateBlock: buildCommonDateBlock(),
    });
  };

  const DelegationSplitTemplate = () => {
    const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
    const beforeBuildings = (() => {
      if (pick.targetBeforeBuildingId) {
        const found = sortedBuildings.find(b => b.id === pick.targetBeforeBuildingId);
        return found ? [found] : sortedBuildings;
      }
      return sortedBuildings;
    })();
    const splitAfterIds = Array.isArray(pick.splitAfterBuildingIds) ? pick.splitAfterBuildingIds : [];
    const propsToUse = splitAfterIds.length > 0
      ? sortedProp.filter(b => splitAfterIds.includes(b.id))
      : sortedProp;

    const renderBuildingForChange = (b) => {
      if (!b) return null;
      const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
          <div>{b.address || "　"}</div>
          {b.houseNum ? <div>家屋番号　{b.houseNum}</div> : null}
          <div>{line}</div>
        </div>
      );
    };

    const buildingBlock = (
      <div>
        <div style={{ marginBottom: '6mm' }}>
          {beforeBuildings.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {beforeBuildings.length === 0 && <div>　</div>}
        </div>
        <h3 style={{ fontSize: '11pt', margin: '4mm 0 0 0', fontWeight: 'bold' }}>分割後</h3>
        <div style={{ marginBottom: '6mm' }}>
          {propsToUse.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {propsToUse.length === 0 && <div>　</div>}
        </div>
      </div>
    );

    return renderDelegationCommon({
      docNoBold: false,
      workText: "建物分割登記",
      buildingTitle: "建物の表示",
      buildingSubTitle: "分割前",
      buildingBlock,
      dateBlock: buildCommonDateBlock(),
    });
  };

  const DelegationCombineTemplate = () => {
    const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
    const combineIds = Array.isArray(pick.combineBeforeBuildingIds) ? pick.combineBeforeBuildingIds : [];
    const beforeBuildings = combineIds.length > 0
      ? sortedBuildings.filter(b => combineIds.includes(b.id))
      : sortedBuildings;
    const propsToUse = targetProp ? [targetProp] : sortedProp;

    const combinePurpose = pick.combinePurpose || "combineOnly";
    const suffix = combinePurpose === "combineAndPreserve"
      ? "したので\n合体による建物の表題登記及び合体前の建物の表題部登記の抹消並びに所有権の保存の登記"
      : "したので\n合体による建物の表題登記及び合体前の建物の表題部登記の抹消";

    const houseNumList = beforeBuildings
      .map(b => b.houseNum || "")
      .filter(h => h)
      .map(h => `家屋番号${h}`)
      .join("と");

    const causeEntries = [];
    for (const b of propsToUse) {
      if (b.registrationCause) {
        causeEntries.push({
          date: formatWareki(b.registrationDate, b.additionalUnknownDate),
          cause: b.registrationCause,
        });
      }
    }

    const workText = (() => {
      if (causeEntries.length === 0 && !houseNumList) {
        return combinePurpose === "combineAndPreserve"
          ? "合体による建物の表題登記及び合体前の建物の表題部登記の抹消並びに所有権の保存の登記"
          : "合体による建物の表題登記及び合体前の建物の表題部登記の抹消";
      }
      const parts = [];
      for (const entry of causeEntries) {
        if (entry.date) parts.push(entry.date);
      }
      if (houseNumList) parts.push(houseNumList + "を");
      for (const entry of causeEntries) {
        if (entry.cause) parts.push(entry.cause);
      }
      const mainText = parts.join("");
      return (
        <div style={{ whiteSpace: 'pre-wrap' }}>{mainText}{suffix}</div>
      );
    })();

    const renderBuildingForChange = (b) => {
      if (!b) return null;
      const line = buildKindStructAreaLine(getMainSymbolPrefix(b), b.kind, b.struct, b.floorAreas);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
          <div>{b.address || "　"}</div>
          {b.houseNum ? <div>家屋番号　{b.houseNum}</div> : null}
          <div>{line}</div>
        </div>
      );
    };

    const buildingBlock = (
      <div>
        <div style={{ marginBottom: '6mm' }}>
          {beforeBuildings.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {beforeBuildings.length === 0 && <div>　</div>}
        </div>
        <h3 style={{ fontSize: '11pt', margin: '4mm 0 0 0', fontWeight: 'bold' }}>合体後</h3>
        <div style={{ marginBottom: '6mm' }}>
          {propsToUse.map(b => (
            <div key={b.id} style={{ marginBottom: '4mm' }}>
              {(pick.showMain ?? true) && renderBuildingForChange(b)}
              {(pick.showAnnex ?? true) && (b.annexes || []).map(a => (
                <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
              ))}
            </div>
          ))}
          {propsToUse.length === 0 && <div>　</div>}
        </div>
      </div>
    );

    return renderDelegationCommon({
      docNoBold: false,
      workText,
      buildingTitle: "建物の表示",
      buildingSubTitle: "合体前",
      buildingBlock,
      dateBlock: buildCommonDateBlock(),
    });
  };

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
      if (hasMultipleStatementPeople) parts.push(formatShare(p?.share));
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
        style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}
      >
        <div className="stamp-area">
          {(statementPeople || []).map((_, i) => {
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
                  {titleText}
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
          <div style={{ position: 'relative' }}>
            <EditableDocBody
              editable={!isPrint}
              customHtml={pick.customText}
              onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
            >
              <h2 style={{ fontSize: "11pt", margin: "0", fontWeight: "bold", marginTop: '36mm', marginBottom: '2mm' }}>建物の表示</h2>
              <div style={{ fontSize: "11pt", marginBottom: "8mm" }}>{buildingBlock}</div>

              <div style={{ fontSize: "11pt", marginBottom: "8mm" }}>
                <div>確認済証の番号{"\u3000\u3000\u3000\u3000\u3000\u3000\u3000"}{targetProp?.confirmationCert ? formatConfirmationCertLine(targetProp.confirmationCert) : "\u3000"}</div>
                <div>確認済証記載の建築主名義</div>
                {(() => {
                  const confirmIds = Array.isArray(pick?.confirmApplicantPersonIds) ? pick.confirmApplicantPersonIds : [];
                  const people = siteData.people || [];
                  const selected = confirmIds.length > 0
                    ? people.filter(p => confirmIds.includes(p.id))
                    : people.filter(p => (p.roles || []).includes("建築申請人"));
                  return selected.length > 0
                    ? selected.map(p => <div key={p.id} style={{ paddingLeft: "15.2em" }}>{p.name || "\u3000"}</div>)
                    : <div style={{ paddingLeft: "15.2em" }}>{"\u3000"}</div>;
                })()}
              </div>

              <div style={{ fontSize: "11pt", marginBottom: "8mm", whiteSpace: "pre-wrap" }}>
                {defaultBody}
              </div>

              <div style={{ textAlign: "left", fontSize: "11pt", margin: "0 0 6mm 0" }}>
                {formatTodayDateBlock()}
              </div>

              <h2 style={{ fontSize: "11pt", margin: "2mm 0 1mm 0", fontWeight: "bold" }}>申述人</h2>
              <div style={{ fontSize: "11pt" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2mm", paddingRight: "calc(1em + 26.6mm)" }}>
                  {(statementPeople || []).map((p, i) => (
                    <div key={p.id || i} style={{ display: "flex", alignItems: "center", minHeight: "26.6mm" }}>{formatStatementLine(p)}</div>
                  ))}
                </div>
              </div>
            </EditableDocBody>
            <div style={{ position: 'absolute', bottom: 0, right: 0, display: 'flex', flexDirection: 'column', gap: '2mm', pointerEvents: 'auto' }}>
              {(statementPeople || []).map((p, i) => {
                const pos = getSignerPos(i);
                return (
                  <div key={p.id || i} style={{ position: 'relative', width: '26.6mm', height: '26.6mm' }}>
                    <DraggableSignerStamp
                      index={i} dx={pos.dx} dy={pos.dy}
                      editable={!isPrint} onChange={onSignerStampPosChange}
                    />
                  </div>
                );
              })}
            </div>
          </div>
      </div>
      </div>
    );
  };

  // ---- 売渡証明書 ----
  if (name === "売渡証明書") {
    const saleBuildingSource = pick?.saleBuildingSource || "proposed";
    const sortedBuildings = naturalSortList(siteData.buildings || [], 'houseNum');
    const saleBuilding = (() => {
      if (saleBuildingSource === "registered") {
        if (pick.targetBeforeBuildingId) {
          return sortedBuildings.find(b => b.id === pick.targetBeforeBuildingId) || sortedBuildings[0] || null;
        }
        return sortedBuildings[0] || null;
      }
      return targetProp;
    })();

    const saleBuyerIds = Array.isArray(pick?.applicantPersonIds) ? pick.applicantPersonIds : [];
    const saleBuyers = saleBuyerIds.length > 0
      ? allApplicants.filter(p => new Set(saleBuyerIds).has(p.id))
      : allApplicants;
    const displayBuyers = saleBuyers.length > 0 ? saleBuyers : allApplicants;

    const sellerCandidates = (siteData?.people || []).filter(p => (p.roles || []).includes("その他"));
    const sellerIds = Array.isArray(pick?.saleSellerPersonIds) ? pick.saleSellerPersonIds : [];
    const displaySellers = sellerIds.length > 0
      ? sellerCandidates.filter(p => new Set(sellerIds).has(p.id))
      : sellerCandidates;

    const currentYearReiwa = String(new Date().getFullYear() - 2018);
    const w = getWarekiNow();

    const buyerText = displayBuyers.map(p => `${p.address || "　"}　${p.name || "　"}様`).join("、");

    return (
      <div className="doc-content flex flex-col h-full text-black font-serif relative doc-no-bold" style={{ fontFamily: '"MS Mincho","ＭＳ 明朝",serif' }}>
        <div className="stamp-area">
          {(() => {
            const pos = (pick.stampPositions || []).find(p => p.i === 0) || { dx: 0, dy: 0 };
            return <DraggableStamp key={`topstamp-0`} index={0} dx={pos.dx} dy={pos.dy} editable={!isPrint} onChange={onStampPosChange} />;
          })()}
        </div>

        <h1
          style={{
            fontSize: '20pt', fontWeight: 'bold', textAlign: 'center',
            letterSpacing: '0.5em', margin: '0', position: 'absolute', left: '0', right: '0', top: '40mm'
          }}
        >
          売渡証明書
        </h1>

        <div style={{ position: 'absolute', inset: 0, padding: DOC_PAGE_PADDING, boxSizing: 'border-box', pointerEvents: 'none' }}>
        <EditableDocBody
          editable={!isPrint}
          customHtml={pick.customText}
          onCustomHtmlChange={(html) => onPickChange?.({ customText: html })}
        >
          <h2 style={{ fontSize: '12pt', margin: '0', fontWeight: 'normal', marginTop: '36mm' }}>建物の表示</h2>
          <div style={{ fontSize: '11pt', marginBottom: '4mm' }}>
            {saleBuilding ? (
              <>
                {(pick.showMain ?? true) && renderMainValuesInline(saleBuilding, { showHouseNum: false })}
                {(pick.showAnnex ?? true) && (saleBuilding.annexes || []).map(a => (
                  <div key={a.id}>{renderAnnexValuesPlain(a)}</div>
                ))}
              </>
            ) : <div>　</div>}
          </div>
          <div style={{ textAlign: 'right', fontSize: '11pt', marginBottom: '12mm' }}>以下余白</div>

          <p style={{ fontSize: '11pt', marginBottom: '12mm' }}>
            上記建物につき、{toFullWidthDigits(`${w.era}`)}　　年　　月　　日に{buyerText}へ売渡したことを証明します。
          </p>

          <div style={{ textAlign: 'left', fontSize: '12pt', marginBottom: '6mm' }}>
            <p>{toFullWidthDigits(`${w.era}${currentYearReiwa}年　　月　　日`)}</p>
          </div>

          <div style={{ fontSize: '11pt', marginTop: '6mm' }}>
            {displaySellers.length > 0 ? displaySellers.map((p, i) => (
              <div key={p.id} style={{ position: 'relative', width: 'fit-content', marginTop: i > 0 ? '4mm' : '0' }}>
                <div style={{ fontSize: '12pt', paddingRight: 'calc(1em + 26.6mm)' }}>
                  <p style={{ margin: '0 0 2mm 0' }}>{p.address || "　"}</p>
                  <p style={{ margin: '0' }}>{p.name || "　"}</p>
                </div>
                <div contentEditable={false} style={{ position: 'absolute', top: 0, right: 0 }}>
                  <div style={{ position: 'relative', width: '26.6mm', height: '26.6mm' }}>
                    <DraggableSignerStamp
                      index={i}
                      dx={getSignerPos(i).dx}
                      dy={getSignerPos(i).dy}
                      editable={!isPrint}
                      onChange={onSignerStampPosChange}
                    />
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ position: 'relative', width: 'fit-content' }}>
                <div style={{ fontSize: '12pt', paddingRight: 'calc(1em + 26.6mm)' }}>
                  <p style={{ margin: '0 0 2mm 0' }}>　</p>
                  <p style={{ margin: '0' }}>　</p>
                </div>
                <div contentEditable={false} style={{ position: 'absolute', top: 0, right: 0 }}>
                  <div style={{ position: 'relative', width: '26.6mm', height: '26.6mm' }}>
                    <DraggableSignerStamp
                      index={0}
                      dx={getSignerPos(0).dx}
                      dy={getSignerPos(0).dy}
                      editable={!isPrint}
                      onChange={onSignerStampPosChange}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </EditableDocBody>
        </div>
      </div>
    );
  }

  if (name === "申述書（共有）") {
    return renderStatementCommon({
      titleText: "申述書",
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
      titleText: "申述書",
      defaultBody: body,
    });
  }

  return (
    <div className="p-10 text-center font-bold text-black">
      未対応の書類テンプレです：{name}
    </div>
  );
};
