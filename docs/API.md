# API de SMI-ControlBAB

Base: `/api`. Todas las respuestas son JSON. Los errores tienen la forma `{ "error": "mensaje en español", "codigo": "OPCIONAL" }`. Un 503 indica que la base estuvo ocupada y la operación se revirtió por completo: se puede repetir.

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
| `productos:inactivar` (inactivar y activar, con justificación) | ✔ | ✔ | | |
| `productos:eliminar` (borrado físico, solo productos sin movimientos) | ✔ | | | |
| `productos:editar` (descripción, categoría, talla, condición, grupo, stock mínimo) | ✔ | ✔ | | |
| `sbo:crear` (crear, editar ítems) | ✔ | ✔ | ✔ | |
| `sbo:alistar` (iniciar y finalizar alistamiento) | ✔ | ✔ | ✔ | |
| `sbo:aprobar` | ✔ | ✔ | | |
| `sbo:despachar` | ✔ | ✔ | | |
| `sbo:cancelar` | ✔ | ✔ | | |
| `configuracion:gestionar` (catálogos y parámetros) | ✔ | ✔ | | |
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

Exigen sesión y permiso. Desde la Fase C, la categoría, la ubicación, el motivo de salida y la organización deben existir **activos** en su catálogo. Se envían por id o por nombre (sin distinguir mayúsculas). Si no existen, la respuesta es 400.

| Ruta | Permiso |
|---|---|
| GET `/productos`, `/historial`, `/solicitudes`, `/solicitudes/:id`, `/solicitudes/codigo/:codigo` | `inventario:ver` |
| GET `/solicitudes/siguiente-codigo` → `{ codigo: "SBO-0001" }` | `sbo:crear` |
| GET `/productos/:id/kardex`, `/historial/filtros` | `inventario:ver` |
| POST `/productos` (ingreso): `{ codigo_producto, descripcion, cantidad, categoriaId \| categoria, ubicacion_general?, condicion?, talla?, grupo?, stock_minimo? }` | `movimientos:registrar` |
| POST `/salida`: `{ codigo_producto, cantidad_retirada, motivoId \| motivo, detalle? }` (motivo de tipo SALIDA) | `movimientos:registrar` |
| PUT `/productos/:id` (reubicar): `{ codigo_estanteria }` con el código de una ubicación del catálogo | `productos:reubicar` |
| PATCH `/productos/:id` (editar datos, queda EDICIÓN en el historial; ya no acepta `activo`) | `productos:editar` |
| POST `/productos/:id/inactivar` y `/productos/:id/activar`: `{ justificacion }` (5 a 200 caracteres) | `productos:inactivar` |
| DELETE `/productos/:id` (borrado físico) | `productos:eliminar` |
| POST `/solicitudes`: `{ codigo_sbo?, organizacionId \| beneficiario, items, … }` (sin código se asigna el siguiente `SBO-0001`) | `sbo:crear` |
| PUT `/solicitudes/:id/items` | `sbo:crear` |
| POST `/solicitudes/:id/transicion` | Según la acción: `aprobar` pide `sbo:aprobar`; `iniciar` y `finalizar` piden `sbo:alistar`; `despachar` pide `sbo:despachar`; `cancelar` pide `sbo:cancelar`; `renovar` pide `sbo:renovar`. |

- `POST /historial` se eliminó: el historial solo lo escribe el backend.
- `GET /productos` devuelve en `categoria` el nombre vigente del catálogo, además de `categoriaId`, `talla`, `condicion`, `grupo`, `stock_minimo` y `activo`.
- Un producto inactivo no recibe ingresos ni se puede incluir en una SBO (409). Sus unidades sí se pueden retirar.
- Desde la Fase D un producto que llega a 0 unidades **se conserva** (antes se borraba).

### Inventario paginado (Fase D)

`GET /productos?pagina=1` responde `{ datos, total, pagina, porPagina, resumen: { unidades, reservadas, libres } }`. Sin `pagina` devuelve la lista completa, como antes.

