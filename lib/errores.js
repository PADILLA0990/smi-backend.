const { StockError } = require('./stock');

// Traduce errores conocidos a respuestas HTTP claras; el resto se registra como 500
function manejarError(res, error, mensaje) {
  if (error instanceof StockError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.code === 'P2002') {
    return res.status(409).json({ error: 'Ya existe un registro con ese código.' });
  }
  if (error.code === 'P2025') {
    return res.status(404).json({ error: 'El registro no existe.' });
  }
  console.error(mensaje, error);
  res.status(500).json({ error: mensaje });
}

const esEnteroPositivo = (n) => Number.isInteger(n) && n > 0;

// Devuelve el nombre del primer campo de texto vacío o ausente, o null si están todos
function campoFaltante(body, campos) {
  return campos.find(campo => typeof body[campo] !== 'string' || body[campo].trim() === '') || null;
}

module.exports = { manejarError, esEnteroPositivo, campoFaltante };
