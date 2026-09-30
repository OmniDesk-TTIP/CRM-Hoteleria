import { Migration } from '@mikro-orm/migrations';

export class Migration20260921165957 extends Migration {

  override name = 'Migration20260921165957';

  override up(): void | Promise<void> {
    this.addSql(`create table "support_hours" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "weekday" smallint not null, "is_closed" boolean not null default false, "opens_at" varchar(5) not null default '09:00', "closes_at" varchar(5) not null default '21:00', primary key ("id"));`);
    this.addSql(`alter table "support_hours" add constraint "support_hours_weekday_unique" unique ("weekday");`);

    this.addSql(`create table "chat_sessions" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "telegram_user_id" varchar(255) not null, "status" text not null default 'BOT', "assigned_operator_id" uuid null, "guest_display_name" varchar(255) null, "telegram_username" varchar(255) null, "last_message_at" timestamptz null, "last_message_preview" varchar(200) null, "last_message_role" text null, "unread_count" int not null default 0, "consecutive_bot_failures" int not null default 0, "handover_requested_at" timestamptz null, "handover_reason" text null, "taken_over_at" timestamptz null, "released_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "chat_sessions" add constraint "chat_sessions_telegram_user_id_unique" unique ("telegram_user_id");`);
    this.addSql(`create index "chat_sessions_status_last_message_at_index" on "chat_sessions" ("status", "last_message_at");`);

    this.addSql(`alter table "chat_messages" drop constraint "chat_messages_role_check";`);
    this.addSql(`alter table "chat_messages" add "sent_by_id" uuid null;`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_sent_by_id_foreign" foreign key ("sent_by_id") references "users" ("id") on delete set null;`);
    this.addSql(`create index "chat_messages_telegram_user_id_created_at_index" on "chat_messages" ("telegram_user_id", "created_at");`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_role_check" check ("role" in ('USER', 'BOT', 'SYSTEM', 'OPERATOR'));`);

    this.addSql(`alter table "chat_sessions" add constraint "chat_sessions_assigned_operator_id_foreign" foreign key ("assigned_operator_id") references "users" ("id") on delete set null;`);
    this.addSql(`alter table "chat_sessions" add constraint "chat_sessions_status_check" check ("status" in ('BOT', 'WAITING_HUMAN', 'HUMAN'));`);
    this.addSql(`alter table "chat_sessions" add constraint "chat_sessions_last_message_role_check" check ("last_message_role" in ('USER', 'BOT', 'SYSTEM', 'OPERATOR'));`);
    this.addSql(`alter table "chat_sessions" add constraint "chat_sessions_handover_reason_check" check ("handover_reason" in ('GUEST_REQUEST', 'AI_FALLBACK', 'MANUAL_TAKEOVER', 'OUT_OF_HOURS'));`);

    // Backfill: una sesión por cada huésped que ya venía conversando con el bot. Sin esto, las
    // conversaciones anteriores a la US-11 quedarían invisibles en el panel hasta que el huésped
    // vuelva a escribir. gen_random_uuid() es nativo desde PG13 (docker-compose fija pg16).
    this.addSql(`
      insert into "chat_sessions" ("id", "created_at", "telegram_user_id", "status", "unread_count",
                                  "consecutive_bot_failures", "last_message_at", "last_message_preview", "last_message_role")
      select gen_random_uuid(), min(m."created_at"), m."telegram_user_id", 'BOT', 0, 0,
             max(m."created_at"),
             left((array_agg(m."content" order by m."created_at" desc))[1], 200),
             (array_agg(m."role" order by m."created_at" desc))[1]
      from "chat_messages" m
      group by m."telegram_user_id";
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "support_hours" cascade;`);
    this.addSql(`drop table if exists "chat_sessions" cascade;`);

    this.addSql(`alter table "chat_messages" drop constraint "chat_messages_sent_by_id_foreign";`);

    this.addSql(`drop index "chat_messages_telegram_user_id_created_at_index";`);
    this.addSql(`alter table "chat_messages" drop constraint "chat_messages_role_check";`);
    this.addSql(`alter table "chat_messages" drop column "sent_by_id";`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_role_check" check ("role" in ('USER', 'BOT', 'SYSTEM'));`);
  }

}