| Parámetro | Valores |
|---|---|
| `porPagina` | 1 a 100 (20 por defecto) |
| `q` | Texto en código o descripción |
| `categoriaId`, `ubicacion` (código), `condicion` (o `SIN`) | Filtros del catálogo |
| `sinUbicar=1`, `bajoMinimo=1` | Sin estantería asignada; libre por debajo del stock mínimo (propio o el parámetro `stock_minimo_defecto`) |
| `estado` | `activos` (por defecto), `inactivos` o `todos` |
| `orden`, `dir` | `codigo_producto`, `descripcion`, `categoria`, `condicion`, `cantidad`, `reservado`, `libre`, `ubicacion`, `ultima_actualizacion`, `fecha_ingreso`; `asc` o `desc` |

Cada producto trae además `libre`, `stock_minimo_efectivo`, `bajo_minimo` y `ultima_actualizacion` (último movimiento o el ingreso).

### Kardex

`GET /productos/:id/kardex` responde `{ producto, movimientos, reservas, saldo_historial, coincide, avisos }`:
- `movimientos`: el historial del producto en orden cronológico, cada uno con su `saldo` acumulado.
- `reservas`: SBO en curso que lo incluyen, con `reserva_stock` (falso mientras la SBO está CREADA).
- `coincide`: si el saldo según el historial es igual al stock guardado.

### Borrado físico

Solo el Administrador, y solo si el producto no tiene movimientos aparte de su ingreso inicial, ediciones o cambios de estado, nunca estuvo en una SBO y no tiene reservas. En cualquier otro caso responde 409 y se debe inactivar.

### Historial paginado (Fase D)

`GET /historial?pagina=1` responde `{ datos, total, pagina, porPagina }`, del más reciente al más antiguo. Sin `pagina` devuelve todo, como antes.

| Parámetro | Valores |
|---|---|
| `porPagina` | 1 a 100 (25 por defecto) |
| `desde`, `hasta` | `AAAA-MM-DD`, días de Bogotá (ambos incluidos) |
| `codigo` | Parte del código |
| `accion`, `operario` | Valor exacto (los existentes salen de `GET /historial/filtros`) |
| `sbo` | Código de SBO: sus eventos y sus despachos |
| `q` | Texto en código, acción, operario o detalle |

Cada registro trae `sbo` (la SBO relacionada o `null`) y `es_sbo` (si el registro es un evento de SBO y no de un producto). Desde la Fase D2 también trae `documento` (`{ id, numero }` o `null`); el kardex lo incluye en cada movimiento.

Los cambios de Configuración (catálogos, parámetros, estanterías, plano y codificación) quedan con la acción `CONFIGURACIÓN`, en la misma transacción que el cambio y con el usuario autenticado. En `codigo_producto` va el área ("Organización", "Parámetros"…) y en `detalles`, qué cambió ("Editó "X": Contacto: vacío → Ana"). Guardar sin cambios reales no deja registro. No son movimientos de inventario: el verificador de consistencia, los últimos movimientos del Dashboard y el indicador de movimientos por operario los ignoran.

## Solicitudes SBO (Fase D3)

Estados: CREADA → APROBADA → EN_ALISTAMIENTO → ALISTADA → DESPACHADA. Desde cualquiera de los cuatro primeros se puede pasar a CANCELADA (usuario) o a **VENCIDA** (sistema).

- **Código:** sin `codigo_sbo`, el sistema asigna el siguiente consecutivo `SBO-0001`, `SBO-0002`… Los códigos escritos a mano con otro formato no cuentan para el consecutivo. Un código escrito a mano se guarda en mayúsculas, así que un código repetido da 409 aunque cambien las mayúsculas.
- **Lista paginada:** `GET /solicitudes?pagina=1&porPagina=20` devuelve `{ datos, total, pagina, porPagina, resumen: { atrasadas, por_vencer } }`.
  - Filtros:
    - `estado`: un estado, o `ACTIVAS` para las cuatro sin despachar;
    - `organizacionId`, `alistador` (sin distinguir mayúsculas);
    - `desde`, `hasta`: fecha de creación, AAAA-MM-DD en Bogotá;
    - `q`: código, organización, o código o descripción de un producto;
    - `atrasada=1`, `porVencer=1`.
  - Sin `pagina` devuelve el arreglo completo, como antes.
