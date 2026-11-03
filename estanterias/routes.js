// Mapa de Bodega: estanterías (Configuración) y contenido del mapa
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { crearEstanteria, editarEstanteria, listarEstanterias, mapaBodega, crearDistribucionInicial, completarPlano, guardarElemento } = require('../lib/estanterias');

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

// Cambia calle, niveles, huecos (y huecos desde el nivel 2), orden, posición en el plano o activo. Los huecos que sobran se desactivan si están vacíos.
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


// ---- Plano de la bodega (áreas, entradas, puertas, calles y PC; los racks se ubican en su estantería) ----
router.get('/plano', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await prisma.elementoPlano.findMany({ orderBy: [{ zona: 'asc' }, { id: 'asc' }] }));
  } catch (error) {
    manejarError(res, error, 'Error al consultar el plano');
  }
});

router.post('/plano', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction(tx => guardarElemento(tx, null, req.body || {}), OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al crear el elemento del plano');
  }
});

router.patch('/plano/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'El elemento del plano no existe.' });
    res.json(await prisma.$transaction(tx => guardarElemento(tx, id, req.body || {}), OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar el elemento del plano');
  }
});

router.delete('/plano/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const borrado = Number.isInteger(id) ? await prisma.elementoPlano.deleteMany({ where: { id } }) : { count: 0 };
    if (borrado.count === 0) return res.status(404).json({ error: 'El elemento del plano no existe.' });
    res.json({ ok: true });
  } catch (error) {
    manejarError(res, error, 'Error al borrar el elemento del plano');
  }
});

// Completa la bodega ya cargada con la distribución: huecos de los niveles superiores, posición de los racks
// y el plano de las zonas que no lo tienen. No cambia lo que ya esté configurado.
router.post('/plano/completar', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.json(await prisma.$transaction(tx => completarPlano(tx), { maxWait: 10000, timeout: 90000 }));
  } catch (error) {
    manejarError(res, error, 'Error al completar el plano');
  }
});

module.exports = router;
