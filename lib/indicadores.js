// Fase F: indicadores. Cada métrica es una función pura: recibe los datos ya leídos y el período,
// y devuelve { datos, series, excluidos, ... }. cargarDatos() hace las consultas; las pruebas usan datos fijos.
const { StockError } = require('./stock');

const MS_DIA = 24 * 60 * 60 * 1000;
const OFFSET_BOGOTA_H = 5; // America/Bogota es UTC-5 todo el año (sin horario de verano)
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Período en hora de Bogotá: un mes (mes 1–12) o el año completo (mes vacío)
function periodo(anio, mes) {
  const a = Number(anio);
  if (!Number.isInteger(a) || a < 2020 || a > 2100) throw new StockError(400, 'Año inválido.');
  if (mes === undefined || mes === null || mes === '') {
    return { anio: a, mes: null, desde: new Date(Date.UTC(a, 0, 1, OFFSET_BOGOTA_H)), hasta: new Date(Date.UTC(a + 1, 0, 1, OFFSET_BOGOTA_H)), nombre: String(a) };
  }
  const m = Number(mes);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new StockError(400, 'Mes inválido (1 a 12).');
  return { anio: a, mes: m, desde: new Date(Date.UTC(a, m - 1, 1, OFFSET_BOGOTA_H)), hasta: new Date(Date.UTC(a, m, 1, OFFSET_BOGOTA_H)), nombre: `${MESES[m - 1]} ${a}` };
}
const enPeriodo = (fecha, p) => fecha && new Date(fecha) >= p.desde && new Date(fecha) < p.hasta;
const mesBogota = (fecha) => new Date(new Date(fecha).getTime() - OFFSET_BOGOTA_H * 3600 * 1000).getUTCMonth();
// Fin del día (Bogotá) de una fecha de calendario guardada a medianoche UTC
const finDelDia = (fecha) => new Date(new Date(fecha).getTime() + MS_DIA + OFFSET_BOGOTA_H * 3600 * 1000);

const sumar = (filas, clave, valor) => { filas[clave] = (filas[clave] || 0) + valor; };
const ordenarDesc = (obj, campo = 'valor') => Object.entries(obj).map(([etiqueta, valor]) => ({ etiqueta, [campo]: valor })).sort((a, b) => b[campo] - a[campo] || a.etiqueta.localeCompare(b.etiqueta));
const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const numero = (texto, regex) => { const m = texto && texto.match(regex); return m ? Number(m[1]) : null; };

const solicitado = (s) => s.items.reduce((t, i) => t + i.cantidad_solicitada, 0);
const alistado = (s) => s.items.reduce((t, i) => t + i.cantidad_alistada, 0);
const entregado = (s) => s.items.reduce((t, i) => t + i.cantidad_alistada - (i.cantidad_devuelta || 0), 0);
const alistadas = (d, p) => d.solicitudes.filter(s => enPeriodo(s.fecha_fin_alistamiento, p));
const despachadas = (d, p) => d.solicitudes.filter(s => s.estado === 'DESPACHADA' && enPeriodo(s.fecha_despacho, p));
const excluidas = (lista, motivo, enlace) => ({ total: lista.length, motivo, enlace, codigos: lista.slice(0, 20).map(s => s.codigo_sbo || s.codigo_producto) });

// --- Alistamiento ---
function sboPorAlistador(d, p) {
  const base = alistadas(d, p);
  const sin = base.filter(s => !s.alistador);
  const cuenta = {};
  for (const s of base) if (s.alistador) sumar(cuenta, s.alistador, 1);
  return { datos: ordenarDesc(cuenta), series: [{ clave: 'valor', nombre: 'SBO alistadas' }], excluidos: excluidas(sin, 'sin alistador', '/solicitudes') };
}

function unidadesPorAlistador(d, p) {
  const base = alistadas(d, p);
  const sin = base.filter(s => !s.alistador);
  const cuenta = {};
  for (const s of base) if (s.alistador) sumar(cuenta, s.alistador, alistado(s));
  return { datos: ordenarDesc(cuenta), series: [{ clave: 'valor', nombre: 'Unidades alistadas' }], excluidos: excluidas(sin, 'sin alistador', '/solicitudes') };
}

