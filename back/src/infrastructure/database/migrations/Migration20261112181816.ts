import { Migration } from '@mikro-orm/migrations';

export class Migration20261112181816 extends Migration {
  override name = 'Migration20261112181816';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "chat_sessions" add "language" text not null default 'es';`,
    );
    this.addSql(
      `alter table "chat_sessions" add constraint "chat_sessions_language_check" check ("language" in ('es', 'en'));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "chat_sessions" drop constraint "chat_sessions_language_check";`,
    );
    this.addSql(`alter table "chat_sessions" drop column "language";`);
  }
}
