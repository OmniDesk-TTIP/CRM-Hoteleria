import { Migration } from '@mikro-orm/migrations';

export class Migration20260917222858 extends Migration {

  override name = 'Migration20260917222858';

  override up(): void | Promise<void> {
    this.addSql(`alter table "reservations" add "origin" text not null default 'BOT';`);
    this.addSql(`alter table "reservations" alter column "telegram_user_id" drop not null;`);
    this.addSql(`alter table "reservations" add constraint "reservations_origin_check" check ("origin" in ('BOT', 'MANUAL'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "reservations" drop constraint "reservations_origin_check";`);
    this.addSql(`alter table "reservations" drop column "origin";`);
    this.addSql(`alter table "reservations" alter column "telegram_user_id" set not null;`);
  }

}
