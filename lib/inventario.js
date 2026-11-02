// Consultas del Inventario Maestro (Fase D): lista con filtros, orden y paginación, y kardex por producto.
// Los campos calculados (libre, bajo mínimo, última actualización) se resuelven en memoria:
// el inventario de no perecederos es pequeño y así no se duplica lógica en SQL.
const { StockError } = require('./stock');
const { CONDICIONES, leerParametros } = require('./catalogos');
const { recalcular, zonasDe } = require('../scripts/verificar-consistencia');

const ESTADOS_SBO_ACTIVOS = ['CREADA', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];
const ESTADOS_CON_RESERVA = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];

// Página y tamaño de página desde la consulta (?pagina=1&porPagina=20)
function leerPaginacion(query, porDefecto = 20) {
  const pagina = Number(query.pagina || 1);
  const porPagina = Number(query.porPagina || porDefecto);
  if (!Number.isInteger(pagina) || pagina < 1) throw new StockError(400, 'La página debe ser un número entero mayor a 0.');
  if (!Number.isInteger(porPagina) || porPagina < 1 || porPagina > 100) throw new StockError(400, 'El tamaño de página debe estar entre 1 y 100.');
  return { pagina, porPagina };
}

// Las fechas del filtro son días calendario de Bogotá (UTC-5, sin horario de verano)
function inicioDelDia(valor, campo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new StockError(400, `La fecha "${campo}" debe tener el formato AAAA-MM-DD.`);
  const fecha = new Date(`${valor}T00:00:00-05:00`);
  if (Number.isNaN(fecha.getTime())) throw new StockError(400, `La fecha "${campo}" no es válida.`);
  return fecha;
}

// Condiciones de Prisma para ?desde= y ?hasta= (ambos días incluidos) sobre el campo "fecha"
function filtroFechas(query) {
  const and = [];
  if (query.desde) and.push({ fecha: { gte: inicioDelDia(query.desde, 'desde') } });
  if (query.hasta) {
    const fin = inicioDelDia(query.hasta, 'hasta');
    fin.setUTCDate(fin.getUTCDate() + 1);
    and.push({ fecha: { lt: fin } });
  }
  return and;
}

// Códigos de los huecos de estantería activos (Mapa de Bodega)
const codigosDeHuecos = async (prisma) => (await prisma.ubicacion.findMany({ where: { activo: true, estanteriaId: { not: null } }, select: { codigo: true } })).map(u => u.codigo);

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const siNo = (v) => v === '1' || v === 'true';

// Producto ubicado en un código del catálogo: estantería exacta o, si no tiene, su ubicación general
const enUbicacion = (codigo) => ({
  OR: [
    { codigo_estanteria: { equals: codigo, mode: 'insensitive' } },
    { codigo_estanteria: null, ubicacion_general: { equals: codigo, mode: 'insensitive' } }
  ]
});

const ORDENES = {
  codigo_producto: p => p.codigo_producto,
  descripcion: p => p.descripcion,
  categoria: p => p.categoria,
  condicion: p => (p.condicion ? CONDICIONES[p.condicion] : null),
  cantidad: p => p.cantidad,
  reservado: p => p.cantidad_reservada,
  libre: p => p.libre,
  ubicacion: p => p.codigo_estanteria || p.ubicacion_general,
  ultima_actualizacion: p => p.ultima_actualizacion.getTime(),
  fecha_ingreso: p => p.fecha_ingreso.getTime()
};

function comparar(va, vb) {
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
}

