import { Migration } from '@mikro-orm/migrations';

export class Migration20261007150000 extends Migration {
  override name = 'Migration20261007150000';

  override up(): void | Promise<void> {
    this.addSql(`
      with base as (
        insert into "knowledge_documents"
          ("id", "filename", "mime_type", "type", "size_bytes", "storage_path", "status", "chunks_count")
        select gen_random_uuid(), 'Conocimiento Base', 'application/json', 'TXT', 0,
               'internal/seeder/knowledge.json', 'READY', count(*)
        from "document"
        where "source_document_id" is null
        having count(*) > 0
        returning "id"
      )
      update "document"
      set "source_document_id" = (select "id" from base)
      where "source_document_id" is null
        and exists (select 1 from base);
    `);
  }

  override down(): void | Promise<void> {}
}
