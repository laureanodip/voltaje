const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const xlsx = require('xlsx');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY en el entorno');
  }
  return new OpenAI({ apiKey });
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function workbookToCompactText(filePath) {
  const wb = xlsx.readFile(filePath, { cellDates: false });
  const blocks = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const limitedRows = rows.slice(0, 300).map((row) => row.slice(0, 30));

    const text = limitedRows
      .map((row) =>
        row
          .map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim())
          .join(' | ')
      )
      .join('\n');

    blocks.push(`### HOJA: ${sheetName}\n${text}`);
  }

  return blocks.join('\n\n');
}

// 🔥 PARSER ULTRA ROBUSTO
function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {}

  try {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
  } catch {}

  try {
    const first = raw.indexOf('[');
    const last = raw.lastIndexOf(']');
    if (first !== -1 && last !== -1) {
      let jsonText = raw.slice(first, last + 1);

      // FIX 1: agregar comillas a claves
      jsonText = jsonText.replace(/(\w+):/g, '"$1":');

      // FIX 2: convertir coma decimal a punto
      jsonText = jsonText.replace(/(\d+),(\d+)/g, '$1.$2');

      // FIX 3: eliminar símbolos moneda
      jsonText = jsonText.replace(/[$€]/g, '');

      // FIX 4: eliminar texto extraño antes/después
      jsonText = jsonText.trim();

      return JSON.parse(jsonText);
    }
  } catch {}

  console.log("⚠️ RESPUESTA IA COMPLETA:\n", raw);

  throw new Error('La IA no devolvió un JSON válido.');
}

// 🔥 LLAMADA A IA
async function askModelForJson(input) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',

    input: Array.isArray(input)
      ? input
      : [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: input
              }
            ]
          }
        ],

    max_output_tokens: 2000
  });

  let text = response.output_text || "";

  // 🔥 LIMPIEZA GENERAL
  text = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return text;
}

// 🔹 EXCEL
async function extractFromExcelWithAI(filePath, supplierName) {
  const workbookText = workbookToCompactText(filePath);

  const prompt = `
Extraer códigos y precios de lista.

Proveedor: ${supplierName}

Formato requerido:
[{"codigo":"...","precio":12345.67,"confianza":"alta"}]

Reglas:
- SOLO devolver JSON
- NO agregar texto
`;

  const raw = await askModelForJson(prompt + "\n\n" + workbookText);
  return extractJson(raw);
}

// 🔹 PDF / IMAGEN
async function extractFromFileWithAI(filePath, supplierName) {
  const client = getClient();

  const uploaded = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: 'user_data',
  });

  const input = [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `
Proveedor: ${supplierName}

Extraer códigos y precios.

Formato:
[{"codigo":"...","precio":12345.67,"confianza":"alta"}]

NO agregar explicaciones.
`
        },
        {
          type: 'input_file',
          file_id: uploaded.id,
        }
      ]
    }
  ];

  const raw = await askModelForJson(input);
  return extractJson(raw);
}

// 🔹 MAIN
async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext === '.xlsx' || ext === '.xls') {
    return extractFromExcelWithAI(filePath, supplierName);
  }

  return extractFromFileWithAI(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
