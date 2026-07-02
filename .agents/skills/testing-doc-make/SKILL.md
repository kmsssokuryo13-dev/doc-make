---
name: testing-doc-make
description: Test the doc-make document generation app end-to-end. Use when verifying document template changes, formatting, or new fields in delegation/application documents.
---

# Testing doc-make Application

## Prerequisites
- Node.js installed
- Run `npm install` in the repo root
- Start dev server: `npm run dev` (serves at `http://localhost:5173/doc-make/`)

## App Structure
- **Editor view** (`/`): Left sidebar with site list, main area with tabs: 土地情報, 既登記建物, 申請建物, 関係人
- **Docs view** (`/docs?siteId=X`): 3-step wizard: 1) 申請選択 (select registration type), 2) 書類選定 (select documents), 3) 書類作成 (preview/print)

## Testing Document Templates

### Setting Up Test Data
1. Navigate to the Editor view
2. Create or select a site (現場) from the left sidebar
3. Go to 関係人 tab to add/edit people (申請人)
4. Fill in required fields: 住所 (address), 氏名 (name)
5. Optional fields: 代表者 (representative), ふりがな (furigana), 持分 (share)
6. Ensure at least one 申請建物 (proposed building) exists with an address

### Generating Documents
1. Click the "作成" button next to the site name in the sidebar
2. Step 1: Click "+" next to the desired registration type (e.g., 建物表題登記)
3. Select the target building and applicant(s)
4. Click "次へ進む" to go to Step 2
5. Step 2: Click "+" next to the desired document types (e.g., 委任状（表題）, 委任状（保存）)
6. Click "次へ進む" to go to Step 3
7. Step 3: Click document names in the left panel to preview each

### Document Format Types
- **Single-line format** (e.g., 委任状（表題）): Signer shown as `住所　氏名` on one line
- **Multi-line format** (e.g., 委任状（保存）, 委任状（住所変更）): Signer shown with labeled fields: `住　　所　...`, `氏　　名　...`

### Key Things to Verify
- Document content renders correctly in the preview
- Alignment of text fields (Japanese text alignment uses full-width spaces)
- Conditional fields only appear when data is present (e.g., 代表者 only shows when filled)
- Both single-line and multi-line format templates render correctly
- Changes to person data in Editor immediately reflect in Docs view (state is shared via React)

## Tips
- The app uses localStorage to persist state; data survives page refreshes
- The sample site "令和7年表題登記サンプル案件" might already exist with pre-filled data
- When testing formatting changes, compare both with and without the field filled (regression test)
- Document templates are defined in `DocTemplate.jsx` — the main rendering file
- The `APPLICATION_TO_DOCS` mapping determines which document types are available for each registration type

## Devin Secrets Needed
None required — the app runs entirely locally with no external services.
