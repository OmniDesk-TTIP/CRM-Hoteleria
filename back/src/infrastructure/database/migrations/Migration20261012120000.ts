import { Migration } from '@mikro-orm/migrations';

export class Migration20261012120000 extends Migration {
  override name = 'Migration20261012120000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "cancellation_policies" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "name" varchar(120) not null, "tiers" jsonb not null, "active" boolean not null default false, constraint "cancellation_policies_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "cancellation_policies" add constraint "cancellation_policies_name_unique" unique ("name");`,
    );

    this.addSql(
      `alter table "reservations" add "cancelled_at" timestamp(6) null, add "cancellation_policy_name" varchar(120) null, add "refund_percentage" numeric(5,2) null, add "refund_amount" numeric(12,2) null, add "refund_status" text null, add "refunded_at" timestamp(6) null;`,
    );
    this.addSql(
      `alter table "reservations" add constraint "reservations_refund_status_check" check ("refund_status" in ('PENDING', 'COMPLETED'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "reservations" drop constraint "reservations_refund_status_check";`,
    );
    this.addSql(
      `alter table "reservations" drop column "cancelled_at", drop column "cancellation_policy_name", drop column "refund_percentage", drop column "refund_amount", drop column "refund_status", drop column "refunded_at";`,
    );

    this.addSql(`drop table if exists "cancellation_policies" cascade;`);
  }
}
