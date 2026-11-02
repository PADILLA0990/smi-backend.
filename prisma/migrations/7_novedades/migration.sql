-- CreateEnum
CREATE TYPE "TipoNovedad" AS ENUM ('FALTANTE', 'DANADO', 'TALLA_NO_DISPONIBLE', 'SUSTITUCION', 'DEVOLUCION', 'OTRO');

-- AlterTable
ALTER TABLE "SolicitudItem" ADD COLUMN     "cantidad_devuelta" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codigo_original" TEXT;

-- CreateTable
CREATE TABLE "Novedad" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoNovedad" NOT NULL,
    "solicitudId" INTEGER,
    "itemId" INTEGER,
    "codigo_producto" TEXT NOT NULL,
    "codigo_sustituto" TEXT,
    "cantidad" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "motivoId" INTEGER,
    "usuario" TEXT NOT NULL,
    "usuarioId" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Novedad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Novedad_codigo_key" ON "Novedad"("codigo");

-- CreateIndex
CREATE INDEX "Novedad_solicitudId_idx" ON "Novedad"("solicitudId");

-- CreateIndex
CREATE INDEX "Novedad_codigo_producto_idx" ON "Novedad"("codigo_producto");

-- CreateIndex
CREATE INDEX "Novedad_tipo_idx" ON "Novedad"("tipo");

-- CreateIndex
CREATE INDEX "Novedad_fecha_idx" ON "Novedad"("fecha");

-- AddForeignKey
ALTER TABLE "Novedad" ADD CONSTRAINT "Novedad_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "Solicitud"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Novedad" ADD CONSTRAINT "Novedad_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SolicitudItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Novedad" ADD CONSTRAINT "Novedad_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "Motivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Novedad" ADD CONSTRAINT "Novedad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

