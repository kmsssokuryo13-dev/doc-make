# Testing doc-make Application

## Overview
doc-make is a Vite + React application for creating Japanese real estate registration documents. It runs locally on port 5173/5174.

## Dev Server Setup
```bash
cd /home/ubuntu/repos/doc-make
npm run dev
# or: npx vite --host 0.0.0.0 --port 5173
```
The app is served at `http://localhost:5173/doc-make/` (note the `/doc-make/` base path).

If the default port is taken, Vite will auto-increment (5174, 5175, etc.). Check the terminal output for the actual port.

## Application Structure
The app has a sidebar (left) with site/project management and a main content area (right) with tabs:
- **土地情報** (Land Info) - Land entries with address (所在) and lot number (地番)
- **既登記建物** (Registered Buildings) - Existing building records
- **申請建物** (Application Buildings) - New building applications
- **関係人** (Related Persons) - Applicants and stakeholders

## Testing Patterns

### Adding Test Data
- **Land entries**: Go to 土地情報 tab → click 「筆を追加」 to add entries → fill in 所在 and 地番 fields
- **Building entries**: Go to 申請建物 tab → click 「物件を追加」 or 「土地から転記」

### Deleting Test Data
- Delete buttons appear on **hover** over entries. They are small red trash icons at the top-right of each card.
- The delete button may not have a stable `devinid`. Use coordinate-based clicking on the trash icon when hovering over the entry.
- For land entries, hover near the right edge of the entry card to reveal the delete button.

### Tab Navigation
Click the tab buttons at the top of the main content area. Tab buttons have icons and Japanese labels.

### Common Gotchas
- **Full-width characters**: The app uses full-width (全角) Japanese numerals for display (１、２、３). Input fields accept half-width but display full-width.
- **番→番地 conversion**: When land lot numbers are transferred to building addresses, 番 is converted to 番地 (but not if already 番地). The regex uses negative lookahead `/番(?!地)/`.
- **Modal behavior**: The land selection modal only appears when there are 2+ land entries. With 1 land, transfer happens immediately without a modal.
- **Button visibility**: The 「土地から転記」 button is conditionally rendered - it only appears when `site.land.length > 0` and the form is not in registration mode (`!isReg`).

### Sample Test Data Setup
For testing the 土地から転記 feature with multiple lands across different addresses:
1. Go to 土地情報 tab
2. Add land: 所在=「富山市A町」, 地番=「１番」
3. Add land: 所在=「富山市B町」, 地番=「１番」  
4. Add land: 所在=「富山市A町」, 地番=「２番」

This creates a scenario with address grouping (2 addresses) and multiple lots per address.

## Devin Secrets Needed
None - the app runs fully locally without authentication.
