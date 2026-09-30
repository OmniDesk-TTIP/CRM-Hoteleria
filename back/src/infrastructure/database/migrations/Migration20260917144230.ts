import { Migration } from '@mikro-orm/migrations';

export class Migration20260917144230 extends Migration {

  override name = 'Migration20260917144230';

  override up(): void | Promise<void> {
    this.addSql(`create table "users" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "email" varchar(255) not null, "password_hash" varchar(255) not null, "full_name" varchar(255) not null, "role" text not null default 'EMPLOYEE', "is_active" boolean not null default true, "last_login_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "refresh_tokens" ("id" uuid not null, "created_at" timestamp(6) not null default now(), "updated_at" timestamp(6) null, "user_id" uuid not null, "token_hash" varchar(255) not null, "expires_at" timestamptz not null, "revoked_at" timestamptz null, "replaced_by_hash" varchar(255) null, primary key ("id"));`);
    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_token_hash_unique" unique ("token_hash");`);

    this.addSql(`alter table "users" add constraint "users_role_check" check ("role" in ('ADMIN', 'EMPLOYEE'));`);

    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "refresh_tokens" drop constraint "refresh_tokens_user_id_foreign";`);

    this.addSql(`drop table if exists "users" cascade;`);
    this.addSql(`drop table if exists "refresh_tokens" cascade;`);
  }

}
