# 署名者印影の自動配置 — 全帳票棚卸し＋委任状2種の先行実装

- 対象仕様: AI-Brain `Decisions/2026-09-16-building-doc-signer-stamp-auto-alignment-by-rendered-line-width.md` (v1.3)
- 作業指示: AI-Brain `Projects/App-Ecosystem/building-doc-signer-stamp-pilot-task-packet-2026-09-16.md`
- 基点main: `bc17ce16ea80bfc7ab92c1b37486267fc6384afd`
- 今回有効化した帳票: **委任状（表題）／委任状（保存）の2種類のみ**

---

## 1. 全帳票の署名者印影 棚卸し

`DocTemplate.jsx` / `DraggableSignerStamp.jsx` / `EditableDocBody.jsx` / `Docs.jsx` を読み、
署名者印影（帳票上部の `DraggableStamp` ではない方）を持つ帳票を一覧化した。
コードベースの棚卸しを基本とし、先行2帳票のみ実ブラウザ描画でも照合した。

| 帳票 | 描画branch | 署名者の種類 | 通常行 | 追加行 | 複数人 | 印影位置の参照 | 今回 |
|---|---|---|---|---|---|---|---|
| 委任状（表題） | `renderDelegationCommon` + `formatApplicantLine` | 申請人 | 1行（住所＋持分＋氏名） | なし（※1） | 署名者ごとに1行＋印影1つ | `getSignerPos(i)`（`i`一致） | **先行対象** |
| 委任状（保存） | `renderDelegationCommon` + `renderSignerMultiLine` | 申請人 | 4行（住所／持分／ふりがな／氏名） | なし（※1） | 署名者ごとに4行＋印影1つ | `getSignerPos(i)` | **先行対象** |
| 委任状（住所変更） | `renderDelegationCommon` + `renderSignerMultiLine` | 申請人 | 4行（同上） | なし | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（地目変更） | `renderDelegationCommon`（既定renderer） | 土地所有者（未選択時） | 1行 | 被相続人/相続人で2行（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（滅失） | `renderDelegationCommon`（既定） | 申請人系 | 1行 | 同上（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（表題部変更） | `renderDelegationCommon`（既定） | 申請人 | 1行 | 同上（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（表題部更正） | `renderDelegationCommon`（既定） | 申請人 | 1行 | 同上（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（合併） | `renderDelegationCommon`（既定） | 申請人 | 1行 | 同上（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（分割） | `renderDelegationCommon`（既定） | 申請人 | 1行 | 同上（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 委任状（合体） | `renderDelegationCommon`（既定） | 申請人 | 1行 | 同上（※2） | 同上 | `getSignerPos(i)` | 後続 |
| 工事完了引渡証明書（表題） | 個別branch | 工事人（単独） | 3行（住所／氏名／代表者） | 代表者行は常時 | 単独のみ・印影1つ | `signerStampPositions?.[0]`（**配列index参照**・既知の不統一） | 後続 |
| 工事完了引渡証明書（表題部変更） | 個別branch | 工事人（単独） | 3行（同上） | 同上 | 単独 | `signerStampPositions?.[0]` | 後続 |
| 滅失証明書（滅失） | 個別branch | 工事人（単独） | 3行（同上） | 同上 | 単独 | `signerStampPositions?.[0]` | 後続 |
| 滅失証明書（表題部変更） | 個別branch | 工事人（単独） | 3行（同上） | 同上 | 単独 | `signerStampPositions?.[0]` | 後続 |
| 申述書（共有） | `renderStatementCommon` | 申述人 | 1行（住所＋持分＋氏名） | なし | 署名者ごとに1行＋印影1つ | `getSignerPos(i)` | 後続 |
| 申述書（単独） | `renderStatementCommon` | 申述人 | 1行（同上） | なし | 同上 | `getSignerPos(i)` | 後続 |
| 売渡証明書 | 個別branch | 売主 | 2行（住所／氏名） | なし | 売主ごとに2行＋印影1つ（0名時も1つ） | `getSignerPos(i)` | 後続 |
| 非登載証明書 | 個別branch | — | — | — | — | **署名者印影なし** | 対象外 |

※1 現在のmainの委任状テンプレートは、法人でも `representative`（代表者）行を描画していない。
「法人の追加行」は未merge branch `origin/devin/1782956322-delegation-representative` にのみ存在する。
本件では業務上の表示構成を変更しないため追加せず、**追加行が存在する場合に正しく比較できること**を
全文編集で行を追加した実描画で確認した（下記 P-AC02）。

※2 `renderOwnerWithDecedent` は `AFFECTED_BY_DECEDENT` の帳票かつ `decedentName` がある場合のみ
「被相続人／相続人」の2行になる。委任状（表題）・委任状（保存）はこのリストに含まれない。

### 棚卸しで確認できなかった点
- 法人の追加行の最終的な文言・行位置（未mergeのためmain上に存在しない）。
- 工事完了引渡証明書系4帳票の `signerStampPositions?.[0]` 参照は他帳票（`find(p => p.i === i)`）と不統一。
  単独署名者のみのため現状の実害は未確認。今回は変更していない。

---

## 2. 実装方式

### 共通処理
- `src/signerStampAlignment.js` … 対象帳票の判定・DOM計測・配置決定（純粋関数＋DOM読み取りのみ）
- `src/components/DocTemplate/useSignerStampAlignment.js` … 各DocTemplateインスタンスが
  「自分のDOMだけ」を計測して配置を決めるhook

