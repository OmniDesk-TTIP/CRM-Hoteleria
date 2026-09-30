import { Migration } from '@mikro-orm/migrations';

export class Migration20260906133451 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "reservations" add "guest_full_name" varchar(255) null, add "guest_dni" varchar(255) null, add "mp_preference_id" varchar(255) null, add "mp_init_point" varchar(255) null, add "mp_payment_id" varchar(255) null;`);
    this.addSql(`update "reservations" set "guest_full_name" = 'Sin datos (reserva previa a la integración de Mercado Pago)', "guest_dni" = '00000000' where "guest_full_name" is null;`);
    this.addSql(`alter table "reservations" alter column "guest_full_name" set not null, alter column "guest_dni" set not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "reservations" drop column "guest_full_name", drop column "guest_dni", drop column "mp_preference_id", drop column "mp_init_point", drop column "mp_payment_id";`);
  }

}
