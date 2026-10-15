import { Migration } from '@mikro-orm/migrations';

export class Migration20261010203012 extends Migration {
  override name = 'Migration20261010203012';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "satisfaction_surveys" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "reservation_id" uuid not null, "telegram_user_id" varchar(255) not null, "token_hash" varchar(255) not null, "status" text not null default 'PENDING', "expires_at" timestamptz not null, "sent_at" timestamptz null, "answered_at" timestamptz null, "overall_rating" smallint null, "cleanliness_rating" smallint null, "attention_rating" smallint null, "services_rating" smallint null, "comment" text null, "publish_consent" boolean not null default false, "published_at" timestamptz null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_reservation_id_unique" unique ("reservation_id");`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_token_hash_unique" unique ("token_hash");`,
    );

    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_reservation_id_foreign" foreign key ("reservation_id") references "reservations" ("id") on delete cascade;`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_overall_rating_check" check (overall_rating between 1 and 5);`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_cleanliness_rating_check" check (cleanliness_rating between 1 and 5);`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_attention_rating_check" check (attention_rating between 1 and 5);`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_services_rating_check" check (services_rating between 1 and 5);`,
    );
    this.addSql(
      `alter table "satisfaction_surveys" add constraint "satisfaction_surveys_status_check" check ("status" in ('PENDING', 'SENT', 'SEND_FAILED', 'ANSWERED'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "satisfaction_surveys" cascade;`);
  }
}
