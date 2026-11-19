import { Migration } from '@mikro-orm/migrations';

/**
 * US-28: los movimientos guardan con qué medio se cobró o se devolvió y una referencia opcional
 * (número de operación o de cupón). Los movimientos existentes quedan con ambos en null.
 */
export class Migration20261119174242 extends Migration {
  override name = 'Migration20261119174242';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "account_entries" add "payment_method" text null, add "reference" varchar(100) null;`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_payment_method_check" check ("payment_method" in ('CASH', 'CARD', 'TRANSFER', 'MERCADO_PAGO'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "account_entries" drop constraint "account_entries_payment_method_check";`,
    );
    this.addSql(
      `alter table "account_entries" drop column "payment_method", drop column "reference";`,
    );
  }
}
