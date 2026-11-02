// Fase E: lista de novedades y trazabilidad (solo lectura). Registrar novedades va por /solicitudes/:id/...
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { TIPOS, TIPOS_MANUALES, listarNovedades, trazabilidad } = require('../lib/novedades');

const router = express.Router();

router.get('/novedades/tipos', autorizar('inventario:ver'), (req, res) => res.json({ tipos: TIPOS, manuales: TIPOS_MANUALES }));

router.get('/novedades', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await listarNovedades(prisma, req.query));
  } catch (error) {
    manejarError(res, error, 'Error al obtener las novedades');
  }
});

router.get('/trazabilidad', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await trazabilidad(prisma, req.query.codigo));
  } catch (error) {
    manejarError(res, error, 'Error al consultar la trazabilidad');
  }
});

module.exports = router;
