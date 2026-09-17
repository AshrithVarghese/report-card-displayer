# Report Card Displayer

Student Report Portal for Department of Computer Science and Engineering. Select a semester pill at the top, enter a roll number, and view/download the corresponding report page rendered from a semester PDF via `pdf.js`.

Live: `https://report-cse-jec.vercel.app` (Vercel) – serves `index.html` + `semesters/*.pdf` + static `config.json`/`semesters.json` with serverless fallbacks `api/semesters.js` & `api/config.js`. Local dev uses `node server.js`.

---

## 1. How The Platform Works

### 1.1 High-Level Flow
```
User selects semester pill → enters roll number → click View Report
  → Frontend resolves selected semester → validates roll against config → calculates PDF page → renders page via pdf.js → enables Download (PNG)
```

### 1.2 Architecture

| Layer | File | Role |
|-------|------|------|
| **Frontend** | `index.html` | Single-page app. Fetches semester list + config, renders pills, validates input, calculates page number, renders PDF to `<canvas>`. |
| **PDF Rendering** | `pdf.js@3.4.120` (CDN) | `pdfjsLib.getDocument(url).promise` → `pdf.getPage(n)` → `page.render(canvasContext)`. Hi-DPI handling via `devicePixelRatio * 2`. |
| **Local API Server** | `server.js` | Node `http` server (port 3000). Endpoints `GET /api/semesters`, `GET /api/config`, static serving of `semesters/*.pdf`, `*.html`, `*.json`, `*.png`. Auto-scans `semesters/` on every request. |
| **Vercel Serverless** | `api/semesters.js`, `api/config.js` | Same logic as `server.js` but as Vercel serverless functions (bundled at deploy time). Provide `GET /api/semesters` & `GET /api/config` on hosted site. |
| **Static Fallback** | `semesters.json`, `config.json` | `semesters.json` is a committed manifest (`[{name,file,url}]`). `index.html` uses `fetchJsonWithFallback(["/api/semesters","/semesters.json"])` and `["/api/config","/config.json"]`. Guarantees pills load even when `api/` returns 404 (e.g., pure static hosts). |
| **Config** | `config.json` | Defines per-semester `missingRolls` and `rollRanges`. See §2. |
| **Assets** | `semesters/*.pdf`, `jyothi_letter_head.png` | Semester PDFs (one PDF per semester/class). Letterhead displayed in header. |

### 1.3 Semester Pills
* Generated dynamically, **not hard-coded**.
* `server.js:getSemesterFiles()` / `api/semesters.js` scans `semesters/*.pdf` (+ root `*.pdf` fallback) → deduplicates case-insensitively → sorts numerically (`S3-B` before `S5-A` before `S5-B` before `S5-C`) → maps to `{ name: "S5-A", file: "S5-A.pdf", url: "semesters/S5-A.pdf" }`.
* Frontend `fetchSemesters()` → `renderPills()` creates `<button class="pill" data-file="S5-A.pdf">S5-A</button>`. Active pill gets `.active` (black). Auto-selects first entry.
* If both `/api/semesters` and `/semesters.json` fail, frontend derives pills from `config.json` keys (`rollRanges` + `missingRolls` union) as last resort.

### 1.4 Roll → Page Calculation (Core Logic)

Each PDF is a sequence of pages, one page per student roll number in that class. Gaps occur when a roll has no report (student left, etc.).

**Config defines:**
*   `rollRanges[SEM] = { start, end }` – valid global roll numbers contained in that PDF (inclusive).
*   `missingRolls[SEM] = [31, 112, ...]` – rolls within the range that have no page.

**Validation (in `index.html:openReport()`):**
```js
range = getRollRangeForSemester(selectedSemester) // e.g., S5-B: 64-129
missing = getMissingForSemester(selectedSemester) // e.g., [112]

if (range && roll < range.start)  →  showError("Report not available")
if (range && roll > range.end)    →  showError("Report not available")
if (missing.includes(roll))       →  showError("Report not available")
```

**Page Number Formula (`index.html:rollToPage`):**
```js
function rollToPage(roll, missingArr, range) {
  const start = range?.start ?? 1;
  let countBefore = 0;
  for (const m of missingArr) {
    if (m >= roll) break;                         // sorted
    if (range?.start != null && m < range.start) continue;
    if (range?.end != null && m > range.end) continue;
    if (m < roll) countBefore++;
  }
  return (roll - start + 1) - countBefore;
}
```
*Only counts missing rolls **within the range** and **< roll**.*

