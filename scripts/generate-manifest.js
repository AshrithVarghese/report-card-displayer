const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEM_DIR = path.join(ROOT, 'semesters');
const OUT = path.join(ROOT, 'semesters.json');

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

const data = getSemesterFiles(ROOT);
fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log(`Generated ${OUT} with ${data.length} entries:`);
data.forEach(e => console.log(` - ${e.name} -> ${e.url}`));

if (data.length === 0) {
  console.warn('Warning: No PDFs found! Add PDFs to semesters/ folder.');
}