### 計測（実表示右端）
署名欄コンテナ配下の**テキストノード単位**で `Range.getClientRects()` を取り、
幅0と空白だけの行を除いた全矩形の `right` の最大値を取る。

- 幅100%のブロックコンテナや、印影用に予約された `paddingRight: calc(1em + 26.6mm)` を
  文字の右端と誤認しない。
- 折返しは1テキストノードから複数矩形が返るため、別行を合算しない。
- 行頭が異なっても、印影列の `offsetParent`（`position:relative` コンテナ）左端を共通原点とするため
  「幅の最大値」ではなく「同一座標系の右端」で比較される。

### 余白G
署名欄コンテナ（`fontSize: 11pt` の div）の `getComputedStyle().fontSize` × 2。
内部の一部だけ拡縮された文字やふりがなでは基準を切り替えない。

### 配置
`Xauto = 最長行右端 + G` を印影列（全署名者共通）の `left` に適用する。
個々の `dx/dy` は従来どおり `DraggableSignerStamp` 側の `left/top` として加算されるため、
自動基準と手動補正が二重加算されない。縦位置・印影サイズ・上部印影は未変更。

---

## 3. 署名欄の識別・fallback・横幅不足

### 識別
- 署名欄コンテナに `data-signer-block="<templateKey>"`、各署名者行に `data-signer-row="<index>"` を付与。
- 値にtemplateKeyを入れるため、別帳票のHTMLを貼り付けた場合は一致せず判別不能になる。
- 目印は先行2帳票にだけ付き、対象外帳票のDOMは一切変わらない。
- `EditableDocBody` の非表示capture用DOMには `data-doc-capture` を付け、計測対象から除外する。

### 状態
| 状態 | 条件 | 配置 | 注意 |
|---|---|---|---|
| `measured` | 目印あり・計測可 | 実表示右端＋2em | なし |
| `empty` | 目印あり・署名者0名 | 従来の右端（印影自体が無い） | なし |
| `stored` | 判別不能・保存済み基準あり | 保存済み基準 | 判別不能 |
| `legacy-right` | 判別不能・基準なし | 従来の署名欄右端へ仮配置 | 判別不能 |
| （横幅不足） | 上記いずれかで `baseX + 印影幅 > 紙面幅` | 紙面内へclamp | 横幅不足 |

判別不能と横幅不足は別状態として別々の文言を出し、両方立つこともある。

### fallback基準の保存先
- pick key: `signerStampBaseRatio`（コンテナ幅に対する比率、小数5桁）
- v8側: `documentInstances[].layoutOverrides.signerStampBaseRatio`
  （`LAYOUT_OVERRIDE_KEYS` に追加。`selectionOverrides` 側には入らない）
- 書き込むのは `measured` のときだけ。判別不能中・0名時は上書きしない。
- 測定結果が同じなら書き込まない（保存ループ防止）。プレビュー中のinstanceKeyと一致する通知のみ受理し、
  印刷用DocTemplateには保存・通知のcallbackを渡さない。
- 位置リセット（`stampPositions` / `signerStampPositions` を null）では初期化しない。

### 横幅不足時の手修正導線
- 左パネルに非阻害の注意を表示（印刷本文へは混入しない）。
- 印影が紙面外へ出て操作不能にならないよう、**描画位置だけ**紙面内へclampする。
  これは自動で収めた成功状態ではなく、注意を出したうえで手修正へ回すための到達性の担保。
  自動縮小・追加強制改行・余白圧縮・省略は行わない。
- 注意の下にドラッグ／全文編集の案内を出し、対象4帳票では「レイアウト調整を開く」ボタンを添える。

---

## 4. 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/signerStampAlignment.js` | 新規。対象判定・目印・DOM計測・配置決定・注意文言 |
| `src/components/DocTemplate/useSignerStampAlignment.js` | 新規。計測タイミングと保存/通知の接続 |
| `src/components/DocTemplate/DocTemplate.jsx` | hook接続、委任状共通ブロックへ目印・ref・印影列のleft |
| `src/components/DocTemplate/EditableDocBody.jsx` | capture用DOMへ `data-doc-capture` |
| `src/components/Docs/Docs.jsx` | 基準保存/注意表示のハンドラ、左パネルの注意UI |
| `src/v8Compatibility.js` | `signerStampBaseRatio` を既定値とレイアウトキーへ追加 |
| `tests/signerStampAutoAlignment.test.mjs` | 新規（41件） |

## 5. 対象外（今回変更していない）
帳票上部印影、印影サイズ、縦位置ルール、本文の行構成、委任状（保存）の編集方式、
P1〜P4のUI、人物IDキー化、旧座標migration、工事完了引渡証明書の `[0]` 参照方式、
`esbuild` devDependency宣言、contentOverrides。

## 6. 既知の残件
- 極端に短い全文固定本文（実データでは想定しにくい）で、対象4帳票のread-only描画には
  contentEditable側の `min-h-[50mm]` が無いため、`bottom:0` の印影列が紙面上端より上に出て
  クリップされることがある。横位置は従来どおりで本件の変更とは無関係（対象外帳票でも同条件なら同じ）だが、
  縦位置は本件の変更対象外のため未修正。
