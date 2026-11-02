// Fase F: indicadores (solo lectura)
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { catalogo, calcular, periodo, cargarDatos } = require('../lib/indicadores');

const router = express.Router();

router.get('/indicadores', autorizar('inventario:ver'), (req, res) => res.json(catalogo()));

// ?anio=2026&mes=11 (sin mes: el año completo) · sin-movimiento acepta ?dias=
router.get('/indicadores/:id', autorizar('inventario:ver'), async (req, res) => {
  try {
    const hoy = new Date();
    const p = periodo(req.query.anio || hoy.getFullYear(), req.query.mes);
    const dias = req.query.dias ? Number(req.query.dias) : undefined;
    if (dias !== undefined && (!Number.isInteger(dias) || dias < 1 || dias > 3650)) {
      return res.status(400).json({ error: 'Días inválidos (1 a 3650).' });
    }
    res.json(calcular(req.params.id, await cargarDatos(prisma), p, { dias }));
  } catch (error) {
    manejarError(res, error, 'Error al calcular el indicador');
  }
});

module.exports = router;
