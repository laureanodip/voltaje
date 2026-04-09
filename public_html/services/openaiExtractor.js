const fs = require('fs');
const OpenAI = require('openai');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

// 🔥 NORMALIZADOR
function normalizePrice(raw) {
  if (!raw) return null;

  let value = String(raw)
    .replace(/\$/g, '')
    .replace(/USD/gi, '')
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
  return Number.isFinite(num) ? num : null;
}

// 🔥 PARSER SIMPLE
function extractPairs(text) {
  const lines = text.split('\n');
  const results = [];

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim());

    if (parts.length < 2) continue;

    const codigo = parts[0];
    const precio = normalizePrice(parts[1]);

    if (codigo && precio) {
      results.push({ codigo, precio });
    }
  }

  return results;
}

// 🔥 IA LIVIANA (CLAVE)
async function askAIDocument(filePath, supplierName) {
  const client = getClient();

  const uploaded = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: 'user_data'
  });

  const response = await client.responses.create({
    model: 'gpt-5-mini',

    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `
Proveedor: ${supplierName}

Analizá SOLO las primeras páginas.

Extraé productos con código y precio.

Formato obligatorio:
CODIGO | PRECIO

Ejemplo:
LEP-1100-6 | 29000

Reglas:
- solo productos con precio visible
- no inventar
- no texto extra
`
          },
          {
            type: 'input_file',
            file_id: uploaded.id
          }
        ]
      }
    ],

    max_output_tokens: 1500 // 🔥 BAJO = evita 502
  });

  return response.output_text || '';
}

// 🔥 MAIN
async function extractCodesAndPrices(filePath, supplierName) {
  const text = await askAIDocument(filePath, supplierName);
  return extractPairs(text);
}

module.exports = { extractCodesAndPrices };
