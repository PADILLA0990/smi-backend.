-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('CREADA', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA', 'DESPACHADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Producto" (
    "id" SERIAL NOT NULL,
    "codigo_producto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "cantidad_reservada" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL,
    "ubicacion_general" TEXT NOT NULL,
    "codigo_estanteria" TEXT,
    "fecha_ingreso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Historial" (
    "id" SERIAL NOT NULL,
    "codigo_producto" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "operario" TEXT NOT NULL,
    "detalles" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Historial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Solicitud" (
    "id" SERIAL NOT NULL,
    "codigo_sbo" TEXT NOT NULL,
    "beneficiario" TEXT NOT NULL,
    "estado" "EstadoSolicitud" NOT NULL DEFAULT 'CREADA',
    "creado_por" TEXT NOT NULL,
    "alistador" TEXT,
    "observaciones" TEXT,
    "fecha_solicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_requerida" TIMESTAMP(3),
    "fecha_aprobacion" TIMESTAMP(3),
    "fecha_inicio_alistamiento" TIMESTAMP(3),
    "fecha_fin_alistamiento" TIMESTAMP(3),
    "fecha_despacho" TIMESTAMP(3),
    "fecha_cancelacion" TIMESTAMP(3),

    CONSTRAINT "Solicitud_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitudItem" (
    "id" SERIAL NOT NULL,
    "solicitudId" INTEGER NOT NULL,
    "codigo_producto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad_solicitada" INTEGER NOT NULL,
    "cantidad_alistada" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SolicitudItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitudEvento" (
    "id" SERIAL NOT NULL,
    "solicitudId" INTEGER NOT NULL,
    "estado_anterior" "EstadoSolicitud",
    "estado_nuevo" "EstadoSolicitud" NOT NULL,
    "usuario" TEXT NOT NULL,
    "nota" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolicitudEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Producto_codigo_producto_key" ON "Producto"("codigo_producto");

-- CreateIndex
CREATE UNIQUE INDEX "Solicitud_codigo_sbo_key" ON "Solicitud"("codigo_sbo");

-- CreateIndex
CREATE INDEX "SolicitudItem_solicitudId_idx" ON "SolicitudItem"("solicitudId");

-- CreateIndex
CREATE INDEX "SolicitudEvento_solicitudId_idx" ON "SolicitudEvento"("solicitudId");

-- AddForeignKey
ALTER TABLE "SolicitudItem" ADD CONSTRAINT "SolicitudItem_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "Solicitud"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudEvento" ADD CONSTRAINT "SolicitudEvento_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "Solicitud"("id") ON DELETE CASCADE ON UPDATE CASCADE;

