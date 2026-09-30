import { Migration } from '@mikro-orm/migrations';

export class Migration20260903182704 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "reservations" add "deposit_amount" numeric(12,2) not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "reservations" drop column "deposit_amount";`);
  }

}