**Example – `config.json` current:**
```json
"S5-B": { "start": 64, "end": 129 }, missing [112] → 66 rolls -1 missing = 65 pages
roll 64  → (64-64+1)-0 = 1  → page 1
roll 112 → missing → "Report not available"
roll 113 → (113-64+1)-1 = 49 → page 49
roll 120 → (120-64+1)-1 = 56 → page 56
roll 129 → (129-64+1)-1 = 65 → last page
```
For `S5-A: 1-63`, missing `[31]`: roll `31` missing, roll `32 → (32-1+1)-1 =31 → page31`, roll `33 →32`.

If `rollRanges` absent, defaults to `start=1`, no range validation (page = `roll - missingBefore`).

**PDF Loading (`index.html:loadPDF`):**
```js
pdfjsLib.getDocument(fileUrl).promise.then(pdf => {
  if (pageNumber <1 || pageNumber > pdf.numPages) → "Report not available"
  else renderPage(pageNumber)
})
```
`fileUrl` is `selectedSemester.url` (e.g., `semesters/S5-B.pdf`). Detailed errors are simplified to `Report not available` per UX requirement.

### 1.5 File Structure
```
report-card-displayer/
├── index.html           # SPA + styles + all JS (fetch, pills, validation, render)
├── server.js            # Local Node server, scans semesters/, serves static + /api/*
├── api/
│   ├── semesters.js     # Vercel serverless – same scan logic
│   └── config.js        # Vercel serverless – parses config.json
├── semesters/
│   ├── S3-B.pdf
│   ├── S5-A.pdf
│   ├── S5-B.pdf
│   └── S5-C.pdf
├── semesters.json       # Static manifest – must be regenerated when PDFs change (Option A)
├── config.json          # Manual per-semester rollRanges + missingRolls
├── jyothi_letter_head.png
└── package.json         # scripts.start = node server.js
```

---

## 2. Configuration – `config.json`

### 2.1 Schema
Supports 3 shapes (normalized by `server.js:getConfig()` & `index.html:normalize*`):

**Shape 1 – Recommended (current file):**
```json
{
  "missingRolls": {
    "S5-A": [31],
    "S5-B": [112],
    "S5-C": [132],
    "S3-B": [70, 104]
  },
  "rollRanges": {
    "S5-A": { "start": 1, "end": 63 },
    "S5-B": { "start": 64, "end": 129 },
    "S5-C": { "start": 127, "end": 194 },
    "S3-B": { "start": 65, "end": 124 }
  }
}
```

**Shape 2 – Unified `semesters`:**
```json
{
  "semesters": {
    "S5-A": { "start": 1, "end": 63, "missing": [31] },
    "S5-B": { "startRoll": 64, "endRoll": 129, "missingRolls": [112] }
  }
}
```
Keys `start/end/startRoll/endRoll/firstRoll/from` + `missing/missingRolls` are all accepted (case-insensitive file/name matching).

**Shape 3 – Flat legacy (missing only):**
```json
{
  "S5-A": [31],
  "S5-B": [112]
}
```

*Keys are case-insensitive and match both `S5-A` and `S5-A.pdf`. `rollRanges` values may be `{start,end}` or array `[start,end]`.*

If a semester has no entry, `missing = []` and `range = null` (no validation, page calc from 1).

### 2.2 Editing Rules for New Developers
* Always use **exact semester name** matching PDF basename (e.g., PDF `S6-A.pdf` → key `"S6-A"`).
* `missingRolls` – list **global roll numbers** missing in that PDF, sorted ascending (duplicates removed automatically). Example: if class `S5-A` rolls `1-63` but roll `31` has no page, set `"S5-A": [31]`. Then `32` correctly maps to page `31`.
* `rollRanges` – `{start,end}` inclusive. Must cover all rolls printable for that PDF. Example: `S5-B` covers `64-129` (66 numbers, -1 missing = 65 pages). Overlapping ranges across semesters are allowed but usually indicate sequential classes; keep them consistent with actual roll allocation.
* After editing, validate JSON (no trailing commas) and test locally `npm start` → select pill → test boundary rolls (`start`, `end`, `missing`, `missing+1`).

