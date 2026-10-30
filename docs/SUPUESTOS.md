# Supuestos y decisiones por defecto

Reglas que no estaban definidas y se resolvieron con la opción más simple. Las que afectan stock o datos se consultaron antes con el usuario.

| # | Fecha | Supuesto | Dónde | Configurable |
|---|---|---|---|---|
| 1 | 30/10/2026 | Ingresar un código que ya existe **suma** al stock y conserva la descripción y categoría originales. | `productos/routes.js` | No (aprobado por el usuario) |
| 2 | 30/10/2026 | Aprobar una SBO **reserva** el stock; cancelar lo libera; despachar descuenta lo alistado y libera el resto. | `solicitudes/routes.js`, `lib/stock.js` | No (aprobado) |
| 3 | 30/10/2026 | Un producto que llega a 0 unidades se elimina (comportamiento original). Cambiará a inactivar en la Fase D. | `lib/stock.js` | — |
| 4 | 30/10/2026 | La sesión dura mientras la pestaña esté abierta (sessionStorage). | `SMI-Frontend/src/App.jsx` | — |
| 5 | 30/10/2026 | Solo las consultas (GET) se reintentan automáticamente si el servidor duerme (hasta ~60 s); las escrituras nunca, para no duplicar movimientos. | `SMI-Frontend/src/api.js` | `ESPERAS_REINTENTO_MS` |
| 6 | 30/10/2026 | El aviso "Conectando con el servidor…" aparece si una petición tarda más de 3 s. | `SMI-Frontend/src/api.js` | `MS_AVISO_LENTO` |
| 7 | 30/10/2026 | El rol mostrado en el encabezado es "Operario" fijo hasta la Fase B. | `SMI-Frontend/src/App.jsx` | — |
| 8 | 30/10/2026 | Las fechas sin hora (fecha requerida de la SBO) se muestran en UTC para que no se corran un día en Bogotá. | `SMI-Frontend/src/lib/formato.js` | — |
| 9 | 30/10/2026 | Las tablas paginan en el navegador (15–20 filas). Con mucho volumen se pasará a paginación en el servidor (Fase D). | `DataTable.jsx` | prop `porPagina` |
| 10 | 30/10/2026 | Las pruebas de integración corren contra la base de producción usando solo datos `TEST-`, que se borran antes y después (autorizado por el usuario). | `tests/api.test.js` | `DATABASE_URL` |
