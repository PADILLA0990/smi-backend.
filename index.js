const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const { descontarStock, StockError } = require('./lib/stock');
const solicitudesRoutes = require('./solicitudes/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de middlewares
app.use(cors());
app.use(express.json()); // Permite al servidor entender datos en formato JSON

// Ruta de prueba para verificar que el servidor vive
app.get('/', (req, res) => {
  res.send('API del Banco de Alimentos funcionando correctamente');
});

// Ruta para obtener el inventario de productos
app.get('/api/productos', async (req, res) => {
  try {
    const productos = await prisma.producto.findMany();
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: 'Error al conectar con la base de datos' });
  }
});

// Ruta para crear un nuevo producto
app.post('/api/productos', async (req, res) => {
  try {
    const nuevoProducto = await prisma.producto.create({
      data: req.body
    });
    res.status(201).json(nuevoProducto);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: `Ya existe un producto con el código ${req.body.codigo_producto}.` });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
});

// --- RUTAS PARA LA AUDITORÍA (HISTORIAL) ---

// 1. Guardar un nuevo movimiento en el historial
app.post('/api/historial', async (req, res) => {
  try {
    const { codigo_producto, accion, operario, detalles } = req.body;
    const nuevoRegistro = await prisma.historial.create({
      data: { codigo_producto, accion, operario, detalles }
    });
    res.status(201).json(nuevoRegistro);
  } catch (error) {
    console.error("Error al guardar historial:", error);
    res.status(500).json({ error: "Error al registrar el movimiento" });
  }
});

// 2. Obtener todo el historial (del más reciente al más antiguo)
app.get('/api/historial', async (req, res) => {
  try {
    const registros = await prisma.historial.findMany({
      orderBy: { fecha: 'desc' } // Ordena por fecha descendente
    });
    res.json(registros);
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ error: "Error al obtener los registros" });
  }
});

// --- RUTAS PARA GESTIÓN DE INVENTARIO (REUBICAR Y ELIMINAR) ---

// Actualizar ubicación de un producto (Reubicar)
app.put('/api/productos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ubicacion_general, codigo_estanteria } = req.body;
    const productoActualizado = await prisma.producto.update({
      where: { id: Number(id) },
      data: { ubicacion_general, codigo_estanteria }
    });
    res.json(productoActualizado);
  } catch (error) {
    console.error("Error al actualizar producto:", error);
    res.status(500).json({ error: "Error al actualizar" });
  }
});

// Eliminar un producto físicamente del inventario
app.delete('/api/productos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.producto.delete({
      where: { id: Number(id) }
    });
    res.json({ message: "Producto eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    res.status(500).json({ error: "Error al eliminar" });
  }
});

// --- RUTA INTELIGENTE PARA SALIDAS DE INVENTARIO ---
app.post('/api/salida', async (req, res) => {
  try {
    const { codigo_producto, cantidad_retirada, motivo, operario } = req.body;

    if (!Number.isInteger(cantidad_retirada) || cantidad_retirada <= 0) {
      return res.status(400).json({ error: "La cantidad a retirar debe ser un número entero mayor a 0." });
    }

    // Descuento de stock y auditoría en una sola transacción: o se hacen ambos o ninguno
    const nuevaCantidad = await prisma.$transaction(async (tx) => {
      const restante = await descontarStock(tx, codigo_producto, cantidad_retirada);
      await tx.historial.create({
        data: {
          codigo_producto,
          accion: 'SALIDA/RETIRO',
          operario,
          detalles: `Retiro de ${cantidad_retirada} unidades. Motivo: ${motivo}`
        }
      });
      return restante;
    }, { maxWait: 10000, timeout: 20000 });

    res.json({ message: "Salida exitosa", nuevaCantidad });
  } catch (error) {
    if (error instanceof StockError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Error en salida:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- MÓDULO DE SOLICITUDES SBO ---
app.use('/api/solicitudes', solicitudesRoutes);

// Inicializar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});