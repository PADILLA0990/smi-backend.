const express = require('express');
const prisma = require('../lib/prisma');
const { descontarStock, StockError } = require('../lib/stock');
const { manejarError, esEnteroPositivo, campoFaltante } = require('../lib/errores');
const { registrarHistorial } = require('../lib/historial');
const { autorizar } = require('../auth/middleware');
const { CONDICIONES, GRUPOS, resolverActivo } = require('../lib/catalogos');
const { listarProductos, kardexProducto, ESTADOS_SBO_ACTIVOS } = require('../lib/inventario');

const router = express.Router();

// Atributos opcionales del producto (Fase C). Devuelve solo los campos enviados, ya validados.
function validarAtributos(body) {
  const data = {};
  if ('talla' in body) {
    const talla = typeof body.talla === 'string' ? body.talla.trim() : '';
    if (talla.length > 20) throw new StockError(400, 'Talla: máximo 20 caracteres.');
    data.talla = talla || null;
  }
  if ('condicion' in body) {
    if (body.condicion && !Object.hasOwn(CONDICIONES, body.condicion)) throw new StockError(400, 'Condición no válida.');
    data.condicion = body.condicion || null;
  }
  if ('grupo' in body) {
    if (body.grupo && !GRUPOS.includes(body.grupo)) throw new StockError(400, 'Género o grupo etario no válido.');
    data.grupo = body.grupo || null;
  }
  if ('stock_minimo' in body) {
    const vacio = body.stock_minimo === null || body.stock_minimo === '';
    const n = Number(body.stock_minimo);
    if (!vacio && (!Number.isInteger(n) || n < 0 || n > 100000)) throw new StockError(400, 'Stock mínimo: número entero entre 0 y 100.000.');
    data.stock_minimo = vacio ? null : n;
  }
  return data;
}

// La categoría llega como id (categoriaId) o por nombre (categoria); debe estar activa en el catálogo
const resolverCategoria = (tx, body) =>
  resolverActivo(tx, 'categoria', body.categoriaId ?? body.categoria, { etiqueta: 'La categoría' });

// Una ubicación del catálogo, por su código
const resolverUbicacion = (tx, codigo) =>
  resolverActivo(tx, 'ubicacion', codigo, { campoTexto: 'codigo', etiqueta: 'La ubicación' });

const OPCIONES_TX = { maxWait: 10000, timeout: 20000 };

// Acciones del historial que no mueven stock: un producto que solo tiene estas (y su ingreso inicial)
// se considera "sin movimientos" y el Administrador puede borrarlo físicamente
const ACCIONES_SIN_MOVIMIENTO = ['INGRESO NUEVO', 'EDICIÓN', 'INACTIVACIÓN', 'ACTIVACIÓN'];

// Justificación obligatoria para inactivar o activar (texto libre: explica el caso, no clasifica)
function leerJustificacion(body) {
  const justificacion = typeof body?.justificacion === 'string' ? body.justificacion.trim() : '';
  if (justificacion.length < 5 || justificacion.length > 200) {
    throw new StockError(400, 'La justificación es obligatoria (entre 5 y 200 caracteres).');
  }
  return justificacion;
}

// SBO en curso que incluyen el producto
const sboActivasDe = (tx, codigo_producto) => tx.solicitud.findMany({
  where: { estado: { in: ESTADOS_SBO_ACTIVOS }, items: { some: { codigo_producto } } },
  select: { codigo_sbo: true }
});

// Cada acción sobre el inventario guarda su auditoría en la misma transacción:
// o quedan registrados ambos (movimiento + historial) o ninguno.
// El autor es siempre el usuario autenticado (req.usuario); se ignora cualquier "operario" del cuerpo.

const idValido = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'El producto no existe.' });
    return null;
  }
  return id;
};

