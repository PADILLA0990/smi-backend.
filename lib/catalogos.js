// Catálogos administrables (Fase C): definición de campos, validación y búsqueda por id o nombre.
// Un registro de catálogo nunca se borra; se desactiva para que no se use en movimientos nuevos.
const { StockError } = require('./stock');

const CONDICIONES = {
  PERFECTO: 'Perfecto estado',
  BUENO: 'Buen estado',
  DETERIORO: 'En deterioro',
  DANADO: 'Dañado'
};

// Género o grupo etario del artículo (lista fija; ampliarla aquí si hace falta)
const GRUPOS = ['Mujer', 'Hombre', 'Unisex', 'Niña', 'Niño', 'Infantil unisex', 'Bebé', 'Adulto mayor'];

const TIPOS_TERCERO = { DONANTE: 'Donante', PROVEEDOR: 'Proveedor', AMBOS: 'Donante y proveedor' };
const TIPOS_MOTIVO = { SALIDA: 'Salida', AJUSTE: 'Ajuste', NOVEDAD: 'Novedad' };

// Tipos de campo: normalizan el valor recibido o lanzan un error con mensaje en español
const texto = (max) => ({ tipo: 'texto', max });
const TIPOS_CAMPO = {
  texto: (v, d, etiqueta) => {
    if (v.length > d.max) throw new StockError(400, `${etiqueta}: máximo ${d.max} caracteres.`);
    return v;
  },
  prefijo: (v, d, etiqueta) => {
    const p = v.toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(p)) throw new StockError(400, `${etiqueta}: de 2 a 5 letras sin tildes (ej. ROP).`);
    return p;
  },
  nit: (v, d, etiqueta) => {
    const n = v.replace(/[.\s]/g, '');
    if (!/^\d{5,12}(-\d)?$/.test(n)) throw new StockError(400, `${etiqueta}: solo números, con dígito de verificación opcional (ej. 900123456-7).`);
    return n;
  },
  telefono: (v, d, etiqueta) => {
    if (!/^[+\d][\d\s()-]{6,19}$/.test(v)) throw new StockError(400, `${etiqueta}: número no válido.`);
    return v;
  },
  correo: (v, d, etiqueta) => {
    if (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new StockError(400, `${etiqueta}: correo no válido.`);
    return v.toLowerCase();
  },
  codigo: (v, d, etiqueta) => {
    if (!/^[\p{L}\d][\p{L}\d ._-]{0,29}$/u.test(v)) throw new StockError(400, `${etiqueta}: hasta 30 caracteres (letras, números, espacio, punto o guion).`);
    return v;
  },
  entero: (v, d, etiqueta) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < d.min || n > d.max) throw new StockError(400, `${etiqueta}: número entero entre ${d.min} y ${d.max}.`);
    return n;
  },
  enum: (v, d, etiqueta) => {
    if (!Object.hasOwn(d.valores, v)) throw new StockError(400, `${etiqueta}: valor no válido.`);
    return v;
  }
};

