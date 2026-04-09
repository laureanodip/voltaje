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

// 🔥 FUNCIÓN DEFINITIVA (COMPATIBLE API NUEVA)
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

    // ✅ NUEVA FORMA CORRECTA
    text: {
      format: {
        type: "json_schema",
        name: "respuesta",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  codigo: { type: "string" },
                  precio: { type: "number" }
                },
                required: ["codigo", "precio"]
              }
            }
          },
          required: ["items"]
        }
      }
    },

    max_output_tokens: 2000
  });

  return response.output_parsed;
}

// 🔹 EXCEL
async function extractFromExcelWithAI(filePath, supplierName) {
  const text = workbookToCompactText(filePath);

  const prompt = `
Proveedor: ${supplierName}

Extraer códigos y precios.

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
`
          },
          {
            type: "input_file",
            file_id: uploaded.id
          }
        ]
      }
    ],

    text: {
      format: {
        type: "json_schema",
        name: "respuesta",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  codigo: { type: "string" },
                  precio: { type: "number" }
                },
                required: ["codigo", "precio"]
              }
            }
          },
          required: ["items"]
        }
      }
    },

    max_output_tokens: 2000
  });

  return response.output_parsed.items || [];
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
