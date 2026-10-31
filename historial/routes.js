// Historial de movimientos (solo lectura: se escribe únicamente desde cada operación, en su transacción)
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { leerPaginacion, filtroFechas } = require('../lib/inventario');

const router = express.Router();

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// SBO relacionada con el registro: los eventos SBO usan el código de la SBO como "código";
// los despachos lo incluyen en el detalle ("SBO <código> → <organización>")
function sboDe(registro) {
  if (registro.accion.startsWith('SBO ')) return registro.codigo_producto;
  const m = (registro.detalles || '').match(/SBO (\S+) →/);
  return m ? m[1] : null;
}

// Con ?pagina= responde { datos, total, pagina, porPagina } con filtros:
// desde, hasta (AAAA-MM-DD), codigo, accion, operario, sbo y q (texto en código, operario o detalle).
// Sin ?pagina= devuelve todo, como antes (lo usa el verificador de consistencia).
router.get('/historial', autorizar('inventario:ver'), async (req, res) => {
  try {
    if (req.query.pagina === undefined) {
      return res.json(await prisma.historial.findMany({ orderBy: { fecha: 'desc' } }));
    }
    const { pagina, porPagina } = leerPaginacion(req.query, 25);
    const and = filtroFechas(req.query);
    const codigo = texto(req.query.codigo);
    if (codigo) and.push({ codigo_producto: { contains: codigo, mode: 'insensitive' } });
    if (texto(req.query.accion)) and.push({ accion: texto(req.query.accion) });
    if (texto(req.query.operario)) and.push({ operario: { equals: texto(req.query.operario), mode: 'insensitive' } });
    const sbo = texto(req.query.sbo);
    if (sbo) {
      and.push({
        OR: [
          { accion: { startsWith: 'SBO ' }, codigo_producto: { equals: sbo, mode: 'insensitive' } },
          { detalles: { contains: `SBO ${sbo} `, mode: 'insensitive' } }
        ]
      });
    }
    const q = texto(req.query.q);
    if (q) {
      and.push({
        OR: ['codigo_producto', 'operario', 'detalles', 'accion'].map(c => ({ [c]: { contains: q, mode: 'insensitive' } }))
      });
    }

    const where = { AND: and };
    const [total, registros] = await Promise.all([
      prisma.historial.count({ where }),
      prisma.historial.findMany({
        where, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (pagina - 1) * porPagina, take: porPagina,
        include: { documento: { select: { id: true, numero: true } } }
      })
    ]);
    res.json({
      datos: registros.map(r => ({ ...r, sbo: sboDe(r), es_sbo: r.accion.startsWith('SBO ') })),
      total, pagina, porPagina
    });
  } catch (error) {
    manejarError(res, error, 'Error al obtener los registros');
  }
});

// Valores existentes para los filtros (acciones y operarios)
router.get('/historial/filtros', autorizar('inventario:ver'), async (req, res) => {
  try {
    const [acciones, operarios] = await Promise.all([
      prisma.historial.findMany({ distinct: ['accion'], select: { accion: true }, orderBy: { accion: 'asc' } }),
      prisma.historial.findMany({ distinct: ['operario'], select: { operario: true }, orderBy: { operario: 'asc' } })
    ]);
    res.json({ acciones: acciones.map(a => a.accion), operarios: operarios.map(o => o.operario) });
  } catch (error) {
    manejarError(res, error, 'Error al obtener los filtros del historial');
  }
});

module.exports = router;