function tiempoAlistamiento(d, p) {
  const base = alistadas(d, p);
  const sin = base.filter(s => !s.alistador || !s.fecha_inicio_alistamiento);
  const acum = {};
  for (const s of base) {
    if (!s.alistador || !s.fecha_inicio_alistamiento) continue;
    const horas = (new Date(s.fecha_fin_alistamiento) - new Date(s.fecha_inicio_alistamiento)) / 3600000;
    const a = acum[s.alistador] || (acum[s.alistador] = { total: 0, n: 0 });
    a.total += horas;
    a.n += 1;
  }
  const meta = d.parametros.tiempo_meta_alistamiento_horas;
  const datos = Object.entries(acum).map(([etiqueta, a]) => ({ etiqueta, valor: redondear(a.total / a.n), sbo: a.n, meta }))
    .sort((a, b) => b.valor - a.valor);
  return { datos, series: [{ clave: 'valor', nombre: 'Horas promedio' }], referencia: { valor: meta, nombre: `Meta: ${meta} h` }, unidad: 'h', excluidos: excluidas(sin, 'sin alistador o sin inicio de alistamiento', '/solicitudes') };
}

function cumplimiento(d, p) {
  const base = despachadas(d, p);
  const sin = base.filter(s => !s.fecha_requerida);
  const tolerancia = (d.parametros.dias_atraso_sbo || 0) * MS_DIA;
  let aTiempo = 0, tarde = 0;
  for (const s of base) {
    if (!s.fecha_requerida) continue;
    if (new Date(s.fecha_despacho) <= new Date(finDelDia(s.fecha_requerida).getTime() + tolerancia)) aTiempo++;
    else tarde++;
  }
  const total = aTiempo + tarde;
  return {
    datos: [{ etiqueta: 'A tiempo', valor: aTiempo }, { etiqueta: 'Tarde', valor: tarde }],
    series: [{ clave: 'valor', nombre: 'SBO despachadas' }],
    destacado: { valor: total ? redondear((aTiempo / total) * 100) : null, unidad: '%', texto: 'a tiempo' },
    excluidos: excluidas(sin, 'sin fecha requerida', '/solicitudes?estado=DESPACHADA')
  };
}

function lotes(d, p) {
  const { lote_pequeno_max: peq, lote_mediano_max: med } = d.parametros;
  const cuenta = { pequeno: 0, mediano: 0, grande: 0 };
  for (const s of despachadas(d, p)) {
    const u = alistado(s);
    cuenta[u <= peq ? 'pequeno' : u <= med ? 'mediano' : 'grande']++;
  }
  return {
    datos: [
      { etiqueta: `Pequeños (≤ ${peq} u.)`, valor: cuenta.pequeno },
      { etiqueta: `Medianos (${peq + 1}–${med} u.)`, valor: cuenta.mediano },
      { etiqueta: `Grandes (> ${med} u.)`, valor: cuenta.grande }
    ],
    series: [{ clave: 'valor', nombre: 'SBO despachadas' }]
  };
}

// --- Inventario ---
function unidadesPorCategoria(d) {
  const cuenta = {};
  for (const pr of d.productos) if (pr.activo && pr.cantidad > 0) sumar(cuenta, pr.categoria || 'Sin categoría', pr.cantidad);
  return { datos: ordenarDesc(cuenta), series: [{ clave: 'valor', nombre: 'Unidades' }], fotoActual: true };
}

// Unidades que entran y salen según el historial (mismo formato que lee el verificador)
function cantidadMovimiento(h) {
  const t = h.detalles || '';
  switch (h.accion) {
    case 'INGRESO NUEVO':
    case 'INGRESO ADICIONAL': return { entrada: numero(t, /cantidad:\s*(\d+)/i) || 0 };
    case 'DEVOLUCIÓN SBO': return { entrada: numero(t, /Devolución de (\d+)/i) || 0 };
    case 'SALIDA/RETIRO':
    case 'SALIDA SBO': return { salida: numero(t, /(?:Retiro|Despacho) de (\d+)/i) || 0 };
    default: return {};
  }
}

