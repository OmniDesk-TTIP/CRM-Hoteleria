import { Migration } from '@mikro-orm/migrations';

export class Migration20261028120000 extends Migration {
  override name = 'Migration20261028120000';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" drop constraint if exists "reservations_status_check";`,
    );

    this.addSql(
      `alter table "reservations" add "expires_at" timestamp(6) null, add "reminder_sent_at" timestamp(6) null, add "recovery_answered_at" timestamp(6) null;`,
    );
    this.addSql(
      `alter table "reservations" add constraint "reservations_status_check" check ("status" in ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'));`,
    );

    // Las pendientes que ya existían vencen con el mismo plazo que usaba el cron (30 minutos).
    this.addSql(
      `update "reservations" set "expires_at" = "created_at" + interval '30 minutes' where "status" = 'PENDING_PAYMENT';`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" drop constraint if exists "reservations_status_check";`,
    );

    this.addSql(
      `update "reservations" set "status" = 'CANCELLED' where "status" = 'EXPIRED';`,
    );
    this.addSql(
      `alter table "reservations" drop column "expires_at", drop column "reminder_sent_at", drop column "recovery_answered_at";`,
    );
    this.addSql(
      `alter table "reservations" add constraint "reservations_status_check" check ("status" in ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'));`,
    );
  }
}
