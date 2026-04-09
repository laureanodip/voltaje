const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const xlsx = require('xlsx');
const pdf = require('pdf-parse');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

// ==========================
// HELPERS
// ==========================
function normalizePrice(raw) {
  if (!raw) return null;

  let value = String(raw)
    .replace(/\$/g, '')
    .replace(/USD/gi, '')
    .replace(/US\$/gi, '')
    .replace(/\s+/g, '')
    .trim();

  if (value.includes(',') && value.includes('.')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    value = value.replace(',', '.');
  } else {
    value = value.replace(/\./g, '');
  }

  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function dedupe(results) {
  const map = new Map();
  for (const r of results) {
    if (!r.codigo || !r.precio) continue;
    map.set(r.codigo, r);
  }
  return Array.from(map.values());
}

function looksLikeCode(text) {
  return /^[A-Z0-9\-\/]{4,}$/i.test(text);
}

// ==========================
// 🔥 DETECTOR DE COLUMNA REAL
// ==========================
function extractFromTable(rows) {
  const results = [];

  for (const row of rows) {
    if (!row || row.length < 2) continue;

    let codigo = null;
    let precio = null;

    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i]).trim();

      // detectar código
      if (!codigo && looksLikeCode(cell)) {
        codigo = cell;
      }

      // detectar precio SOLO si parece precio real
      if (!precio) {
        const match =
          cell.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?/) ||
          cell.match(/USD\s*\d+(?:[.,]\d+)?/i) ||
          (cell.includes(',') && cell.match(/\d+[.,]\d+/));

        if (match) {
          precio = normalizePrice(match[0]);
        }
      }
    }

    if (codigo && precio) {
      results.push({ codigo, precio });
    }
  }

  return dedupe(results);
}

// ==========================
// EXCEL (AHORA BIEN HECHO)
// ==========================
function extractFromExcel(filePath) {
  const wb = xlsx.readFile(filePath);
  let results = [];

  wb.SheetNames.forEach((name) => {
    const sheet = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      defval: ''
    });

    const parsed = extractFromTable(rows);
    results = results.concat(parsed);
  });

  return dedupe(results);
}

// ==========================
// PDF TEXTO
// ==========================
async function extractFromPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);

  const lines = data.text.split('\n');

  const rows = lines.map(line => line.split(/\s+/));
  return extractFromTable(rows);
}

// ==========================
// IA OCR (IMÁGENES / PDFs ROTOS)
// ==========================
async function extractWithAI(filePath, supplierName) {
  const client = getClient();

  const uploaded = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: 'user_data'
  });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `
Proveedor: ${supplierName}

Analizá este documento (puede ser imagen o escaneo).

Extraé SOLO tabla de productos.

Formato de salida:
CODIGO | PRECIO

Ejemplo:
IM2102002 | 40,73
LEP-1100-6 | 29000

REGLAS:
- ignorar descripciones
- ignorar medidas
- ignorar lumenes
- ignorar cantidades
- SOLO precio real de venta
- recorrer todas las páginas
`
          },
          {
            type: 'input_file',
            file_id: uploaded.id
          }
        ]
      }
    ],
    max_output_tokens: 5000
  });

  const text = (response.output_text || '').replace(/```/g, '');

  const rows = text.split('\n').map(l => l.split('|'));
  return extractFromTable(rows);
}

// ==========================
// MAIN
// ==========================
async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext.includes('xls')) {
    const data = extractFromExcel(filePath);
    if (data.length > 3) return data;
  }

  if (ext === '.pdf') {
    const textData = await extractFromPdfText(filePath);
    if (textData.length > 3) return textData;

    return await extractWithAI(filePath, supplierName);
  }

  return await extractWithAI(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
