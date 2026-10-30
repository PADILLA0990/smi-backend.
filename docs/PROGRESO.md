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

## Fase A · Interfaz y sistema de diseño (30/10/2026, sin commit)

- Tema único (azul marino, tarjetas blancas, campos claros con borde) con contraste WCAG AA verificado; se quitó la columna de 1126 px de la plantilla de Vite.
- Componentes en `SMI-Frontend/src/components/ui/`: PageHeader, Card, Campo, DataTable, Badge, Modal, ConfirmModal, DialogosProvider (confirmaciones y Toasts), Skeleton, EmptyState, ErrorState, SelectBuscable.
- Sin `alert`/`confirm`/`prompt`: ventanas y avisos propios.
- Formatos es-CO (`src/lib/formato.js`): dd/mm/aaaa, 12 h, America/Bogota, miles con punto.
- Aviso "Conectando con el servidor…" y reintento automático de consultas mientras Render despierta.
- Encabezado con usuario, rol y hora; título de pestaña por página; favicon propio; menú colapsable recordado y superpuesto en celular.
- Backend: las 33 pruebas de integración pasaron a `tests/api.test.js` (`npm test`) + 4 pruebas del verificador; carpetas generadas de skills fuera de git.

## Pendiente (en orden)

- **B** Usuarios, roles y seguridad (requiere BD).
- **C** Configuración y catálogos (requiere BD).
- **D** Mejora de módulos (incluye KPIs en unidades del Dashboard).
- **E** Novedades y trazabilidad.
- **F** Indicadores.
- **G** Conciliación (requiere BD).
- **H** Calidad y entrega.
