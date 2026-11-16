import { Migration } from '@mikro-orm/migrations';

export class Migration20261030195936 extends Migration {
  override name = 'Migration20261030195936';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "arrival_messages" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "reservation_id" uuid not null, "type" text not null, "telegram_user_id" varchar(255) not null, "status" text not null default 'PENDING', "sent_at" timestamptz null, "failure_reason" text null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "arrival_messages" add constraint "arrival_messages_reservation_id_type_unique" unique ("reservation_id", "type");`,
    );
    this.addSql(
      `alter table "arrival_messages" add constraint "arrival_messages_reservation_id_foreign" foreign key ("reservation_id") references "reservations" ("id") on delete cascade;`,
    );
    this.addSql(
      `alter table "arrival_messages" add constraint "arrival_messages_type_check" check ("type" in ('REMINDER', 'WELCOME'));`,
    );
    this.addSql(
      `alter table "arrival_messages" add constraint "arrival_messages_status_check" check ("status" in ('PENDING', 'SENT', 'BLOCKED', 'FAILED'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "arrival_messages" cascade;`);
  }
}
