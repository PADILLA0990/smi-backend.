// Mapa de Bodega: estanterías (Configuración) y contenido del mapa
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { StockError } = require('../lib/stock');
const { crearEstanteria, editarEstanteria, listarEstanterias, mapaBodega, marcarHuecoLleno, crearDistribucionInicial, completarPlano, guardarElemento } = require('../lib/estanterias');
const { registrarConfiguracion, registrarEdicion } = require('../lib/historial');

const router = express.Router();
const OPCIONES_TX = { maxWait: 10000, timeout: 30000 };

// Campos que se muestran en el historial cuando cambian
const CAMPOS_ESTANTERIA = { calle: 'Calle', niveles: 'Niveles', huecos: 'Huecos', huecos_superiores: 'Huecos desde el nivel 2', orden: 'Orden', plano_x: 'Posición X', plano_y: 'Posición Y', plano_vertical: 'Vertical' };
const CAMPOS_ELEMENTO = { zona: 'Zona', tipo: 'Tipo', etiqueta: 'Etiqueta', x: 'Posición X', y: 'Posición Y', ancho: 'Ancho', alto: 'Alto', ubicacion: 'Ubicación' };
const cambioElPlano = (c) => c.racks.length > 0 || c.elementos > 0 || c.areas_retiradas.length > 0;

// Zonas con estanterías (celdas nivel × hueco con sus productos), áreas y productos fuera de estanterías
router.get('/mapa', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await mapaBodega(prisma));
  } catch (error) {
    manejarError(res, error, 'Error al consultar el mapa de bodega');
  }
});

// Casilla "Lleno" de un hueco de rack: body { lleno: true | false }
router.patch('/mapa/huecos/:codigo/lleno', autorizar('productos:reubicar'), async (req, res) => {
  try {
    res.json(await prisma.$transaction(tx => marcarHuecoLleno(tx, req.params.codigo, req.body?.lleno, req.usuario), OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al marcar el hueco');
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
    res.status(201).json(await prisma.$transaction(async (tx) => {
      const estanteria = await crearEstanteria(tx, req.body || {});
      await registrarConfiguracion(tx, 'Estantería', req.usuario, `Creó ${estanteria.codigo}: ${estanteria.niveles} nivel(es), ${estanteria.huecos} hueco(s)`);
      return estanteria;
    }, OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al crear la estantería');
  }
});

// Cambia calle, niveles, huecos (y huecos desde el nivel 2), orden, posición en el plano o activo. Los huecos que sobran se desactivan si están vacíos.
router.patch('/estanterias/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'La estantería no existe.' });
    res.json(await prisma.$transaction(async (tx) => {
      const antes = await tx.estanteria.findUnique({ where: { id } });
      const estanteria = await editarEstanteria(tx, id, req.body || {});
      await registrarEdicion(tx, 'Estantería', req.usuario, estanteria.codigo, antes, estanteria, CAMPOS_ESTANTERIA);
      return estanteria;
    }, OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar la estantería');
  }
});

// Carga la distribución propuesta (racks A–J y áreas). Solo crea lo que falta.
router.post('/estanterias/distribucion-inicial', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction(async (tx) => {
      const creado = await crearDistribucionInicial(tx);
      if (creado.estanterias.length || creado.areas.length || cambioElPlano(creado.plano)) {
        await registrarConfiguracion(tx, 'Plano', req.usuario, `Cargó la distribución inicial: ${creado.estanterias.length} estanterías, ${creado.areas.length} áreas, ${creado.plano.elementos} elementos del plano`);
      }
      return creado;
    }, { maxWait: 10000, timeout: 90000 }));
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
    res.status(201).json(await prisma.$transaction(async (tx) => {
      const elemento = await guardarElemento(tx, null, req.body || {});
      await registrarConfiguracion(tx, 'Plano', req.usuario, `Creó "${elemento.etiqueta}" en ${elemento.zona}`);
      return elemento;
    }, OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al crear el elemento del plano');
  }
});

router.patch('/plano/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'El elemento del plano no existe.' });
    res.json(await prisma.$transaction(async (tx) => {
      const antes = await tx.elementoPlano.findUnique({ where: { id } });
      const elemento = await guardarElemento(tx, id, req.body || {});
      await registrarEdicion(tx, 'Plano', req.usuario, `"${elemento.etiqueta}"`, antes, elemento, CAMPOS_ELEMENTO);
      return elemento;
    }, OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar el elemento del plano');
  }
});

router.delete('/plano/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'El elemento del plano no existe.' });
    await prisma.$transaction(async (tx) => {
      const elemento = await tx.elementoPlano.findUnique({ where: { id } });
      if (!elemento) throw new StockError(404, 'El elemento del plano no existe.');
      await tx.elementoPlano.delete({ where: { id } });
      await registrarConfiguracion(tx, 'Plano', req.usuario, `Borró "${elemento.etiqueta}" de ${elemento.zona}`);
    }, OPCIONES_TX);
    res.json({ ok: true });
  } catch (error) {
    manejarError(res, error, 'Error al borrar el elemento del plano');
  }
});

// Completa la bodega ya cargada con la distribución: huecos de los niveles superiores, posición de los racks
// y el plano de las zonas que no lo tienen. No cambia lo que ya esté configurado.
router.post('/plano/completar', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.json(await prisma.$transaction(async (tx) => {
      const cambios = await completarPlano(tx);
      if (cambioElPlano(cambios)) {
        await registrarConfiguracion(tx, 'Plano', req.usuario, `Completó el plano: ${cambios.racks.length} racks, ${cambios.elementos} elementos, ${cambios.areas_retiradas.length} áreas retiradas`);
      }
      return cambios;
    }, { maxWait: 10000, timeout: 90000 }));
  } catch (error) {
    manejarError(res, error, 'Error al completar el plano');
  }
});

module.exports = router;