- **Campos calculados** en la lista, el detalle y las respuestas de las transiciones:
  - `activa`, `unidades_solicitadas`, `ultimo_movimiento`, `dias_sin_movimiento`;
  - `vence_el`, `dias_para_vencer`, `por_vencer`, `atrasada`;
  - `tiempos: { espera_aprobacion_min, alistamiento_min, total_min, meta_alistamiento_min, excede_meta }`;
  - cada ítem trae `referencia` (`SBO-0001-<código>`, con `-2`, `-3`… si el producto se repite), `cantidad_reservada` y `cantidad_despachada`.
- **Atrasada:** la solicitud no está despachada, cancelada ni vencida, y la fecha de hoy en Bogotá ya pasó la fecha requerida más `dias_atraso_sbo`.
- **Vencimiento:** una solicitud activa que lleva `dias_vencimiento_sbo` días (30) sin un evento pasa a VENCIDA. Un evento es un cambio de estado o una renovación.
  - Se libera la reserva si la tenía.
  - Queda un evento y un historial `SBO VENCIDA` con el usuario `sistema`.
  - La revisión corre al arrancar el servidor, cada hora y con cada consulta de solicitudes (como mucho una vez cada 5 minutos).
  - `vencer` no se puede pedir por la API (400).
- **Renovar** (`accion: "renovar"`, `sbo:renovar`): deja el mismo estado y reinicia el conteo con un evento nuevo. En el historial queda `SBO RENOVADA`. En `acciones` solo aparece dentro de los `dias_aviso_vencimiento_sbo` días (5) antes de vencer.
- **Alistamiento parcial:** si en `finalizar` alguna cantidad es menor que la solicitada, la `nota` es obligatoria (mínimo 5 caracteres). Si falta, la respuesta es 400.
- **Versión:** `GET /version` (público, fuera de `/api`) → `{ commit, arranque }`. El commit es el que despliega Render (`RENDER_GIT_COMMIT`).

## Documentos de ingreso y salida (Fase D2)

| Ruta | Permiso |
|---|---|
| POST `/documentos/ingreso` | `movimientos:registrar` |
| POST `/documentos/salida` | `movimientos:registrar` |
| GET `/documentos?pagina=` | `inventario:ver` |
| GET `/documentos/:id` (id o número, p. ej. `ING-0001`) | `inventario:ver` |

Un documento agrupa varias líneas y se registra en **una sola transacción**: si una línea falla no se guarda nada, y el error empieza por `Línea N (código): …`. La fecha es la del registro y el número es consecutivo por tipo, sin año (`ING-0001`, `SAL-0001`). Cada línea deja su movimiento en el historial (INGRESO NUEVO, INGRESO ADICIONAL o SALIDA/RETIRO) con `documentoId` y el número al final del detalle.

**Ingreso**

```json
{
  "origen": "DONACION",
  "terceroId": 3,
  "soporte": "Remisión 123",
  "observaciones": "…",
  "lineas": [
    { "codigo_producto": "ROP-005", "cantidad": 2, "unidadId": 4 },
    { "codigo_producto": "HOG-001", "cantidad": 5, "nuevo": { "descripcion": "Linterna", "categoriaId": 5, "condicion": "PERFECTO", "talla": "", "grupo": null, "stock_minimo": null, "ubicacion_general": "Recepción" } }
  ]
}
```

- `origen`: `DONACION` o `COMPRA`. `terceroId` es opcional y debe ser donante (o "ambos") en una donación, y proveedor (o "ambos") en una compra.
- `cantidad` va en la unidad de manejo (`unidadId`, opcional). Las unidades de inventario son `cantidad × factor`.
- Sin `nuevo`, el código debe existir y estar activo (404 o 409). Con `nuevo`, el código no debe existir (409).
- **Cada condición tiene su propio código:** si se envía `condicion` y no es la del producto existente, responde 409.
- Hasta 100 líneas, de 1 a 100.000 por línea. Un código no se repite en el mismo documento (400).

**Salida**