---

## 3. Local Development

```bash
git clone <repo>
cd report-card-displayer
npm start          # starts node server.js at http://localhost:3000
# open http://localhost:3000
# pills auto-load from semesters/ via /api/semesters
# edit config.json, refresh browser to see effect
```

*No build step.* `server.js` rescans `semesters/` on every request, so adding a PDF locally shows pills immediately without regenerating `semesters.json`.

---

## 4. Adding New PDFs – Option A (Manual, Documented)

Option A is the current workflow for this repo: **explicit manual regeneration** of the static fallback manifest. Recommended for simplicity and to keep `semesters.json` in sync for static hosts.

**Steps when you add `semesters/S6-A.pdf` (or any new PDF):**

### 4.1 Add PDF File
```bash
cp ~/Downloads/S6-A.pdf semesters/S6-A.pdf
# also ensure file is lowercase-consistent and named as you want pills to appear (pill text = basename without .pdf)
ls semesters/
```

### 4.2 Regenerate Static Manifest `semesters.json`
`semesters.json` is the fallback when `GET /api/semesters` 404s on static hosting. It **must** be regenerated manually in Option A.

Run:
```bash
node -e "
const fs=require('fs'), path=require('path');
const root=__dirname;
const semDir=path.join(root,'semesters');
let cands=[], seen=new Set();
if(fs.existsSync(semDir)){
  fs.readdirSync(semDir).filter(f=>f.toLowerCase().endsWith('.pdf'))
    .forEach(f=>{ if(!seen.has(f.toLowerCase())){seen.add(f.toLowerCase()); cands.push({file:f, dir:'semesters'})}})
}
fs.readdirSync(root).filter(f=>f.toLowerCase().endsWith('.pdf'))
  .forEach(f=>{ if(!seen.has(f.toLowerCase())){cands.push({file:f, dir:''}); seen.add(f.toLowerCase())}});
cands.sort((a,b)=>{ const aN=Number((a.file.match(/\d+/)||[])[0]); const bN=Number((b.file.match(/\d+/)||[])[0]); const aI=!isNaN(aN), bI=!isNaN(bN); if(aI&&bI){ if(aN!==bN) return aN-bN; return a.file.localeCompare(b.file)} if(aI) return -1; if(bI) return 1; return a.file.localeCompare(b.file)});
const out=cands.map(({file,dir})=>({name:path.basename(file, path.extname(file)), file, url: dir? dir+'/'+file: file}));
fs.writeFileSync('semesters.json', JSON.stringify(out, null, 2));
console.log('wrote semesters.json', out);
"
```
Verify:
```bash
cat semesters.json
# should now contain {name:"S6-A", file:"S6-A.pdf", url:"semesters/S6-A.pdf"}
```

### 4.3 Update `config.json`
Add entries for the new semester:
```json
{
  "missingRolls": {
    "S6-A": [ 45, 67 ]   // leave [] if none missing
  },
  "rollRanges": {
    "S6-A": { "start": 195, "end": 260 } // set correct global roll window for this class
  }
}
```
*If unsure of missing rolls, start with `[]`. If unsure of range, set `start:1, end: <pdf.numPages + missing.length>` or sequential after previous class.*

### 4.4 Test Locally
```bash
npm start
# 1) pills should show new S6-A alongside S3-B etc.
# 2) select S6-A → enter start roll (195) → should render page 1
# 3) enter missing roll (45) → should show "Report not available"
# 4) enter 46 → should render page after gap
# 5) enter end roll (260) → should render last page
# 6) test download button
```

### 4.5 Commit & Deploy
```bash
git add semesters/S6-A.pdf semesters.json config.json
git commit -m "feat: add S6-A semester (rolls 195-260, missing 45,67)"
git push origin main
# Vercel auto-deploys: api/semesters.js bundles new PDF, static semesters.json fallback is updated, config is live.
```

