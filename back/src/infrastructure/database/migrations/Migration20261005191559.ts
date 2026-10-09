import { Migration } from '@mikro-orm/migrations';

export class Migration20261005191559 extends Migration {

  override name = 'Migration20261005191559';

  override up(): void | Promise<void> {
    this.addSql(`alter table "knowledge_documents" alter column "chunks_count" set default 0;`);
    this.addSql(`alter table "knowledge_documents" alter column "status" set default 'PENDING';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "knowledge_documents" alter column "status" drop default;`);
    this.addSql(`alter table "knowledge_documents" alter column "chunks_count" drop default;`);
  }
}
