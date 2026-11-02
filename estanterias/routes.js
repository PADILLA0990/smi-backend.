// Mapa de Bodega: estanterías (Configuración) y contenido del mapa
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { crearEstanteria, editarEstanteria, listarEstanterias, mapaBodega, crearDistribucionInicial } = require('../lib/estanterias');

const router = express.Router();
const OPCIONES_TX = { maxWait: 10000, timeout: 30000 };

// Zonas con estanterías (celdas nivel × hueco con sus productos), áreas y productos fuera de estanterías
router.get('/mapa', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await mapaBodega(prisma));
  } catch (error) {
    manejarError(res, error, 'Error al consultar el mapa de bodega');
  }
});

router.get('/estanterias', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await listarEstanterias(prisma));
  } catch (error) {
    manejarError(res, error, 'Error al consultar las estanterías');
  }
});

// Crea la estantería y sus huecos (Z1-A-1-01…)
router.post('/estanterias', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction(tx => crearEstanteria(tx, req.body || {}), OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al crear la estantería');
  }
});

// Cambia calle, niveles, huecos, orden o activo. Los huecos que sobran se desactivan si están vacíos.
router.patch('/estanterias/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'La estantería no existe.' });
    res.json(await prisma.$transaction(tx => editarEstanteria(tx, id, req.body || {}), OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar la estantería');
  }
});

// Carga la distribución propuesta (racks A–J y áreas). Solo crea lo que falta.
router.post('/estanterias/distribucion-inicial', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction(tx => crearDistribucionInicial(tx), { maxWait: 10000, timeout: 90000 }));
  } catch (error) {
    manejarError(res, error, 'Error al cargar la distribución inicial');
  }
});

module.exports = router;
