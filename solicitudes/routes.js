const express = require('express');
const { EstadoSolicitud } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { StockError, LLAVES_CONSECUTIVO, bloquearConsecutivo, bloquearSolicitud, reservarStock, liberarReserva, despacharReservado } = require('../lib/stock');
const { manejarError: manejarErrorGeneral, esEnteroPositivo } = require('../lib/errores');
const { validarTransicion, accionesDisponibles } = require('./estados');
const { registrarHistorial } = require('../lib/historial');
const { autorizar } = require('../auth/middleware');
const { resolverActivo } = require('../lib/catalogos');
const { tienePermiso, PERMISO_TRANSICION, ROLES_ALISTADORES } = require('../auth/permisos');
const { leerParametros } = require('../lib/catalogos');
const { ESTADOS_CON_RESERVA, siguienteCodigo, describirSolicitud, listarSolicitudes, revisarVencimientos } = require('../lib/solicitudes');
const { registrarNovedad, sustituirItem, devolverItem, registrarFaltantes } = require('../lib/novedades');

const router = express.Router();

// Las transacciones van contra Supabase remoto: damos margen extra al tiempo límite
const OPCIONES_TX = { maxWait: 10000, timeout: 60000 };

const INCLUIR_DETALLE = { items: { orderBy: { id: 'asc' } }, eventos: { orderBy: { fecha: 'asc' } }, novedades: { orderBy: { fecha: 'asc' }, include: { motivo: { select: { nombre: true } } } } };

