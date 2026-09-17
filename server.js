const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const SEMESTERS_DIR = path.join(ROOT_DIR, 'semesters');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

function getSemesterFiles() {
  const candidates = [];
  const seen = new Set();

  // Primary: semesters/ folder
  if (fs.existsSync(SEMESTERS_DIR)) {
    const semFiles = fs.readdirSync(SEMESTERS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
    semFiles.forEach((file) => {
      const key = file.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ file, dir: 'semesters' });
      }
    });
  }

  // Fallback: also check ROOT_DIR for PDFs (e.g., S3-B.pdf, report.pdf) if semesters is empty or for backwards compat
  // Exclude files already seen, and avoid serving accidental pdfs like dummy
  const rootFiles = fs.readdirSync(ROOT_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  rootFiles.forEach((file) => {
    const key = file.toLowerCase();
    if (!seen.has(key)) {
      // only include if semesters dir didn't already have it, and file looks like a semester report
      candidates.push({ file, dir: '' });
      seen.add(key);
    }
  });

  // Sort: numeric first then lexicographic, e.g., S3-B before S5-A
  candidates.sort((a, b) => {
    const aNum = Number((a.file.match(/\d+/) || [])[0]);
    const bNum = Number((b.file.match(/\d+/) || [])[0]);
    const aIsNum = !Number.isNaN(aNum);
    const bIsNum = !Number.isNaN(bNum);
    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum - bNum;
      return a.file.localeCompare(b.file);
    }
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return a.file.localeCompare(b.file);
  });

  return candidates.map(({ file, dir }) => ({
    name: path.basename(file, path.extname(file)),
    file: file,
    url: dir ? `${dir}/${file}` : file
  }));
}

function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { missingRolls: {}, rollRanges: {} };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    let missingRolls = {};
    let rollRanges = {};

    // 1) Direct missingRolls field
    if (parsed.missingRolls && typeof parsed.missingRolls === 'object' && !Array.isArray(parsed.missingRolls)) {
      missingRolls = parsed.missingRolls;
    }

    // 2) Direct rollRanges field — supports { "S5-A": {start:1,end:60} } or { "S5-A": [1,60] }
    if (parsed.rollRanges && typeof parsed.rollRanges === 'object' && !Array.isArray(parsed.rollRanges)) {
      rollRanges = parsed.rollRanges;
    }

    // 3) Unified semesters field: { semesters: { "S5-A": { startRoll, endRoll, missing } } }
    if (parsed.semesters && typeof parsed.semesters === 'object' && !Array.isArray(parsed.semesters)) {
      for (const [semKey, val] of Object.entries(parsed.semesters)) {
        if (!val || typeof val !== 'object') continue;
        // missing
        const m = val.missing ?? val.missingRolls ?? val.missingRoll ?? [];
        if (Array.isArray(m)) missingRolls[semKey] = m;
        // range
        const s = val.start ?? val.startRoll ?? val.firstRoll ?? val.from;
        const e = val.end ?? val.endRoll ?? val.lastRoll ?? val.to;
        if (s != null || e != null) {
          rollRanges[semKey] = {};
          if (s != null) rollRanges[semKey].start = s;
          if (e != null) rollRanges[semKey].end = e;
          // also allow alternative keys startRoll/endRoll inside same object for flexibility
          if (val.startRoll != null) rollRanges[semKey].start = val.startRoll;
          if (val.endRoll != null) rollRanges[semKey].end = val.endRoll;
        }
      }
    }

    // 4) Flat fallback: { "S5-A": [32] }  -> treat as missingRolls
    const isFlatMissing = Object.values(parsed).every((v) => Array.isArray(v));
    if (isFlatMissing && Object.keys(parsed).length > 0 && !parsed.missingRolls && !parsed.rollRanges && !parsed.semesters) {
      missingRolls = parsed;
    }

    // Normalize rollRanges values to { start, end } numbers (allow [start,end] array shorthand)
    const normalizedRanges = {};
    for (const [k, v] of Object.entries(rollRanges)) {
      if (Array.isArray(v) && v.length >= 2) {
        normalizedRanges[k] = { start: Number(v[0]), end: Number(v[1]) };
      } else if (v && typeof v === 'object') {
        const s = v.start ?? v.startRoll ?? v.firstRoll ?? v.from;
        const e = v.end ?? v.endRoll ?? v.lastRoll ?? v.to;
        normalizedRanges[k] = {};
        if (s != null) normalizedRanges[k].start = Number(s);
        if (e != null) normalizedRanges[k].end = Number(e);
        // if nothing valid, skip
        if (normalizedRanges[k].start != null && Number.isNaN(normalizedRanges[k].start)) delete normalizedRanges[k].start;
        if (normalizedRanges[k].end != null && Number.isNaN(normalizedRanges[k].end)) delete normalizedRanges[k].end;
        if (Object.keys(normalizedRanges[k]).length === 0) delete normalizedRanges[k];
      }
    }

    return { missingRolls, rollRanges: normalizedRanges };
  } catch (err) {
    console.error('Failed to parse config.json:', err.message);
    return { missingRolls: {}, rollRanges: {}, _error: err.message };
  }
}

// Backward compat alias
function getMissingRollsConfig() {
  return getConfig();
}

function sendJson(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/api/semesters') {
    sendJson(res, getSemesterFiles());
    return;
  }

  if (pathname === '/api/config') {
    sendJson(res, getConfig());
    return;
  }

  let resolvedPath;

  if (pathname === '/' || pathname === '/index.html') {
    resolvedPath = path.join(ROOT_DIR, 'index.html');
  } else if (pathname.startsWith('/semesters/')) {
    const relative = pathname.replace(/^\/+/u, '');
    resolvedPath = path.join(ROOT_DIR, relative);
  } else {
    resolvedPath = path.join(ROOT_DIR, pathname.replace(/^\/+/u, ''));
  }

  const normalizedPath = path.normalize(resolvedPath);
  if (!normalizedPath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(normalizedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const stats = fs.statSync(normalizedPath);
  if (stats.isDirectory()) {
    const indexPath = path.join(normalizedPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      serveFile(res, indexPath);
      return;
    }

    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Directory listing is not enabled');
    return;
  }

  serveFile(res, normalizedPath);
});

server.listen(PORT, () => {
  console.log(`Report portal running at http://localhost:${PORT}`);
});
