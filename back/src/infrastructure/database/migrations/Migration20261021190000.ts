import { Migration } from '@mikro-orm/migrations';

export class Migration20261021190000 extends Migration {
  override name = 'Migration20261021190000';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" add "refund_account_alias" varchar(20) null, add "refund_account_holder" varchar(150) null;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" drop column "refund_account_alias", drop column "refund_account_holder";`,
    );
  }
}
