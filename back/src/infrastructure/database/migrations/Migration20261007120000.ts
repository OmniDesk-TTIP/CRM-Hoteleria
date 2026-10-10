import { Migration } from '@mikro-orm/migrations';

export class Migration20261007120000 extends Migration {
  override name = 'Migration20261007120000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "spa_services" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "name" varchar(120) not null, "description" text not null, "duration_minutes" int not null, "price" numeric(12,2) not null, "status" text not null default 'ACTIVE', "available_weekdays" jsonb not null, "opens_at" varchar(5) not null, "closes_at" varchar(5) not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "spa_services" add constraint "spa_services_name_unique" unique ("name");`,
    );
    this.addSql(
      `alter table "spa_services" add constraint "spa_services_status_check" check ("status" in ('ACTIVE', 'INACTIVE'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "spa_services" cascade;`);
  }
}
