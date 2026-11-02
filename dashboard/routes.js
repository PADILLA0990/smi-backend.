// Dashboard (Fase D4): resumen de solo lectura para el panel principal
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { resumenDashboard } = require('../lib/dashboard');

const router = express.Router();

router.get('/dashboard', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await resumenDashboard(prisma));
  } catch (error) {
    manejarError(res, error, 'Error al obtener el resumen del panel');
  }
});

module.exports = router;
