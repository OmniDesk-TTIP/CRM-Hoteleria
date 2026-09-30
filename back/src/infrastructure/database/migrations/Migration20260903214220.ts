import { Migration } from '@mikro-orm/migrations';

export class Migration20260903214220 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "booking_processes" alter column "step" type text using ("step"::text);`);
    this.addSql(`alter table "booking_processes" add constraint "booking_processes_step_check" check ("step" in ('AWAITING_CHECKIN', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'COMPLETED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "booking_processes" drop constraint "booking_processes_step_check";`);
    this.addSql(`alter table "booking_processes" alter column "step" type varchar(255) using ("step"::varchar(255));`);
  }

}
