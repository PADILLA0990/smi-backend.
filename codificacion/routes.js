// Codificación de productos 001-RCM-B: árbol (Configuración → Codificación) y siguiente código sugerido
const express = require('express');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { arbol, siguienteCodigo, editarCategoriaCodigo, crearNivel, editarNivel, crearArbol } = require('../lib/codificacion');
const { registrarConfiguracion, registrarEdicion } = require('../lib/historial');

const router = express.Router();
const OPCIONES_TX = { maxWait: 10000, timeout: 30000 };
const idDe = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : 0);

// Cómo aparece cada cambio en el historial
const AREA = 'Codificación';
const NIVELES = { subcategorias: { modelo: 'subcategoria', etiqueta: 'subcategoría' }, variantes: { modelo: 'variante', etiqueta: 'variante' } };
const CAMPOS_CATEGORIA = { letra: 'Letra', nombre_variante: 'Nombre del nivel 3' };
const CAMPOS_NIVEL = { nombre: 'Nombre', letra: 'Letra' };

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
    res.json(await prisma.$transaction(async (tx) => {
      const antes = await tx.categoria.findUnique({ where: { id: idDe(req) } });
      const categoria = await editarCategoriaCodigo(tx, idDe(req), req.body || {});
      // El activo de la categoría se gestiona en su catálogo: aquí solo cuentan letra y nombre del nivel 3
      await registrarEdicion(tx, AREA, req.usuario, `la categoría "${categoria.nombre}"`, { ...antes, activo: categoria.activo }, categoria, CAMPOS_CATEGORIA);
      return categoria;
    }, OPCIONES_TX));
  } catch (error) {
    manejarError(res, error, 'Error al guardar la categoría');
  }
});

// Subcategorías (nivel 2) y variantes (nivel 3)
for (const tipo of ['subcategorias', 'variantes']) {
  router.post(`/codificacion/categorias/:id/${tipo}`, autorizar('configuracion:gestionar'), async (req, res) => {
    try {
      res.status(201).json(await prisma.$transaction(async (tx) => {
        const nivel = await crearNivel(tx, tipo, idDe(req), req.body || {});
        const categoria = await tx.categoria.findUnique({ where: { id: nivel.categoriaId }, select: { nombre: true } });
        await registrarConfiguracion(tx, AREA, req.usuario, `Creó la ${NIVELES[tipo].etiqueta} "${nivel.nombre}" (letra ${nivel.letra}) en ${categoria.nombre}`);
        return nivel;
      }, OPCIONES_TX));
    } catch (error) {
      manejarError(res, error, 'Error al guardar en la codificación');
    }
  });
  router.patch(`/codificacion/${tipo}/:id`, autorizar('configuracion:gestionar'), async (req, res) => {
    try {
      res.json(await prisma.$transaction(async (tx) => {
        const antes = await tx[NIVELES[tipo].modelo].findUnique({ where: { id: idDe(req) } });
        const nivel = await editarNivel(tx, tipo, idDe(req), req.body || {});
        await registrarEdicion(tx, AREA, req.usuario, `la ${NIVELES[tipo].etiqueta} "${antes.nombre}"`, antes, nivel, CAMPOS_NIVEL);
        return nivel;
      }, OPCIONES_TX));
    } catch (error) {
      manejarError(res, error, 'Error al guardar en la codificación');
    }
  });
}

// Carga el árbol propuesto en docs/CODIFICACION.md (solo crea lo que falta)
router.post('/codificacion/arbol-inicial', autorizar('configuracion:gestionar'), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction(async (tx) => {
      const creado = await crearArbol(tx);
      if (creado.categorias.length || creado.subcategorias || creado.variantes) {
        await registrarConfiguracion(tx, AREA, req.usuario, `Cargó el árbol inicial: ${creado.categorias.length} categorías, ${creado.subcategorias} subcategorías, ${creado.variantes} variantes`);
      }
      return creado;
    }, { maxWait: 10000, timeout: 90000 }));
  } catch (error) {
    manejarError(res, error, 'Error al cargar el árbol de codificación');
  }
});

module.exports = router;
