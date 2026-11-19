import { Migration } from '@mikro-orm/migrations';

/**
 * US-26: cuenta corriente por reserva y su libro de movimientos. No abre cuentas de reservas
 * existentes: cada cuenta se abre cuando recepción registra el pago del resto de la estadía.
 */
export class Migration20261118121645 extends Migration {
  override name = 'Migration20261118121645';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "accounts" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "reservation_id" uuid not null, "status" text not null default 'OPEN', "stay_balance_amount" numeric(12,2) not null, "stay_balance_payment_method" text not null, "opened_by_id" uuid not null, "opened_at" timestamp(6) not null, "closed_at" timestamp(6) null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "accounts" add constraint "accounts_reservation_id_unique" unique ("reservation_id");`,
    );
    this.addSql(
      `create table "account_entries" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "account_id" uuid not null, "type" text not null, "amount" numeric(12,2) not null, "description" varchar(200) not null, "origin" text not null, "source_id" uuid null, "reverses_id" uuid null, "registered_at" timestamp(6) not null, "registered_by_id" uuid null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_reverses_id_unique" unique ("reverses_id");`,
    );
    this.addSql(
      `create index "account_entries_account_id_registered_at_index" on "account_entries" ("account_id", "registered_at");`,
    );
    this.addSql(
      `alter table "accounts" add constraint "accounts_reservation_id_foreign" foreign key ("reservation_id") references "reservations" ("id");`,
    );
    this.addSql(
      `alter table "accounts" add constraint "accounts_opened_by_id_foreign" foreign key ("opened_by_id") references "users" ("id");`,
    );
    this.addSql(
      `alter table "accounts" add constraint "accounts_status_check" check ("status" in ('OPEN', 'CLOSED'));`,
    );
    this.addSql(
      `alter table "accounts" add constraint "accounts_stay_balance_payment_method_check" check ("stay_balance_payment_method" in ('CASH', 'CARD', 'TRANSFER', 'MERCADO_PAGO'));`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_account_id_foreign" foreign key ("account_id") references "accounts" ("id");`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_reverses_id_foreign" foreign key ("reverses_id") references "account_entries" ("id") on delete no action;`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_registered_by_id_foreign" foreign key ("registered_by_id") references "users" ("id") on delete no action;`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_amount_check" check (amount > 0);`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_type_check" check ("type" in ('CHARGE', 'PAYMENT', 'CHARGE_REVERSAL', 'PAYMENT_REVERSAL', 'REFUND'));`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_origin_check" check ("origin" in ('ROOM_SERVICE', 'SPA', 'RESTAURANT', 'RECEPTION'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "account_entries" cascade;`);
    this.addSql(`drop table if exists "accounts" cascade;`);
  }
}
