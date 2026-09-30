import { Migration } from '@mikro-orm/migrations';

export class Migration20260828184635 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "reservations" alter column "total_amount" type numeric(12,2) using ("total_amount"::numeric(12,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "reservations" alter column "total_amount" type numeric(5,2) using ("total_amount"::numeric(5,2));`);
  }

}
