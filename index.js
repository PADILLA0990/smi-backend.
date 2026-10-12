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

// Inicializar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});