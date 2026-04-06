const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const xlsx = require('xlsx');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY en el archivo .env');
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
      .map((row) => row.map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim()).join(' | '))
      .join('\n');

    blocks.push(`### HOJA: ${sheetName}\n${text}`);
  }

  return blocks.join('\n\n');
}

function extractJson(raw) {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);

  const firstBracket = raw.indexOf('[');
  const lastBracket = raw.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return JSON.parse(raw.slice(firstBracket, lastBracket + 1));
  }

  throw new Error('La IA no devolvió un JSON válido.');
}

async function askModelForJson(input) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',

    // 🔥 IMPORTANTE: usar formato nuevo
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

    // 🔥 CLAVE para evitar errores con claves nuevas
    max_output_tokens: 2000
  });

  return response.output_text || '';
}
async function extractFromExcelWithAI(filePath, supplierName) {
  const workbookText = workbookToCompactText(filePath);

  const prompt = `
Sos un extractor de listas de precios de luminaria para compras.
Proveedor: ${supplierName}

Necesito que extraigas SOLO una lista JSON con objetos de la forma:
[
  {
    "codigo": "...",
    "precio": 12345.67,
    "confianza": "alta|media|baja"
  }
]

Reglas obligatorias:
- No inventar códigos.
- Ignorar descripciones.
- Buscar códigos de producto y su precio de lista asociado.
- Si ves porcentajes de descuento, IVA u otras columnas, priorizar PRECIO DE LISTA si existe.
- Si hay varias hojas, recorrer todas.
- Si un mismo código aparece varias veces, devolver una sola vez el precio más claro.
- El precio debe quedar numérico, sin símbolos.
- Responder SOLO con JSON válido.

Contenido del Excel:
${workbookText}
`;

  const raw = await askModelForJson(prompt);
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
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: `Sos un extractor de listas de precios de luminaria para compras. Extraé SOLO codigo y precio, devolviendo exclusivamente JSON válido.`
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Proveedor: ${supplierName}

Devolvé exclusivamente un JSON array con objetos:
[{"codigo":"...","precio":12345.67,"confianza":"alta|media|baja"}]

Reglas:
- No inventar datos.
- Ignorar descripciones.
- Priorizar precio de lista si hay varias columnas.
- Si no estás seguro, usar confianza baja.
- Responder SOLO con JSON.`
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
