import { Migration } from '@mikro-orm/migrations';

export class Migration20261021225945 extends Migration {
  override name = 'Migration20261021225945';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "campaigns" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "title" varchar(100) not null, "message" text not null, "audience" text not null, "has_image" boolean not null default false, "status" text not null default 'SENDING', "total_recipients" int not null, "sent_count" int not null default 0, "failed_count" int not null default 0, "blocked_count" int not null default 0, "created_by_id" uuid null, "finished_at" timestamp(6) null, primary key ("id"));`,
    );
    this.addSql(
      `create index "campaigns_status_index" on "campaigns" ("status");`,
    );

    this.addSql(
      `alter table "campaigns" add constraint "campaigns_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on delete set null;`,
    );
    this.addSql(
      `alter table "campaigns" add constraint "campaigns_audience_check" check ("audience" in ('ALL', 'CONFIRMED', 'NO_RESERVATION'));`,
    );
    this.addSql(
      `alter table "campaigns" add constraint "campaigns_status_check" check ("status" in ('SENDING', 'COMPLETED', 'INTERRUPTED'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "campaigns" cascade;`);
  }
}