function entradasSalidas(d, p) {
  const anio = { ...periodo(p.anio) };
  const meses = MESES.map(etiqueta => ({ etiqueta, entradas: 0, salidas: 0 }));
  for (const h of d.historial) {
    if (!enPeriodo(h.fecha, anio)) continue;
    const { entrada = 0, salida = 0 } = cantidadMovimiento(h);
    const m = meses[mesBogota(h.fecha)];
    m.entradas += entrada;
    m.salidas += salida;
  }
  return { datos: meses, series: [{ clave: 'entradas', nombre: 'Entradas' }, { clave: 'salidas', nombre: 'Salidas' }], tipo: 'lineas', anual: true };
}

const RANGOS_ANTIGUEDAD = [[30, '0–30 días'], [90, '31–90 días'], [180, '91–180 días'], [365, '181–365 días'], [Infinity, 'Más de un año']];
function antiguedad(d, p, ahora = new Date()) {
  const filas = RANGOS_ANTIGUEDAD.map(([, etiqueta]) => ({ etiqueta, valor: 0, productos: 0 }));
  for (const pr of d.productos) {
    if (!pr.activo || pr.cantidad <= 0) continue;
    const dias = Math.floor((ahora - new Date(pr.fecha_ingreso)) / MS_DIA);
    const i = RANGOS_ANTIGUEDAD.findIndex(([max]) => dias <= max);
    filas[i].valor += pr.cantidad;
    filas[i].productos += 1;
  }
  return { datos: filas, series: [{ clave: 'valor', nombre: 'Unidades' }], fotoActual: true };
}

function sinMovimiento(d, p, ahora = new Date(), dias = 90) {
  const ultimo = {};
  for (const h of d.historial) {
    if (h.accion === 'NOVEDAD' || h.accion.startsWith('SBO ')) continue;
    if (!ultimo[h.codigo_producto] || new Date(h.fecha) > ultimo[h.codigo_producto]) ultimo[h.codigo_producto] = new Date(h.fecha);
  }
  const quietos = d.productos
    .filter(pr => pr.activo && pr.cantidad > 0)
    .map(pr => ({ pr, fecha: ultimo[pr.codigo_producto] || new Date(pr.fecha_ingreso) }))
    .filter(x => (ahora - x.fecha) / MS_DIA > dias)
    .map(({ pr, fecha }) => ({ etiqueta: pr.codigo_producto, descripcion: pr.descripcion, categoria: pr.categoria, valor: Math.floor((ahora - fecha) / MS_DIA), unidades: pr.cantidad }))
    .sort((a, b) => b.valor - a.valor);
  return { datos: quietos.slice(0, 30), total: quietos.length, series: [{ clave: 'valor', nombre: 'Días sin movimiento' }], unidad: 'días', fotoActual: true, dias };
}

// --- Operación ---
const GRUPO_ACCION = (accion) => accion.startsWith('INGRESO') || accion === 'DEVOLUCIÓN SBO' ? 'ingresos'
  : accion.startsWith('SALIDA') ? 'salidas' : accion.startsWith('REUBICACI') ? 'reubicaciones' : 'otros';
function movimientosPorOperario(d, p) {
  const filas = {};
  for (const h of d.historial) {
    if (!enPeriodo(h.fecha, p) || h.operario === 'SISTEMA') continue;
    const f = filas[h.operario] || (filas[h.operario] = { etiqueta: h.operario, ingresos: 0, salidas: 0, reubicaciones: 0, otros: 0 });
    f[GRUPO_ACCION(h.accion)] += 1;
  }
  const total = (f) => f.ingresos + f.salidas + f.reubicaciones + f.otros;
  return {
    datos: Object.values(filas).sort((a, b) => total(b) - total(a)),
    series: [{ clave: 'ingresos', nombre: 'Ingresos' }, { clave: 'salidas', nombre: 'Salidas' }, { clave: 'reubicaciones', nombre: 'Reubicaciones' }, { clave: 'otros', nombre: 'SBO y otros' }],
    apilado: true
  };
}

