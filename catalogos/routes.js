const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { StockError } = require('../lib/stock');
const { autorizar } = require('../auth/middleware');
const {
  CATALOGOS, CONDICIONES, GRUPOS, TIPOS_TERCERO, TIPOS_MOTIVO, PARAMETROS,
  validarCampos, verificarUnicos, leerParametros, validarParametros
} = require('../lib/catalogos');
// Un producto está en la ubicación de su estantería o, si no tiene, en su ubicación general (p. ej. Recepción)
const { enUbicacion } = require('../lib/inventario');
const { registrarConfiguracion, describirCambios, registrarEdicion } = require('../lib/historial');

const router = express.Router();
const OPCIONES_TX = { maxWait: 10000, timeout: 20000 };


const definicion = (req, res) => {
  const def = CATALOGOS[req.params.catalogo];
  if (!def) res.status(404).json({ error: 'Catálogo no encontrado.' });
  return def;
};

// Cómo aparece cada cambio de catálogo en el historial
const areaDe = (def) => def.etiqueta[0].toUpperCase() + def.etiqueta.slice(1);
const nombreDe = (registro) => `"${registro.codigo ?? registro.nombre}"`;
const etiquetasDe = (def) => Object.fromEntries(Object.entries(def.campos).map(([campo, d]) => [campo, d.etiqueta]));

// Listas fijas que el frontend necesita para sus selectores
router.get('/catalogos/opciones', autorizar('inventario:ver'), (req, res) => {
  res.json({ condiciones: CONDICIONES, grupos: GRUPOS, tiposTercero: TIPOS_TERCERO, tiposMotivo: TIPOS_MOTIVO });
});

// Siguiente código sugerido para una categoría: PREFIJO-NNN según los códigos existentes
router.get('/catalogos/categorias/:id/siguiente-codigo', autorizar('inventario:ver'), async (req, res) => {
  try {
    const categoria = await prisma.categoria.findUnique({ where: { id: Number(req.params.id) || 0 } });
    if (!categoria) return res.status(404).json({ error: 'La categoría no existe.' });
    if (!categoria.prefijo) return res.json({ codigo: null });
    const productos = await prisma.producto.findMany({
      where: { codigo_producto: { startsWith: categoria.prefijo + '-', mode: 'insensitive' } },
      select: { codigo_producto: true }
    });
    const mayor = productos.reduce((max, p) => {
      const n = Number(p.codigo_producto.slice(categoria.prefijo.length + 1));
      return Number.isInteger(n) && n > max ? n : max;
    }, 0);
    res.json({ codigo: `${categoria.prefijo}-${String(mayor + 1).padStart(3, '0')}` });
  } catch (error) {
    manejarError(res, error, 'Error al sugerir el código');
  }
});

// Listar un catálogo. ?activos=1 solo los activos; ?tipo=SALIDA filtra motivos o terceros por tipo
router.get('/catalogos/:catalogo', autorizar('inventario:ver'), async (req, res) => {
  const def = definicion(req, res);
  if (!def) return;
  try {
    const where = {};
    if (req.query.activos === '1') where.activo = true;
    if (req.query.tipo && def.campos.tipo) {
      if (!Object.hasOwn(def.campos.tipo.valores, req.query.tipo)) return res.status(400).json({ error: 'Tipo no válido.' });
      // Un tercero "AMBOS" aparece tanto entre donantes como entre proveedores
      where.tipo = req.query.tipo === 'DONANTE' || req.query.tipo === 'PROVEEDOR' ? { in: [req.query.tipo, 'AMBOS'] } : req.query.tipo;
    }
    const registros = await prisma[def.modelo].findMany({ where, orderBy: def.orden });
    if (req.params.catalogo === 'categorias') {
      const conteos = await prisma.producto.groupBy({ by: ['categoriaId'], _count: true });
      const porCategoria = Object.fromEntries(conteos.map(c => [c.categoriaId, c._count]));
      return res.json(registros.map(r => ({ ...r, productos: porCategoria[r.id] || 0 })));
    }
    res.json(registros);
  } catch (error) {
    manejarError(res, error, 'Error al consultar el catálogo');
  }
});

router.post('/catalogos/:catalogo', autorizar('configuracion:gestionar'), async (req, res) => {
  const def = definicion(req, res);
  if (!def) return;
  try {
    const data = validarCampos(def, req.body || {});
    const registro = await prisma.$transaction(async (tx) => {
      await verificarUnicos(tx, def, data);
      const creado = await tx[def.modelo].create({ data });
      await registrarConfiguracion(tx, areaDe(def), req.usuario, `Creó ${nombreDe(creado)}`);
      return creado;
    }, OPCIONES_TX);
    res.status(201).json(registro);
  } catch (error) {
    manejarError(res, error, 'Error al guardar en el catálogo');
  }
});

