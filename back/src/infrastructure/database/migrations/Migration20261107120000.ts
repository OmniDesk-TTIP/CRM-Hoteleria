import { Migration } from '@mikro-orm/migrations';

export class Migration20261107120000 extends Migration {
  override name = 'Migration20261107120000';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "campaigns" drop constraint if exists "campaigns_stay_filter_check";`,
    );
    this.addSql(
      `alter table "campaigns" add constraint "campaigns_stay_filter_check" check ("stay_filter" in ('IN_HOUSE', 'UPCOMING', 'FINISHED', 'UNPAID', 'QUOTED'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "campaigns" drop constraint if exists "campaigns_stay_filter_check";`,
    );
    this.addSql(
      `alter table "campaigns" add constraint "campaigns_stay_filter_check" check ("stay_filter" in ('IN_HOUSE', 'UPCOMING', 'FINISHED', 'UNPAID'));`,
    );
  }
}
