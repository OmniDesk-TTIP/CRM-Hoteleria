import { Migration } from '@mikro-orm/migrations';

export class Migration20261030012505 extends Migration {
  override name = 'Migration20261030012505';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "spa_photos" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "data" bytea not null, "mime_type" varchar(60) not null, "size_bytes" int not null, "position" int not null default 0, primary key ("id"));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "spa_photos" cascade;`);
  }
}
