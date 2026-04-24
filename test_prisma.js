const { PrismaClient } = require('@prisma/client');

// Test different constructor signatures for Prisma 7.x
try {
  const p1 = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  p1.$connect().then(() => {
    console.log('datasources approach: OK');
    p1.$disconnect();
  }).catch(e => console.log('datasources approach FAILED:', e.message));
} catch(e) {
  console.log('datasources approach ERROR:', e.message);
}

try {
  const p2 = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  p2.$connect().then(() => {
    console.log('datasourceUrl approach: OK');
    p2.$disconnect();
  }).catch(e => console.log('datasourceUrl approach FAILED:', e.message));
} catch(e) {
  console.log('datasourceUrl approach ERROR:', e.message);
}

// Check available options
const pc = new PrismaClient.__proto__;
console.log('PrismaClient keys:', Object.getOwnPropertyNames(PrismaClient.prototype));
