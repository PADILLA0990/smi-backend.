const { PrismaClient } = require('@prisma/client');

// Instancia única compartida por todas las rutas
const prisma = new PrismaClient();

module.exports = prisma;
