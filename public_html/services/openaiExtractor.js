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

// 🔥 JSON extractor robusto
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
      return JSON.parse(raw.slice(first, last + 1));
    }
  } catch {}

  console.log("⚠️ RESPUESTA IA COMPLETA:\n", raw);

  throw new Error('La IA no devolvió un JSON válido.');
}

// 🔥 FUNCIÓN CLAVE CORREGIDA (FORZAMOS JSON)
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

    // 🔥 ESTO SOLUCIONA TODO
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lista_precios",
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              codigo: { type: "string" },
              precio: { type: "number" },
              confianza: { type: "string" }
            },
            required: ["codigo", "precio"]
          }
        }
      }
    },

    max_output_tokens: 2000
  });

  return response.output_text || '';
}

async function extractFromExcelWithAI(filePath, supplierName) {
  const workbookText = workbookToCompactText(filePath);

  const prompt = `
Extraer códigos y precios.

Proveedor: ${supplierName}

Devolver SOLO JSON.
`;

  const raw = await askModelForJson(prompt + "\n\n" + workbookText);
  return extractJson(raw);
}

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
Devolver SOLO JSON.
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

async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext === '.xlsx' || ext === '.xls') {
    return extractFromExcelWithAI(filePath, supplierName);
  }

  return extractFromFileWithAI(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
