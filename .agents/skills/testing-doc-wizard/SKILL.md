# Testing: Doc-Make Document Wizard

## Local Dev Server

- Run with `npm run dev` (Vite-based project)
- Default port is 5173, but may use next available port (e.g., 5174) if occupied
- When exposing externally, add hostname to `server.allowedHosts` in `vite.config.js` or set `server.allowedHosts: "all"`
- HMR works automatically - file changes are reflected without manual reload

## Navigating to Step 3 (Document Creation)

1. From main page, click "作成" on a site card to enter the Document Wizard
2. Step 1 (申請選択): Select application types, then click "次へ進む"
3. Step 2 (書類選定): Select documents to create, then click "次へ進む"
4. Step 3 (書類作成): Left sidebar shows document settings, right area shows document preview

## Testing Font Size Feature

- The font size dropdown is in the left sidebar under "文字サイズ（選択テキスト）"
- It applies font-size to selected text within contenteditable areas
- **Important**: Playwright's `select_option` action does NOT properly trigger React's synthetic `onChange` event on `<select>` elements. Instead, simulate the font-size application logic directly via JavaScript console:
  1. Select text using `createRange` + `setStart/setEnd` + `addRange`
  2. Save range to `window.__savedFontRange`
  3. Execute `document.execCommand('fontSize', false, '7')` to wrap text in `<font>` tags
  4. Replace `<font>` tags with `<span style="font-size: X%">` elements
  5. Dispatch `input` event on the contenteditable element
- Verify by checking DOM for `<span style="font-size: X%">` elements

## Testing Stamp Drag

- Stamp circles (hanko) are visible in the document preview
- They can be dragged to reposition
- If CSS transform scaling is used, drag calculations must divide by scale factor
- Current implementation has no CSS transform, so drag is 1:1 with mouse movement

## Known Issues & Workarounds

- **"文言をリセット" button**: Clears ALL custom text in the contenteditable area. If accidentally clicked, navigate back to the site list and re-enter the wizard to get fresh default content.
- **React event handling**: For testing React-controlled form elements (select, input), prefer JavaScript console simulation over Playwright's native select/type actions, as they may not trigger React's synthetic event system correctly.
- **contenteditable and execCommand**: `document.execCommand` is deprecated but widely supported. The app uses it for inline text formatting. When testing, verify that `<font>` tags are properly replaced with `<span>` elements.

## Devin Secrets Needed

No secrets are required for local testing of this app.
