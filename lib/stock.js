// Error de negocio con código HTTP asociado
class StockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Lee el producto bloqueando su fila hasta el fin de la transacción (tx).
// Así dos operaciones simultáneas sobre el mismo producto se ejecutan una tras otra.
async function bloquearProducto(tx, codigo_producto) {
  const filas = await tx.$queryRaw`
    SELECT id, cantidad, cantidad_reservada FROM "Producto"
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

// Se mantiene el comportamiento original: el producto se elimina al agotarse
async function eliminarSiAgotado(tx, id) {
  const { cantidad } = await tx.producto.findUnique({ where: { id } });
  if (cantidad === 0) {
    await tx.producto.delete({ where: { id } });
  }
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
  return eliminarSiAgotado(tx, producto.id);
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
  return eliminarSiAgotado(tx, producto.id);
}

module.exports = { StockError, descontarStock, reservarStock, liberarReserva, despacharReservado };