// unicos: campos que no se pueden repetir (sin distinguir mayúsculas). Un arreglo agrupa campos (único por tipo).
const CATALOGOS = {
  categorias: {
    modelo: 'categoria', etiqueta: 'categoría', orden: { nombre: 'asc' },
    campos: {
      nombre: { ...texto(60), etiqueta: 'Nombre', requerido: true },
      prefijo: { tipo: 'prefijo', etiqueta: 'Prefijo' },
      descripcion: { ...texto(200), etiqueta: 'Descripción' }
    },
    unicos: ['nombre', 'prefijo']
  },
  organizaciones: {
    modelo: 'organizacion', etiqueta: 'organización', orden: { nombre: 'asc' },
    campos: {
      nombre: { ...texto(120), etiqueta: 'Nombre', requerido: true },
      nit: { tipo: 'nit', etiqueta: 'NIT' },
      contacto: { ...texto(120), etiqueta: 'Contacto' },
      telefono: { tipo: 'telefono', etiqueta: 'Teléfono' },
      correo: { tipo: 'correo', etiqueta: 'Correo' },
      localidad: { ...texto(60), etiqueta: 'Localidad' },
      direccion: { ...texto(160), etiqueta: 'Dirección' }
    },
    unicos: ['nombre', 'nit']
  },
  terceros: {
    modelo: 'tercero', etiqueta: 'donante o proveedor', orden: { nombre: 'asc' },
    campos: {
      tipo: { tipo: 'enum', valores: TIPOS_TERCERO, etiqueta: 'Tipo', requerido: true },
      nombre: { ...texto(120), etiqueta: 'Nombre', requerido: true },
      nit: { tipo: 'nit', etiqueta: 'NIT o documento' },
      contacto: { ...texto(120), etiqueta: 'Contacto' },
      telefono: { tipo: 'telefono', etiqueta: 'Teléfono' },
      correo: { tipo: 'correo', etiqueta: 'Correo' }
    },
    unicos: ['nombre', 'nit']
  },
  motivos: {
    modelo: 'motivo', etiqueta: 'motivo', orden: [{ tipo: 'asc' }, { nombre: 'asc' }],
    campos: {
      tipo: { tipo: 'enum', valores: TIPOS_MOTIVO, etiqueta: 'Tipo', requerido: true, fijo: true },
      nombre: { ...texto(80), etiqueta: 'Nombre', requerido: true }
    },
    unicos: [['tipo', 'nombre']]
  },
  unidades: {
    modelo: 'unidadManejo', etiqueta: 'unidad de manejo', orden: { factor: 'asc' },
    campos: {
      nombre: { ...texto(40), etiqueta: 'Nombre', requerido: true },
      abreviatura: { ...texto(10), etiqueta: 'Abreviatura' },
      factor: { tipo: 'entero', min: 1, max: 100000, etiqueta: 'Factor a unidades', requerido: true }
    },
    unicos: ['nombre']
  },
  ubicaciones: {
    modelo: 'ubicacion', etiqueta: 'ubicación', orden: { codigo: 'asc' },
    campos: {
      codigo: { tipo: 'codigo', etiqueta: 'Código', requerido: true },
      nombre: { ...texto(80), etiqueta: 'Nombre' },
      zona: { ...texto(40), etiqueta: 'Zona' },
      estante: { ...texto(20), etiqueta: 'Estante' },
      nivel: { ...texto(20), etiqueta: 'Nivel' },
      posicion: { ...texto(20), etiqueta: 'Posición' }
    },
    unicos: ['codigo']
  }
};

// Valida el cuerpo según la definición. En una edición (parcial) solo se revisan los campos enviados.
function validarCampos(def, body, { parcial = false } = {}) {
  const data = {};
  for (const [campo, d] of Object.entries(def.campos)) {
    if (!(campo in body)) {
      if (!parcial && d.requerido) throw new StockError(400, `El campo "${d.etiqueta}" es obligatorio.`);
      continue;
    }
    if (parcial && d.fijo) throw new StockError(400, `El campo "${d.etiqueta}" no se puede cambiar.`);
    const crudo = body[campo];
    const valor = typeof crudo === 'string' ? crudo.trim() : crudo;
    if (valor === null || valor === undefined || valor === '') {
      if (d.requerido) throw new StockError(400, `El campo "${d.etiqueta}" es obligatorio.`);
      data[campo] = null;
      continue;
    }
    if (d.tipo !== 'entero' && typeof valor !== 'string') throw new StockError(400, `${d.etiqueta}: debe ser texto.`);
    data[campo] = TIPOS_CAMPO[d.tipo](valor, d, d.etiqueta);
  }
  if ('activo' in body) {
    if (typeof body.activo !== 'boolean') throw new StockError(400, 'El campo "activo" debe ser verdadero o falso.');
    data.activo = body.activo;
  }
  return data;
}

