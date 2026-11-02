# Guía para la ronda de pruebas (testers)

Objetivo: usar el programa como en un día normal de bodega y encontrar errores, cosas confusas o que falten.
Todo lo que ingresen es de prueba y se borrará al terminar la ronda, así que pueden crear, modificar y eliminar sin miedo.

## Cómo reportar
Por cada hallazgo envíen:
1. **Dónde** (pantalla) y **con qué usuario/rol**.
2. **Qué hicieron** (pasos).
3. **Qué esperaban** y **qué pasó**.
4. **Captura de pantalla** (si sale un mensaje de error, que se vea completo).

Si algo tarda unos 50 segundos la primera vez del día, es normal: el servidor se está despertando. Repórtenlo solo si pasa seguido.

## Roles
| Rol | Puede |
|---|---|
| Administrador | Todo, incluido usuarios y eliminar productos sin movimientos |
| Coordinador | Operar, editar e inactivar productos, aprobar/despachar/cancelar/renovar SBO, Configuración |
| Operario | Ingresos, salidas, reubicar, crear SBO y alistarlas |
| Consulta | Solo ver |

Prueben también que cada rol **no** pueda hacer lo que no le corresponde.

## Qué probar

### 1. Ingreso de mercancía (Movimientos → Ingreso)
- Un documento con varias líneas: productos existentes y productos nuevos.
- Producto nuevo de una categoría codificada (p. ej. Ropa): elegir subcategoría y nivel 3, revisar que el código salga solo (`001-RCM-B`).
- El mismo artículo en otra condición ("otra condición"): debe conservar la base y cambiar solo la última letra.
- Abrir e imprimir el comprobante del documento.

### 2. Salidas (Movimientos → Salida)
- Retirar de varios productos con su motivo; intentar retirar más de lo disponible (no debe dejar).

### 3. Inventario
- Buscar, filtrar (categoría, ubicación, condición, sin ubicar, bajo mínimo, inactivos) y ordenar.
- Kardex de un producto: ¿cuadra con lo que hicieron?
- Editar, reubicar, inactivar con justificación y reactivar. Eliminar un producto recién creado sin movimientos (Administrador).

### 4. Mapa de Bodega
- Buscar un producto ("¿Dónde está?"), abrir un hueco, ver su contenido y kardex.
- "Ingresar aquí" desde un hueco vacío.
- Ubicar productos que están "fuera de estanterías".
- Avisar si la distribución de racks, niveles o huecos no coincide con la bodega real.

### 5. Solicitudes SBO (de principio a fin)
- Crear una solicitud con varios ítems → aprobar → iniciar alistamiento → finalizar (completa y parcial) → despachar.
- Imprimir la remisión. Cancelar otra solicitud. Renovar una que esté por vencer.
- Revisar que las unidades reservadas y libres cambien correctamente en el Inventario.

### 6. Dashboard
- ¿Los números coinciden con las listas? Probar los enlaces de las alertas.

### 7. Historial
- Que cada acción quede registrada con el usuario y la fecha correctos.

### 8. Configuración (Administrador / Coordinador)
- Catálogos (categorías, ubicaciones, motivos, organizaciones…), parámetros, estanterías y codificación.

### 9. Celular
- Abrir el programa desde el celular y repetir algunas tareas.
