import { Migration } from '@mikro-orm/migrations';

export class Migration20261029144711 extends Migration {
  override name = 'Migration20261029144711';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "room_service_orders" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "status" text not null default 'PENDING_CONFIRMATION', "telegram_user_id" varchar(255) not null, "room_reservation_id" uuid not null, "room_number" varchar(255) not null, "guest_full_name" varchar(255) not null, "items" jsonb not null, "notes" text null, "total" numeric(12,2) not null, "payment_status" text not null default 'PENDING', "confirmed_at" timestamptz null, "mp_preference_id" varchar(255) null, "mp_init_point" varchar(255) null, "mp_payment_id" varchar(255) null, primary key ("id"));`,
    );
    this.addSql(
      `create index "room_service_orders_status_index" on "room_service_orders" ("status");`,
    );

    this.addSql(
      `alter table "restaurant_menu_items" add "available_for_room_service" boolean not null default false;`,
    );

    this.addSql(
      `alter table "restaurant_settings" add "room_service_enabled" boolean not null default false, add "room_service_opens_at" varchar(5) not null default '07:00', add "room_service_closes_at" varchar(5) not null default '23:00';`,
    );

    this.addSql(
      `alter table "room_service_orders" add constraint "room_service_orders_room_reservation_id_foreign" foreign key ("room_reservation_id") references "reservations" ("id");`,
    );
    this.addSql(
      `alter table "room_service_orders" add constraint "room_service_orders_status_check" check ("status" in ('PENDING_CONFIRMATION', 'RECEIVED', 'IN_PREPARATION', 'DELIVERED', 'CANCELLED'));`,
    );
    this.addSql(
      `alter table "room_service_orders" add constraint "room_service_orders_payment_status_check" check ("payment_status" in ('PENDING', 'PAID'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "room_service_orders" cascade;`);

    this.addSql(
      `alter table "restaurant_menu_items" drop column "available_for_room_service";`,
    );

    this.addSql(
      `alter table "restaurant_settings" drop column "room_service_enabled", drop column "room_service_opens_at", drop column "room_service_closes_at";`,
    );
  }
}