**What happens if you forget 4.2 or 4.3?**
*   Forgot `semesters.json`: Local `npm start` still works (dynamic scan), but hosted site pills may be stale until next redeploy includes `semesters.json` fallback. `api/semesters.js` will still serve new pill after redeploy even if `semesters.json` stale, because frontend tries `api` first.
*   Forgot `config.json` range: Pill appears, but roll validation skipped and page calc assumes `start=1`. Rolls within range still render but offset is wrong if actual start ≠1. Missing handling defaults to `[]` (no gap correction).
*   Forgot `config.json` missing: New missing rolls will be treated as valid → user sees next student's report (wrong page). Always add missing rolls if known.

---

## 5. Deployment

### Vercel (Primary)
*   Static files (`index.html`, `semesters/*.pdf`, `semesters.json`, `config.json`) deployed as static.
*   `api/semesters.js` & `api/config.js` deployed as serverless functions handling `GET /api/*`.
*   Frontend fallback order ensures resilience: `api/*` → `*.json` static.
*   No env vars required. `package.json:start` only for local.

### Pure Static (GitHub Pages, etc., No `api/`)
*   Works via fallback to `semesters.json` + `config.json` static. Keep Option A steps to keep `semesters.json` fresh.

---

## 6. Troubleshooting for New Developers

| Symptom | Cause | Fix |
|---------|-------|-----|
| `GET /api/semesters 404` on hosted site, pills not showing | Static host without serverless (expected) – fallback failed | Ensure `semesters.json` committed & `config.json` valid; check browser console for `fetchJsonWithFallback` logs. If `semesters.json` stale, regenerate (4.2). |
| `TypeError: Cannot set properties of null (semStatus)` | `index.html` missing `#semStatus` (old deploy) | Pull latest `index.html` where `<div id="semStatus">` is uncommented and JS has null-guards. |
| Roll `120` shows `Report not available` but should be page `56` | `rollRanges` wrong or missing | Check `config.json` `rollRanges[S5-B]` matches actual class allocation (e.g., `64-129`). Verify `rollToPage` uses `(roll-start+1)-missingBefore`. |
| Roll after missing shows next student's report | `missingRolls` incomplete | Add missing roll to `config.json` array, redeploy. |
| New PDF not appearing as pill | `semesters.json` stale or PDF not in `semesters/` | Confirm PDF in `semesters/`, lowercase `.pdf`, regenerate `semesters.json`, commit, push. |
| PDF fails to load `Error loading PDF file` | `url` wrong or PDF not bundled | Check `semesters.json` `url` matches `semesters/FILE.pdf` case, ensure PDF committed and Vercel `includeFiles` includes `semesters/`. |
| Download PNG is blank | Canvas not rendered yet | Enter roll → wait for `Loading PDF...` to clear → canvas appears → Download. |

---

## 7. Quick Reference for New Developer

```bash
# 1. Clone & run
npm start

# 2. Add semester
cp new.pdf semesters/S6-B.pdf
# 3. Regenerate manifest
node -e "const fs=require('fs'),p=require('path');const r=__dirname,s=p.join(r,'semesters');let c=[],seen=new Set();if(fs.existsSync(s))fs.readdirSync(s).filter(f=>f.toLowerCase().endsWith('.pdf')).forEach(f=>{if(!seen.has(f.toLowerCase())){seen.add(f.toLowerCase());c.push({file:f,dir:'semesters'})}});fs.readdirSync(r).filter(f=>f.toLowerCase().endsWith('.pdf')).forEach(f=>{if(!seen.has(f.toLowerCase())){c.push({file:f,dir:''});seen.add(f.toLowerCase())}});c.sort((a,b)=>{const aN=Number((a.file.match(/\d+/)||[])[0]);const bN=Number((b.file.match(/\d+/)||[])[0]);const aI=!isNaN(aN),bI=!isNaN(bN);if(aI&&bI){if(aN!==bN)return aN-bN;return a.file.localeCompare(b.file)}if(aI)return -1;if(bI)return 1;return a.file.localeCompare(b.file)});const o=c.map(({file,dir})=>({name:p.basename(file,p.extname(file)),file,url:dir?dir+'/'+file:file}));fs.writeFileSync('semesters.json',JSON.stringify(o,null,2));console.log(o)"
# 4. Edit config.json (missingRolls + rollRanges for S6-B)
# 5. Test & push
git add semesters.json config.json semesters/S6-B.pdf && git commit -m "add S6-B" && git push
```

For questions: check `index.html:rollToPage()` for page math, `server.js:getSemesterFiles()` for sorting, `config.json` for examples.