// Agrega los campos calculados (Fase D3) y las acciones válidas para el estado Y permitidas al rol,
// para que el frontend sepa qué botones mostrar. Renovar solo aparece dentro del aviso de vencimiento.
const conAcciones = (solicitud, usuario, parametros) => {
  const descrita = describirSolicitud(solicitud, parametros);
  return {
    ...descrita,
    acciones: accionesDisponibles(solicitud.estado)
      .filter(a => tienePermiso(usuario.rol, PERMISO_TRANSICION[a]))
      .filter(a => a !== 'renovar' || descrita.por_vencer)
  };
};

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
    if (!producto.activo) {
      throw new StockError(409, `El producto ${codigo} está inactivo y no se puede solicitar.`);
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

// 1. Listar solicitudes.
//    Con ?pagina= devuelve { datos, total, pagina, porPagina, resumen } con filtros (estado, ACTIVAS,
//    organizacionId, alistador, desde, hasta, q, atrasada, porVencer). Sin pagina, el arreglo completo.
router.get('/', autorizar('inventario:ver'), async (req, res) => {
  try {
    const { estado } = req.query;
    if (estado && estado !== 'ACTIVAS' && !Object.values(EstadoSolicitud).includes(estado)) {
      return res.status(400).json({ error: `Estado inválido: ${estado}` });
    }
    await revisarVencimientos(prisma);
    if (req.query.pagina !== undefined) {
      return res.json(await listarSolicitudes(prisma, req.query));
    }
    const [solicitudes, parametros] = await Promise.all([
      prisma.solicitud.findMany({
        where: estado ? { estado } : undefined,
        include: { items: true, eventos: { select: { fecha: true } } },
        orderBy: { fecha_solicitud: 'desc' }
      }),
      leerParametros(prisma)
    ]);
    // Sin los eventos: la lista completa conserva su forma de antes, más los campos calculados
    res.json(solicitudes.map(s => {
      const { eventos, ...resto } = conAcciones(s, req.usuario, parametros);
      return resto;
    }));
  } catch (error) {
    manejarError(res, error, 'Error al obtener las solicitudes');
  }
});

// 1b. Código que se asignará a la próxima solicitud (SBO-0001, SBO-0002…)
router.get('/siguiente-codigo', autorizar('sbo:crear'), async (req, res) => {
  try {
    res.json({ codigo: await siguienteCodigo(prisma) });
  } catch (error) {
    manejarError(res, error, 'Error al calcular el código');
  }
});

async function responderDetalle(req, res, where) {
  try {
    await revisarVencimientos(prisma);
    const [solicitud, parametros] = await Promise.all([
      prisma.solicitud.findUnique({ where, include: INCLUIR_DETALLE }),
      leerParametros(prisma)
    ]);
    if (!solicitud) {
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }
    res.json(conAcciones(solicitud, req.usuario, parametros));
  } catch (error) {
    manejarError(res, error, 'Error al obtener la solicitud');
  }
}

// 2. Detalle por código (lo usan la remisión y los enlaces del historial)
router.get('/codigo/:codigo', autorizar('inventario:ver'), (req, res) =>
  responderDetalle(req, res, { codigo_sbo: String(req.params.codigo) }));

// 2b. Detalle de una solicitud con ítems y trazabilidad de estados
router.get('/:id', autorizar('inventario:ver'), (req, res) =>
  responderDetalle(req, res, { id: Number(req.params.id) }));

// 3. Crear una solicitud SBO con sus ítems
router.post('/', autorizar('sbo:crear'), async (req, res) => {
  try {
    const { fecha_requerida, observaciones, items } = req.body;
    const creado_por = req.usuario.usuario;
    // Sin código, el sistema asigna el siguiente SBO-0001; uno escrito a mano debe ser único.
    // Se guarda en mayúsculas para que el índice único no admita sbo-1 y SBO-1 a la vez
    const codigoEnviado = typeof req.body.codigo_sbo === 'string' ? req.body.codigo_sbo.trim().toUpperCase() : '';
    if (codigoEnviado.length > 40) {
      return res.status(400).json({ error: 'El código SBO admite máximo 40 caracteres.' });
    }
    // Fecha requerida (AAAA-MM-DD) y observaciones: se validan aquí para responder 400 y no un error interno
    let fechaRequerida = null;
    if (fecha_requerida !== undefined && fecha_requerida !== null && fecha_requerida !== '') {
      fechaRequerida = typeof fecha_requerida === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha_requerida)
        ? new Date(fecha_requerida) : null;
      if (!fechaRequerida || Number.isNaN(fechaRequerida.getTime())) {
        return res.status(400).json({ error: 'La fecha requerida debe tener el formato AAAA-MM-DD.' });
      }
    }
    if (observaciones !== undefined && observaciones !== null && (typeof observaciones !== 'string' || observaciones.trim().length > 500)) {
      return res.status(400).json({ error: 'Las observaciones deben ser texto de máximo 500 caracteres.' });
    }
    // El beneficiario es una organización del catálogo (por id o por nombre)
    const beneficiarioEnviado = req.body.organizacionId ?? req.body.beneficiario;
    if (beneficiarioEnviado === undefined || beneficiarioEnviado === null || String(beneficiarioEnviado).trim() === '') {
      return res.status(400).json({ error: 'La organización beneficiaria es obligatoria.' });
    }

    const crear = () => prisma.$transaction(async (tx) => {
      if (!codigoEnviado) await bloquearConsecutivo(tx, LLAVES_CONSECUTIVO.SBO);
      const codigo_sbo = codigoEnviado || await siguienteCodigo(tx);
      const organizacion = await resolverActivo(tx, 'organizacion', beneficiarioEnviado, { etiqueta: 'La organización beneficiaria' });
      const beneficiario = organizacion.nombre;
      const itemsPreparados = await prepararItems(tx, items);
      const nueva = await tx.solicitud.create({
        data: {
          codigo_sbo,
          beneficiario,
          organizacionId: organizacion.id,
          creado_por,
          observaciones: typeof observaciones === 'string' ? observaciones.trim() || null : null,
          fecha_requerida: fechaRequerida,
          items: { create: itemsPreparados },
          eventos: { create: { estado_nuevo: 'CREADA', usuario: creado_por } }
        },
        include: INCLUIR_DETALLE
      });
      await registrarHistorial(tx, codigo_sbo, 'SBO CREADA', req.usuario,
        `Solicitud para ${beneficiario} con ${itemsPreparados.length} ítem(s)`);
      return nueva;
    }, OPCIONES_TX);

    // Un número automático puede chocar con uno escrito a mano en ese instante: se reintenta con el siguiente
    let solicitud;
    for (let intento = 1; ; intento++) {
      try {
        solicitud = await crear();
        break;
      } catch (error) {
        if (codigoEnviado || error.code !== 'P2002' || intento === 3) throw error;
      }
    }

    res.status(201).json(conAcciones(solicitud, req.usuario, await leerParametros(prisma)));
  } catch (error) {
    manejarError(res, error, 'Error al crear la solicitud');
  }
});

