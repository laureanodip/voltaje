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

// 🔥 PARSER ROBUSTO FINAL
function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {}

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  console.log("⚠️ RESPUESTA IA:", text);
  throw new Error("No se pudo parsear JSON");
}

// 🔥 LLAMADA SIMPLE Y ESTABLE
async function askModel(prompt) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: prompt,
    max_output_tokens: 2000
  });

  const text = response.output_text || "";

  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

// 🔹 EXCEL
async function extractFromExcelWithAI(filePath, supplierName) {
  const text = workbookToCompactText(filePath);

  const prompt = `
Extraer códigos y precios.

Proveedor: ${supplierName}

Responder SOLO JSON así:
{
 "items":[
  {"codigo":"...","precio":12345}
 ]
}

Datos:
${text}
`;

  const raw = await askModel(prompt);
  const parsed = safeParseJson(raw);

  return parsed.items || [];
}

// 🔹 PDF
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
 "items":[
  {"codigo":"...","precio":12345}
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

    max_output_tokens: 2000
  });

  const text = (response.output_text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const parsed = safeParseJson(text);

  return parsed.items || [];
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
