const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const xlsx = require('xlsx');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function workbookToCompactText(filePath) {
  const wb = xlsx.readFile(filePath);
  let text = '';

  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    rows.slice(0, 200).forEach(r => {
      text += r.join(' | ') + '\n';
    });
  });

  return text;
}

// 🔥 FUNCIÓN DEFINITIVA (NO FALLA NUNCA)
async function askModelForJson(input) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',

    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: input }
        ]
      }
    ],

    // 🔥 ESTO ES LA CLAVE TOTAL
    response_format: { type: "json_object" },

    max_output_tokens: 2000
  });

  return JSON.parse(response.output_text);
}

// 🔹 EXCEL
async function extractFromExcelWithAI(filePath, supplierName) {
  const text = workbookToCompactText(filePath);

  const prompt = `
Extraer códigos y precios de lista.

Proveedor: ${supplierName}

Devolver JSON con este formato EXACTO:
{
  "items": [
    {"codigo": "...", "precio": 12345.67}
  ]
}
`;

  const result = await askModelForJson(prompt + "\n\n" + text);

  return result.items || [];
}

// 🔹 PDF / IMAGEN
async function extractFromFileWithAI(filePath, supplierName) {
  const client = getClient();

  const uploaded = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: 'user_data',
  });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',

    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Proveedor: ${supplierName}

Extraer códigos y precios.

Formato:
{
  "items": [
    {"codigo": "...", "precio": 12345.67}
  ]
}
`
          },
          {
            type: "input_file",
            file_id: uploaded.id
          }
        ]
      }
    ],

    response_format: { type: "json_object" },

    max_output_tokens: 2000
  });

  const result = JSON.parse(response.output_text);

  return result.items || [];
}

// 🔹 MAIN
async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext.includes('xls')) {
    return extractFromExcelWithAI(filePath, supplierName);
  }

  return extractFromFileWithAI(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
