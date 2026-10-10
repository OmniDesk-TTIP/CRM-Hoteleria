import { Migration } from '@mikro-orm/migrations';

export class Migration20261010133105 extends Migration {
  override name = 'Migration20261010133105';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "spa_reservations" drop constraint "spa_reservations_room_reservation_id_foreign";`,
    );

    this.addSql(
      `alter table "spa_services" add "capacity" int not null default 1;`,
    );

    this.addSql(
      `alter table "spa_reservations" drop constraint "spa_reservations_status_check";`,
    );
    this.addSql(
      `alter table "spa_reservations" add "client_type" text not null default 'GUEST', add "guest_dni" varchar(255) null, add "amount" numeric(12,2) not null default 0, add "mp_preference_id" varchar(255) null, add "mp_init_point" varchar(255) null, add "mp_payment_id" varchar(255) null;`,
    );
    this.addSql(
      `alter table "spa_reservations" alter column "room_reservation_id" drop not null;`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_room_reservation_id_foreign" foreign key ("room_reservation_id") references "reservations" ("id") on delete set null;`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_client_type_check" check ("client_type" in ('GUEST', 'EXTERNAL'));`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_status_check" check ("status" in ('PENDING', 'PENDING_PAYMENT', 'CONFIRMED', 'REJECTED', 'CANCELLED'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "spa_reservations" drop constraint "spa_reservations_room_reservation_id_foreign";`,
    );

    this.addSql(
      `alter table "spa_reservations" drop constraint "spa_reservations_client_type_check";`,
    );
    this.addSql(
      `alter table "spa_reservations" drop constraint "spa_reservations_status_check";`,
    );
    this.addSql(
      `alter table "spa_reservations" drop column "client_type", drop column "guest_dni", drop column "amount", drop column "mp_preference_id", drop column "mp_init_point", drop column "mp_payment_id";`,
    );
    this.addSql(
      `alter table "spa_reservations" alter column "room_reservation_id" set not null;`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_room_reservation_id_foreign" foreign key ("room_reservation_id") references "reservations" ("id");`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_status_check" check ("status" in ('PENDING', 'CONFIRMED', 'REJECTED'));`,
    );

    this.addSql(`alter table "spa_services" drop column "capacity";`);
  }
}
