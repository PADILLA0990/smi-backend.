// Fase E: novedades de las SBO (faltante, dañado, talla, sustitución, devolución, otro) y trazabilidad.
const { StockError, LLAVES_CONSECUTIVO, bloquearConsecutivo, bloquearSolicitud, reservarStock, liberarReserva } = require('./stock');
const { registrarHistorial } = require('./historial');
const { leerPaginacion, filtroFechas } = require('./inventario');

const TIPOS = {
  FALTANTE: 'Faltante',
  DANADO: 'Artículo dañado',
  TALLA_NO_DISPONIBLE: 'Talla no disponible',
  SUSTITUCION: 'Sustitución',
  DEVOLUCION: 'Devolución',
  OTRO: 'Otro'
};
// Las que se registran a mano (sustitución y devolución tienen su propia acción porque mueven stock o reservas)
const TIPOS_MANUALES = ['FALTANTE', 'DANADO', 'TALLA_NO_DISPONIBLE', 'OTRO'];
const ESTADOS_CON_NOVEDAD = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA', 'DESPACHADA'];
const ESTADOS_SUSTITUCION = ['APROBADA', 'EN_ALISTAMIENTO'];

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

async function siguienteCodigoNovedad(tx) {
  await bloquearConsecutivo(tx, LLAVES_CONSECUTIVO.NOVEDAD);
  const ultima = await tx.novedad.findFirst({ orderBy: { id: 'desc' }, select: { codigo: true } });
  const n = ultima ? Number((ultima.codigo.match(/(\d+)$/) || [0, 0])[1]) : 0;
  return `NOV-${String(n + 1).padStart(4, '0')}`;
}

// Crea la novedad y deja un registro "NOVEDAD" (sin efecto en stock) en el historial del producto
async function crearNovedad(tx, { sbo: codigoSbo, ...datos }, usuario) {
  const codigo = await siguienteCodigoNovedad(tx);
  const novedad = await tx.novedad.create({
    data: { ...datos, codigo, usuario: usuario.usuario, usuarioId: usuario.id ?? null }
  });
  const sbo = codigoSbo ? ` · SBO ${codigoSbo}` : '';
  await registrarHistorial(tx, datos.codigo_producto, 'NOVEDAD',
    usuario, `${codigo} ${TIPOS[datos.tipo]}: ${datos.cantidad} u.${sbo}. ${datos.descripcion}`);
  return novedad;
}

const descripcionValida = (d) => {
  const t = texto(d);
  if (t.length < 5) throw new StockError(400, 'Describa la novedad (mínimo 5 caracteres).');
  return t.slice(0, 500);
};

async function cargarSolicitudEItem(tx, solicitudId, itemId) {
  await bloquearSolicitud(tx, solicitudId);
  const solicitud = await tx.solicitud.findUnique({ where: { id: solicitudId }, include: { items: true } });
  if (!solicitud) throw new StockError(404, 'Solicitud no encontrada.');
  const item = solicitud.items.find(i => i.id === Number(itemId));
  if (!item) throw new StockError(400, 'El ítem no pertenece a esta solicitud.');
  return { solicitud, item };
}

// Novedad informativa (no mueve stock): faltante, dañado, talla no disponible u otro
async function registrarNovedad(tx, solicitudId, body, usuario) {
  const tipo = texto(body.tipo);
  if (!TIPOS_MANUALES.includes(tipo)) throw new StockError(400, `Tipo de novedad inválido. Use: ${TIPOS_MANUALES.join(', ')}.`);
  const { solicitud, item } = await cargarSolicitudEItem(tx, solicitudId, body.itemId);
  if (!ESTADOS_CON_NOVEDAD.includes(solicitud.estado)) {
    throw new StockError(400, `Solo se registran novedades en solicitudes aprobadas, en alistamiento, alistadas o despachadas (actual: ${solicitud.estado}).`);
  }
  const cantidad = Number(body.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > item.cantidad_solicitada) {
    throw new StockError(400, `Cantidad inválida (1 a ${item.cantidad_solicitada}).`);
  }
  let motivoId = null;
  if (body.motivoId !== undefined && body.motivoId !== null && body.motivoId !== '') {
    const motivo = await tx.motivo.findFirst({ where: { id: Number(body.motivoId), tipo: 'NOVEDAD', activo: true } });
    if (!motivo) throw new StockError(400, 'El motivo de novedad no existe o está inactivo.');
    motivoId = motivo.id;
  }
  return crearNovedad(tx, {
    tipo, solicitudId, itemId: item.id, codigo_producto: item.codigo_producto, cantidad,
    descripcion: descripcionValida(body.descripcion), motivoId, sbo: solicitud.codigo_sbo
  }, usuario);
}

