import { Migration } from '@mikro-orm/migrations';

export class Migration20260903211334 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "booking_processes" alter column "capacity" type int using ("capacity"::int);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "booking_processes" alter column "capacity" type varchar(255) using ("capacity"::varchar(255));`);
  }

}
