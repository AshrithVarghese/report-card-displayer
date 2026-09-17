const fs = require('fs');
const path = require('path');

function getSemesterFiles(rootDir) {
  const semestersDir = path.join(rootDir, 'semesters');
  const candidates = [];
  const seen = new Set();

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

  const rootFiles = fs.readdirSync(rootDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  rootFiles.forEach(file => {
    const key = file.toLowerCase();
    if (!seen.has(key)) {
      candidates.push({ file, dir: '' });
      seen.add(key);
    }
  });

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
  // Vercel runs from api/ folder, root is one level up
  const rootDir = path.join(__dirname, '..');
  const data = getSemesterFiles(rootDir);
  res.status(200).json(data);
};
