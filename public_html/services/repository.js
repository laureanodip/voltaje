const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { normalizeSupplierName } = require('./equivalences');
const { extractCodesAndPrices } = require('./openaiExtractor');

// 🔥 NORMALIZADOR DE CÓDIGO (CLAVE)
function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9\-]/g, '');
}

async function ensureSupplier(name) {
  const db = await getDb();
  const normalized = normalizeSupplierName(name);

  await db.run(
    `INSERT INTO proveedores (nombre) VALUES (?)
     ON CONFLICT(nombre) DO NOTHING`,
    [normalized]
  );

  return db.get('SELECT * FROM proveedores WHERE nombre = ?', [normalized]);
}

async function updateSupplierDiscount(name, discount) {
  const db = await getDb();
  const proveedor = await ensureSupplier(name);

  await db.run(
    'UPDATE proveedores SET descuento = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [discount || 0, proveedor.id]
  );
}

function buildStoragePath(originalName, supplierName) {
  const safeSupplier = supplierName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = path.join(__dirname, '..', 'uploads', safeSupplier);

  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${Date.now()}-${originalName.replace(/\s+/g, '_')}`;

  return path.join(dir, fileName);
}

async function saveUploadRecord(proveedorId, originalName, filePath) {
  const db = await getDb();

  const result = await db.run(
    'INSERT INTO listas_subidas (proveedor_id, archivo_original, ruta_archivo) VALUES (?, ?, ?)',
    [proveedorId, originalName, filePath]
  );

  return result.lastID;
}

async function markUploadStatus(listaId, status, message = null) {
  const db = await getDb();

  await db.run(
    'UPDATE listas_subidas SET estado = ?, mensaje = ? WHERE id = ?',
    [status, message, listaId]
  );
}

function normalizeNumericPrice(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') return value;

  const cleaned = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(',', '.');

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

async function processPriceFile({
  supplierName,
  discount = 0,
  originalName,
  tempFilePath
}) {
  const db = await getDb();

  const proveedor = await ensureSupplier(supplierName);

  await updateSupplierDiscount(supplierName, Number(discount || 0));

  const finalPath = buildStoragePath(originalName, supplierName);

  fs.renameSync(tempFilePath, finalPath);

  const listaId = await saveUploadRecord(
    proveedor.id,
    originalName,
    finalPath
  );

  try {
    const extracted = await extractCodesAndPrices(
      finalPath,
      proveedor.nombre
    );

    const discountFactor = 1 - Number(discount || 0) / 100;

    await db.run(
      'DELETE FROM precios_detectados WHERE lista_id = ?',
      [listaId]
    );

    for (const item of extracted) {
      // 🔥 NORMALIZACIÓN CLAVE
      const codigo = normalizeCode(item.codigo);

      if (!codigo) continue;

      const precio = normalizeNumericPrice(item.precio);

      const precioFinal =
        precio === null ? null : +(precio * discountFactor).toFixed(2);

      await db.run(
        `INSERT INTO precios_detectados
         (lista_id, proveedor_id, codigo, precio, precio_final, confianza, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          listaId,
          proveedor.id,
          codigo,
          precio,
          precioFinal,
          String(item.confianza || 'media')
            .trim()
            .toLowerCase(),
          JSON.stringify(item)
        ]
      );
    }

    await markUploadStatus(
      listaId,
      'procesado',
      `Se detectaron ${extracted.length} registros.`
    );

    return { listaId, detected: extracted.length };

  } catch (error) {
    await markUploadStatus(listaId, 'error', error.message);
    throw error;
  }
}

async function getDashboardData() {
  const db = await getDb();

  const proveedores = await db.all(
    'SELECT * FROM proveedores ORDER BY nombre'
  );

  const ultimasListas = await db.all(`
    SELECT l.*, p.nombre AS proveedor
    FROM listas_subidas l
    JOIN proveedores p ON p.id = l.proveedor_id
    ORDER BY l.id DESC
    LIMIT 15
  `);

  const comparativa = await db.all(`
    SELECT
      pr.nombre AS producto,
      pv.nombre AS proveedor,
      eq.codigo AS codigo_equivalente,
      (
        SELECT pd.precio_final
        FROM precios_detectados pd
        JOIN listas_subidas ls ON ls.id = pd.lista_id
        WHERE pd.proveedor_id = pv.id
          AND UPPER(TRIM(pd.codigo)) = UPPER(TRIM(eq.codigo)) -- 🔥 FIX FINAL
          AND ls.estado = 'procesado'
        ORDER BY ls.id DESC
        LIMIT 1
      ) AS precio_final
    FROM equivalencias eq
    JOIN productos pr ON pr.id = eq.producto_id
    JOIN proveedores pv ON pv.id = eq.proveedor_id
    ORDER BY pr.nombre, pv.nombre
    LIMIT 500
  `);

  return { proveedores, ultimasListas, comparativa };
}

module.exports = {
  processPriceFile,
  getDashboardData,
  updateSupplierDiscount,
};
