// Fase G: conciliación. Conteos físicos, ajustes aprobados y reporte de consistencia historial ↔ stock.
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { crearConteo, registrarConteo, aprobarConteo, anularConteo, describirConteo, reporteConsistencia } = require('../lib/conciliacion');

const router = express.Router();
const OPCIONES_TX = { maxWait: 10000, timeout: 60000 };
const INCLUIR = { lineas: { orderBy: { id: 'asc' } }, motivo: { select: { nombre: true } } };

router.param('id', (req, res, next, id) => (Number.isInteger(Number(id)) ? next() : res.status(404).json({ error: 'Conteo no encontrado.' })));

const responder = async (res, id, status = 200) => {
  const conteo = await prisma.conteo.findUnique({ where: { id }, include: INCLUIR });
  res.status(status).json(describirConteo(conteo));
};

router.get('/conteos', autorizar('inventario:ver'), async (req, res) => {
  try {
    const conteos = await prisma.conteo.findMany({ include: INCLUIR, orderBy: { id: 'desc' }, take: 100 });
    res.json(conteos.map(c => { const { lineas, ...d } = describirConteo(c); return d; }));
  } catch (error) {
    manejarError(res, error, 'Error al obtener los conteos');
  }
});

router.get('/conteos/:id', autorizar('inventario:ver'), async (req, res) => {
  try {
    const conteo = await prisma.conteo.findUnique({ where: { id: Number(req.params.id) }, include: INCLUIR });
    if (!conteo) return res.status(404).json({ error: 'Conteo no encontrado.' });
    res.json(describirConteo(conteo));
  } catch (error) {
    manejarError(res, error, 'Error al obtener el conteo');
  }
});

// { alcance: TODO|CATEGORIA|UBICACION, categoriaId?, ubicacion?, observaciones? }
router.post('/conteos', autorizar('movimientos:registrar'), async (req, res) => {
  try {
    const conteo = await prisma.$transaction(tx => crearConteo(tx, req.body || {}, req.usuario), OPCIONES_TX);
    await responder(res, conteo.id, 201);
  } catch (error) {
    manejarError(res, error, 'Error al crear el conteo');
  }
});

// { lineas: [{ id, cantidad_contada }] }
router.put('/conteos/:id/lineas', autorizar('movimientos:registrar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction(tx => registrarConteo(tx, id, req.body?.lineas, req.usuario), OPCIONES_TX);
    await responder(res, id);
  } catch (error) {
    manejarError(res, error, 'Error al registrar el conteo');
  }
});

// { motivoId, observaciones? } → aplica los ajustes y cierra el conteo
router.post('/conteos/:id/aprobar', autorizar('conciliacion:aprobar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction(tx => aprobarConteo(tx, id, req.body || {}, req.usuario), OPCIONES_TX);
    await responder(res, id);
  } catch (error) {
    manejarError(res, error, 'Error al aprobar los ajustes');
  }
});

router.post('/conteos/:id/anular', autorizar('conciliacion:aprobar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction(tx => anularConteo(tx, id, req.usuario), OPCIONES_TX);
    await responder(res, id);
  } catch (error) {
    manejarError(res, error, 'Error al anular el conteo');
  }
});

router.get('/conciliacion/consistencia', autorizar('conciliacion:aprobar'), async (req, res) => {
  try {
    res.json(await reporteConsistencia(prisma));
  } catch (error) {
    manejarError(res, error, 'Error al revisar la consistencia');
  }
});

module.exports = router;
