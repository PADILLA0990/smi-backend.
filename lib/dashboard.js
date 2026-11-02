// Resumen del Dashboard (Fase D4): indicadores, gráficas, alertas y últimos movimientos en una sola consulta.
// Usa las mismas reglas que el inventario (libre, bajo mínimo, sin ubicar) y las SBO (atrasada, por vencer),
// así los números del panel coinciden con lo que muestran las listas filtradas a las que enlaza.
const { leerParametros } = require('./catalogos');
const { describirSolicitud, revisarVencimientos } = require('./solicitudes');
const { ACTIVOS } = require('../solicitudes/estados');

const ESTADOS_SBO = ['CREADA', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA', 'DESPACHADA', 'CANCELADA', 'VENCIDA'];
const MAX_ALERTAS = 6;
const MAX_MOVIMIENTOS = 8;

const sumar = (lista, campo) => lista.reduce((t, x) => t + x[campo], 0);

// Agrupa productos por una clave y suma unidades, de mayor a menor
function agrupar(productos, clave) {
  const grupos = {};
  for (const p of productos) {
    const k = clave(p) || 'Sin dato';
    grupos[k] ??= { nombre: k, productos: 0, unidades: 0 };
    grupos[k].productos += 1;
    grupos[k].unidades += p.cantidad;
  }
  return Object.values(grupos).sort((a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, 'es'));
}

async function resumenDashboard(prisma, ahora = new Date()) {
  await revisarVencimientos(prisma);
  const [productos, parametros, porEstado, activas, movimientos, ubicaciones] = await Promise.all([
    prisma.producto.findMany({ where: { activo: true }, include: { categoriaRef: { select: { nombre: true } } } }),
    leerParametros(prisma),
    prisma.solicitud.groupBy({ by: ['estado'], _count: { _all: true } }),
    prisma.solicitud.findMany({ where: { estado: { in: ACTIVOS } }, include: { items: true, eventos: { select: { fecha: true } } } }),
    prisma.historial.findMany({ orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: MAX_MOVIMIENTOS, select: { id: true, fecha: true, codigo_producto: true, accion: true, operario: true, detalles: true } }),
    prisma.ubicacion.findMany({ where: { activo: true }, select: { codigo: true } })
  ]);

  // --- Inventario (solo productos activos, como la lista por defecto) ---
  const filas = productos.map(p => {
    const libre = p.cantidad - p.cantidad_reservada;
    const minimo = p.stock_minimo ?? parametros.stock_minimo_defecto;
    return { ...p, categoria: p.categoriaRef?.nombre ?? p.categoria, libre, bajo_minimo: libre < minimo };
  });
  const conStock = filas.filter(p => p.cantidad > 0);
  const inventario = {
    productos: filas.length,
    unidades: sumar(filas, 'cantidad'),
    reservadas: sumar(filas, 'cantidad_reservada'),
    libres: sumar(filas, 'libre'),
    sin_ubicar: filas.filter(p => !p.codigo_estanteria).length,
    bajo_minimo: filas.filter(p => p.bajo_minimo).length,
    agotados: filas.length - conStock.length
  };

  // --- Bodega: unidades por zona y ocupación de las ubicaciones del catálogo ---
  const codigosCatalogo = new Set(ubicaciones.map(u => u.codigo.toUpperCase()));
  const ocupadas = new Set(conStock.filter(p => p.codigo_estanteria).map(p => p.codigo_estanteria.toUpperCase()));
  const bodega = {
    por_zona: agrupar(conStock, p => p.ubicacion_general),
    ubicaciones_catalogo: codigosCatalogo.size,
    ubicaciones_ocupadas: [...ocupadas].filter(c => codigosCatalogo.has(c)).length
  };

  // --- Solicitudes SBO ---
  const conteo = Object.fromEntries(ESTADOS_SBO.map(e => [e, 0]));
  for (const g of porEstado) conteo[g.estado] = g._count._all;
  const descritas = activas.map(s => describirSolicitud(s, parametros, ahora));
  const alertasSbo = descritas
    .filter(s => s.atrasada || s.por_vencer)
    .sort((a, b) => (b.atrasada - a.atrasada) || (a.dias_para_vencer - b.dias_para_vencer))
    .slice(0, MAX_ALERTAS)
    .map(s => ({
      id: s.id, codigo_sbo: s.codigo_sbo, beneficiario: s.beneficiario, estado: s.estado,
      atrasada: s.atrasada, por_vencer: s.por_vencer, dias_para_vencer: s.dias_para_vencer,
      fecha_requerida: s.fecha_requerida, activa: s.activa
    }));
  const solicitudes = {
    por_estado: conteo,
    activas: descritas.length,
    atrasadas: descritas.filter(s => s.atrasada).length,
    por_vencer: descritas.filter(s => s.por_vencer).length,
    alertas: alertasSbo
  };

  // --- Productos que piden atención: bajo mínimo primero (menos libre), luego sin ubicar ---
  const productosAlerta = filas
    .filter(p => p.bajo_minimo || (!p.codigo_estanteria && p.cantidad > 0))
    .sort((a, b) => (b.bajo_minimo - a.bajo_minimo) || (a.libre - b.libre) || a.codigo_producto.localeCompare(b.codigo_producto, 'es'))
    .slice(0, MAX_ALERTAS)
    .map(p => ({ id: p.id, codigo_producto: p.codigo_producto, descripcion: p.descripcion, libre: p.libre, bajo_minimo: p.bajo_minimo, sin_ubicar: !p.codigo_estanteria }));

  return {
    generado: ahora,
    inventario,
    por_categoria: agrupar(conStock, p => p.categoria),
    bodega,
    solicitudes,
    productos_alerta: productosAlerta,
    ultimos_movimientos: movimientos
  };
}

module.exports = { resumenDashboard };