```json
{ "motivoId": 2, "organizacionId": 7, "observaciones": "…", "lineas": [{ "codigo_producto": "ROP-005", "cantidad": 3, "unidadId": 1 }] }
```

- El motivo (tipo SALIDA) es obligatorio. La organización destino es opcional.
- Solo se retira el stock libre. Los productos inactivos se pueden retirar.

**Respuesta** (201, y también la de `GET /documentos/:id`): el documento con `tipo`, `consecutivo`, `numero`, `fecha`, `origen`, `tercero_nombre`, `soporte`, `motivo_nombre`, `organizacion_nombre`, `observaciones`, `operario` y `lineas`. Cada línea trae `codigo_producto`, `descripcion`, `condicion`, `unidad`, `factor`, `cantidad_manejo`, `cantidad` (unidades) y `producto_nuevo`. Los nombres se copian al guardar, así que el comprobante no cambia si después se edita el catálogo.

**Lista:** `GET /documentos?pagina=1` responde `{ datos, total, pagina, porPagina }`, del más reciente al más antiguo. Admite `porPagina` (25 por defecto), `tipo` (`INGRESO` o `SALIDA`), `desde` y `hasta` (`AAAA-MM-DD`, Bogotá) y `q` (número, donante, organización, soporte, operario o código de producto). En la lista, `lineas` es el número de líneas y `unidades` es el total.

`POST /productos` y `POST /salida` siguen disponibles para un solo producto, sin documento.

## Catálogos (Fase C)

`:catalogo` puede ser `categorias`, `organizaciones`, `terceros` (donantes y proveedores), `motivos`, `unidades` o `ubicaciones`. Los registros **no se borran**: se desactivan con `{ "activo": false }`.

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/catalogos/opciones` | `inventario:ver` | Listas fijas: `condiciones`, `grupos`, `tiposTercero`, `tiposMotivo`. |
| GET | `/catalogos/:catalogo` | `inventario:ver` | `?activos=1` devuelve solo los activos. `?tipo=SALIDA` filtra motivos; `?tipo=DONANTE` o `PROVEEDOR` filtra terceros, incluidos los que son AMBOS. Las categorías traen el conteo de `productos`. |
| POST | `/catalogos/:catalogo` | `configuracion:gestionar` | Valida cada campo; un nombre repetido da 409, sin importar mayúsculas. |
| PATCH | `/catalogos/:catalogo/:id` | `configuracion:gestionar` | Edición parcial. El tipo de un motivo no se cambia. Una ubicación con productos no se desactiva ni cambia de código (409). Renombrar una categoría actualiza el texto en sus productos. |
| GET | `/catalogos/categorias/:id/siguiente-codigo` | `inventario:ver` | Devuelve `{ codigo: "ROP-006" }`, o `null` si la categoría no tiene prefijo. |

**Campos por catálogo:**
- categorías: `nombre*`, `prefijo` (2 a 5 letras), `descripcion`;
- organizaciones: `nombre*`, `nit`, `contacto`, `telefono`, `correo`, `localidad`, `direccion`;
- terceros: `tipo*` (DONANTE, PROVEEDOR o AMBOS), `nombre*`, `nit`, `contacto`, `telefono`, `correo`;
- motivos: `tipo*` (SALIDA, AJUSTE o NOVEDAD), `nombre*`;
- unidades: `nombre*`, `abreviatura`, `factor*` (unidades que equivale);
- ubicaciones: `codigo*`, `nombre`, `zona`, `estante`, `nivel`, `posicion`.

## Parámetros

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/parametros` | `inventario:ver` | Devuelve `[{ clave, etiqueta, valor, defecto, min, max }]`. |
| PUT | `/parametros` | `configuracion:gestionar` | Recibe `{ clave: valor }`. Una clave desconocida da 400. El lote pequeño debe ser menor que el mediano, y los días de aviso, menos que los de vencimiento. |

Claves disponibles:
- `tiempo_meta_alistamiento_horas` (24);
- `dias_atraso_sbo` (0);
- `dias_vencimiento_sbo` (30);
- `dias_aviso_vencimiento_sbo` (5);
- `stock_minimo_defecto` (5);
- `lote_pequeno_max` (10);
- `lote_mediano_max` (50).

