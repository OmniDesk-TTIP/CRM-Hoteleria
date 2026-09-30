import { MikroORM, type Options } from '@mikro-orm/core';
import databaseConfig from '../src/infrastructure/database/database.config';

/**
 * Prepara la base de datos antes de cada suite e2e: la crea si no existe, habilita pgvector
 * y sincroniza el esquema con las entidades. Jest deja NODE_ENV=test, así que
 * database.config.ts toma .env.test y esto nunca toca la base de desarrollo.
 *
 * Corre acá (y no en globalSetup) porque dentro del sandbox de Jest las entidades se
 * descubren desde los .ts que transpila swc; afuera MikroORM busca en dist/ y queda desfasado.
 */
beforeAll(async () => {
  const dbName = databaseConfig.dbName;

  if (!dbName?.endsWith('_test')) {
    throw new Error(
      `Los e2e apuntan a la base "${dbName}", que no es de test. Revisá DATABASE_NAME en .env.test (tiene que terminar en "_test").`,
    );
  }

  // El cast es por los tipos de MikroORM 7.2.0: PostgreSqlDriver no satisface IDatabaseDriver.
  const orm = await MikroORM.init({
    ...databaseConfig,
    debug: false,
  } as Options);

  try {
    await orm.schema.ensureDatabase();
    await orm.schema.execute('CREATE EXTENSION IF NOT EXISTS vector;');
    await orm.schema.update();
  } finally {
    await orm.close(true);
  }
});
