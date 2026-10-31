const express = require('express');
const { EstadoSolicitud } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { StockError, reservarStock, liberarReserva, despacharReservado } = require('../lib/stock');
const { manejarError: manejarErrorGeneral, esEnteroPositivo } = require('../lib/errores');
const { validarTransicion, accionesDisponibles } = require('./estados');
const { registrarHistorial } = require('../lib/historial');
const { autorizar } = require('../auth/middleware');
const { resolverActivo } = require('../lib/catalogos');
const { tienePermiso, PERMISO_TRANSICION, ROLES_ALISTADORES } = require('../auth/permisos');

const router = express.Router();

// Las transacciones van contra Supabase remoto: damos margen extra al tiempo límite
const OPCIONES_TX = { maxWait: 10000, timeout: 20000 };

// Estados en los que la solicitud tiene stock reservado
const ESTADOS_CON_RESERVA = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];

// Agrega las acciones válidas para el estado Y permitidas al rol, para que el frontend sepa qué botones mostrar
const conAcciones = (solicitud, usuario) => ({
  ...solicitud,
  acciones: accionesDisponibles(solicitud.estado).filter(a => tienePermiso(usuario.rol, PERMISO_TRANSICION[a]))
});

// Valida los ítems recibidos y completa la descripción desde el inventario
async function prepararItems(tx, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new StockError(400, 'La solicitud debe tener al menos un ítem.');
  }

  const preparados = [];
  for (const item of items) {
    const cantidad = Number(item.cantidad_solicitada);
    const codigo = typeof item.codigo_producto === 'string' ? item.codigo_producto.trim() : '';
    if (!codigo || !esEnteroPositivo(cantidad)) {
      throw new StockError(400, 'Cada ítem necesita código de producto y una cantidad entera mayor a 0.');
    }
    const producto = await tx.producto.findUnique({ where: { codigo_producto: codigo } });
    if (!producto) {
      throw new StockError(404, `El producto ${codigo} no existe en el inventario.`);
    }
    preparados.push({
      codigo_producto: producto.codigo_producto,
      descripcion: producto.descripcion,
      cantidad_solicitada: cantidad
    });
  }
  return preparados;
}

// Suma cantidades por producto (una SBO puede repetir el mismo código en varias líneas)
function totalesPorProducto(items, campo) {
  const totales = {};
  for (const item of items) {
    totales[item.codigo_producto] = (totales[item.codigo_producto] || 0) + item[campo];
  }
  return totales;
}

function manejarError(res, error, mensaje) {
  if (error.code === 'P2002') {
    return res.status(409).json({ error: 'Ya existe una solicitud con ese código SBO.' });
  }
  manejarErrorGeneral(res, error, mensaje);
}

// Rechaza ids no numéricos antes de llegar a Prisma
router.param('id', (req, res, next, id) => {
  if (!Number.isInteger(Number(id))) {
    return res.status(404).json({ error: 'Solicitud no encontrada.' });
  }
  next();
});

// 1. Listar solicitudes (filtro opcional por estado)
router.get('/', autorizar('inventario:ver'), async (req, res) => {
  try {
    const { estado } = req.query;
    if (estado && !Object.values(EstadoSolicitud).includes(estado)) {
      return res.status(400).json({ error: `Estado inválido: ${estado}` });
    }
    const solicitudes = await prisma.solicitud.findMany({
      where: estado ? { estado } : undefined,
      include: { items: true },
      orderBy: { fecha_solicitud: 'desc' }
    });
    res.json(solicitudes.map(s => conAcciones(s, req.usuario)));
  } catch (error) {
    manejarError(res, error, 'Error al obtener las solicitudes');
  }
});

// 2. Detalle de una solicitud con ítems y trazabilidad de estados
router.get('/:id', autorizar('inventario:ver'), async (req, res) => {
  try {
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: true, eventos: { orderBy: { fecha: 'asc' } } }
    });
    if (!solicitud) {
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }
    res.json(conAcciones(solicitud, req.usuario));
  } catch (error) {
    manejarError(res, error, 'Error al obtener la solicitud');
  }
});