// Rechaza duplicados sin distinguir mayúsculas (el índice único de la base solo compara exacto)
async function verificarUnicos(tx, def, data, id, actual = {}) {
  for (const unico of def.unicos) {
    const campos = Array.isArray(unico) ? unico : [unico];
    const valores = campos.map(c => (c in data ? data[c] : actual[c]));
    if (valores.some(v => v === null || v === undefined) || !campos.some(c => c in data)) continue;
    const where = { AND: campos.map((c, i) => (typeof valores[i] === 'string' && def.campos[c].tipo !== 'enum'
      ? { [c]: { equals: valores[i], mode: 'insensitive' } }
      : { [c]: valores[i] })) };
    if (id) where.NOT = { id };
    const repetido = await tx[def.modelo].findFirst({ where });
    if (repetido) {
      const campo = def.campos[campos[campos.length - 1]].etiqueta.toLowerCase();
      throw new StockError(409, `Ya existe una ${def.etiqueta} con ese ${campo}.`);
    }
  }
}

// Busca un registro activo por id (número) o por su texto (sin distinguir mayúsculas)
async function resolverActivo(tx, modelo, valor, { campoTexto = 'nombre', extra = {}, etiqueta }) {
  if (valor === undefined || valor === null || valor === '') return null;
  const where = /^\d+$/.test(String(valor).trim())
    ? { id: Number(valor), ...extra }
    : { [campoTexto]: { equals: String(valor).trim(), mode: 'insensitive' }, ...extra };
  const registro = await tx[modelo].findFirst({ where });
  if (!registro) throw new StockError(400, `${etiqueta} no existe en el catálogo.`);
  if (!registro.activo) throw new StockError(400, `${etiqueta} no está disponible: "${registro[campoTexto]}" fue desactivado en el catálogo.`);
  return registro;
}

// --- Parámetros de operación (valores por defecto si nadie los ha cambiado) ---
const PARAMETROS = {
  tiempo_meta_alistamiento_horas: { etiqueta: 'Tiempo meta de alistamiento (horas)', defecto: 24, min: 1, max: 720 },
  dias_atraso_sbo: { etiqueta: 'Días de tolerancia antes de marcar una SBO como atrasada', defecto: 0, min: 0, max: 60 },
  dias_vencimiento_sbo: { etiqueta: 'Días sin movimiento para que una SBO se venza', defecto: 30, min: 1, max: 365 },
  dias_aviso_vencimiento_sbo: { etiqueta: 'Días de aviso antes del vencimiento de una SBO', defecto: 5, min: 0, max: 60 },
  stock_minimo_defecto: { etiqueta: 'Stock mínimo por defecto (unidades)', defecto: 5, min: 0, max: 100000 },
  lote_pequeno_max: { etiqueta: 'Lote pequeño: hasta (unidades)', defecto: 10, min: 1, max: 100000 },
  lote_mediano_max: { etiqueta: 'Lote mediano: hasta (unidades)', defecto: 50, min: 2, max: 100000 }
};

async function leerParametros(tx) {
  const guardados = await tx.parametro.findMany();
  const valores = Object.fromEntries(Object.entries(PARAMETROS).map(([k, d]) => [k, d.defecto]));
  for (const p of guardados) if (p.clave in valores) valores[p.clave] = Number(p.valor);
  return valores;
}

function validarParametros(body, actuales) {
  const nuevos = { ...actuales };
  const cambios = {};
  for (const [clave, valor] of Object.entries(body)) {
    const d = PARAMETROS[clave];
    if (!d) throw new StockError(400, `Parámetro desconocido: ${clave}.`);
    nuevos[clave] = cambios[clave] = TIPOS_CAMPO.entero(valor, d, d.etiqueta);
  }
  if (nuevos.lote_pequeno_max >= nuevos.lote_mediano_max) {
    throw new StockError(400, 'El límite del lote pequeño debe ser menor que el del lote mediano.');
  }
  if (nuevos.dias_aviso_vencimiento_sbo >= nuevos.dias_vencimiento_sbo) {
    throw new StockError(400, 'Los días de aviso deben ser menos que los días para el vencimiento de una SBO.');
  }
  return cambios;
}

module.exports = {
  CATALOGOS, CONDICIONES, GRUPOS, TIPOS_TERCERO, TIPOS_MOTIVO, PARAMETROS,
  validarCampos, verificarUnicos, resolverActivo, leerParametros, validarParametros
};
