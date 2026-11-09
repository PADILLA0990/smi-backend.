const { Prisma } = require('@prisma/client');

// Error de negocio con código HTTP asociado
class StockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Tabla con su esquema (?schema= de DATABASE_URL; producción usa public). Con el pooler de Supabase
// en modo transacción el search_path de la conexión no es confiable, y la consulta SQL directa
// podría leer la tabla de otro esquema (p. ej. las pruebas en smi_pruebas leyendo public).
function esquemaDe(url) {
  try { return new URL(url).searchParams.get('schema') || 'public'; } catch { return 'public'; }
}
const tabla = (nombre) => Prisma.raw(`"${esquemaDe(process.env.DATABASE_URL).replace(/"/g, '')}"."${nombre}"`);
const tablaProducto = () => tabla('Producto');

// Llaves del bloqueo que serializa la numeración automática (ING y SAL usan 4201 y 4202 en documentos/routes.js)
const LLAVES_CONSECUTIVO = { SBO: 4203, NOVEDAD: 4204, CONTEO: 4205 };

// Dos numeraciones simultáneas del mismo tipo van una tras otra: el bloqueo dura hasta el fin de la transacción (tx)
async function bloquearConsecutivo(tx, llave) {
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${llave})::text`);
}

// Bloquea la solicitud hasta el fin de la transacción (tx). Debe ir ANTES de leerla:
// así dos acciones simultáneas sobre la misma SBO se ejecutan una tras otra y la segunda ve lo que hizo la primera.
async function bloquearSolicitud(tx, id) {
  await tx.$queryRaw`SELECT id FROM ${tabla('Solicitud')} WHERE id = ${id} FOR UPDATE`;
}

// Lee el producto bloqueando su fila hasta el fin de la transacción (tx).
// Así dos operaciones simultáneas sobre el mismo producto se ejecutan una tras otra.
async function bloquearProducto(tx, codigo_producto) {
  const filas = await tx.$queryRaw`
    SELECT id, cantidad, cantidad_reservada FROM ${tablaProducto()}
    WHERE codigo_producto = ${codigo_producto} FOR UPDATE`;
  return filas[0] || null;
}

async function obtenerProducto(tx, codigo_producto) {
  const producto = await bloquearProducto(tx, codigo_producto);
  if (!producto) {
    throw new StockError(404, `El producto ${codigo_producto} no existe en el inventario.`);
  }
  return producto;
}

const disponible = (producto) => producto.cantidad - producto.cantidad_reservada;

// Desde la Fase D un producto agotado se conserva con 0 unidades (kardex e inactivación)
async function cantidadActual(tx, id) {
  const { cantidad } = await tx.producto.findUnique({ where: { id } });
  return cantidad;
}

// Retiro manual: solo puede usar el stock que no está reservado por una SBO
async function descontarStock(tx, codigo_producto, cantidad) {
  const producto = await obtenerProducto(tx, codigo_producto);

  if (disponible(producto) < cantidad) {
    const reservadas = producto.cantidad_reservada > 0 ? ` (${producto.cantidad_reservada} reservadas para Solicitudes SBO)` : '';
    throw new StockError(400, `Stock insuficiente para ${codigo_producto}. Solo hay ${disponible(producto)} unidades disponibles${reservadas}.`);
  }

  await tx.producto.update({ where: { id: producto.id }, data: { cantidad: { decrement: cantidad } } });
  return cantidadActual(tx, producto.id);
}

// Aparta stock para una SBO aprobada
async function reservarStock(tx, codigo_producto, cantidad) {
  const producto = await obtenerProducto(tx, codigo_producto);

  if (disponible(producto) < cantidad) {
    throw new StockError(400, `Stock insuficiente para ${codigo_producto}: se requieren ${cantidad} y hay ${disponible(producto)} disponibles.`);
  }

  await tx.producto.update({ where: { id: producto.id }, data: { cantidad_reservada: { increment: cantidad } } });
}

// Devuelve al stock disponible lo reservado por una SBO cancelada
async function liberarReserva(tx, codigo_producto, cantidad) {
  const producto = await bloquearProducto(tx, codigo_producto);
  if (!producto) return;

  await tx.producto.update({
    where: { id: producto.id },
    data: { cantidad_reservada: Math.max(0, producto.cantidad_reservada - cantidad) }
  });
}

// Despacho de una SBO: libera toda la reserva y descuenta solo lo realmente alistado
async function despacharReservado(tx, codigo_producto, alistada, reservada) {
  const producto = await obtenerProducto(tx, codigo_producto);

  await tx.producto.update({
    where: { id: producto.id },
    data: {
      cantidad: { decrement: alistada },
      cantidad_reservada: Math.max(0, producto.cantidad_reservada - reservada)
    }
  });
  return cantidadActual(tx, producto.id);
}

module.exports = { StockError, tablaProducto, LLAVES_CONSECUTIVO, bloquearConsecutivo, bloquearSolicitud, descontarStock, reservarStock, liberarReserva, despacharReservado };
