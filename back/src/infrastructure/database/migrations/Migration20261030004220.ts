import { Migration } from '@mikro-orm/migrations';

export class Migration20261030004220 extends Migration {
  override name = 'Migration20261030004220';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "room_category_photos" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "category_id" uuid not null, "data" bytea not null, "mime_type" varchar(60) not null, "size_bytes" int not null, "position" int not null default 0, primary key ("id"));`,
    );
    this.addSql(
      `create index "room_category_photos_category_id_index" on "room_category_photos" ("category_id");`,
    );

    this.addSql(
      `alter table "room_category_photos" add constraint "room_category_photos_category_id_foreign" foreign key ("category_id") references "room_categories" ("id") on delete cascade;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "room_category_photos" cascade;`);
  }
}
