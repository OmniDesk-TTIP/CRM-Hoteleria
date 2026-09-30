import { Migration } from '@mikro-orm/migrations';

export class Migration20260828132125 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_messages" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "telegram_user_id" varchar(255) not null, "role" text not null default 'USER', "content" text not null, primary key ("id"));`);

    this.addSql(`alter table "chat_messages" add constraint "chat_messages_role_check" check ("role" in ('USER', 'BOT', 'SYSTEM'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "chat_messages" cascade;`);
  }

}