// Sustitución: el ítem pasa a otro producto equivalente. Se libera la reserva del original y se reserva el sustituto.
async function sustituirItem(tx, solicitudId, body, usuario) {
  const { solicitud, item } = await cargarSolicitudEItem(tx, solicitudId, body.itemId);
  if (!ESTADOS_SUSTITUCION.includes(solicitud.estado)) {
    throw new StockError(400, `Solo se sustituye en solicitudes aprobadas o en alistamiento (actual: ${solicitud.estado}).`);
  }
  const codigo = texto(body.codigo_sustituto);
  if (!codigo) throw new StockError(400, 'Indique el producto sustituto.');
  if (codigo === item.codigo_producto) throw new StockError(400, 'El sustituto debe ser un producto distinto.');
  const sustituto = await tx.producto.findUnique({ where: { codigo_producto: codigo } });
  if (!sustituto) throw new StockError(404, `El producto ${codigo} no existe en el inventario.`);
  if (!sustituto.activo) throw new StockError(409, `El producto ${codigo} está inactivo.`);
  const descripcion = descripcionValida(body.descripcion);

  await liberarReserva(tx, item.codigo_producto, item.cantidad_solicitada);
  await reservarStock(tx, codigo, item.cantidad_solicitada);
  // Condicionado al estado leído: si la solicitud cambió mientras tanto, se revierte todo
  const { count } = await tx.solicitud.updateMany({ where: { id: solicitud.id, estado: solicitud.estado }, data: { estado: solicitud.estado } });
  if (count === 0) throw new StockError(409, 'La solicitud fue modificada por otro usuario. Recargue e intente de nuevo.');
  await tx.solicitudItem.update({
    where: { id: item.id },
    data: { codigo_producto: codigo, descripcion: sustituto.descripcion, codigo_original: item.codigo_original || item.codigo_producto }
  });
  const novedad = await crearNovedad(tx, {
    tipo: 'SUSTITUCION', solicitudId: solicitud.id, itemId: item.id, codigo_producto: item.codigo_producto,
    codigo_sustituto: codigo, cantidad: item.cantidad_solicitada, descripcion, sbo: solicitud.codigo_sbo
  }, usuario);
  await registrarHistorial(tx, codigo, 'NOVEDAD', usuario,
    `${novedad.codigo} Sustituto de ${item.codigo_producto}: ${item.cantidad_solicitada} u. reservadas · SBO ${solicitud.codigo_sbo}. ${descripcion}`);
  await registrarHistorial(tx, solicitud.codigo_sbo, 'SBO SUSTITUCIÓN', usuario,
    `${item.codigo_producto} → ${codigo} (${item.cantidad_solicitada} u.). ${novedad.codigo}: ${descripcion}`);
  return novedad;
}

// Devolución después del despacho: las unidades vuelven al stock del producto despachado
async function devolverItem(tx, solicitudId, body, usuario) {
  const { solicitud, item } = await cargarSolicitudEItem(tx, solicitudId, body.itemId);
  if (solicitud.estado !== 'DESPACHADA') throw new StockError(400, `Solo se registran devoluciones de solicitudes despachadas (actual: ${solicitud.estado}).`);
  const maximo = item.cantidad_alistada - item.cantidad_devuelta;
  const cantidad = Number(body.cantidad);
  if (maximo <= 0) throw new StockError(400, `Ya se devolvieron todas las unidades despachadas de ${item.codigo_producto}.`);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > maximo) throw new StockError(400, `Cantidad inválida (1 a ${maximo}).`);
  const descripcion = descripcionValida(body.descripcion);

  const producto = await tx.producto.findUnique({ where: { codigo_producto: item.codigo_producto } });
  if (!producto) throw new StockError(404, `El producto ${item.codigo_producto} ya no existe en el inventario; regístrelo con un documento de ingreso.`);
  // Condicionado a lo devuelto que se leyó: dos devoluciones simultáneas no superan lo despachado
  const { count } = await tx.solicitudItem.updateMany({
    where: { id: item.id, cantidad_devuelta: item.cantidad_devuelta },
    data: { cantidad_devuelta: item.cantidad_devuelta + cantidad }
  });
  if (count === 0) throw new StockError(409, 'El ítem fue modificado por otro usuario. Recargue e intente de nuevo.');
  await tx.producto.update({ where: { id: producto.id }, data: { cantidad: { increment: cantidad } } });
  const novedad = await crearNovedad(tx, {
    tipo: 'DEVOLUCION', solicitudId: solicitud.id, itemId: item.id, codigo_producto: item.codigo_producto,
    cantidad, descripcion, sbo: solicitud.codigo_sbo
  }, usuario);
  // El verificador suma "Devolución de N" como un ingreso
  await registrarHistorial(tx, item.codigo_producto, 'DEVOLUCIÓN SBO', usuario,
    `Devolución de ${cantidad} unidades. SBO ${solicitud.codigo_sbo} ← ${solicitud.beneficiario}. ${novedad.codigo}: ${descripcion}`);
  return novedad;
}

