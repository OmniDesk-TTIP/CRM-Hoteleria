import { defineConfig } from '@mikro-orm/postgresql';
import { join } from 'path';
import { Migrator } from '@mikro-orm/migrations';
import * as dotenv from 'dotenv';

// Cargar variables de entorno según el entorno
const isTest = process.env.NODE_ENV === 'test';
const envFile = isTest ? '.env.test' : '.env';

dotenv.config({ path: join(__dirname, '../../../', envFile) });

export default defineConfig({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  dbName: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,

  entities: ['dist/**/*.entity.js'],
  entitiesTs: ['src/**/*.entity.ts'],

  extensions: [Migrator],
  migrations: {
    path: join(__dirname, './migrations'),
    pathTs: join(__dirname, './migrations'),
    snapshot: true,
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    dropTables: true,
    safe: false,
    snapshotName: '.snapshot',
  },

  debug: process.env.NODE_ENV === 'dev',
  timezone: 'UTC',
  allowGlobalContext: true,
});
