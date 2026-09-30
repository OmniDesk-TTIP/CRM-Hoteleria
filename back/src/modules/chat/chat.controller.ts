import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ListChatsQueryDto } from './dto/listChats.dto';
import { ListChatMessagesQueryDto } from './dto/listChatMessages.dto';
import { SendChatMessageDto } from './dto/sendChatMessage.dto';
import { ReleaseChatDto } from './dto/releaseChat.dto';
import { ChatDetailDto, ChatMessageDto, ChatSummaryDto, CursorPageDto } from './dto/chat.dto';
import { PaginatedResultDto } from '../reservation/dto/adminReservation.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthUser } from '../auth/auth.types';

/**
 * Bandeja de conversaciones y control manual del bot (US-11). Como ReservationAdminController,
 * solo lo protege el guard global (JwtAuthGuard): cualquier usuario autenticado, ADMIN o
 * EMPLOYEE, atiende chats. La configuración de horarios sí es de ADMIN (ver SupportHoursModule).
 */
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(@Query() query: ListChatsQueryDto, @CurrentUser() user: AuthUser): Promise<PaginatedResultDto<ChatSummaryDto>> {
    return this.chatService.list(query, user);
  }

  @Get(':chatId')
  detail(@Param('chatId', ParseUUIDPipe) chatId: string): Promise<ChatDetailDto> {
    return this.chatService.getDetail(chatId);
  }

  // CA3: historial completo para que el operador tome contexto antes de escribir.
  @Get(':chatId/messages')
  messages(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: ListChatMessagesQueryDto,
  ): Promise<CursorPageDto<ChatMessageDto>> {
    return this.chatService.getMessages(chatId, query);
  }

  // CA3: el operador le escribe al Telegram del huésped desde el panel.
  @Post(':chatId/messages')
  send(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() body: SendChatMessageDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ChatMessageDto> {
    return this.chatService.sendOperatorMessage(chatId, user, body);
  }

  // CA2: "Tomar el control" silencia al bot.
  @Post(':chatId/takeover')
  @HttpCode(HttpStatus.OK)
  takeOver(@Param('chatId', ParseUUIDPipe) chatId: string, @CurrentUser() user: AuthUser): Promise<ChatDetailDto> {
    return this.chatService.takeOver(chatId, user);
  }

  // CA4: "Devolver al asistente" reactiva a Chamber y avisa al huésped.
  @Post(':chatId/release')
  @HttpCode(HttpStatus.OK)
  release(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() body: ReleaseChatDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ChatDetailDto> {
    return this.chatService.releaseToBot(chatId, user, body);
  }

  @Post(':chatId/read')
  @HttpCode(HttpStatus.OK)
  markAsRead(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ unreadCount: number }> {
    return this.chatService.markAsRead(chatId, user);
  }
}
