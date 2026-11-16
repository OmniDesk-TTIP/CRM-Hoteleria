import { Migration } from '@mikro-orm/migrations';

export class Migration20261106205912 extends Migration {
  override name = 'Migration20261106205912';

  override up(): void | Promise<void> {
    this.addSql(`alter table "reservations" add "guest_count" int null;`);

    // Las reservas del bot ya creadas no guardaban la cantidad de personas, pero la búsqueda que
    // las originó sí: se recupera de la búsqueda del mismo huésped con las mismas fechas
    // (booking_processes guarda las fechas como DD-MM-YYYY).
    this.addSql(
      `update "reservations" r set "guest_count" = (
        select bp."capacity" from "booking_processes" bp
        where bp."telegram_user_id" = r."telegram_user_id"
          and bp."check_in" = to_char(r."check_in", 'DD-MM-YYYY')
          and bp."check_out" = to_char(r."check_out", 'DD-MM-YYYY')
          and bp."capacity" is not null
        order by bp."created_at" desc
        limit 1
      )
      where r."origin" = 'BOT' and r."telegram_user_id" is not null;`,
    );

    this.addSql(
      `alter table "campaigns" add "stay_filter" text null, add "stay_from" varchar(10) null, add "stay_to" varchar(10) null, add "min_guests" int null, add "max_guests" int null;`,
    );
    this.addSql(
      `alter table "campaigns" add constraint "campaigns_stay_filter_check" check ("stay_filter" in ('IN_HOUSE', 'UPCOMING', 'FINISHED', 'UNPAID'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "campaigns" drop constraint "campaigns_stay_filter_check";`,
    );
    this.addSql(
      `alter table "campaigns" drop column "stay_filter", drop column "stay_from", drop column "stay_to", drop column "min_guests", drop column "max_guests";`,
    );

    this.addSql(`alter table "reservations" drop column "guest_count";`);
  }
}
