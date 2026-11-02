// Codificación de productos 001-RCM-B: árbol (Configuración → Codificación) y siguiente código sugerido
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { arbol, siguienteCodigo, editarCategoriaCodigo, crearNivel, editarNivel, crearArbol } = require('../lib/codificacion');

const router = express.Router();
const OPCIONES_TX = { maxWait: 10000, timeout: 30000 };
const idDe = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : 0);

router.get('/codificacion', autorizar('inventario:ver'), async (req, res) => {
  try {
    res.json(await arbol(prisma));
  } catch (error) {
    manejarError(res, error, 'Error al consultar la codificación');
  }
});

// ?categoriaId=&subcategoriaId=&varianteId=&condicion=&excluir=001-RCM-B,002-RCM-B → { codigo } (null si la categoría no tiene letra)
router.get('/codificacion/siguiente', autorizar('inventario:ver'), async (req, res) => {
  try {
    const excluir = typeof req.query.excluir === 'string' && req.query.excluir ? req.query.excluir.split(',').slice(0, 200) : [];
    res.json(await siguienteCodigo(prisma, { ...req.query, excluir }));
  } catch (error) {
    manejarError(res, error, 'Error al sugerir el código');
  }
});

// Letra (nivel 1) y nombre del nivel 3 de una categoría
router.patch('/codificacion/categorias/:id', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.json(await prisma.$transaction(tx => editarCategoriaCodigo(tx, idDe(req), req.body || {}), OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al guardar la categoría');
  }
});

// Subcategorías (nivel 2) y variantes (nivel 3)
for (const tipo of ['subcategorias', 'variantes']) {
  router.post(`/codificacion/categorias/:id/${tipo}`, autorizar('configuracion:gestionar'), async (req, res) => {
    try {
      res.status(201).json(await prisma.$transaction(tx => crearNivel(tx, tipo, idDe(req), req.body || {}), OPCIONES_TX));
    } catch (error) {
      manejarError(res, error, 'Error al guardar en la codificación');
    }
  });
  router.patch(`/codificacion/${tipo}/:id`, autorizar('configuracion:gestionar'), async (req, res) => {
    try {
      res.json(await prisma.$transaction(tx => editarNivel(tx, tipo, idDe(req), req.body || {}), OPCIONES_TX));
    } catch (error) {
      manejarError(res, error, 'Error al guardar en la codificación');
    }
  });
}

// Carga el árbol propuesto en docs/CODIFICACION.md (solo crea lo que falta)
router.post('/codificacion/arbol-inicial', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction(tx => crearArbol(tx), { maxWait: 10000, timeout: 90000 }));
  } catch (error) {
    manejarError(res, error, 'Error al cargar el árbol de codificación');
  }
});

module.exports = router;
