// Error de negocio con código HTTP asociado
class StockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Descuenta stock de forma atómica dentro de una transacción (tx).
// El UPDATE condicional evita que dos retiros simultáneos dejen stock negativo.
async function descontarStock(tx, codigo_producto, cantidad) {
  const producto = await tx.producto.findUnique({ where: { codigo_producto } });

  if (!producto) {
    throw new StockError(404, `El producto ${codigo_producto} no existe en el inventario.`);
  }

  const { count } = await tx.producto.updateMany({
    where: { id: producto.id, cantidad: { gte: cantidad } },
    data: { cantidad: { decrement: cantidad } }
  });

  if (count === 0) {
    // Se relee: otro retiro simultáneo pudo haber cambiado la cantidad
    const actual = await tx.producto.findUnique({ where: { id: producto.id } });
    throw new StockError(400, `Stock insuficiente para ${codigo_producto}. Solo hay ${actual ? actual.cantidad : 0} unidades disponibles.`);
  }

  const { cantidad: nuevaCantidad } = await tx.producto.findUnique({ where: { id: producto.id } });

  // Se mantiene el comportamiento original: el producto se elimina al agotarse
  if (nuevaCantidad === 0) {
    await tx.producto.delete({ where: { id: producto.id } });
  }

  return nuevaCantidad;
}

module.exports = { descontarStock, StockError };