// Faltantes automáticos al finalizar un alistamiento parcial (la nota es la descripción)
async function registrarFaltantes(tx, solicitud, itemsAntes, cantidades, nota, usuario) {
  for (const item of itemsAntes) {
    const alistada = cantidades[item.id] === undefined ? item.cantidad_solicitada : Number(cantidades[item.id]);
    if (alistada >= item.cantidad_solicitada) continue;
    await crearNovedad(tx, {
      tipo: 'FALTANTE', solicitudId: solicitud.id, itemId: item.id, codigo_producto: item.codigo_producto,
      cantidad: item.cantidad_solicitada - alistada, descripcion: texto(nota).slice(0, 500), sbo: solicitud.codigo_sbo
    }, usuario);
  }
}

const INCLUIR_LISTA = {
  solicitud: { select: { id: true, codigo_sbo: true, beneficiario: true, estado: true } },
  motivo: { select: { id: true, nombre: true } }
};

// Lista con filtros: tipo, q (código, producto, SBO, descripción), sbo, desde, hasta. Sin ?pagina devuelve todo (exportar).
async function listarNovedades(prisma, query) {
  const and = filtroFechas(query);
  const tipo = texto(query.tipo);
  if (tipo) {
    if (!TIPOS[tipo]) throw new StockError(400, 'Tipo de novedad inválido.');
    and.push({ tipo });
  }
  const sbo = texto(query.sbo);
  if (sbo) and.push({ solicitud: { codigo_sbo: { equals: sbo, mode: 'insensitive' } } });
  const q = texto(query.q);
  if (q) {
    const c = { contains: q, mode: 'insensitive' };
    and.push({ OR: [{ codigo: c }, { codigo_producto: c }, { codigo_sustituto: c }, { descripcion: c }, { usuario: c }, { solicitud: { codigo_sbo: c } }] });
  }
  const where = { AND: and };
  const orderBy = [{ fecha: 'desc' }, { id: 'desc' }];
  if (!query.pagina) return prisma.novedad.findMany({ where, include: INCLUIR_LISTA, orderBy });
  const { pagina, porPagina } = leerPaginacion(query, 20);
  const [datos, total, porTipo] = await Promise.all([
    prisma.novedad.findMany({ where, include: INCLUIR_LISTA, orderBy, skip: (pagina - 1) * porPagina, take: porPagina }),
    prisma.novedad.count({ where }),
    prisma.novedad.groupBy({ by: ['tipo'], where, _count: true })
  ]);
  return { datos, total, pagina, porPagina, resumen: Object.fromEntries(porTipo.map(t => [t.tipo, t._count])) };
}

// --- Trazabilidad: línea de tiempo unificada por código de producto o de SBO ---
const eventoHistorial = (h, extra = {}) => ({
  fecha: h.fecha, origen: 'historial', accion: h.accion, detalle: h.detalles, usuario: h.operario,
  documento: h.documento ? h.documento.numero : null, documentoId: h.documentoId || null, ...extra
});
const eventoNovedad = (n) => ({
  fecha: n.fecha, origen: 'novedad', accion: `NOVEDAD · ${TIPOS[n.tipo]}`, tipo: n.tipo, codigo: n.codigo,
  detalle: `${n.cantidad} u. de ${n.codigo_producto}${n.codigo_sustituto ? ` → ${n.codigo_sustituto}` : ''}. ${n.descripcion}`,
  usuario: n.usuario, sbo: n.solicitud?.codigo_sbo || null
});
const eventoSolicitud = (s, e) => ({
  fecha: e.fecha, origen: 'sbo', accion: `SBO ${e.estado_nuevo}`, sbo: s.codigo_sbo,
  detalle: `${s.codigo_sbo} (${s.beneficiario})${e.estado_anterior ? `: ${e.estado_anterior} → ${e.estado_nuevo}` : ''}${e.nota ? `. ${e.nota}` : ''}`,
  usuario: e.usuario
});
const porFecha = (a, b) => new Date(a.fecha) - new Date(b.fecha);

