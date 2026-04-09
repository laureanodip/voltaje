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

// ==========================
// 🔹 EXCEL → TEXTO
// ==========================
function workbookToText(filePath) {
  const wb = xlsx.readFile(filePath);
  let text = '';

  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    rows.slice(0, 300).forEach(r => {
      text += r.join(' ') + '\n';
    });
  });

  return text;
}

// ==========================
// 🔥 PARSER INTELIGENTE
// ==========================
function extractFromText(text) {
  const lines = text.split('\n');
  const results = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // detectar códigos tipo LEP-1100-6
    const codigos = line.match(/[A-Z]{2,}-\d{2,}(-\d+)?/g);

    // detectar precios (formato AR o US)
    const precios = line.match(/\d{1,3}(\.\d{3})*(,\d+)?|\d+/g);

    if (!codigos || !precios) continue;

    const codigo = codigos[0];

    let precioRaw = precios[precios.length - 1];

    precioRaw = precioRaw
      .replace(/\./g, '')   // miles
      .replace(',', '.');  // decimal

    const precio = Number(precioRaw);

    if (!isNaN(precio) && precio > 0) {
      results.push({ codigo, precio });
    }
  }

  // eliminar duplicados
  const map = new Map();
  results.forEach(r => map.set(r.codigo, r));

  return Array.from(map.values());
}

// ==========================
// 🔹 IA TEXTO (EXCEL)
// ==========================
async function askAI(text) {
  const client = getClient();

  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: text,
    max_output_tokens: 2000
  });

  return (response.output_text || '')
    .replace(/```/g, '')
    .replace(/\$/g, '')
    .trim();
}

// ==========================
// 🔥 IA ARCHIVO (PDF / IMG)
// ==========================
async function askVision(filePath, supplierName) {
  const client = getClient();

  const uploaded = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: 'user_data',
  });

  const response = await client.responses.create({
    model: "gpt-5-mini",

    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Proveedor: ${supplierName}

Extraer TODOS los códigos de producto y precios visibles.

FORMATO:
CODIGO PRECIO

Ejemplo:
LEP-1100-6 12500

NO agregar explicaciones.
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

  return (response.output_text || '')
    .replace(/```/g, '')
    .replace(/\$/g, '')
    .trim();
}

// ==========================
// 🔹 EXCEL
// ==========================
async function extractFromExcel(filePath, supplierName) {
  const text = workbookToText(filePath);
  const aiText = await askAI(text);
  return extractFromText(aiText);
}

// ==========================
// 🔹 PDF / IMAGEN
// ==========================
async function extractFromFile(filePath, supplierName) {
  const aiText = await askVision(filePath, supplierName);
  return extractFromText(aiText);
}

// ==========================
// 🔹 MAIN
// ==========================
async function extractCodesAndPrices(filePath, supplierName) {
  const ext = extensionOf(filePath);

  if (ext.includes('xls')) {
    return extractFromExcel(filePath, supplierName);
  }

  return extractFromFile(filePath, supplierName);
}

module.exports = { extractCodesAndPrices };
