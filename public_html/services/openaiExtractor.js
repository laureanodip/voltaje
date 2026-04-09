const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const xlsx = require('xlsx');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function workbookToText(filePath) {
  const wb = xlsx.readFile(filePath);
  let text = '';

  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    rows.slice(0, 200).forEach(r => {
      text += r.join(' ') + '\n';
    });
  });

  return text;
}

// 🔥 PARSER INTELIGENTE (NO JSON)
function extractFromText(text) {
  const lines = text.split('\n');
  const results = [];

  const regex = /([A-Z0-9\-]{3,})\s+(\d{3,})/g;

  for (const line of lines) {
    let match;
    while ((match = regex.exec(line)) !== null) {
      results.push({
        codigo: match[1],
        precio: Number(match[2])
      });
    }
  }

  return results;
}

// 🔥 LLAMADA SIMPLE
async function askAI(text) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: text,
    max_output_tokens: 2000
  });

  return response.output_text || '';
}

// 🔹 EXCEL
async function extractFromExcel(filePath, supplierName) {
  const text = workbookToText(filePath);

  const aiText = await askAI(`
Proveedor: ${supplierName}

Extraer códigos y precios de este texto:

${text}
`);

  return extractFromText(aiText);
}

// 🔹 PDF
async function extractFromFile(filePath, supplierName) {
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
          { type: "input_text", text: `Extraer códigos y precios (${supplierName})` },
          { type: "input_file", file_id: uploaded.id }
        ]
      }
    ],

    max_output_tokens: 2000
  });

  const text = response.output_text || '';

  return extractFromText(text);
}

// 🔹 MAIN
async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext.includes('xls')) {
    return extractFromExcel(filePath, supplierName);
  }

  return extractFromFile(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
