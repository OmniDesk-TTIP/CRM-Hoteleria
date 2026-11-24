import { Migration } from '@mikro-orm/migrations';

/** US-27: el bar como origen de los consumos que se cargan a mano en la cuenta corriente. */
export class Migration20261122155107 extends Migration {
  override name = 'Migration20261122155107';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "account_entries" drop constraint "account_entries_origin_check";`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_origin_check" check ("origin" in ('ROOM_SERVICE', 'SPA', 'RESTAURANT', 'BAR', 'RECEPTION'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "account_entries" drop constraint "account_entries_origin_check";`,
    );
    this.addSql(
      `alter table "account_entries" add constraint "account_entries_origin_check" check ("origin" in ('ROOM_SERVICE', 'SPA', 'RESTAURANT', 'RECEPTION'));`,
    );
  }
}
