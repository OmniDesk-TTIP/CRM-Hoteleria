import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const user = client.data?.user as AuthUser | undefined;
    const tokenExp = client.data?.tokenExp as number | undefined;

    if (!user) throw new WsException('No autenticado');

    if (tokenExp !== undefined && tokenExp * 1000 <= Date.now()) {
      client.emit('auth:error', { message: 'La sesión expiró' });
      client.disconnect(true);
      throw new WsException('La sesión expiró');
    }

    return true;
  }
}
