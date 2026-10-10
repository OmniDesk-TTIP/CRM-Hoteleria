import { Migration } from '@mikro-orm/migrations';

export class Migration20261007130000 extends Migration {
  override name = 'Migration20261007130000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "spa_reservations" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "status" text not null default 'PENDING', "telegram_user_id" varchar(255) not null, "room_reservation_id" uuid not null, "spa_service_id" uuid not null, "service_name" varchar(120) not null, "guest_full_name" varchar(255) not null, "requested_date" varchar(10) not null, "requested_time" varchar(5) not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_status_check" check ("status" in ('PENDING', 'CONFIRMED', 'REJECTED'));`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_room_reservation_id_foreign" foreign key ("room_reservation_id") references "reservations" ("id");`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_spa_service_id_foreign" foreign key ("spa_service_id") references "spa_services" ("id");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "spa_reservations" cascade;`);
  }
}
