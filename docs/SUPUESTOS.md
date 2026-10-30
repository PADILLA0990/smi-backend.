# Supuestos y decisiones por defecto

Reglas que no estaban definidas y se resolvieron con la opción más simple. Las que afectan stock o datos se consultaron antes con el usuario.

| # | Fecha | Supuesto | Dónde | Configurable |
|---|---|---|---|---|
| 1 | 30/10/2026 | Ingresar un código que ya existe **suma** al stock y conserva la descripción y categoría originales. | `productos/routes.js` | No (aprobado por el usuario) |
| 2 | 30/10/2026 | Aprobar una SBO **reserva** el stock; cancelar lo libera; despachar descuenta lo alistado y libera el resto. | `solicitudes/routes.js`, `lib/stock.js` | No (aprobado) |
| 3 | 30/10/2026 | Un producto que llega a 0 unidades se elimina (comportamiento original). Cambiará a inactivar en la Fase D. | `lib/stock.js` | — |
| 4 | 30/10/2026 | La sesión dura mientras la pestaña esté abierta (marcador en sessionStorage) y como máximo 10 h. Recargar la página la conserva. | `SMI-Frontend/src/lib/sesion.js` | `SESION_HORAS` |
| 5 | 30/10/2026 | Solo las consultas (GET) se reintentan automáticamente si el servidor duerme (hasta ~60 s); las escrituras nunca, para no duplicar movimientos. | `SMI-Frontend/src/api.js` | `ESPERAS_REINTENTO_MS` |
| 6 | 30/10/2026 | El aviso "Conectando con el servidor…" aparece si una petición tarda más de 3 s. | `SMI-Frontend/src/api.js` | `MS_AVISO_LENTO` |
| 7 | 30/10/2026 | ~~El rol del encabezado es fijo~~. Desde la Fase B sale del usuario real. | — | — |
| 8 | 30/10/2026 | Las fechas sin hora (fecha requerida de la SBO) se muestran en UTC para que no se corran un día en Bogotá. | `SMI-Frontend/src/lib/formato.js` | — |
| 9 | 30/10/2026 | Las tablas paginan en el navegador (15–20 filas). Con mucho volumen se pasará a paginación en el servidor (Fase D). | `DataTable.jsx` | prop `porPagina` |
| 10 | 30/10/2026 | Las pruebas de integración corren en el esquema `smi_pruebas` de Supabase (archivo `.env.pruebas`, fuera de git) usando solo datos y usuarios `TEST-`, que se borran antes y después. | `tests/api.test.js` | `ARCHIVO_ENV` |
| 11 | 30/10/2026 | La matriz de permisos: Operario registra movimientos, reubica, crea y alista SBO; aprobar, despachar, cancelar y eliminar quedan para Coordinador y Administrador; Consulta solo lee. | `auth/permisos.js` | Sí (en código) |
| 12 | 30/10/2026 | Solo pueden ser alistadores los usuarios activos con rol Operario o Coordinador. | `auth/permisos.js` | `ROLES_ALISTADORES` |
| 13 | 30/10/2026 | Token de acceso de 15 min; bloqueo de 15 min tras 5 fallos; límite de 20 fallos por IP cada 15 min. | `lib/config.js` | `ACCESO_MINUTOS`, `MAX_INTENTOS`, `BLOQUEO_MINUTOS`, `LIMITE_LOGIN_IP` |
| 14 | 30/10/2026 | Reutilizar una cookie de sesión ya rotada se trata como robo y cierra todas las sesiones del usuario. Hay un margen de 30 s para pestañas que renuevan al mismo tiempo. | `auth/routes.js` | `MARGEN_CARRERA_MS` |
| 15 | 30/10/2026 | `trust proxy` = 2 (Vercel y luego Render) para leer la IP real en el límite de intentos. | `lib/config.js` | `TRUST_PROXY` |
| 16 | 30/10/2026 | La cookie de sesión es Secure por defecto. Solo se desactiva en local con `COOKIE_SEGURA=false`. | `lib/config.js` | `COOKIE_SEGURA` |
| 17 | 30/10/2026 | El historial antiguo conserva su `operario` en texto, con `usuarioId` vacío. Los movimientos nuevos guardan ambos. | `lib/historial.js` | — |
