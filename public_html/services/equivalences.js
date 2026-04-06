const xlsx = require('xlsx');
const { getDb } = require('../db');

function normalizeSupplierName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeCode(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim();
}

async function importEquivalences(filePath) {
  const wb = xlsx.readFile(filePath, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rows.length) {
    throw new Error('El archivo de equivalencias está vacío.');
  }

  const db = await getDb();
  const supplierNames = rows[0].slice(1).map(normalizeSupplierName).filter(Boolean);

  if (!supplierNames.length) {
    throw new Error('No se encontraron proveedores en la fila 1 del archivo de equivalencias.');
  }

  await db.exec('BEGIN');
  try {
    for (const supplierName of supplierNames) {
      await db.run(
        `INSERT INTO proveedores (nombre) VALUES (?)
         ON CONFLICT(nombre) DO NOTHING`,
        [supplierName]
      );
    }

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const productName = String(row[0] || '').trim();
      if (!productName) continue;

      const productResult = await db.run(
        `INSERT INTO productos (nombre) VALUES (?)
         ON CONFLICT(nombre) DO NOTHING`,
        [productName]
      );

      const producto = await db.get('SELECT id FROM productos WHERE nombre = ?', [productName]);

      for (let col = 1; col <= supplierNames.length; col += 1) {
        const supplierName = supplierNames[col - 1];
        const code = normalizeCode(row[col]);
        if (!code) continue;

        const proveedor = await db.get('SELECT id FROM proveedores WHERE nombre = ?', [supplierName]);
        await db.run(
          `INSERT INTO equivalencias (producto_id, proveedor_id, codigo)
           VALUES (?, ?, ?)
           ON CONFLICT(producto_id, proveedor_id)
           DO UPDATE SET codigo = excluded.codigo`,
          [producto.id, proveedor.id, code]
        );
      }
    }

    await db.exec('COMMIT');

    const totalProducts = await db.get('SELECT COUNT(*) as total FROM productos');
    const totalSuppliers = await db.get('SELECT COUNT(*) as total FROM proveedores');
    const totalEquivalences = await db.get('SELECT COUNT(*) as total FROM equivalencias');

    return {
      products: totalProducts.total,
      suppliers: totalSuppliers.total,
      equivalences: totalEquivalences.total,
    };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { importEquivalences, normalizeSupplierName };
