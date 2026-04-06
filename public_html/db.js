const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let dbPromise;

async function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: path.join(__dirname, 'data', 'app.db'),
      driver: sqlite3.Database,
    });

    const db = await dbPromise;
    await db.exec(`
      CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proveedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        descuento REAL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS equivalencias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id INTEGER NOT NULL,
        proveedor_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        UNIQUE(producto_id, proveedor_id),
        FOREIGN KEY (producto_id) REFERENCES productos(id),
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
      );

      CREATE TABLE IF NOT EXISTS listas_subidas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor_id INTEGER NOT NULL,
        archivo_original TEXT NOT NULL,
        ruta_archivo TEXT NOT NULL,
        fecha_subida TEXT DEFAULT CURRENT_TIMESTAMP,
        estado TEXT DEFAULT 'subido',
        mensaje TEXT,
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
      );

      CREATE TABLE IF NOT EXISTS precios_detectados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lista_id INTEGER NOT NULL,
        proveedor_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        precio REAL,
        precio_final REAL,
        moneda TEXT DEFAULT 'ARS',
        confianza TEXT DEFAULT 'media',
        origen TEXT DEFAULT 'ia',
        raw_json TEXT,
        FOREIGN KEY (lista_id) REFERENCES listas_subidas(id),
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
      );
    `);
  }

  return dbPromise;
}

module.exports = { getDb };
