-- Fase D3: vencimiento de solicitudes SBO sin movimiento (aditiva)
ALTER TYPE "EstadoSolicitud" ADD VALUE IF NOT EXISTS 'VENCIDA';

ALTER TABLE "Solicitud" ADD COLUMN "fecha_vencimiento" TIMESTAMP(3);
