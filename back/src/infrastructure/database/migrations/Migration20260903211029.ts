import { Migration } from '@mikro-orm/migrations';

export class Migration20260903211029 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "booking_processes" rename column "room_type" to "capacity";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "booking_processes" rename column "capacity" to "room_type";`);
  }

}
