// Fase G: conciliación. Conteos físicos (CNT-0001), diferencias sistema ↔ conteo y ajustes aprobados.
const { StockError, tablaProducto } = require('./stock');
const { registrarHistorial } = require('./historial');
const { resolverActivo } = require('./catalogos');
const { enUbicacion } = require('./inventario');
const { compararConsistencia } = require('../scripts/verificar-consistencia');

const ALCANCES = ['TODO', 'CATEGORIA', 'UBICACION'];
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

async function siguienteCodigoConteo(tx) {
  const ultimo = await tx.conteo.findFirst({ orderBy: { id: 'desc' }, select: { codigo: true } });
  const n = ultimo ? Number((ultimo.codigo.match(/(\d+)$/) || [0, 0])[1]) : 0;
  return `CNT-${String(n + 1).padStart(4, '0')}`;
}

// Diferencia de una línea: unidades y % sobre el sistema (null si aún no se cuenta)
function diferencia(linea) {
  if (linea.cantidad_contada === null || linea.cantidad_contada === undefined) return { diferencia: null, porcentaje: null };
  const d = linea.cantidad_contada - linea.cantidad_sistema;
  const porcentaje = linea.cantidad_sistema === 0 ? (d === 0 ? 0 : null) : Math.round((d / linea.cantidad_sistema) * 1000) / 10;
  return { diferencia: d, porcentaje };
}

function describirConteo(c) {
  const lineas = (c.lineas || []).map(l => ({ ...l, ...diferencia(l) }));
  const contadas = lineas.filter(l => l.cantidad_contada !== null);
  const conDiferencia = contadas.filter(l => l.diferencia !== 0);
  return {
    ...c,
    lineas,
    resumen: {
      productos: lineas.length,
      contados: contadas.length,
      con_diferencia: conDiferencia.length,
      faltantes: conDiferencia.filter(l => l.diferencia < 0).reduce((t, l) => t - l.diferencia, 0),
      sobrantes: conDiferencia.filter(l => l.diferencia > 0).reduce((t, l) => t + l.diferencia, 0)
    }
  };
}

// Crea el conteo con los productos activos del alcance y el stock de ese momento
async function crearConteo(tx, body, usuario) {
  const alcance = texto(body.alcance).toUpperCase() || 'TODO';
  if (!ALCANCES.includes(alcance)) throw new StockError(400, `Alcance inválido. Use: ${ALCANCES.join(', ')}.`);
  const where = { activo: true };
  let filtro = null;
  if (alcance === 'CATEGORIA') {
    const cat = await resolverActivo(tx, 'categoria', body.categoriaId ?? body.categoria, { etiqueta: 'La categoría' });
    if (!cat) throw new StockError(400, 'Elija la categoría a contar.');
    where.categoriaId = cat.id;
    filtro = cat.nombre;
  }
  if (alcance === 'UBICACION') {
    const ub = await resolverActivo(tx, 'ubicacion', body.ubicacion, { campoTexto: 'codigo', etiqueta: 'La ubicación' });
    if (!ub) throw new StockError(400, 'Elija la ubicación a contar.');
    Object.assign(where, enUbicacion(ub.codigo));
    filtro = ub.codigo;
  }
  const productos = await tx.producto.findMany({ where, orderBy: [{ codigo_estanteria: 'asc' }, { ubicacion_general: 'asc' }, { codigo_producto: 'asc' }] });
  if (productos.length === 0) throw new StockError(400, 'No hay productos activos en ese alcance.');
  return tx.conteo.create({
    data: {
      codigo: await siguienteCodigoConteo(tx), alcance, filtro, observaciones: texto(body.observaciones).slice(0, 500) || null,
      creado_por: usuario.usuario, usuarioId: usuario.id ?? null,
      lineas: {
        create: productos.map(p => ({
          codigo_producto: p.codigo_producto, descripcion: p.descripcion,
          ubicacion: p.codigo_estanteria || p.ubicacion_general, cantidad_sistema: p.cantidad
        }))
      }
    },
    include: { lineas: { orderBy: { id: 'asc' } } }
  });
}

async function conteoAbierto(tx, id) {
  const conteo = await tx.conteo.findUnique({ where: { id }, include: { lineas: true } });
  if (!conteo) throw new StockError(404, 'Conteo no encontrado.');
  if (conteo.estado !== 'ABIERTO') throw new StockError(400, `El conteo ${conteo.codigo} está ${conteo.estado.toLowerCase()}.`);
  return conteo;
}

