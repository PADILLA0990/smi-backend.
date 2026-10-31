-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('INGRESO', 'SALIDA');

-- CreateEnum
CREATE TYPE "OrigenIngreso" AS ENUM ('DONACION', 'COMPRA');

-- AlterTable
ALTER TABLE "Historial" ADD COLUMN     "documentoId" INTEGER;

-- CreateTable
CREATE TABLE "Documento" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "consecutivo" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origen" "OrigenIngreso",
    "terceroId" INTEGER,
    "tercero_nombre" TEXT,
    "soporte" TEXT,
    "motivoId" INTEGER,
    "motivo_nombre" TEXT,
    "organizacionId" INTEGER,
    "organizacion_nombre" TEXT,
    "observaciones" TEXT,
    "operario" TEXT NOT NULL,
    "usuarioId" INTEGER,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoLinea" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "codigo_producto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "condicion" "Condicion",
    "unidad" TEXT NOT NULL,
    "factor" INTEGER NOT NULL,
    "cantidad_manejo" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "producto_nuevo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentoLinea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Documento_numero_key" ON "Documento"("numero");

-- CreateIndex
CREATE INDEX "Documento_fecha_idx" ON "Documento"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_tipo_consecutivo_key" ON "Documento"("tipo", "consecutivo");

-- CreateIndex
CREATE INDEX "DocumentoLinea_documentoId_idx" ON "DocumentoLinea"("documentoId");

-- CreateIndex
CREATE INDEX "Historial_documentoId_idx" ON "Historial"("documentoId");

-- AddForeignKey
ALTER TABLE "Historial" ADD CONSTRAINT "Historial_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "Motivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoLinea" ADD CONSTRAINT "DocumentoLinea_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

