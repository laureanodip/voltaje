require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { importEquivalences } = require('./services/equivalences');
const { processPriceFile, getDashboardData, updateSupplierDiscount } = require('./services/repository');
const { getDb } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });

const upload = multer({ dest: path.join(__dirname, 'temp') });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req, res) => {
  const data = await getDashboardData();
  const flash = req.query.ok || req.query.error || null;
  res.render('index', { ...data, flash, flashType: req.query.error ? 'error' : 'ok' });
});

app.post('/importar-equivalencias', upload.single('equivalencias'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Debes seleccionar el archivo de equivalencias.');
    const result = await importEquivalences(req.file.path);
    fs.unlinkSync(req.file.path);
    res.redirect(`/?ok=${encodeURIComponent(`Equivalencias importadas. Productos: ${result.products}. Proveedores: ${result.suppliers}. Códigos: ${result.equivalences}.`)}`);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post('/actualizar-descuento', async (req, res) => {
  try {
    await updateSupplierDiscount(req.body.proveedor, Number(req.body.descuento || 0));
    res.redirect('/?ok=' + encodeURIComponent('Descuento actualizado.'));
  } catch (error) {
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

app.post('/procesar-lista', upload.single('lista'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Debes seleccionar la lista del proveedor.');
    if (!req.body.proveedor) throw new Error('Debes indicar el proveedor.');

    const result = await processPriceFile({
      supplierName: req.body.proveedor,
      discount: Number(req.body.descuento || 0),
      originalName: req.file.originalname,
      tempFilePath: req.file.path,
    });

    res.redirect('/?ok=' + encodeURIComponent(`Lista procesada correctamente. Registros detectados: ${result.detected}.`));
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

app.get('/api/comparativa', async (req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT
      pr.nombre AS producto,
      pv.nombre AS proveedor,
      eq.codigo AS codigo,
      (
        SELECT pd.precio_final
        FROM precios_detectados pd
        JOIN listas_subidas ls ON ls.id = pd.lista_id
        WHERE pd.proveedor_id = pv.id
          AND pd.codigo = eq.codigo
          AND ls.estado = 'procesado'
        ORDER BY ls.id DESC
        LIMIT 1
      ) AS precio
    FROM equivalencias eq
    JOIN productos pr ON pr.id = eq.producto_id
    JOIN proveedores pv ON pv.id = eq.proveedor_id
    ORDER BY pr.nombre, pv.nombre
  `);
  res.json(rows);
});

app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
