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

    rows.slice(0, 300).forEach(r => {
      text += r.join(' ') + '\n';
    });
  });

  return text;
}

// 🔥 PARSER MEJORADO (REALISTA)
function extractFromText(text) {
  const lines = text.split('\n');
  const results = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // posibles códigos
    const codigos = line.match(/[A-Z0-9\-]{3,}/g);

    // posibles precios
    const precios = line.match(/\d{1,3}(\.\d{3})*(,\d+)?|\d+/g);

    if (!codigos || !precios) continue;

    const codigo = codigos[0];

    // tomar último número como precio (más fiable)
    let precioRaw = precios[precios.length - 1];

    // limpiar formatos
    precioRaw = precioRaw
      .replace(/\./g, '')   // miles
      .replace(',', '.');  // decimal

    const precio = Number(precioRaw);

    if (!isNaN(precio) && precio > 0) {
      results.push({ codigo, precio });
    }
  }

  // 🔥 eliminar duplicados (mismo código → último precio)
  const map = new Map();
  results.forEach(r => map.set(r.codigo, r));

  return Array.from(map.values());
}

// 🔥 LLAMADA A IA (MEJORADA)
async function askAI(text) {
  const client = getClient();

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: text,
    max_output_tokens: 2000
  });

  let output = response.output_text || '';

  // limpiar basura típica
  output = output
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/\$/g, '')
    .trim();

  return output;
}

// 🔹 EXCEL
async function extractFromExcel(filePath, supplierName) {
  const text = workbookToText(filePath);

  const aiText = await askAI(`
Proveedor: ${supplierName}

Extraer códigos de producto y precios.

IMPORTANTE:
- devolver datos en texto claro
- formato: CODIGO PRECIO
- no explicar nada

${text}
`);

  return extractFromText(aiText);
}

// 🔹 PDF / IMAGEN
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
          {
            type: "input_text",
            text: `
Proveedor: ${supplierName}

Extraer códigos y precios.

FORMATO:
CODIGO PRECIO
SIN EXPLICACIONES
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

  let text = response.output_text || '';

  // limpieza
  text = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/\$/g, '')
    .trim();

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