function organizacionesAtendidas(d, p) {
  const cuenta = {};
  for (const s of despachadas(d, p)) sumar(cuenta, s.beneficiario, entregado(s));
  const datos = ordenarDesc(cuenta);
  return { datos: datos.slice(0, 10), total: datos.length, series: [{ clave: 'valor', nombre: 'Unidades entregadas' }] };
}

const ETIQUETA_NOVEDAD = { FALTANTE: 'Faltante', DANADO: 'Artículo dañado', TALLA_NO_DISPONIBLE: 'Talla no disponible', SUSTITUCION: 'Sustitución', DEVOLUCION: 'Devolución', OTRO: 'Otro' };
function novedadesPorMotivo(d, p) {
  const cuenta = {};
  for (const n of d.novedades) {
    if (!enPeriodo(n.fecha, p)) continue;
    const etiqueta = n.motivo ? `${ETIQUETA_NOVEDAD[n.tipo]} · ${n.motivo.nombre}` : ETIQUETA_NOVEDAD[n.tipo];
    sumar(cuenta, etiqueta, 1);
  }
  return { datos: ordenarDesc(cuenta), series: [{ clave: 'valor', nombre: 'Novedades' }] };
}

function unidadesNoEntregadas(d, p) {
  const filas = {};
  const fila = (s) => filas[s.beneficiario] || (filas[s.beneficiario] = { etiqueta: s.beneficiario, parcial: 0, cancelada: 0, vencida: 0 });
  for (const s of despachadas(d, p)) {
    const falta = solicitado(s) - alistado(s);
    if (falta > 0) fila(s).parcial += falta;
  }
  for (const s of d.solicitudes) {
    if (s.estado === 'CANCELADA' && enPeriodo(s.fecha_cancelacion, p)) fila(s).cancelada += solicitado(s);
    if (s.estado === 'VENCIDA' && enPeriodo(s.fecha_vencimiento, p)) fila(s).vencida += solicitado(s);
  }
  const total = (f) => f.parcial + f.cancelada + f.vencida;
  return {
    datos: Object.values(filas).filter(f => total(f) > 0).sort((a, b) => total(b) - total(a)),
    series: [{ clave: 'parcial', nombre: 'Despacho parcial' }, { clave: 'cancelada', nombre: 'SBO cancelada' }, { clave: 'vencida', nombre: 'SBO vencida' }],
    apilado: true
  };
}

