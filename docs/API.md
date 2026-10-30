# API de SMI-ControlBAB

Base: `/api`. Todas las respuestas son JSON. Los errores tienen la forma `{ "error": "mensaje en español", "codigo": "OPCIONAL" }`.

En producción el frontend llama a `/api/*` en su propio dominio (Vercel) y Vercel lo reenvía a Render. Así la cookie de sesión es de primera parte.

## Autenticación

- **Token de acceso:** JWT HS256 de 15 min (`ACCESO_MINUTOS`). Se envía en `Authorization: Bearer <token>` y el frontend lo guarda solo en memoria.
- **Sesión (refresh):** cookie `smi_sesion` (httpOnly, SameSite=Strict, `path=/api/auth`, Secure). Dura 10 h (`SESION_HORAS`) y rota en cada renovación. En la base solo se guarda su hash SHA-256.
- Si se reutiliza una cookie ya rotada (más de 30 s después), se considera robada y se cierran **todas** las sesiones de ese usuario.
- El usuario se vuelve a leer de la base en cada petición, así que desactivarlo o cambiarle el rol aplica de inmediato.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `{ usuario, password }` | `{ accessToken, usuario }` y la cookie de sesión. |
| POST | `/auth/refresh` | — (usa la cookie) | `{ accessToken, usuario }` y una cookie nueva. |
| POST | `/auth/logout` | — | Revoca la sesión y borra la cookie. |
| GET | `/auth/yo` | — | El usuario actual. |
| POST | `/auth/cambiar-password` | `{ actual, nueva }` | `{ accessToken, usuario }`. Cierra las demás sesiones del usuario. |

- `usuario` lleva `{ id, nombre, usuario, rol, activo, debe_cambiar_password, ultimo_acceso, permisos[] }` y nunca el hash.
- **Política de contraseña:** de 10 a 72 caracteres, con letras y números, y distinta de la actual.
- **Límites:** tras 5 intentos fallidos el usuario queda bloqueado 15 min (423 `USUARIO_BLOQUEADO`). Cada IP admite 20 intentos fallidos cada 15 min (429).

**Códigos de error:**

| Código | HTTP | Qué hace el frontend |
|---|---|---|
| `SIN_SESION`, `TOKEN_VENCIDO`, `TOKEN_INVALIDO` | 401 | Renueva la sesión una vez y repite la petición. |
| `USUARIO_INACTIVO` | 401 | Cierra la sesión. |
| `DEBE_CAMBIAR_PASSWORD` | 403 | Bloquea todo menos `/auth/*`. |
| `SIN_PERMISO` | 403 | Muestra el error de permiso. |
| `CREDENCIALES_INVALIDAS` | 401 | Muestra el error de login. |
| `SESION_VENCIDA` | 401 | Pide iniciar sesión de nuevo. |

## Roles y permisos

La matriz está en `auth/permisos.js`. El frontend recibe `permisos[]` y solo lo usa para ocultar botones; quien decide siempre es el backend.

| Permiso | Administrador | Coordinador | Operario | Consulta |
|---|:-:|:-:|:-:|:-:|
| `inventario:ver` (todas las consultas) | ✔ | ✔ | ✔ | ✔ |
| `movimientos:registrar` (ingreso, salida) | ✔ | ✔ | ✔ | |
| `productos:reubicar` | ✔ | ✔ | ✔ | |
| `productos:eliminar` | ✔ | ✔ | | |
| `sbo:crear` (crear, editar ítems) | ✔ | ✔ | ✔ | |
| `sbo:alistar` (iniciar y finalizar alistamiento) | ✔ | ✔ | ✔ | |
| `sbo:aprobar` | ✔ | ✔ | | |
| `sbo:despachar` | ✔ | ✔ | | |
| `sbo:cancelar` | ✔ | ✔ | | |
| `usuarios:gestionar` | ✔ | | | |

- Solo pueden ser alistadores los usuarios activos con rol Operario o Coordinador.
- El autor de cada movimiento (`Historial.operario` y `Historial.usuarioId`) sale de la sesión, nunca del cuerpo de la petición.

## Usuarios

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/usuarios/alistadores` | `inventario:ver` | Devuelve `[{ usuario, nombre, rol }]` de los activos. |
| GET | `/usuarios` | `usuarios:gestionar` | Lista sin hashes. |
| POST | `/usuarios` | `usuarios:gestionar` | Recibe `{ nombre, usuario, rol }` y devuelve `{ usuario, passwordTemporal }`. La contraseña temporal se muestra **una sola vez**. Un usuario repetido da 409, sin importar mayúsculas. |
| PATCH | `/usuarios/:id` | `usuarios:gestionar` | Recibe `{ nombre?, rol?, activo? }`. Nadie puede desactivarse ni quitarse el rol de administrador a sí mismo, y siempre debe quedar al menos un administrador activo (409). Desactivar cierra las sesiones del usuario. |
| POST | `/usuarios/:id/restablecer` | `usuarios:gestionar` | Genera una contraseña temporal nueva, obliga a cambiarla, desbloquea al usuario y cierra sus sesiones. |

## Inventario y SBO

Las rutas no cambiaron, pero ahora exigen sesión y permiso. Se describirán en detalle en la Fase H.

| Ruta | Permiso |
|---|---|
| GET `/productos`, `/historial`, `/solicitudes`, `/solicitudes/:id` | `inventario:ver` |
| POST `/productos` (ingreso) y POST `/salida` | `movimientos:registrar` |
| PUT `/productos/:id` (reubicar) | `productos:reubicar` |
| DELETE `/productos/:id` | `productos:eliminar` |
| POST `/solicitudes` y PUT `/solicitudes/:id/items` | `sbo:crear` |
| POST `/solicitudes/:id/transicion` | Según la acción: `aprobar` pide `sbo:aprobar`; `iniciar` y `finalizar` piden `sbo:alistar`; `despachar` pide `sbo:despachar`; `cancelar` pide `sbo:cancelar`. |

- `POST /historial` se eliminó: el historial solo lo escribe el backend.
- El campo `operario` ya no se acepta en ninguna petición.