// Obtener el inventario de productos.
// Con ?pagina= responde { datos, total, pagina, porPagina, resumen } con filtros y orden (lib/inventario.js);
// sin ella devuelve la lista completa, como antes (la usan los formularios y el verificador).
router.get('/productos', autorizar('inventario:ver'), async (req, res) => {
  try {
    if (req.query.pagina !== undefined) return res.json(await listarProductos(prisma, req.query));
    const productos = await prisma.producto.findMany({
      orderBy: { fecha_ingreso: 'desc' },
      include: { categoriaRef: { select: { nombre: true, prefijo: true } } }
    });
    // "categoria" muestra el nombre vigente del catálogo; el texto original queda solo para productos sin enlazar
    res.json(productos.map(({ categoriaRef, ...p }) => ({ ...p, categoria: categoriaRef?.nombre ?? p.categoria })));
  } catch (error) {
    manejarError(res, error, 'Error al conectar con la base de datos');
  }
});

// Ingreso: crea el producto o, si el código ya existe, suma la cantidad a su stock
router.post('/productos', autorizar('movimientos:registrar'), async (req, res) => {
  try {
    const faltante = campoFaltante(req.body, ['codigo_producto', 'descripcion']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    const cantidad = Number(req.body.cantidad);
    if (!esEnteroPositivo(cantidad)) {
      return res.status(400).json({ error: 'La cantidad debe ser un número entero mayor a 0.' });
    }

    const codigo_producto = req.body.codigo_producto.trim();
    const descripcion = req.body.descripcion.trim();
    const atributos = validarAtributos(req.body);

    const resultado = await prisma.$transaction(async (tx) => {
      const existente = await tx.producto.findUnique({ where: { codigo_producto } });

      if (existente) {
        if (!existente.activo) throw new StockError(409, `El producto ${codigo_producto} está inactivo. Actívelo antes de registrar ingresos.`);
        const producto = await tx.producto.update({
          where: { id: existente.id },
          data: { cantidad: { increment: cantidad } }
        });
        await registrarHistorial(tx, codigo_producto, 'INGRESO ADICIONAL', req.usuario,
          `Ingresó cantidad: ${cantidad}. Stock total: ${producto.cantidad}`);
        return { producto, adicional: true };
      }

      // Producto nuevo: la categoría y la ubicación deben existir en los catálogos
      if (req.body.categoriaId === undefined && (typeof req.body.categoria !== 'string' || !req.body.categoria.trim())) {
        throw new StockError(400, 'El campo "categoria" es obligatorio.');
      }
      const categoria = await resolverCategoria(tx, req.body);
      const ubicacion = await resolverUbicacion(tx, req.body.ubicacion_general || 'Recepción');
      const producto = await tx.producto.create({
        data: {
          codigo_producto, descripcion, cantidad, ...atributos,
          categoria: categoria.nombre,
          categoriaId: categoria.id,
          // "estado" (texto) se conserva por compatibilidad y refleja la condición
          estado: atributos.condicion ? CONDICIONES[atributos.condicion] : (req.body.estado || 'Bueno'),
          ubicacion_general: ubicacion.codigo
        }
      });
      await registrarHistorial(tx, codigo_producto, 'INGRESO NUEVO', req.usuario, `Ingresó cantidad: ${cantidad}`);
      return { producto, adicional: false };
    }, OPCIONES_TX);

    res.status(resultado.adicional ? 200 : 201).json(resultado);
  } catch (error) {
    manejarError(res, error, 'Error al registrar el ingreso');
  }
});

// Reubicar un producto
router.put('/productos/:id', autorizar('productos:reubicar'), async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;

    const faltante = campoFaltante(req.body, ['codigo_estanteria']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    const producto = await prisma.$transaction(async (tx) => {
      if (!(await tx.producto.findUnique({ where: { id } }))) throw new StockError(404, 'El producto no existe.');
      // Solo se puede mover a una ubicación activa del catálogo
      const ubicacion = await resolverUbicacion(tx, req.body.codigo_estanteria);
      const actualizado = await tx.producto.update({
        where: { id },
        data: { ubicacion_general: ubicacion.zona || 'Almacenamiento', codigo_estanteria: ubicacion.codigo }
      });
      await registrarHistorial(tx, actualizado.codigo_producto, 'REUBICACIÓN', req.usuario, `Movido a: ${actualizado.codigo_estanteria}`);
      return actualizado;
    }, OPCIONES_TX);

    res.json(producto);
  } catch (error) {
    manejarError(res, error, 'Error al reubicar el producto');
  }
});