## Dashboard (Fase D4)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/dashboard` | `inventario:ver` | `{ generado, inventario, por_categoria, bodega, solicitudes, productos_alerta, ultimos_movimientos }` |

- `inventario`: `{ productos, unidades, reservadas, libres, sin_ubicar, bajo_minimo, agotados }`, solo productos activos. `sin_ubicar` y `bajo_minimo` coinciden con los filtros `?sinUbicar=1` y `?bajoMinimo=1` de `/productos`.
- `por_categoria` y `bodega.por_zona`: `[{ nombre, productos, unidades }]` de productos con existencias, de mayor a menor.
- `bodega`: además `ubicaciones_catalogo` (activas) y `ubicaciones_ocupadas` (con algún producto con existencias).
- `solicitudes`: `{ por_estado: { CREADA: n, … }, activas, atrasadas, por_vencer, alertas: [{ id, codigo_sbo, beneficiario, estado, atrasada, por_vencer, dias_para_vencer, fecha_requerida }] }`. Antes de calcular revisa los vencimientos.
- `productos_alerta`: hasta 6 `{ id, codigo_producto, descripcion, libre, bajo_minimo, sin_ubicar }`, primero los de bajo mínimo.
- `ultimos_movimientos`: los 8 registros más recientes del historial.

## Mapa de Bodega y estanterías

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/mapa` | `inventario:ver` | `{ zonas: [{ zona, nombre, estanterias: [{ id, codigo, rack, calle, niveles, huecos, huecos_superiores, plano: { x, y, vertical } | null, celdas: [{ codigo, nivel, hueco, lleno, productos, unidades }] }], areas: [{ codigo, nombre, productos, unidades }], plano: [{ id, tipo, etiqueta, x, y, ancho, alto, ubicacion, unidades? }] }], fuera_de_estanterias, resumen }`. Las celdas van del nivel más alto al 1; del nivel 2 hacia arriba hay `huecos_superiores` por nivel si no es null. Solo cuenta productos con unidades. |
| PATCH | `/mapa/huecos/:codigo/lleno` | `productos:reubicar` | `{ lleno: true \| false }`. Solo huecos de rack (un área → 400). Mientras esté lleno, los ingresos (producto nuevo o unidades de un producto que ya está allí) y las reubicaciones a ese hueco → 409. Salidas, despachos, devoluciones y ajustes no se bloquean. Deja `HUECO LLENO` o `HUECO DISPONIBLE` en el historial. |
| GET | `/estanterias` | `inventario:ver` | `[{ id, codigo, zona, rack, calle, niveles, huecos, huecos_superiores, orden, plano_x, plano_y, plano_vertical, activo, ubicaciones, productos }]` |
| POST | `/estanterias` | `configuracion:gestionar` | `{ zona: "Z1", rack: "A", niveles: 1–6, huecos: 1–30, huecos_superiores?: 1–30 | null, calle?, orden?, plano_x?, plano_y?: 0–200 | null, plano_vertical? }` → 201 y genera los huecos. Repetida → 409. |
| PATCH | `/estanterias/:id` | `configuracion:gestionar` | `{ calle?, niveles?, huecos?, huecos_superiores?, orden?, plano_x?, plano_y?, plano_vertical?, activo? }`. Zona y rack no cambian (400). Quitar o desactivar huecos con producto → 409 con los códigos. |
| POST | `/estanterias/distribucion-inicial` | `configuracion:gestionar` | Crea lo que falte de la distribución inicial → `{ estanterias: [...], areas: [...], plano: { racks, elementos } }`. |
| GET | `/plano` | `inventario:ver` | Elementos del plano: `[{ id, zona, tipo: AREA\|ENTRADA\|PUERTA\|CALLE\|PC\|PASO, etiqueta, x, y, ancho, alto, ubicacion, activo }]` (medidas en cuadros). |
| POST | `/plano` | `configuracion:gestionar` | `{ zona, tipo, etiqueta, x, y, ancho, alto, ubicacion? }` → 201. `ubicacion` debe ser un área activa (no un hueco de rack). |
| PATCH | `/plano/:id` | `configuracion:gestionar` | Cualquiera de los campos anteriores o `activo`. |
| DELETE | `/plano/:id` | `configuracion:gestionar` | Quita el elemento (no toca la ubicación). |
| POST | `/plano/completar` | `configuracion:gestionar` | Completa una bodega ya cargada con la distribución: huecos de los niveles superiores, posición de los racks y plano de las zonas que no lo tienen; las mesas de alistamiento dejan de ser ubicaciones si no tienen producto → `{ racks: [...], elementos: n, areas_retiradas: [...], areas_con_producto: [...] }`. No cambia lo demás ya configurado. |

Los productos de `/mapa` traen `ubicacion` (su `codigo_estanteria` o, si no tiene, su `ubicacion_general`).

## Codificación de productos (`001-RCM-B`)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/codificacion` | `inventario:ver` | `[{ id, nombre, letra, nombre_variante, activo, subcategorias: [{ id, letra, nombre, activo, productos }], variantes: [...] }]` |
| GET | `/codificacion/siguiente?categoriaId&subcategoriaId&varianteId&condicion&excluir=a,b` | `inventario:ver` | `{ codigo }`: el consecutivo siguiente de esa base (`null` si la categoría no tiene letra). `excluir`: códigos ya usados en el documento en curso. |
| PATCH | `/codificacion/categorias/:id` | `configuracion:gestionar` | `{ letra?, nombre_variante? }`. La letra no cambia si hay productos codificados (409). |
| POST | `/codificacion/categorias/:id/subcategorias` y `/variantes` | `configuracion:gestionar` | `{ letra, nombre }` → 201. Letra repetida en la categoría → 409. |
| PATCH | `/codificacion/subcategorias/:id` y `/variantes/:id` | `configuracion:gestionar` | `{ nombre?, letra?, activo? }`. La letra no cambia si tiene productos. |
| POST | `/codificacion/arbol-inicial` | `configuracion:gestionar` | Carga el árbol de `docs/CODIFICACION.md` (solo lo que falte) → `{ categorias, subcategorias, variantes }`. |

