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

  // formato argentino: 7.092,20
  if (value.includes(',') && value.includes('.')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    value = value.replace(',', '.');
  } else {
    // si viene 7.092 y parece miles
    const dots = (value.match(/\./g) || []).length;
    if (dots >= 1) value = value.replace(/\./g, '');
  }

  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function dedupeResults(results) {
  const map = new Map();
  for (const item of results) {
    if (!item || !item.codigo || !item.precio) continue;
    map.set(item.codigo, item);
  }
  return Array.from(map.values());
}

function looksLikeCode(token) {
  if (!token) return false;
  const t = token.trim();

  // acepta códigos tipo:
  // LEP-1100-6
  // DRV-12V-IP20-025W
  // LE27-ECA60009-30
  // W13308060283527
  // ZT1018
  // PER-A-1407-1M
  return (
    /^[A-Z0-9]{2,}(?:[-\/][A-Z0-9]{1,})+$/i.test(t) ||
    /^[A-Z]{1,}[0-9]{2,}[A-Z0-9\-\/]*$/i.test(t) ||
    /^[A-Z0-9]{6,}$/i.test(t)
  );
}

// ==========================
// EXCEL
// ==========================
function workbookToText(filePath) {
  const wb = xlsx.readFile(filePath);
  let text = '';

  wb.SheetNames.forEach((name) => {
    const sheet = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    rows.slice(0, 500).forEach((r) => {
      text += r.join(' | ') + '\n';
    });
  });

  return text;
}

// ==========================
// PDF TEXTO
// ==========================
async function pdfToText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  return data.text || '';
}

// ==========================
// PARSERS
// ==========================
function extractPairsFromStructuredText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const results = [];

  for (const line of lines) {
    // Buscar precios tipo:
    // $ 7.092,20
    // 7092,20
    // USD170
    // USD 170
    const priceMatches =
      line.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?/g) ||
      line.match(/USD\s*\d+(?:[.,]\d+)?/gi) ||
      line.match(/\d{1,3}(?:\.\d{3})*(?:,\d+)?/g);

    if (!priceMatches) continue;

    // Buscar candidatos a código en la línea
    const tokens = line.split(/[\s|]+/).map((t) => t.trim());
    const codeCandidates = tokens.filter(looksLikeCode);

    if (!codeCandidates.length) continue;

    const codigo = codeCandidates[0];
    const precio = normalizePrice(priceMatches[priceMatches.length - 1]);

    if (codigo && precio) {
      results.push({ codigo, precio });
    }
  }

  return dedupeResults(results);
}

function extractPairsFromAiLines(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const results = [];

  for (const line of lines) {
    // Formato esperado ideal:
    // CODIGO | PRECIO
    // CODIGO - PRECIO
    // CODIGO PRECIO
    let codigo = null;
    let precio = null;

    const pipeParts = line.split('|').map((p) => p.trim());
    if (pipeParts.length >= 2) {
      if (looksLikeCode(pipeParts[0])) codigo = pipeParts[0];
      precio = normalizePrice(pipeParts[1]);
    }

    if (!codigo || !precio) {
      const tokens = line.split(/\s+/);
      const possibleCodes = tokens.filter(looksLikeCode);
      const possiblePrices = tokens
        .map(normalizePrice)
        .filter((n) => Number.isFinite(n));

      if (!codigo && possibleCodes.length) codigo = possibleCodes[0];
      if (!precio && possiblePrices.length) {
        precio = possiblePrices[possiblePrices.length - 1];
      }
    }

    if (codigo && precio) {
      results.push({ codigo, precio });
    }
  }

  return dedupeResults(results);
}

// ==========================
// IA TEXTO
// ==========================
async function askAIText(prompt) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: prompt,
    max_output_tokens: 3000
  });

  return (response.output_text || '').replace(/```/g, '').trim();
}

// ==========================
// IA DOCUMENTO (PDF/IMAGEN)
// ==========================
async function askAIDocument(filePath, supplierName) {
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

Necesito OCR + extracción de precios.
Leé el documento completo, aunque sea catálogo escaneado o imagen.

Extraé SOLO los productos que tengan:
1. código de producto
2. precio visible

Respondé UNA línea por producto con este formato exacto:
CODIGO | PRECIO

Ejemplos:
LEP-1100-6 | 29000
DRV-12V-IP20-025W | 7092,20
W13308060283527 | 12198,60

Reglas:
- no agregues explicaciones
- no agregues títulos
- no agregues texto extra
- si una línea no tiene precio visible, no la incluyas
- si una línea no tiene código claro, no la incluyas
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

  return (response.output_text || '').replace(/```/g, '').trim();
}

// ==========================
// EXTRACTORES
// ==========================
async function extractFromExcel(filePath, supplierName) {
  const text = workbookToText(filePath);

  // 1) intento directo desde texto del excel
  let direct = extractPairsFromStructuredText(text);
  if (direct.length >= 5) return direct;

  // 2) fallback IA
  const aiText = await askAIText(`
Proveedor: ${supplierName}

Del siguiente texto, extraer códigos y precios.

Devolver solo líneas:
CODIGO | PRECIO

${text}
  `);

  return extractPairsFromAiLines(aiText);
}

async function extractFromPdf(filePath, supplierName) {
  // 1) intentar texto real del PDF
  const pdfText = await pdfToText(filePath);

  const direct = extractPairsFromStructuredText(pdfText);

  // si ya encontró suficientes, no gastar IA
  if (direct.length >= 5) {
    return direct;
  }

  // 2) fallback documento completo con IA/OCR
  const aiText = await askAIDocument(filePath, supplierName);
  const aiResults = extractPairsFromAiLines(aiText);

  return aiResults;
}

async function extractFromImageLikeFile(filePath, supplierName) {
  const aiText = await askAIDocument(filePath, supplierName);
  return extractPairsFromAiLines(aiText);
}

// ==========================
// MAIN
// ==========================
async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext === '.xlsx' || ext === '.xls') {
    return extractFromExcel(filePath, supplierName);
  }

  if (ext === '.pdf') {
    return extractFromPdf(filePath, supplierName);
  }

  return extractFromImageLikeFile(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