// Kardex: movimientos con saldo acumulado y SBO en las que está el producto
router.get('/productos/:id/kardex', autorizar('inventario:ver'), async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;
    res.json(await kardexProducto(prisma, id));
  } catch (error) {
    manejarError(res, error, 'Error al consultar el kardex');
  }
});

// Inactivar (borrado lógico): el producto deja de recibir ingresos y de aparecer en SBO nuevas.
// Conserva su stock y su historial; las unidades que queden se pueden retirar.
router.post('/productos/:id/inactivar', autorizar('productos:inactivar'), async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;
    const justificacion = leerJustificacion(req.body);

    const producto = await prisma.$transaction(async (tx) => {
      const actual = await tx.producto.findUnique({ where: { id } });
      if (!actual) throw new StockError(404, 'El producto no existe.');
      if (!actual.activo) throw new StockError(400, `${actual.codigo_producto} ya está inactivo.`);
      const pendientes = await sboActivasDe(tx, actual.codigo_producto);
      if (pendientes.length > 0) {
        throw new StockError(409, `No se puede inactivar: el producto está en Solicitudes SBO en curso (${pendientes.map(s => s.codigo_sbo).join(', ')}). Cancélelas o despáchelas primero.`);
      }
      const actualizado = await tx.producto.update({ where: { id }, data: { activo: false } });
      await registrarHistorial(tx, actual.codigo_producto, 'INACTIVACIÓN', req.usuario,
        `Justificación: ${justificacion} (tenía ${actual.cantidad} unidades)`);
      return actualizado;
    }, OPCIONES_TX);

    res.json(producto);
  } catch (error) {
    manejarError(res, error, 'Error al inactivar el producto');
  }
});

router.post('/productos/:id/activar', autorizar('productos:inactivar'), async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;
    const justificacion = leerJustificacion(req.body);

    const producto = await prisma.$transaction(async (tx) => {
      const actual = await tx.producto.findUnique({ where: { id } });
      if (!actual) throw new StockError(404, 'El producto no existe.');
      if (actual.activo) throw new StockError(400, `${actual.codigo_producto} ya está activo.`);
      const actualizado = await tx.producto.update({ where: { id }, data: { activo: true } });
      await registrarHistorial(tx, actual.codigo_producto, 'ACTIVACIÓN', req.usuario, `Justificación: ${justificacion}`);
      return actualizado;
    }, OPCIONES_TX);

    res.json(producto);
  } catch (error) {
    manejarError(res, error, 'Error al activar el producto');
  }
});

// Borrado físico: solo el Administrador y solo si el producto no tiene movimientos
// (registrado por error). Lo normal es inactivarlo.
router.delete('/productos/:id', autorizar('productos:eliminar'), async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;

    await prisma.$transaction(async (tx) => {
      const producto = await tx.producto.findUnique({ where: { id } });
      if (!producto) {
        throw new StockError(404, 'El producto no existe.');
      }

      const [movimientos, enSolicitudes] = await Promise.all([
        tx.historial.count({ where: { codigo_producto: producto.codigo_producto, accion: { notIn: ACCIONES_SIN_MOVIMIENTO } } }),
        tx.solicitudItem.count({ where: { codigo_producto: producto.codigo_producto } })
      ]);
      if (movimientos > 0 || enSolicitudes > 0 || producto.cantidad_reservada > 0) {
        throw new StockError(409, `No se puede borrar ${producto.codigo_producto}: ya tiene movimientos${enSolicitudes > 0 ? ' o Solicitudes SBO' : ''}. Inactívelo en su lugar.`);
      }

      await tx.producto.delete({ where: { id } });
      await registrarHistorial(tx, producto.codigo_producto, 'ELIMINACIÓN', req.usuario,
        `Producto registrado por error, borrado del sistema (tenía ${producto.cantidad} unidades)`);
    }, OPCIONES_TX);

    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error) {
    manejarError(res, error, 'Error al eliminar el producto');
  }
});

