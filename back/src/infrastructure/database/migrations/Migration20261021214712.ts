import { Migration } from '@mikro-orm/migrations';

export class Migration20261021214712 extends Migration {
  override name = 'Migration20261021214712';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "restaurant_settings" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "status" text not null default 'ACTIVE', "description" text null, "available_weekdays" jsonb not null, "shifts" jsonb not null, "max_party_size" int not null default 10, primary key ("id"));`,
    );
    this.addSql(
      `alter table "restaurant_settings" add constraint "restaurant_settings_status_check" check ("status" in ('ACTIVE', 'INACTIVE'));`,
    );

    this.addSql(
      `create table "restaurant_menu_items" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "name" varchar(120) not null, "description" text null, "category" varchar(60) not null, "price" numeric(12,2) not null, "status" text not null default 'ACTIVE', primary key ("id"));`,
    );
    this.addSql(
      `alter table "restaurant_menu_items" add constraint "restaurant_menu_items_name_unique" unique ("name");`,
    );
    this.addSql(
      `alter table "restaurant_menu_items" add constraint "restaurant_menu_items_status_check" check ("status" in ('ACTIVE', 'INACTIVE'));`,
    );

    this.addSql(
      `create table "restaurant_photos" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "data" bytea not null, "mime_type" varchar(60) not null, "size_bytes" int not null, "position" int not null default 0, primary key ("id"));`,
    );

    this.addSql(
      `create table "restaurant_reservations" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "status" text not null default 'PENDING', "telegram_user_id" varchar(255) not null, "room_reservation_id" uuid not null, "guest_full_name" varchar(255) not null, "requested_date" varchar(10) not null, "requested_time" varchar(5) not null, "party_size" int not null, "notes" varchar(300) null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "restaurant_reservations" add constraint "restaurant_reservations_status_check" check ("status" in ('PENDING', 'CONFIRMED', 'REJECTED'));`,
    );
    this.addSql(
      `alter table "restaurant_reservations" add constraint "restaurant_reservations_room_reservation_id_foreign" foreign key ("room_reservation_id") references "reservations" ("id");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "restaurant_reservations" cascade;`);
    this.addSql(`drop table if exists "restaurant_photos" cascade;`);
    this.addSql(`drop table if exists "restaurant_menu_items" cascade;`);
    this.addSql(`drop table if exists "restaurant_settings" cascade;`);
  }
}
