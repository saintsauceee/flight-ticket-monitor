#!/usr/bin/env node
// Regenerates server/src/data/airports.json from the OurAirports dataset
// (public domain, https://ourairports.com/data/). Run: npm run data:airports
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/src/data/airports.json');

/** Minimal RFC 4180 CSV parser (handles quoted fields, escaped quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const rows = parseCsv(await res.text());
const header = rows.shift();
const col = Object.fromEntries(header.map((name, i) => [name, i]));
const SIZE = { large_airport: 2, medium_airport: 1 };

const seen = new Set();
const airports = [];
for (const r of rows) {
  const code = (r[col.iata_code] ?? '').trim().toUpperCase();
  const size = SIZE[r[col.type]];
  if (!size || !/^[A-Z]{3}$/.test(code) || r[col.scheduled_service] !== 'yes' || seen.has(code)) continue;
  const lat = Number(r[col.latitude_deg]);
  const lon = Number(r[col.longitude_deg]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  seen.add(code);
  airports.push([
    code,
    r[col.name].trim(),
    (r[col.municipality] ?? '').trim(),
    r[col.iso_country].trim().toUpperCase(),
    Math.round(lat * 1000) / 1000,
    Math.round(lon * 1000) / 1000,
    size,
  ]);
}
airports.sort((a, b) => b[6] - a[6] || a[0].localeCompare(b[0]));

await writeFile(OUT, '[\n' + airports.map((a) => JSON.stringify(a)).join(',\n') + '\n]\n');
console.log(`Wrote ${airports.length} airports to ${path.relative(process.cwd(), OUT)}`);