- Al crear un producto (`POST /productos` o en un documento) de una categoría con letra se exigen `subcategoriaId` y `varianteId`, y el código debe tener la forma `NNN-<cat><sub><var>-<estado>` (400 con la forma esperada). Las categorías sin letra conservan el código libre.
- `PATCH /productos/:id` no cambia la categoría ni la condición de un producto codificado (400).

## Novedades y trazabilidad (Fase E)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| POST | `/solicitudes/:id/novedades` | `sbo:alistar` | `{ tipo: FALTANTE\|DANADO\|TALLA_NO_DISPONIBLE\|OTRO, itemId, cantidad (1 a lo solicitado), descripcion (≥ 5), motivoId? }` → 201 con la solicitud. Solo en APROBADA, EN_ALISTAMIENTO, ALISTADA o DESPACHADA. No mueve stock. |
| POST | `/solicitudes/:id/sustituir` | `sbo:alistar` | `{ itemId, codigo_sustituto, descripcion }` → 201. APROBADA o EN_ALISTAMIENTO. Libera la reserva del producto original y reserva el sustituto (400 si no alcanza). El ítem guarda `codigo_original`. |
| POST | `/solicitudes/:id/devolver` | `movimientos:registrar` | `{ itemId, cantidad, descripcion }` → 201. Solo DESPACHADA; hasta lo despachado menos lo ya devuelto (`cantidad_devuelta`). Suma al stock (historial `DEVOLUCIÓN SBO`). |
| GET | `/novedades?pagina&porPagina&tipo&sbo&q&desde&hasta` | `inventario:ver` | `{ datos, total, pagina, porPagina, resumen: { TIPO: n } }`. Sin `pagina`, el arreglo completo (exportar). |
| GET | `/novedades/tipos` | `inventario:ver` | `{ tipos: { FALTANTE: 'Faltante', … }, manuales: [...] }` |
| GET | `/trazabilidad?codigo=` | `inventario:ver` | `{ tipo: 'producto'\|'sbo', codigo, resumen, eventos: [{ fecha, origen: historial\|novedad\|sbo, accion, detalle, usuario, documento?, sbo?, producto?, codigo? }] }` en orden cronológico. 404 si no hay registros. |