// 4. Reemplazar los ítems (solo mientras la solicitud está en CREADA)
router.put('/:id/items', autorizar('sbo:crear'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const solicitud = await prisma.$transaction(async (tx) => {
      await bloquearSolicitud(tx, id);
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
        include: INCLUIR_DETALLE
      });
    }, OPCIONES_TX);

    res.json(conAcciones(solicitud, req.usuario, await leerParametros(prisma)));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar los ítems');
  }
});

// 5. Ejecutar una transición de la máquina de estados
//    Body: { accion, alistador?, cantidades?: { [itemId]: n }, nota? }
//    renovar deja el estado igual y reinicia el conteo de vencimiento; vencer es solo del sistema.
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
      await bloquearSolicitud(tx, id);
      const actual = await tx.solicitud.findUnique({ where: { id }, include: { items: true } });
      if (!actual) {
        throw new StockError(404, 'Solicitud no encontrada.');
      }

      const { transicion, error } = validarTransicion(actual.estado, accion);
      if (error) {
        throw new StockError(400, error);
      }

      const datos = { estado: transicion.hacia, ...(transicion.fecha ? { [transicion.fecha]: new Date() } : {}) };

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
        // Alistamiento parcial: la nota es obligatoria (en la Fase E se volverá una novedad)
        const parcial = actual.items.some(item => {
          const enviada = cantidades[item.id];
          return enviada !== undefined && Number(enviada) < item.cantidad_solicitada;
        });
        if (parcial && (typeof nota !== 'string' || nota.trim().length < 5)) {
          throw new StockError(400, 'Alistamiento parcial: explique en la nota por qué faltan unidades (mínimo 5 caracteres).');
        }
        // Fase E: cada ítem incompleto queda como novedad FALTANTE con la nota
        if (parcial) await registrarFaltantes(tx, actual, actual.items, cantidades, nota, req.usuario);
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
      if (accion === 'renovar') {
        await registrarHistorial(tx, actual.codigo_sbo, 'SBO RENOVADA', req.usuario,
          nota || `Renovada en ${actual.estado}: se reinicia el conteo de vencimiento`);
      } else {
        await registrarHistorial(tx, actual.codigo_sbo, `SBO ${transicion.hacia}`, req.usuario,
          nota || `${actual.estado} → ${transicion.hacia}${datos.alistador ? ` (alistador: ${datos.alistador})` : ''}`);
      }

      return tx.solicitud.findUnique({ where: { id }, include: INCLUIR_DETALLE });
    }, OPCIONES_TX);

    res.json(conAcciones(solicitud, req.usuario, await leerParametros(prisma)));
  } catch (error) {
    manejarError(res, error, 'Error al cambiar el estado de la solicitud');
  }
});

// 6. Fase E: novedades, sustitución y devolución. Responden la solicitud actualizada.
//    novedades: { tipo: FALTANTE|DANADO|TALLA_NO_DISPONIBLE|OTRO, itemId, cantidad, descripcion, motivoId? }
//    sustituir: { itemId, codigo_sustituto, descripcion }  (APROBADA o EN_ALISTAMIENTO)
//    devolver:  { itemId, cantidad, descripcion }          (DESPACHADA: vuelve al stock)
const accionesNovedad = [
  ['novedades', 'sbo:alistar', registrarNovedad, 'Error al registrar la novedad'],
  ['sustituir', 'sbo:alistar', sustituirItem, 'Error al sustituir el producto'],
  ['devolver', 'movimientos:registrar', devolverItem, 'Error al registrar la devolución']
];
for (const [ruta, permiso, accion, mensaje] of accionesNovedad) {
  router.post(`/:id/${ruta}`, autorizar(permiso), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const solicitud = await prisma.$transaction(async (tx) => {
        await accion(tx, id, req.body || {}, req.usuario);
        return tx.solicitud.findUnique({ where: { id }, include: INCLUIR_DETALLE });
      }, OPCIONES_TX);
      res.status(201).json(conAcciones(solicitud, req.usuario, await leerParametros(prisma)));
    } catch (error) {
      manejarError(res, error, mensaje);
    }
  });
}

module.exports = router;
