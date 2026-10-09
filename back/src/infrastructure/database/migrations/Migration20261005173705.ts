import { Migration } from '@mikro-orm/migrations';

export class Migration20261005173705 extends Migration {
  override name = 'Migration20261005173705';

  override up(): void | Promise<void> {
    this.addSql(`create extension if not exists "vector";`);

    this.addSql(`
      create table "knowledge_documents" (
        "id" uuid not null,
        "created_at" timestamp(6) not null default now(),
        "updated_at" timestamp(6) null,
        "filename" varchar(255) not null,
        "mime_type" varchar(120) not null,
        "type" text not null,
        "size_bytes" int not null,
        "storage_path" varchar(500) not null,
        "status" text not null default 'PENDING',
        "chunks_count" int not null default 0,
        "error_message" text null,
        "uploaded_by_id" uuid null,
        primary key ("id")
      );
    `);
    this.addSql(
      `alter table "knowledge_documents" add constraint "knowledge_documents_type_check" check ("type" in ('PDF', 'TXT'));`,
    );
    this.addSql(
      `alter table "knowledge_documents" add constraint "knowledge_documents_status_check" check ("status" in ('PENDING', 'PROCESSING', 'READY', 'ERROR'));`,
    );
    this.addSql(
      `create index "knowledge_documents_created_at_index" on "knowledge_documents" ("created_at");`,
    );

    this.addSql(`alter table "document" add "source_document_id" uuid null;`);
    this.addSql(`alter table "document" add "filename" varchar(255) null;`);
    this.addSql(`alter table "document" add "mime_type" varchar(120) null;`);

    this.addSql(`
      alter table "document"
        add constraint "document_source_document_id_foreign"
        foreign key ("source_document_id")
        references "knowledge_documents" ("id")
        on delete cascade;
    `);
    this.addSql(
      `create index "document_source_document_id_index" on "document" ("source_document_id");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "document" drop constraint "document_source_document_id_foreign";`,
    );
    this.addSql(`drop index "document_source_document_id_index";`);
    this.addSql(`alter table "document" drop column "source_document_id";`);
    this.addSql(`alter table "document" drop column "filename";`);
    this.addSql(`alter table "document" drop column "mime_type";`);
    this.addSql(`drop table if exists "knowledge_documents" cascade;`);
  }
}