// Catálogo: id, grupo, título, cómo se calcula y la función
const INDICADORES = [
  { id: 'sbo-por-alistador', grupo: 'Alistamiento', titulo: 'SBO por alistador', fn: sboPorAlistador,
    como: 'Solicitudes cuyo alistamiento terminó en el período, contadas por la persona asignada como alistador.' },
  { id: 'unidades-por-alistador', grupo: 'Alistamiento', titulo: 'Unidades alistadas por alistador', fn: unidadesPorAlistador,
    como: 'Suma de las unidades alistadas en las solicitudes cuyo alistamiento terminó en el período.' },
  { id: 'tiempo-alistamiento', grupo: 'Alistamiento', titulo: 'Tiempo promedio de alistamiento', fn: tiempoAlistamiento,
    como: 'Promedio, por alistador, de las horas entre "iniciar alistamiento" y "finalizar". La línea es la meta configurada en Parámetros.' },
  { id: 'cumplimiento', grupo: 'Alistamiento', titulo: 'SBO cumplidas a tiempo', fn: cumplimiento,
    como: 'Solicitudes despachadas en el período: a tiempo si el despacho fue hasta el final del día requerido (más los días de tolerancia de Parámetros).' },
  { id: 'lotes', grupo: 'Alistamiento', titulo: 'Lotes pequeños, medianos y grandes', fn: lotes,
    como: 'Solicitudes despachadas en el período según las unidades alistadas. Los límites se configuran en Parámetros.' },
  { id: 'unidades-por-categoria', grupo: 'Inventario', titulo: 'Unidades por categoría', fn: unidadesPorCategoria,
    como: 'Existencias actuales de los productos activos, por categoría. Es una foto de hoy: no depende del período.' },
  { id: 'entradas-salidas', grupo: 'Inventario', titulo: 'Entradas frente a salidas por mes', fn: entradasSalidas,
    como: 'Unidades que entraron (ingresos y devoluciones) y salieron (retiros y despachos de SBO) cada mes del año elegido, según el historial.' },
  { id: 'antiguedad', grupo: 'Inventario', titulo: 'Antigüedad del inventario', fn: antiguedad,
    como: 'Unidades en existencia agrupadas por los días desde que el producto ingresó. Foto de hoy.' },
  { id: 'sin-movimiento', grupo: 'Inventario', titulo: 'Productos sin movimiento', fn: sinMovimiento,
    como: 'Productos con existencias cuyo último ingreso, salida o reubicación fue hace más de N días (90 por defecto). Se muestran los 30 más quietos.' },
  { id: 'movimientos-por-operario', grupo: 'Operación', titulo: 'Movimientos por operario', fn: movimientosPorOperario,
    como: 'Registros del historial hechos por cada usuario en el período, por tipo. No cuenta las acciones automáticas del sistema.' },
  { id: 'organizaciones', grupo: 'Operación', titulo: 'Organizaciones más atendidas', fn: organizacionesAtendidas,
    como: 'Unidades entregadas (alistadas menos devueltas) en las solicitudes despachadas en el período. Las 10 primeras.' },
  { id: 'novedades', grupo: 'Operación', titulo: 'Novedades por motivo', fn: novedadesPorMotivo,
    como: 'Novedades registradas en el período, por tipo y motivo del catálogo.' },
  { id: 'no-entregadas', grupo: 'Operación', titulo: 'Unidades no entregadas', fn: unidadesNoEntregadas,
    como: 'Unidades solicitadas que no llegaron a la organización: faltantes de despachos parciales, y lo pedido en SBO canceladas o vencidas en el período.' }
];

const catalogo = () => INDICADORES.map(({ id, grupo, titulo }) => ({ id, grupo, titulo }));

function calcular(id, datos, p, opciones = {}) {
  const ind = INDICADORES.find(i => i.id === id);
  if (!ind) throw new StockError(404, 'Indicador desconocido.');
  const ahora = opciones.ahora || new Date();
  const resultado = ind.id === 'sin-movimiento' ? ind.fn(datos, p, ahora, opciones.dias || 90)
    : ind.id === 'antiguedad' ? ind.fn(datos, p, ahora) : ind.fn(datos, p);
  return { id: ind.id, grupo: ind.grupo, titulo: ind.titulo, como_se_calcula: ind.como, periodo: p.nombre, ...resultado };
}

// Lee de la base lo que necesitan las métricas
async function cargarDatos(prisma) {
  const [solicitudes, productos, historial, novedades, parametros] = await Promise.all([
    prisma.solicitud.findMany({ include: { items: true } }),
    prisma.producto.findMany({ select: { codigo_producto: true, descripcion: true, categoria: true, cantidad: true, activo: true, fecha_ingreso: true } }),
    prisma.historial.findMany({ select: { codigo_producto: true, accion: true, detalles: true, operario: true, fecha: true } }),
    prisma.novedad.findMany({ include: { motivo: { select: { nombre: true } } } }),
    require('./catalogos').leerParametros(prisma)
  ]);
  return { solicitudes, productos, historial, novedades, parametros };
}

module.exports = { INDICADORES, catalogo, calcular, periodo, cargarDatos, cantidadMovimiento };
