import { Migration } from '@mikro-orm/migrations';

export class Migration20261103011103 extends Migration {
  override name = 'Migration20261103011103';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "promotions" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "title" varchar(100) not null, "description" text not null, "discount_percentage" int not null, "start_date" varchar(10) not null, "end_date" varchar(10) not null, "target" text not null, "min_nights" int null, "enabled" boolean not null default true, primary key ("id"));`,
    );
    this.addSql(
      `alter table "promotions" add constraint "promotions_target_check" check ("target" in ('ROOMS', 'SPA'));`,
    );

    this.addSql(
      `alter table "booking_processes" add "quoted_total" numeric(12,2) null;`,
    );

    this.addSql(
      `alter table "reservations" add "promotion_id" uuid null, add "promotion_title" varchar(100) null, add "promotion_percentage" int null, add "discount_amount" numeric(12,2) not null default 0;`,
    );
    this.addSql(
      `alter table "reservations" add constraint "reservations_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on delete set null;`,
    );

    this.addSql(
      `alter table "spa_reservations" add "promotion_id" uuid null, add "promotion_title" varchar(100) null, add "promotion_percentage" int null, add "discount_amount" numeric(12,2) not null default 0;`,
    );
    this.addSql(
      `alter table "spa_reservations" add constraint "spa_reservations_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on delete set null;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "spa_reservations" drop constraint "spa_reservations_promotion_id_foreign";`,
    );
    this.addSql(
      `alter table "spa_reservations" drop column "promotion_id", drop column "promotion_title", drop column "promotion_percentage", drop column "discount_amount";`,
    );

    this.addSql(
      `alter table "reservations" drop constraint "reservations_promotion_id_foreign";`,
    );
    this.addSql(
      `alter table "reservations" drop column "promotion_id", drop column "promotion_title", drop column "promotion_percentage", drop column "discount_amount";`,
    );

    this.addSql(`alter table "booking_processes" drop column "quoted_total";`);

    this.addSql(`drop table if exists "promotions" cascade;`);
  }
}