async function trazabilidad(prisma, codigoBuscado) {
  const codigo = texto(codigoBuscado);
  if (!codigo) throw new StockError(400, 'Indique un código de producto o de SBO.');
  const conDocumento = { documento: { select: { numero: true } } };

  const solicitud = await prisma.solicitud.findFirst({
    where: { codigo_sbo: { equals: codigo, mode: 'insensitive' } },
    include: { items: true, eventos: { orderBy: { fecha: 'asc' } }, novedades: { include: { solicitud: { select: { codigo_sbo: true } } } } }
  });
  if (solicitud) {
    // Despachos y devoluciones de la SBO quedan en el historial de cada producto con "SBO <código> "
    const movimientos = await prisma.historial.findMany({
      where: { accion: { in: ['SALIDA SBO', 'DEVOLUCIÓN SBO'] }, detalles: { contains: `SBO ${solicitud.codigo_sbo} ` } },
      include: conDocumento
    });
    const sustituciones = await prisma.historial.findMany({ where: { codigo_producto: solicitud.codigo_sbo, accion: 'SBO SUSTITUCIÓN' }, include: conDocumento });
    const eventos = [
      ...solicitud.eventos.map(e => eventoSolicitud(solicitud, e)),
      ...solicitud.novedades.map(eventoNovedad),
      ...movimientos.map(h => eventoHistorial(h, { producto: h.codigo_producto })),
      ...sustituciones.map(h => eventoHistorial(h))
    ].sort(porFecha);
    return {
      tipo: 'sbo', codigo: solicitud.codigo_sbo,
      resumen: {
        id: solicitud.id, beneficiario: solicitud.beneficiario, estado: solicitud.estado, alistador: solicitud.alistador,
        items: solicitud.items.map(i => ({ codigo_producto: i.codigo_producto, codigo_original: i.codigo_original, descripcion: i.descripcion, solicitada: i.cantidad_solicitada, alistada: i.cantidad_alistada, devuelta: i.cantidad_devuelta }))
      },
      eventos
    };
  }

  const producto = await prisma.producto.findFirst({ where: { codigo_producto: { equals: codigo, mode: 'insensitive' } } });
  const codigoProducto = producto ? producto.codigo_producto : codigo;
  const [historial, novedades, solicitudes] = await Promise.all([
    prisma.historial.findMany({ where: { codigo_producto: codigoProducto }, include: conDocumento }),
    prisma.novedad.findMany({ where: { OR: [{ codigo_producto: codigoProducto }, { codigo_sustituto: codigoProducto }] }, include: { solicitud: { select: { codigo_sbo: true } } } }),
    prisma.solicitud.findMany({
      where: { items: { some: { OR: [{ codigo_producto: codigoProducto }, { codigo_original: codigoProducto }] } } },
      include: { eventos: true }
    })
  ]);
  if (!producto && historial.length === 0 && solicitudes.length === 0) {
    throw new StockError(404, `No hay registros del código ${codigo}.`);
  }
  // El historial ya trae una línea "NOVEDAD" por cada novedad: se muestra la novedad (más completa) y se omite esa línea
  const eventos = [
    ...historial.filter(h => h.accion !== 'NOVEDAD').map(h => eventoHistorial(h)),
    ...novedades.map(eventoNovedad),
    // De cada SBO interesan la reserva, el alistamiento y el cierre; el despacho ya está en el historial
    ...solicitudes.flatMap(s => s.eventos.filter(e => e.estado_nuevo !== 'DESPACHADA' && e.estado_nuevo !== 'CREADA').map(e => eventoSolicitud(s, e)))
  ].sort(porFecha);
  return {
    tipo: 'producto', codigo: codigoProducto,
    resumen: producto ? {
      id: producto.id, descripcion: producto.descripcion, categoria: producto.categoria, condicion: producto.condicion,
      cantidad: producto.cantidad, reservada: producto.cantidad_reservada, ubicacion: producto.codigo_estanteria || producto.ubicacion_general, activo: producto.activo
    } : null,
    eventos
  };
}

module.exports = {
  TIPOS, TIPOS_MANUALES, crearNovedad, registrarNovedad, sustituirItem, devolverItem, registrarFaltantes,
  listarNovedades, trazabilidad, siguienteCodigoNovedad
};
