const fs = require('fs');
const path = require('path');

// Try to load config via require for Vercel bundling (static analysis)
let bundledConfig = null;
try {
  bundledConfig = require('../config.json');
} catch (e) {
  try { bundledConfig = require('../../config.json'); } catch (e2) {}
}

function getConfig(rootDir) {
  // First, try bundled require (most reliable on Vercel)
  if (bundledConfig && (bundledConfig.missingRolls || bundledConfig.rollRanges || bundledConfig.semesters)) {
    try {
      const parsed = bundledConfig;
      let missingRolls = {};
      let rollRanges = {};
      if (parsed.missingRolls && typeof parsed.missingRolls === 'object' && !Array.isArray(parsed.missingRolls)) {
        missingRolls = parsed.missingRolls;
      }
      if (parsed.rollRanges && typeof parsed.rollRanges === 'object' && !Array.isArray(parsed.rollRanges)) {
        rollRanges = parsed.rollRanges;
      }
      if (parsed.semesters && typeof parsed.semesters === 'object' && !Array.isArray(parsed.semesters)) {
        for (const [semKey, val] of Object.entries(parsed.semesters)) {
          if (!val || typeof val !== 'object') continue;
          const m = val.missing ?? val.missingRolls ?? val.missingRoll ?? [];
          if (Array.isArray(m)) missingRolls[semKey] = m;
          const s = val.start ?? val.startRoll ?? val.firstRoll ?? val.from;
          const e = val.end ?? val.endRoll ?? val.lastRoll ?? val.to;
          if (s != null || e != null) {
            rollRanges[semKey] = {};
            if (s != null) rollRanges[semKey].start = s;
            if (e != null) rollRanges[semKey].end = e;
            if (val.startRoll != null) rollRanges[semKey].start = val.startRoll;
            if (val.endRoll != null) rollRanges[semKey].end = val.endRoll;
          }
        }
      }
      const isFlatMissing = Object.values(parsed).every(v => Array.isArray(v));
      if (isFlatMissing && Object.keys(parsed).length > 0 && !parsed.missingRolls && !parsed.rollRanges && !parsed.semesters) {
        missingRolls = parsed;
      }
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
          if (normalizedRanges[k].start != null && Number.isNaN(normalizedRanges[k].start)) delete normalizedRanges[k].start;
          if (normalizedRanges[k].end != null && Number.isNaN(normalizedRanges[k].end)) delete normalizedRanges[k].end;
          if (Object.keys(normalizedRanges[k]).length === 0) delete normalizedRanges[k];
        }
      }
      const result = { missingRolls, rollRanges: normalizedRanges };
      if (Object.keys(missingRolls).length > 0 || Object.keys(normalizedRanges).length > 0) {
        return result;
      }
    } catch (e) {
      console.error('bundledConfig parse failed', e);
    }
  }

  const configPath = path.join(rootDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    return { missingRolls: {}, rollRanges: {} };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);

    let missingRolls = {};
    let rollRanges = {};

    if (parsed.missingRolls && typeof parsed.missingRolls === 'object' && !Array.isArray(parsed.missingRolls)) {
      missingRolls = parsed.missingRolls;
    }
    if (parsed.rollRanges && typeof parsed.rollRanges === 'object' && !Array.isArray(parsed.rollRanges)) {
      rollRanges = parsed.rollRanges;
    }
    if (parsed.semesters && typeof parsed.semesters === 'object' && !Array.isArray(parsed.semesters)) {
      for (const [semKey, val] of Object.entries(parsed.semesters)) {
        if (!val || typeof val !== 'object') continue;
        const m = val.missing ?? val.missingRolls ?? val.missingRoll ?? [];
        if (Array.isArray(m)) missingRolls[semKey] = m;
        const s = val.start ?? val.startRoll ?? val.firstRoll ?? val.from;
        const e = val.end ?? val.endRoll ?? val.lastRoll ?? val.to;
        if (s != null || e != null) {
          rollRanges[semKey] = {};
          if (s != null) rollRanges[semKey].start = s;
          if (e != null) rollRanges[semKey].end = e;
          if (val.startRoll != null) rollRanges[semKey].start = val.startRoll;
          if (val.endRoll != null) rollRanges[semKey].end = val.endRoll;
        }
      }
    }
    const isFlatMissing = Object.values(parsed).every(v => Array.isArray(v));
    if (isFlatMissing && Object.keys(parsed).length > 0 && !parsed.missingRolls && !parsed.rollRanges && !parsed.semesters) {
      missingRolls = parsed;
    }

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
        if (normalizedRanges[k].start != null && Number.isNaN(normalizedRanges[k].start)) delete normalizedRanges[k].start;
        if (normalizedRanges[k].end != null && Number.isNaN(normalizedRanges[k].end)) delete normalizedRanges[k].end;
        if (Object.keys(normalizedRanges[k]).length === 0) delete normalizedRanges[k];
      }
    }

    return { missingRolls, rollRanges: normalizedRanges };
  } catch (err) {
    return { missingRolls: {}, rollRanges: {}, _error: err.message };
  }
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const candidates = [
    path.join(__dirname, '..'),
    process.cwd(),
    path.join(process.cwd(), '..'),
    __dirname
  ];
  let data = { missingRolls: {}, rollRanges: {} };
  for (const r of candidates) {
    const d = getConfig(r);
    if (d && (Object.keys(d.missingRolls || {}).length > 0 || Object.keys(d.rollRanges || {}).length > 0)) {
      data = d;
      break;
    }
    // keep last non-empty or even empty but valid
    if (d && !data.missingRolls) data = d;
  }
  res.status(200).json(data);
};