// 3. Crear una solicitud SBO con sus ítems
router.post('/', autorizar('sbo:crear'), async (req, res) => {
  try {
    const { codigo_sbo, fecha_requerida, observaciones, items } = req.body;
    const creado_por = req.usuario.usuario;
    // El beneficiario es una organización del catálogo (por id o por nombre)
    const beneficiarioEnviado = req.body.organizacionId ?? req.body.beneficiario;
    if (!codigo_sbo || beneficiarioEnviado === undefined || beneficiarioEnviado === null || String(beneficiarioEnviado).trim() === '') {
      return res.status(400).json({ error: 'Código SBO y beneficiario son obligatorios.' });
    }

    const solicitud = await prisma.$transaction(async (tx) => {
      const organizacion = await resolverActivo(tx, 'organizacion', beneficiarioEnviado, { etiqueta: 'La organización beneficiaria' });
      const beneficiario = organizacion.nombre;
      const itemsPreparados = await prepararItems(tx, items);
      const nueva = await tx.solicitud.create({
        data: {
          codigo_sbo,
          beneficiario,
          organizacionId: organizacion.id,
          creado_por,
          observaciones,
          fecha_requerida: fecha_requerida ? new Date(fecha_requerida) : null,
          items: { create: itemsPreparados },
          eventos: { create: { estado_nuevo: 'CREADA', usuario: creado_por } }
        },
        include: { items: true }
      });
      await registrarHistorial(tx, codigo_sbo, 'SBO CREADA', req.usuario,
        `Solicitud para ${beneficiario} con ${itemsPreparados.length} ítem(s)`);
      return nueva;
    }, OPCIONES_TX);

    res.status(201).json(conAcciones(solicitud, req.usuario));
  } catch (error) {
    manejarError(res, error, 'Error al crear la solicitud');
  }
});

// 4. Reemplazar los ítems (solo mientras la solicitud está en CREADA)
router.put('/:id/items', autorizar('sbo:crear'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const solicitud = await prisma.$transaction(async (tx) => {
      const actual = await tx.solicitud.findUnique({ where: { id } });
      if (!actual) {
        throw new StockError(404, 'Solicitud no encontrada.');
      }
      if (actual.estado !== 'CREADA') {
        throw new StockError(400, `Los ítems solo se pueden editar en estado CREADA (actual: ${actual.estado}).`);
      }
      const itemsPreparados = await prepararItems(tx, req.body.items);
      await tx.solicitudItem.deleteMany({ where: { solicitudId: id } });
      return tx.solicitud.update({
        where: { id },
        data: { items: { create: itemsPreparados } },
        include: { items: true }
      });
    }, OPCIONES_TX);

    res.json(conAcciones(solicitud, req.usuario));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar los ítems');
  }
});

