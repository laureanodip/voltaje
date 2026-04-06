# Sistema MVP de compras para luminaria

Este ZIP trae un MVP listo para subir a Hostinger.

## Qué hace

1. Importa tu Excel de equivalencias.
2. Guarda proveedores y códigos en una base SQLite local.
3. Permite subir listas de proveedor en Excel, PDF o imagen.
4. Usa IA para extraer **solo código y precio**.
5. Guarda el archivo original en un repositorio por proveedor.
6. Muestra una comparativa rápida.

## Antes de subirlo

Necesitás dos cosas:

### 1) Hosting compatible con Node.js
Este proyecto es para **Hostinger con Node.js Web Apps Hosting** o un VPS con Node.js.
No sirve para el Website Builder.

### 2) Una API key de OpenAI
Tu plan de ChatGPT no alcanza para esto. Tenés que crear una API key aparte en la plataforma de OpenAI y cargar un medio de pago.

---

## Paso 1 - Descargar el ZIP y descomprimirlo en tu PC

Extraé el contenido del archivo ZIP en una carpeta.

Dentro vas a ver:

- `app.js`
- `package.json`
- `.env.example`
- carpeta `services`
- carpeta `views`
- carpeta `public`
- carpeta `uploads`
- carpeta `data`

---

## Paso 2 - Crear el archivo `.env`

1. Duplicá el archivo `.env.example`
2. Renombralo a `.env`
3. Abrilo con Bloc de notas
4. Pegá tu clave de OpenAI

Debe quedar así:

```env
PORT=3000
OPENAI_API_KEY=tu_clave_real
OPENAI_MODEL=gpt-5-mini
```

Guardá el archivo.

---

## Paso 3 - Comprimir nuevamente TODO en un ZIP

Seleccioná todos los archivos de la carpeta del proyecto y comprimilos en un ZIP.

Importante:
- al abrir el ZIP, se deben ver directamente `app.js`, `package.json`, etc.
- no debe haber una carpeta extra envolviendo todo.

---

## Paso 4 - Subir a Hostinger

### Opción A - Si tu plan tiene Node.js Web Apps Hosting

1. Entrá a **hPanel**
2. Buscá **Websites**
3. Elegí tu dominio o subdominio
4. Entrá a **Node.js** o **Web Apps**
5. Elegí **Upload ZIP**
6. Subí el ZIP del proyecto
7. Esperá a que termine la instalación

### Opción B - Si usás VPS en Hostinger

En ese caso conviene usar Git, SFTP o File Manager + terminal. Si querés, después te adapto la guía a VPS.

---

## Paso 5 - Variables de entorno en Hostinger

En el panel de la app Node.js buscá la sección **Environment Variables** o **Variables**.

Cargá estas 3 variables:

- `PORT` = `3000`
- `OPENAI_API_KEY` = tu clave real
- `OPENAI_MODEL` = `gpt-5-mini`

Guardá.

---

## Paso 6 - Iniciar la app

Verificá que:

- el comando de inicio sea `npm start`
- el archivo principal sea `app.js`

Luego iniciá o redeployá la app.

Si todo salió bien, al abrir el dominio vas a ver la pantalla principal.

---

## Paso 7 - Primer uso

### Importar equivalencias

1. Entrá a la web
2. En el bloque **Importar equivalencias** subí tu archivo Excel matriz
3. Esperá el mensaje de confirmación

### Cargar descuento

1. Escribí el nombre exacto del proveedor
2. Escribí el descuento en porcentaje
3. Guardá

### Procesar lista del proveedor

1. Escribí el proveedor
2. Indicá descuento si corresponde
3. Subí el Excel, PDF o imagen
4. Tocá **Procesar lista con IA**

El sistema va a:
- guardar el archivo original
- mandarlo a OpenAI
- extraer códigos y precios
- cruzarlo con equivalencias
- mostrar la comparativa

---

## Cómo entiende la lógica

- Producto interno = columna A del Excel de equivalencias
- Proveedor = fila 1 desde columna B
- Código = intersección fila/columna
- Si el código no aparece en la lista nueva, el sistema muestra **no encontrado**
- No usa descripciones para matchear

---

## Repositorio de archivos

Los archivos se guardan en:

- `uploads/king/`
- `uploads/grl-group/`
- etc.

Esto te deja un historial por proveedor.

---

## Base de datos

Para esta prueba se usa una base SQLite local, dentro de:

- `data/app.db`

Ventaja:
- no necesitás crear tablas manualmente
- no necesitás tocar MySQL todavía

Cuando el MVP esté validado, se puede migrar a MySQL.

---

## Si algo falla

### 1) La página no abre
Revisá en Hostinger:
- que haya instalado dependencias
- que `npm start` esté como comando de inicio
- que exista `app.js`

### 2) Error con OpenAI
Revisá:
- que la API key esté bien pegada
- que tenga billing activo
- que el proyecto de OpenAI tenga saldo

### 3) La IA no detecta bien el archivo
Puede pasar con listas muy complejas. En ese caso, el siguiente paso sería mejorar el prompt o agregar una capa OCR previa para algunos PDFs escaneados.

---

## Siguiente evolución recomendada

Cuando este MVP funcione, lo siguiente sería:

1. filtro por proveedor
2. comparativa agrupada por producto
3. resaltado de mejor precio
4. exportación a Excel
5. migración a MySQL
6. login de administrador

