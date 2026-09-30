import { Migration } from '@mikro-orm/migrations';

export class Migration20260828142226 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "booking_processes" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "telegram_user_id" varchar(255) not null, "step" varchar(255) not null default 'AWAITING_CHECKIN', "check_in" varchar(255) null, "check_out" varchar(255) null, "room_type" varchar(255) null, primary key ("id"));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "booking_processes" cascade;`);
  }

}