// Editar o activar/desactivar. No existe borrado.
router.patch('/catalogos/:catalogo/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  const def = definicion(req, res);
  if (!def) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'El registro no existe.' });
    const data = validarCampos(def, req.body || {}, { parcial: true });
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No hay cambios para guardar.' });

    const registro = await prisma.$transaction(async (tx) => {
      const actual = await tx[def.modelo].findUnique({ where: { id } });
      if (!actual) throw new StockError(404, 'El registro no existe.');
      await verificarUnicos(tx, def, data, id, actual);

      if (req.params.catalogo === 'ubicaciones') {
        // Los huecos de una estantería se administran desde Configuración → Estanterías
        if (actual.estanteriaId && ((data.codigo && data.codigo !== actual.codigo) || 'activo' in data)) {
          throw new StockError(409, `${actual.codigo} es un hueco de estantería: cámbielo desde Configuración → Estanterías.`);
        }
        const cambiaCodigo = data.codigo && data.codigo !== actual.codigo;
        if (cambiaCodigo || data.activo === false) {
          const ocupada = await tx.producto.count({ where: enUbicacion(actual.codigo) });
          if (ocupada > 0) {
            throw new StockError(409, `La ubicación ${actual.codigo} tiene ${ocupada} producto(s). Reubíquelos antes de ${cambiaCodigo ? 'cambiar su código' : 'desactivarla'}.`);
          }
        }
      }

      const actualizado = await tx[def.modelo].update({ where: { id }, data });
      // El texto de categoría de los productos sigue al nombre del catálogo
      if (req.params.catalogo === 'categorias' && data.nombre && data.nombre !== actual.nombre) {
        await tx.producto.updateMany({ where: { categoriaId: id }, data: { categoria: data.nombre } });
      }
      await registrarEdicion(tx, areaDe(def), req.usuario, nombreDe(actual), actual, actualizado, etiquetasDe(def));
      return actualizado;
    }, OPCIONES_TX);
    res.json(registro);
  } catch (error) {
    manejarError(res, error, 'Error al actualizar el catálogo');
  }
});

// --- Parámetros de operación ---
router.get('/parametros', autorizar('inventario:ver'), async (req, res) => {
  try {
    const valores = await leerParametros(prisma);
    res.json(Object.entries(PARAMETROS).map(([clave, d]) => ({ clave, etiqueta: d.etiqueta, valor: valores[clave], defecto: d.defecto, min: d.min, max: d.max })));
  } catch (error) {
    manejarError(res, error, 'Error al consultar los parámetros');
  }
});

router.put('/parametros', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const cambios = await prisma.$transaction(async (tx) => {
      const antes = await leerParametros(tx);
      const nuevos = validarParametros(req.body || {}, antes);
      for (const [clave, valor] of Object.entries(nuevos)) {
        await tx.parametro.upsert({ where: { clave }, create: { clave, valor: String(valor) }, update: { valor: String(valor) } });
      }
      const despues = await leerParametros(tx);
      const etiquetas = Object.fromEntries(Object.entries(PARAMETROS).map(([clave, d]) => [clave, d.etiqueta]));
      const cambios = describirCambios(antes, despues, etiquetas);
      if (cambios) await registrarConfiguracion(tx, 'Parámetros', req.usuario, cambios);
      return despues;
    }, OPCIONES_TX);
    res.json(cambios);
  } catch (error) {
    manejarError(res, error, 'Error al guardar los parámetros');
  }
});

// --- Ubicaciones para el equipo del Mapa de Bodega (solo lectura) ---
router.get('/ubicaciones', autorizar('inventario:ver'), async (req, res) => {
  try {
    const [ubicaciones, productos] = await Promise.all([
      prisma.ubicacion.findMany({ where: req.query.todas === '1' ? {} : { activo: true }, orderBy: { codigo: 'asc' } }),
      prisma.producto.findMany({ select: { codigo_estanteria: true, ubicacion_general: true, cantidad: true } })
    ]);
    const resumen = {};
    for (const p of productos) {
      const clave = (p.codigo_estanteria || p.ubicacion_general).toLowerCase();
      resumen[clave] ||= { productos: 0, unidades: 0 };
      resumen[clave].productos++;
      resumen[clave].unidades += p.cantidad;
    }
    res.json(ubicaciones.map(u => ({ ...u, ...(resumen[u.codigo.toLowerCase()] || { productos: 0, unidades: 0 }) })));
  } catch (error) {
    manejarError(res, error, 'Error al consultar las ubicaciones');
  }
});

router.get('/ubicaciones/:codigo/contenido', autorizar('inventario:ver'), async (req, res) => {
  try {
    const ubicacion = await prisma.ubicacion.findFirst({ where: { codigo: { equals: req.params.codigo, mode: 'insensitive' } } });
    if (!ubicacion) return res.status(404).json({ error: 'La ubicación no existe.' });
    const productos = await prisma.producto.findMany({
      where: enUbicacion(ubicacion.codigo),
      orderBy: { codigo_producto: 'asc' },
      select: { id: true, codigo_producto: true, descripcion: true, categoria: true, cantidad: true, cantidad_reservada: true, condicion: true, talla: true, activo: true }
    });
    res.json({ ubicacion, productos, unidades: productos.reduce((s, p) => s + p.cantidad, 0) });
  } catch (error) {
    manejarError(res, error, 'Error al consultar el contenido de la ubicación');
  }
});

module.exports = { router, enUbicacion };
