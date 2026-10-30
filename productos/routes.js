const express = require('express');
const prisma = require('../lib/prisma');
const { descontarStock, StockError } = require('../lib/stock');
const { manejarError, esEnteroPositivo, campoFaltante } = require('../lib/errores');

const router = express.Router();

const OPCIONES_TX = { maxWait: 10000, timeout: 20000 };

// Solicitudes que todavía pueden mover stock de un producto
const ESTADOS_SBO_ACTIVOS = ['CREADA', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];

// Cada acción sobre el inventario guarda su auditoría en la misma transacción:
// o quedan registrados ambos (movimiento + historial) o ninguno.
const registrarHistorial = (tx, codigo_producto, accion, operario, detalles) =>
  tx.historial.create({ data: { codigo_producto, accion, operario, detalles } });

const idValido = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'El producto no existe.' });
    return null;
  }
  return id;
};

// Obtener el inventario de productos
router.get('/productos', async (req, res) => {
  try {
    const productos = await prisma.producto.findMany({ orderBy: { fecha_ingreso: 'desc' } });
    res.json(productos);
  } catch (error) {
    manejarError(res, error, 'Error al conectar con la base de datos');
  }
});

// Ingreso: crea el producto o, si el código ya existe, suma la cantidad a su stock
router.post('/productos', async (req, res) => {
  try {
    const faltante = campoFaltante(req.body, ['codigo_producto', 'descripcion', 'categoria', 'operario']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    const cantidad = Number(req.body.cantidad);
    if (!esEnteroPositivo(cantidad)) {
      return res.status(400).json({ error: 'La cantidad debe ser un número entero mayor a 0.' });
    }

    const codigo_producto = req.body.codigo_producto.trim();
    const { descripcion, categoria, operario } = req.body;
    const estado = req.body.estado || 'Bueno';
    const ubicacion_general = req.body.ubicacion_general || 'Recepción';

    const resultado = await prisma.$transaction(async (tx) => {
      const existente = await tx.producto.findUnique({ where: { codigo_producto } });

      if (existente) {
        const producto = await tx.producto.update({
          where: { id: existente.id },
          data: { cantidad: { increment: cantidad } }
        });
        await registrarHistorial(tx, codigo_producto, 'INGRESO ADICIONAL', operario,
          `Ingresó cantidad: ${cantidad}. Stock total: ${producto.cantidad}`);
        return { producto, adicional: true };
      }

      const producto = await tx.producto.create({
        data: { codigo_producto, descripcion, categoria, cantidad, estado, ubicacion_general }
      });
      await registrarHistorial(tx, codigo_producto, 'INGRESO NUEVO', operario, `Ingresó cantidad: ${cantidad}`);
      return { producto, adicional: false };
    }, OPCIONES_TX);

    res.status(resultado.adicional ? 200 : 201).json(resultado);
  } catch (error) {
    manejarError(res, error, 'Error al registrar el ingreso');
  }
});

// Reubicar un producto
router.put('/productos/:id', async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;

    const faltante = campoFaltante(req.body, ['codigo_estanteria', 'operario']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    const { codigo_estanteria, operario } = req.body;
    const ubicacion_general = req.body.ubicacion_general || 'Almacenamiento';

    const producto = await prisma.$transaction(async (tx) => {
      const actualizado = await tx.producto.update({
        where: { id },
        data: { ubicacion_general, codigo_estanteria: codigo_estanteria.trim() }
      });
      await registrarHistorial(tx, actualizado.codigo_producto, 'REUBICACIÓN', operario, `Movido a: ${actualizado.codigo_estanteria}`);
      return actualizado;
    }, OPCIONES_TX);

    res.json(producto);
  } catch (error) {
    manejarError(res, error, 'Error al reubicar el producto');
  }
});

// Eliminar un producto del inventario (bloqueado si tiene Solicitudes SBO en curso)
router.delete('/productos/:id', async (req, res) => {
  try {
    const id = idValido(req, res);
    if (id === null) return;

    const operario = req.body?.operario;
    if (!operario) {
      return res.status(400).json({ error: 'El campo "operario" es obligatorio.' });
    }

    await prisma.$transaction(async (tx) => {
      const producto = await tx.producto.findUnique({ where: { id } });
      if (!producto) {
        throw new StockError(404, 'El producto no existe.');
      }

      const pendientes = await tx.solicitud.findMany({
        where: { estado: { in: ESTADOS_SBO_ACTIVOS }, items: { some: { codigo_producto: producto.codigo_producto } } },
        select: { codigo_sbo: true }
      });
      if (pendientes.length > 0) {
        throw new StockError(409, `No se puede eliminar: el producto está en Solicitudes SBO en curso (${pendientes.map(s => s.codigo_sbo).join(', ')}). Cancélelas o despáchelas primero.`);
      }

      await tx.producto.delete({ where: { id } });
      await registrarHistorial(tx, producto.codigo_producto, 'ELIMINACIÓN', operario,
        `Artículo retirado del sistema (tenía ${producto.cantidad} unidades)`);
    }, OPCIONES_TX);

    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error) {
    manejarError(res, error, 'Error al eliminar el producto');
  }
});

// Salida manual de inventario
router.post('/salida', async (req, res) => {
  try {
    const { codigo_producto, cantidad_retirada, motivo, operario } = req.body;

    const faltante = campoFaltante(req.body, ['codigo_producto', 'motivo', 'operario']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    if (!esEnteroPositivo(cantidad_retirada)) {
      return res.status(400).json({ error: 'La cantidad a retirar debe ser un número entero mayor a 0.' });
    }

    const nuevaCantidad = await prisma.$transaction(async (tx) => {
      const restante = await descontarStock(tx, codigo_producto.trim(), cantidad_retirada);
      await registrarHistorial(tx, codigo_producto.trim(), 'SALIDA/RETIRO', operario,
        `Retiro de ${cantidad_retirada} unidades. Motivo: ${motivo}`);
      return restante;
    }, OPCIONES_TX);

    res.json({ message: 'Salida exitosa', nuevaCantidad });
  } catch (error) {
    manejarError(res, error, 'Error interno del servidor');
  }
});

module.exports = router;
