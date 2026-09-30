import { Migration } from '@mikro-orm/migrations';

export class Migration20260827145828 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "room_categories" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "name" varchar(255) not null, "capacity" int not null, "base_price" numeric(10,2) not null, primary key ("id"));`);

    this.addSql(`create table "rooms" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "category_id" uuid not null, "room_number" varchar(255) not null, "status" text not null default 'ACTIVE', primary key ("id"));`);
    this.addSql(`alter table "rooms" add constraint "rooms_room_number_unique" unique ("room_number");`);

    this.addSql(`create table "reservations" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "room_id" uuid not null, "telegram_user_id" varchar(255) not null, "check_in" date not null, "check_out" date not null, "status" text not null default 'PENDING_PAYMENT', "total_amount" numeric(5,2) not null, primary key ("id"));`);

    this.addSql(`alter table "rooms" add constraint "rooms_category_id_foreign" foreign key ("category_id") references "room_categories" ("id");`);
    this.addSql(`alter table "rooms" add constraint "rooms_status_check" check ("status" in ('ACTIVE', 'MAINTENANCE', 'INACTIVE'));`);

    this.addSql(`alter table "reservations" add constraint "reservations_room_id_foreign" foreign key ("room_id") references "rooms" ("id");`);
    this.addSql(`alter table "reservations" add constraint "reservations_status_check" check ("status" in ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "rooms" drop constraint "rooms_category_id_foreign";`);
    this.addSql(`alter table "reservations" drop constraint "reservations_room_id_foreign";`);

    this.addSql(`drop table if exists "room_categories" cascade;`);
    this.addSql(`drop table if exists "rooms" cascade;`);
    this.addSql(`drop table if exists "reservations" cascade;`);
  }

}
