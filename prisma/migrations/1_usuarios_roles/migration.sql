-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMINISTRADOR', 'COORDINADOR', 'OPERARIO', 'CONSULTA');

-- AlterTable
ALTER TABLE "Historial" ADD COLUMN     "usuarioId" INTEGER;

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'OPERARIO',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "debe_cambiar_password" BOOLEAN NOT NULL DEFAULT true,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMP(3),
    "ultimo_acceso" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionRefresh" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira" TIMESTAMP(3) NOT NULL,
    "revocada_en" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionRefresh_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_usuario_key" ON "Usuario"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "SesionRefresh_token_hash_key" ON "SesionRefresh"("token_hash");

-- CreateIndex
CREATE INDEX "SesionRefresh_usuarioId_idx" ON "SesionRefresh"("usuarioId");

-- CreateIndex
CREATE INDEX "Historial_usuarioId_idx" ON "Historial"("usuarioId");

-- AddForeignKey
ALTER TABLE "Historial" ADD CONSTRAINT "Historial_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionRefresh" ADD CONSTRAINT "SesionRefresh_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

