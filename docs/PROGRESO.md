# Progreso de SMI-ControlBAB

Documento compartido de los dos repositorios (smi-backend y smi-frontend).
Producción: frontend https://smi-frontend-murex.vercel.app · backend https://smi-backend-r3ac.onrender.com · base PostgreSQL en Supabase.

## Hecho y desplegado

| Fecha | Entrega | Commits |
|---|---|---|
| 12/10/2026 | Beta inicial: login, inventario, ingresos/retiros, historial | backend `5ce907d`…`081311e`, frontend `a68f74e`, `0220f8c` |
| 30/10/2026 | Fase 1: Solicitudes SBO (máquina de estados, trazabilidad) y corrección de errores de inventario | backend `7f24c5e`, frontend `d1f7cb7` |
| 30/10/2026 | Hook de escáner (guardado y **desconectado** por decisión del usuario) | frontend `9c10443`, `ab810f6` |
| 30/10/2026 | Grupos 1 y 2 de pruebas: historial transaccional, validaciones, reserva de stock, bloqueo de eliminación, sesión persistente, manejo de errores | backend `cef8a7a`, frontend `cb8fb4c` |
| 30/10/2026 | Verificador de consistencia, pruebas en el repositorio y documentación | backend `2d2cae3` |
| 30/10/2026 | Fase A: interfaz y sistema de diseño | frontend `5f7993a` |

## Verificaciones previas (30/10/2026, solo lectura)

### Consistencia historial ↔ stock (`npm run verificar`)
- ROP-005: el historial da 5 unidades en AA02; la tabla guarda 25 en Recepción.
  - La REUBICACIÓN del 21/10 no se aplicó: el backend de entonces tenía `PUT /api/productos/:id` duplicado y el primero fallaba siempre (id como texto); el frontend escribía el historial sin revisar la respuesta.
  - El retiro de 20 (12/10, 5:02 p. m.) se registró antes de que existiera `/api/salida` (commit de las 5:11 p. m.): muy probablemente el stock no se descontó.
  - Ambas causas ya están corregidas. **Pendiente: conteo físico de ROP-005 y ajuste autorizado** (o en la Fase G).
- ROP-001: 3 eliminaciones seguidas y una reubicación después de eliminado (mismo origen). Sin efecto en el stock actual.

### Seguridad de la API
- 🔴 Ningún endpoint exige autenticación; el operario lo envía el cliente (historial falsificable).
- 🔴 Contraseñas de Operario01/02 en texto plano dentro del JavaScript público.
- 🟠 CORS abierto (`*`).
- 🟡 Sin helmet ni límite de intentos.
- ✔ `.env` nunca se subió; el bundle no contiene secretos de la base.
- → Se corrige en la Fase B.

## Fase A · Interfaz y sistema de diseño (30/10/2026, desplegada)

- Tema único (azul marino, tarjetas blancas, campos claros con borde) con contraste WCAG AA verificado; se quitó la columna de 1126 px de la plantilla de Vite.
- Componentes en `SMI-Frontend/src/components/ui/`: PageHeader, Card, Campo, DataTable, Badge, Modal, ConfirmModal, DialogosProvider (confirmaciones y Toasts), Skeleton, EmptyState, ErrorState, SelectBuscable.
- Sin `alert`/`confirm`/`prompt`: ventanas y avisos propios.
- Formatos es-CO (`src/lib/formato.js`): dd/mm/aaaa, 12 h, America/Bogota, miles con punto.
- Aviso "Conectando con el servidor…" y reintento automático de consultas mientras Render despierta.
- Encabezado con usuario, rol y hora; título de pestaña por página; favicon propio; menú colapsable recordado y superpuesto en celular.
- Backend: las 33 pruebas de integración pasaron a `tests/api.test.js` (`npm test`) + 4 pruebas del verificador; carpetas generadas de skills fuera de git.

## Fase B · Usuarios, roles y seguridad (30/10/2026, sin commit ni despliegue)

**Base de datos**
- Migraciones versionadas en `prisma/migrations`:
  - `0_init` es la línea base, idéntica a producción (verificado con `migrate diff`).
  - `1_usuarios_roles` es aditiva: crea el enum `Rol` y las tablas `Usuario` y `SesionRefresh`, y agrega `Historial.usuarioId` opcional.
- Probadas en el esquema `smi_pruebas` de Supabase. **Producción todavía no tiene la migración aplicada.**

**Autenticación** (detalle en `docs/API.md`)
- Contraseñas con bcrypt (costo 12).
- Token de acceso JWT de 15 min y cookie de sesión httpOnly rotativa, guardada como hash.
- Bloqueo tras 5 intentos fallidos, límite de intentos por IP, cambio de contraseña obligatorio en el primer ingreso y detección de reutilización de la sesión.

**Roles y API**
- Cuatro roles (Administrador, Coordinador, Operario, Consulta) con una matriz de permisos en `auth/permisos.js`. Todas las rutas `/api` exigen sesión y permiso.
- El autor del historial sale de la sesión: el cliente ya no envía `operario`.
- Se eliminó `POST /api/historial`.
- Seguridad general: helmet, CORS limitado a los dominios del frontend, límite de 100 kB en el JSON y `trust proxy`.

**Frontend**
- Login contra la API: ya no hay contraseñas en el bundle.
- Pantalla de cambio obligatorio de contraseña y menú de usuario (cambiar contraseña, cerrar sesión).
- Página **Usuarios** para el Administrador: crear con contraseña temporal, cambiar rol, activar o desactivar y restablecer.
- El menú y los botones se ocultan según los permisos, y las rutas sin permiso muestran "Sin acceso".
- La sesión se renueva sola. Al recargar se conserva; al cerrar la pestaña termina.
- `vercel.json` reenvía `/api` a Render (cookie de primera parte) y corrige el 404 al recargar rutas como /inventario.

**Pruebas**
- Backend: 19 de 19 en `smi_pruebas`, que incluyen las 33 verificaciones originales y las nuevas de autenticación, permisos, CORS y helmet.
- Frontend: 17 de 17.
- Navegador: 26 de 26, con roles, cambio obligatorio, gestión de usuarios, renovación automática del token e historial con el usuario real.

**Pendiente de autorización:** respaldo de Supabase, migración en producción, usuarios iniciales, variables en Render, commit y despliegue.

## Pendiente (en orden)

- **C** Configuración y catálogos (requiere BD).
- **D** Mejora de módulos (incluye KPIs en unidades del Dashboard).
- **E** Novedades y trazabilidad.
- **F** Indicadores.
- **G** Conciliación (requiere BD).
- **H** Calidad y entrega.
