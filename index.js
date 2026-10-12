const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
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
    console.error(error);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
});

// Ruta para actualizar la ubicación o datos de un producto
app.put('/api/productos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productoActualizado = await prisma.producto.update({
      where: { id: id },
      data: req.body
    });
    res.json(productoActualizado);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el producto' });
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
    
    // 1. Buscar si el producto existe
    const producto = await prisma.producto.findUnique({
      where: { codigo_producto }
    });

    if (!producto) {
      return res.status(404).json({ error: "El producto no existe en el inventario." });
    }

    // 2. Verificar si hay suficiente cantidad
    if (producto.cantidad < cantidad_retirada) {
      return res.status(400).json({ error: `Stock insuficiente. Solo hay ${producto.cantidad} unidades disponibles.` });
    }

    const nuevaCantidad = producto.cantidad - cantidad_retirada;

    // 3. Actualizar la cantidad o eliminar si se acaba
    if (nuevaCantidad === 0) {
      await prisma.producto.delete({ where: { id: producto.id } });
    } else {
      await prisma.producto.update({
        where: { id: producto.id },
        data: { cantidad: nuevaCantidad }
      });
    }

    // 4. Registrar la auditoría en el Historial
    await prisma.historial.create({
      data: {
        codigo_producto,
        accion: 'SALIDA/RETIRO',
        operario,
        detalles: `Retiro de ${cantidad_retirada} unidades. Motivo: ${motivo}`
      }
    });

    res.json({ message: "Salida exitosa", nuevaCantidad });
  } catch (error) {
    console.error("Error en salida:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Inicializar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});