- Cada novedad recibe un código `NOV-0001` y deja una línea `NOVEDAD` (sin efecto en stock) en el historial del producto.
- Al finalizar un alistamiento parcial, cada ítem incompleto crea una novedad `FALTANTE` con la nota.
- El detalle de una SBO (`GET /solicitudes/:id`) incluye `novedades`, y cada ítem `cantidad_devuelta` y `codigo_original`.

## Indicadores (Fase F)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/indicadores` | `inventario:ver` | `[{ id, grupo, titulo }]` (13 indicadores: Alistamiento, Inventario, Operación) |
| GET | `/indicadores/:id?anio=2026&mes=11` | `inventario:ver` | `{ id, grupo, titulo, como_se_calcula, periodo, datos: [{ etiqueta, <serie>: n }], series: [{ clave, nombre }], excluidos?: { total, motivo, enlace, codigos }, apilado?, tipo?: 'lineas', unidad?, referencia?, destacado?, fotoActual?, anual?, total? }`. Sin `mes`: el año completo. `sin-movimiento` acepta `dias` (1–3650, 90 por defecto). |

Ids: `sbo-por-alistador`, `unidades-por-alistador`, `tiempo-alistamiento`, `cumplimiento`, `lotes`, `unidades-por-categoria`, `entradas-salidas`, `antiguedad`, `sin-movimiento`, `movimientos-por-operario`, `organizaciones`, `novedades`, `no-entregadas`. El período usa la hora de Bogotá.

## Conciliación (Fase G)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/conteos` | `inventario:ver` | Últimos 100 conteos con `resumen` (sin líneas). |
| GET | `/conteos/:id` | `inventario:ver` | `{ id, codigo: 'CNT-0001', estado: ABIERTO\|CERRADO\|ANULADO, alcance, filtro, lineas: [{ id, codigo_producto, descripcion, ubicacion, cantidad_sistema, cantidad_contada, diferencia, porcentaje, ajuste }], resumen: { productos, contados, con_diferencia, faltantes, sobrantes }, motivo? }` |
| POST | `/conteos` | `movimientos:registrar` | `{ alcance: TODO\|CATEGORIA\|UBICACION, categoriaId?, ubicacion?, observaciones? }` → 201 con los productos activos del alcance. |
| PUT | `/conteos/:id/lineas` | `movimientos:registrar` | `{ lineas: [{ id, cantidad_contada }] }` (null borra). Guarda el stock del sistema en ese momento. Solo ABIERTO. |
| POST | `/conteos/:id/aprobar` | `conciliacion:aprobar` | `{ motivoId (tipo AJUSTE), observaciones? }`. Aplica `contada − sistema` al stock actual (historial `AJUSTE`, "Ajuste de ±N") y cierra. 409 si deja menos que lo reservado. |
| POST | `/conteos/:id/anular` | `conciliacion:aprobar` | Descarta un conteo abierto sin ajustar. |
| GET | `/conciliacion/consistencia` | `conciliacion:aprobar` | `{ revisados, consistentes, problemas: [{ codigo_producto, diferencias: [{ campo, esperado, guardado }], avisos }], generado }` (el verificador de `scripts/`). |

## Ubicaciones para el Mapa de Bodega (solo lectura)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/ubicaciones` | `inventario:ver` | `[{ id, codigo, nombre, zona, estante, nivel, posicion, activo, productos, unidades }]`. Por defecto solo las activas; `?todas=1` las incluye todas. |
| GET | `/ubicaciones/:codigo/contenido` | `inventario:ver` | `{ ubicacion, productos: [{ id, codigo_producto, descripcion, categoria, cantidad, cantidad_reservada, condicion, talla, activo }], unidades }`. Si no existe, 404. |

Un producto está en la ubicación de su `codigo_estanteria`. Si no tiene estantería asignada, está en su `ubicacion_general` (por ejemplo, Recepción).
- El campo `operario` ya no se acepta en ninguna petición.
