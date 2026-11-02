-- CreateEnum
CREATE TYPE "EstadoConteo" AS ENUM ('ABIERTO', 'CERRADO', 'ANULADO');

-- CreateTable
CREATE TABLE "Conteo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "estado" "EstadoConteo" NOT NULL DEFAULT 'ABIERTO',
    "alcance" TEXT NOT NULL,
    "filtro" TEXT,
    "observaciones" TEXT,
    "creado_por" TEXT NOT NULL,
    "usuarioId" INTEGER,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrado_por" TEXT,
    "fecha_cierre" TIMESTAMP(3),
    "motivoId" INTEGER,

    CONSTRAINT "Conteo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConteoLinea" (
    "id" SERIAL NOT NULL,
    "conteoId" INTEGER NOT NULL,
    "codigo_producto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "ubicacion" TEXT,
    "cantidad_sistema" INTEGER NOT NULL,
    "cantidad_contada" INTEGER,
    "contado_por" TEXT,
    "fecha_conteo" TIMESTAMP(3),
    "ajuste" INTEGER,

    CONSTRAINT "ConteoLinea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conteo_codigo_key" ON "Conteo"("codigo");

-- CreateIndex
CREATE INDEX "Conteo_estado_idx" ON "Conteo"("estado");

-- CreateIndex
CREATE INDEX "ConteoLinea_conteoId_idx" ON "ConteoLinea"("conteoId");

-- CreateIndex
CREATE UNIQUE INDEX "ConteoLinea_conteoId_codigo_producto_key" ON "ConteoLinea"("conteoId", "codigo_producto");

-- CreateIndex
CREATE INDEX "Historial_codigo_producto_fecha_idx" ON "Historial"("codigo_producto", "fecha");

-- CreateIndex
CREATE INDEX "Historial_fecha_idx" ON "Historial"("fecha");

-- CreateIndex
CREATE INDEX "Historial_accion_idx" ON "Historial"("accion");

-- CreateIndex
CREATE INDEX "Producto_activo_categoria_idx" ON "Producto"("activo", "categoria");

-- CreateIndex
CREATE INDEX "Solicitud_estado_idx" ON "Solicitud"("estado");

-- CreateIndex
CREATE INDEX "Solicitud_fecha_solicitud_idx" ON "Solicitud"("fecha_solicitud");

-- CreateIndex
CREATE INDEX "SolicitudItem_codigo_producto_idx" ON "SolicitudItem"("codigo_producto");

-- AddForeignKey
ALTER TABLE "Conteo" ADD CONSTRAINT "Conteo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conteo" ADD CONSTRAINT "Conteo_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "Motivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConteoLinea" ADD CONSTRAINT "ConteoLinea_conteoId_fkey" FOREIGN KEY ("conteoId") REFERENCES "Conteo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