// Registra cantidades contadas: [{ id, cantidad_contada }] (null borra lo contado).
// Guarda el stock del sistema en ese momento para comparar contra lo mismo que se veía al contar.
async function registrarConteo(tx, id, lineas, usuario) {
  if (!Array.isArray(lineas) || lineas.length === 0) throw new StockError(400, 'Envíe al menos una línea contada.');
  const conteo = await conteoAbierto(tx, id);
  const porId = new Map(conteo.lineas.map(l => [l.id, l]));
  for (const { id: lineaId, cantidad_contada } of lineas) {
    const linea = porId.get(Number(lineaId));
    if (!linea) throw new StockError(400, 'Una de las líneas no pertenece a este conteo.');
    if (cantidad_contada === null || cantidad_contada === '') {
      await tx.conteoLinea.update({ where: { id: linea.id }, data: { cantidad_contada: null, contado_por: null, fecha_conteo: null } });
      continue;
    }
    const n = Number(cantidad_contada);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new StockError(400, `Cantidad contada inválida para ${linea.codigo_producto}.`);
    const producto = await tx.producto.findUnique({ where: { codigo_producto: linea.codigo_producto }, select: { cantidad: true } });
    await tx.conteoLinea.update({
      where: { id: linea.id },
      data: { cantidad_contada: n, cantidad_sistema: producto ? producto.cantidad : linea.cantidad_sistema, contado_por: usuario.usuario, fecha_conteo: new Date() }
    });
  }
  return tx.conteo.findUnique({ where: { id }, include: { lineas: { orderBy: { id: 'asc' } } } });
}

// Aprueba los ajustes: cada línea contada con diferencia suma esa diferencia al stock actual (AJUSTE en el historial).
// Coordinador o Administrador; motivo del catálogo (tipo AJUSTE) obligatorio.
async function aprobarConteo(tx, id, body, usuario) {
  const conteo = await conteoAbierto(tx, id);
  const motivo = await resolverActivo(tx, 'motivo', body.motivoId ?? body.motivo, { extra: { tipo: 'AJUSTE' }, etiqueta: 'El motivo de ajuste' });
  if (!motivo) throw new StockError(400, 'El motivo del ajuste es obligatorio.');
  const contadas = conteo.lineas.filter(l => l.cantidad_contada !== null);
  if (contadas.length === 0) throw new StockError(400, 'No hay productos contados: registre el conteo antes de aprobar.');

  const ajustes = [];
  for (const l of contadas) {
    const delta = l.cantidad_contada - l.cantidad_sistema;
    if (delta === 0) continue;
    const filas = await tx.$queryRaw`SELECT id, cantidad, cantidad_reservada FROM ${tablaProducto()} WHERE codigo_producto = ${l.codigo_producto} FOR UPDATE`;
    const p = filas[0];
    if (!p) throw new StockError(409, `El producto ${l.codigo_producto} ya no existe: retírelo del conteo (borre su cantidad) o regístrelo con un ingreso.`);
    const nuevo = p.cantidad + delta;
    if (nuevo < p.cantidad_reservada) {
      throw new StockError(409, `${l.codigo_producto}: el ajuste deja ${nuevo} unidades y hay ${p.cantidad_reservada} reservadas para SBO. Resuelva las solicitudes antes de aprobar.`);
    }
    await tx.producto.update({ where: { id: p.id }, data: { cantidad: nuevo } });
    await tx.conteoLinea.update({ where: { id: l.id }, data: { ajuste: delta } });
    await registrarHistorial(tx, l.codigo_producto, 'AJUSTE', usuario,
      `Ajuste de ${delta > 0 ? '+' : ''}${delta} unidades (${conteo.codigo}). Contado: ${l.cantidad_contada}, sistema: ${l.cantidad_sistema}. Stock total: ${nuevo}. Motivo: ${motivo.nombre}`);
    ajustes.push(l.codigo_producto);
  }
  const { count } = await tx.conteo.updateMany({
    where: { id, estado: 'ABIERTO' },
    data: { estado: 'CERRADO', cerrado_por: usuario.usuario, fecha_cierre: new Date(), motivoId: motivo.id, observaciones: texto(body.observaciones).slice(0, 500) || conteo.observaciones }
  });
  if (count === 0) throw new StockError(409, 'El conteo fue modificado por otro usuario. Recargue e intente de nuevo.');
  return ajustes;
}

async function anularConteo(tx, id, usuario) {
  await conteoAbierto(tx, id);
  await tx.conteo.update({ where: { id }, data: { estado: 'ANULADO', cerrado_por: usuario.usuario, fecha_cierre: new Date() } });
}

// Reporte de consistencia historial ↔ stock (el mismo verificador de scripts/), solo lectura
async function reporteConsistencia(prisma) {
  const [productos, historial, solicitudes, ubicaciones] = await Promise.all([
    prisma.producto.findMany(), prisma.historial.findMany(), prisma.solicitud.findMany({ include: { items: true } }), prisma.ubicacion.findMany()
  ]);
  const resultado = compararConsistencia({ productos, historial, solicitudes, ubicaciones });
  const problemas = resultado.filter(r => !r.ok).map(({ movimientos, ...r }) => r);
  return { revisados: resultado.length, consistentes: resultado.length - problemas.length, problemas, generado: new Date() };
}

module.exports = { ALCANCES, crearConteo, registrarConteo, aprobarConteo, anularConteo, describirConteo, reporteConsistencia, diferencia };