// Editar datos descriptivos del producto (no cambia stock ni ubicación)
const ETIQUETAS_EDICION = {
  descripcion: 'descripción', categoria: 'categoría', talla: 'talla', condicion: 'condición',
  grupo: 'grupo', stock_minimo: 'stock mínimo'
};

router.patch('/productos/:id', autorizar('productos:editar'), async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;
    const body = req.body || {};
    const data = validarAtributos(body);
    if ('descripcion' in body) {
      const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
      if (!descripcion || descripcion.length > 200) return res.status(400).json({ error: 'La descripción es obligatoria (máximo 200 caracteres).' });
      data.descripcion = descripcion;
    }
    if ('activo' in body) {
      return res.status(400).json({ error: 'Para inactivar o activar un producto use la acción correspondiente (pide una justificación).' });
    }

    const producto = await prisma.$transaction(async (tx) => {
      const actual = await tx.producto.findUnique({ where: { id } });
      if (!actual) throw new StockError(404, 'El producto no existe.');
      if ('categoriaId' in body || 'categoria' in body) {
        const categoria = await resolverCategoria(tx, body);
        data.categoria = categoria.nombre;
        data.categoriaId = categoria.id;
      }
      if (data.condicion) data.estado = CONDICIONES[data.condicion];

      const cambios = Object.keys(ETIQUETAS_EDICION).filter(c => c in data && data[c] !== actual[c]);
      if (cambios.length === 0) throw new StockError(400, 'No hay cambios para guardar.');
      const actualizado = await tx.producto.update({ where: { id }, data });
      const mostrar = (c, v) => (v === null || v === undefined ? 'vacío' : c === 'condicion' ? CONDICIONES[v] : v);
      await registrarHistorial(tx, actual.codigo_producto, 'EDICIÓN', req.usuario,
        cambios.map(c => `${ETIQUETAS_EDICION[c]}: ${mostrar(c, actual[c])} → ${mostrar(c, data[c])}`).join('; '));
      return actualizado;
    }, OPCIONES_TX);

    res.json(producto);
  } catch (error) {
    manejarError(res, error, 'Error al editar el producto');
  }
});

// Salida manual de inventario
router.post('/salida', autorizar('movimientos:registrar'), async (req, res) => {
  try {
    const { codigo_producto, cantidad_retirada } = req.body;

    const faltante = campoFaltante(req.body, ['codigo_producto']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    const motivoEnviado = req.body.motivoId ?? req.body.motivo;
    if (motivoEnviado === undefined || motivoEnviado === null || String(motivoEnviado).trim() === '') {
      return res.status(400).json({ error: 'El campo "motivo" es obligatorio.' });
    }
    if (!esEnteroPositivo(cantidad_retirada)) {
      return res.status(400).json({ error: 'La cantidad a retirar debe ser un número entero mayor a 0.' });
    }
    const detalle = typeof req.body.detalle === 'string' ? req.body.detalle.trim() : '';
    if (detalle.length > 200) {
      return res.status(400).json({ error: 'El detalle admite máximo 200 caracteres.' });
    }

    const nuevaCantidad = await prisma.$transaction(async (tx) => {
      // El motivo sale del catálogo de motivos de salida
      const motivo = await resolverActivo(tx, 'motivo', motivoEnviado, { extra: { tipo: 'SALIDA' }, etiqueta: 'El motivo de salida' });
      const restante = await descontarStock(tx, codigo_producto.trim(), cantidad_retirada);
      await registrarHistorial(tx, codigo_producto.trim(), 'SALIDA/RETIRO', req.usuario,
        `Retiro de ${cantidad_retirada} unidades. Motivo: ${motivo.nombre}${detalle ? `. Detalle: ${detalle}` : ''}`);
      return restante;
    }, OPCIONES_TX);

    res.json({ message: 'Salida exitosa', nuevaCantidad });
  } catch (error) {
    manejarError(res, error, 'Error interno del servidor');
  }
});

module.exports = router;