// 5. Ejecutar una transición de la máquina de estados
//    Body: { accion, alistador?, cantidades?: { [itemId]: n }, nota? }
//    Cada acción exige su permiso (auth/permisos.js: PERMISO_TRANSICION)
router.post('/:id/transicion', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { accion, alistador, cantidades = {}, nota } = req.body;
    const usuario = req.usuario.usuario;
    if (PERMISO_TRANSICION[accion] && !tienePermiso(req.usuario.rol, PERMISO_TRANSICION[accion])) {
      return res.status(403).json({ error: 'No tiene permiso para realizar esta acción.', codigo: 'SIN_PERMISO' });
    }

    const solicitud = await prisma.$transaction(async (tx) => {
      const actual = await tx.solicitud.findUnique({ where: { id }, include: { items: true } });
      if (!actual) {
        throw new StockError(404, 'Solicitud no encontrada.');
      }

      const { transicion, error } = validarTransicion(actual.estado, accion);
      if (error) {
        throw new StockError(400, error);
      }

      const datos = { estado: transicion.hacia, [transicion.fecha]: new Date() };

      const solicitadas = totalesPorProducto(actual.items, 'cantidad_solicitada');

      if (accion === 'aprobar') {
        // Se aparta el stock: los retiros manuales ya no pueden usarlo
        for (const [codigo, requerido] of Object.entries(solicitadas)) {
          await reservarStock(tx, codigo, requerido);
        }
      }

      if (accion === 'cancelar' && ESTADOS_CON_RESERVA.includes(actual.estado)) {
        for (const [codigo, reservado] of Object.entries(solicitadas)) {
          await liberarReserva(tx, codigo, reservado);
        }
      }

      if (accion === 'iniciar') {
        if (!alistador) {
          throw new StockError(400, 'Debe asignar un alistador para iniciar el alistamiento.');
        }
        const persona = await tx.usuario.findFirst({ where: { usuario: alistador, activo: true, rol: { in: ROLES_ALISTADORES } } });
        if (!persona) {
          throw new StockError(400, `"${alistador}" no es un alistador activo.`);
        }
        datos.alistador = persona.usuario;
      }

      if (accion === 'finalizar') {
        // Si no se envía cantidad para un ítem, se asume que se alistó completo
        let totalAlistado = 0;
        for (const item of actual.items) {
          const enviada = cantidades[item.id];
          const alistada = enviada === undefined ? item.cantidad_solicitada : Number(enviada);
          if (!Number.isInteger(alistada) || alistada < 0 || alistada > item.cantidad_solicitada) {
            throw new StockError(400, `Cantidad alistada inválida para ${item.codigo_producto} (0 a ${item.cantidad_solicitada}).`);
          }
          totalAlistado += alistada;
          await tx.solicitudItem.update({ where: { id: item.id }, data: { cantidad_alistada: alistada } });
        }
        if (totalAlistado === 0) {
          throw new StockError(400, 'No se alistó ningún producto. Si no hay nada que despachar, cancele la solicitud.');
        }
      }

      if (accion === 'despachar') {
        // Se descuenta lo alistado y se libera toda la reserva (incluido lo que no se alcanzó a alistar)
        const alistadas = totalesPorProducto(actual.items, 'cantidad_alistada');
        for (const [codigo, cantidad] of Object.entries(alistadas)) {
          await despacharReservado(tx, codigo, cantidad, solicitadas[codigo]);
          if (cantidad === 0) continue;
          await registrarHistorial(tx, codigo, 'SALIDA SBO', req.usuario,
            `Despacho de ${cantidad} unidades. SBO ${actual.codigo_sbo} → ${actual.beneficiario}`);
        }
      }

      // Actualización condicionada al estado leído: evita que dos usuarios ejecuten la misma transición
      const { count } = await tx.solicitud.updateMany({ where: { id, estado: actual.estado }, data: datos });
      if (count === 0) {
        throw new StockError(409, 'La solicitud fue modificada por otro usuario. Recargue e intente de nuevo.');
      }

      await tx.solicitudEvento.create({
        data: { solicitudId: id, estado_anterior: actual.estado, estado_nuevo: transicion.hacia, usuario, nota }
      });
      await registrarHistorial(tx, actual.codigo_sbo, `SBO ${transicion.hacia}`, req.usuario,
        nota || `${actual.estado} → ${transicion.hacia}${datos.alistador ? ` (alistador: ${datos.alistador})` : ''}`);

      return tx.solicitud.findUnique({
        where: { id },
        include: { items: true, eventos: { orderBy: { fecha: 'asc' } } }
      });
    }, OPCIONES_TX);

    res.json(conAcciones(solicitud, req.usuario));
  } catch (error) {
    manejarError(res, error, 'Error al cambiar el estado de la solicitud');
  }
});

module.exports = router;
