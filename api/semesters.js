const fs = require('fs');
const path = require('path');

function getSemesterFiles(rootDir) {
  const semestersDir = path.join(rootDir, 'semesters');
  const candidates = [];
  const seen = new Set();

  try {
    if (fs.existsSync(semestersDir)) {
      const semFiles = fs.readdirSync(semestersDir).filter(f => f.toLowerCase().endsWith('.pdf'));
      semFiles.forEach(file => {
        const key = file.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ file, dir: 'semesters' });
        }
      });
    }
  } catch (e) {
    console.error('Error scanning semesters dir', e);
  }

  try {
    const rootFiles = fs.readdirSync(rootDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    rootFiles.forEach(file => {
      const key = file.toLowerCase();
      if (!seen.has(key)) {
        candidates.push({ file, dir: '' });
        seen.add(key);
      }
    });
  } catch (e) {
    console.error('Error scanning root dir', e);
  }

  // Fallback to static semesters.json if scanning yielded nothing (Vercel lambda may not bundle PDFs)
  if (candidates.length === 0) {
    try {
      const manifestPaths = [
        path.join(rootDir, 'semesters.json'),
        path.join(process.cwd(), 'semesters.json'),
        path.join(__dirname, '..', 'semesters.json')
      ];
      for (const mp of manifestPaths) {
        if (fs.existsSync(mp)) {
          const raw = fs.readFileSync(mp, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('Using semesters.json fallback', mp);
            return parsed;
          }
        }
      }
    } catch (e) {
      console.error('Fallback semesters.json failed', e);
    }
    // Last resort: derive from config.json rollRanges/missingRolls keys
    try {
      const configPaths = [path.join(rootDir, 'config.json'), path.join(process.cwd(), 'config.json')];
      for (const cp of configPaths) {
        if (fs.existsSync(cp)) {
          const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
          const keys = new Set([
            ...Object.keys(cfg.rollRanges || {}),
            ...Object.keys(cfg.missingRolls || {}),
            ...Object.keys(cfg.semesters || {})
          ]);
          if (keys.size > 0) {
            const derived = Array.from(keys)
              .filter(k => k && k !== '…')
              .sort((a, b) => {
                const aN = Number((a.match(/\d+/) || [])[0]);
                const bN = Number((b.match(/\d+/) || [])[0]);
                if (!isNaN(aN) && !isNaN(bN) && aN !== bN) return aN - bN;
                return a.localeCompare(b);
              })
              .map(k => {
                const name = k.replace(/\.pdf$/i, '');
                const file = name.includes('.') ? name : `${name}.pdf`;
                const properFile = file.toLowerCase().endsWith('.pdf') ? file : `${file}.pdf`;
                return { name: name.toUpperCase(), file: properFile, url: `semesters/${properFile}` };
              });
            if (derived.length > 0) {
              console.log('Using config-derived fallback', derived);
              return derived;
            }
          }
        }
      }
    } catch (e) {
      console.error('Config-derived fallback failed', e);
    }
  }

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

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  // Try multiple possible roots for Vercel vs local
  const candidates = [
    path.join(__dirname, '..'),
    process.cwd(),
    path.join(process.cwd(), '..'),
    __dirname
  ];
  let data = [];
  for (const r of candidates) {
    data = getSemesterFiles(r);
    if (data && data.length > 0) break;
  }
  res.status(200).json(data);
};
