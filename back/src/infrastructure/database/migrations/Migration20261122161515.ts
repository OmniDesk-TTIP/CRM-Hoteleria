import { Migration } from '@mikro-orm/migrations';

/**
 * US-30: checkout de la estadía. La reserva sigue CONFIRMED; estas columnas registran cuándo y
 * quién hizo el checkout, que es lo que marca la estadía como finalizada.
 */
export class Migration20261122161515 extends Migration {
  override name = 'Migration20261122161515';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" add "checked_out_at" timestamp(6) null, add "checked_out_by_id" uuid null;`,
    );
    this.addSql(
      `alter table "reservations" add constraint "reservations_checked_out_by_id_foreign" foreign key ("checked_out_by_id") references "users" ("id") on delete no action;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" drop constraint "reservations_checked_out_by_id_foreign";`,
    );
    this.addSql(
      `alter table "reservations" drop column "checked_out_at", drop column "checked_out_by_id";`,
    );
  }
}