// Filtros: q (código o descripción), categoriaId, condicion (o SIN), ubicacion (código), sinUbicar,
// bajoMinimo, estado (activos | inactivos | todos). Orden: orden=<campo>&dir=asc|desc.
async function listarProductos(prisma, query) {
  const { pagina, porPagina } = leerPaginacion(query);
  const and = [];
  const q = texto(query.q);
  if (q) and.push({ OR: [{ codigo_producto: { contains: q, mode: 'insensitive' } }, { descripcion: { contains: q, mode: 'insensitive' } }] });
  if (query.categoriaId) {
    const id = Number(query.categoriaId);
    if (!Number.isInteger(id)) throw new StockError(400, 'Categoría no válida.');
    and.push({ categoriaId: id });
  }
  if (query.condicion) {
    if (query.condicion !== 'SIN' && !Object.hasOwn(CONDICIONES, query.condicion)) throw new StockError(400, 'Condición no válida.');
    and.push({ condicion: query.condicion === 'SIN' ? null : query.condicion });
  }
  if (texto(query.ubicacion)) and.push(enUbicacion(texto(query.ubicacion)));
  // Sin ubicar: no tiene estantería y tampoco ingresó directamente a un hueco de estantería (Mapa de Bodega)
  if (siNo(query.sinUbicar)) and.push({ codigo_estanteria: null, ubicacion_general: { notIn: await codigosDeHuecos(prisma), mode: 'insensitive' } });
  const estado = query.estado || 'activos';
  if (!['activos', 'inactivos', 'todos'].includes(estado)) throw new StockError(400, 'Estado no válido (activos, inactivos o todos).');
  if (estado !== 'todos') and.push({ activo: estado === 'activos' });

  const orden = query.orden || 'codigo_producto';
  if (!ORDENES[orden]) throw new StockError(400, `No se puede ordenar por "${orden}".`);
  const factor = query.dir === 'desc' ? -1 : 1;

  const [productos, parametros] = await Promise.all([
    prisma.producto.findMany({ where: { AND: and }, include: { categoriaRef: { select: { nombre: true } } } }),
    leerParametros(prisma)
  ]);
  const ultimas = productos.length === 0 ? [] : await prisma.historial.groupBy({
    by: ['codigo_producto'],
    where: { codigo_producto: { in: productos.map(p => p.codigo_producto) } },
    _max: { fecha: true }
  });
  const ultimaPorCodigo = Object.fromEntries(ultimas.map(u => [u.codigo_producto, u._max.fecha]));

  let filas = productos.map(({ categoriaRef, ...p }) => {
    const libre = p.cantidad - p.cantidad_reservada;
    const minimo = p.stock_minimo ?? parametros.stock_minimo_defecto;
    const ultima = ultimaPorCodigo[p.codigo_producto];
    return {
      ...p,
      categoria: categoriaRef?.nombre ?? p.categoria,
      libre,
      stock_minimo_efectivo: minimo,
      // Bajo mínimo: lo libre está por debajo del mínimo (los inactivos no alertan)
      bajo_minimo: p.activo && libre < minimo,
      ultima_actualizacion: ultima && ultima > p.fecha_ingreso ? ultima : p.fecha_ingreso
    };
  });
  if (siNo(query.bajoMinimo)) filas = filas.filter(p => p.bajo_minimo);

  filas.sort((a, b) => comparar(ORDENES[orden](a), ORDENES[orden](b)) * factor || a.id - b.id);
  const total = filas.length;
  const resumen = {
    unidades: filas.reduce((s, p) => s + p.cantidad, 0),
    reservadas: filas.reduce((s, p) => s + p.cantidad_reservada, 0),
    libres: filas.reduce((s, p) => s + p.libre, 0)
  };
  return { datos: filas.slice((pagina - 1) * porPagina, pagina * porPagina), total, pagina, porPagina, resumen };
}

// Kardex: movimientos del producto con saldo acumulado, reservas en SBO y comparación con el stock guardado
async function kardexProducto(prisma, id) {
  const producto = await prisma.producto.findUnique({ where: { id }, include: { categoriaRef: { select: { nombre: true } } } });
  if (!producto) throw new StockError(404, 'El producto no existe.');
  const codigo = producto.codigo_producto;

  const [historial, ubicaciones, solicitudes] = await Promise.all([
    prisma.historial.findMany({ where: { codigo_producto: codigo }, include: { documento: { select: { id: true, numero: true } } } }),
    prisma.ubicacion.findMany({ select: { codigo: true, zona: true } }),
    prisma.solicitud.findMany({
      where: { estado: { in: ESTADOS_SBO_ACTIVOS }, items: { some: { codigo_producto: codigo } } },
      include: { items: { where: { codigo_producto: codigo } } },
      orderBy: { fecha_solicitud: 'desc' }
    })
  ]);
  const calculado = recalcular(historial, zonasDe(ubicaciones))[codigo];
  const saldoHistorial = calculado ? calculado.cantidad : 0;
  const { categoriaRef, ...datos } = producto;

  return {
    producto: { ...datos, categoria: categoriaRef?.nombre ?? producto.categoria, libre: producto.cantidad - producto.cantidad_reservada },
    movimientos: calculado ? calculado.movimientos : [],
    reservas: solicitudes.map(s => ({
      id: s.id,
      codigo_sbo: s.codigo_sbo,
      estado: s.estado,
      organizacion: s.beneficiario,
      fecha_requerida: s.fecha_requerida,
      cantidad: s.items.reduce((t, i) => t + i.cantidad_solicitada, 0),
      // Las SBO creadas aún no apartan stock: se aprueban primero
      reserva_stock: ESTADOS_CON_RESERVA.includes(s.estado)
    })),
    saldo_historial: saldoHistorial,
    coincide: saldoHistorial === producto.cantidad,
    avisos: calculado ? calculado.avisos : []
  };
}

module.exports = { codigosDeHuecos, leerPaginacion, filtroFechas, listarProductos, kardexProducto, enUbicacion, ESTADOS_SBO_ACTIVOS };
