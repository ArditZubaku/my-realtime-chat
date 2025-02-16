import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { ChatService, ChatMessage } from './chat.service';
import { Logger } from '@nestjs/common';

interface JoinPayload {
  username: string;
  room: string;
}

interface SendMessagePayload {
  username: string;
  room: string;
  message: string;
}

interface TypingPayload {
  username: string;
  room: string;
  isTyping: boolean;
}

interface PrivateMsgPayload {
  from: string;
  to: string; // The username of the recipient
  message: string;
}

// For pagination
interface FetchOlderPayload {
  room: string;
  pageSize: number;
  pageIndex: number; // 0 => newest page, 1 => older, etc.
}

@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);

    client.on('error', (error) => {
      this.logger.error(`Socket error for client ${client.id}:`, error);
    });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    try {
      this.logger.log(`Client disconnected: ${client.id}`);
      const username = client.data.username;
      const room = client.data.room;

      if (username) {
        await this.chatService.removeUserSocket(username);
        if (room) {
          client.broadcast.to(room).emit('user_left', { username, room });
        }
      }
    } catch (error) {
      this.logger.error(
        `Error handling disconnect for client ${client.id}:`,
        error,
      );
    }
  }

  // 1) JOIN ROOM
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: JoinPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { username, room } = data;
      if (!username || !room) {
        throw new WsException('Username and room are required');
      }

      // Store user->socket in Redis
      await this.chatService
        .setUserSocket(username, client.id)
        .catch((error) => {
          this.logger.error(
            `Failed to store user socket mapping: ${error.message}`,
          );
          throw new WsException('Failed to join room');
        });

      // Attach user + room to socket for disconnect usage
      client.data.username = username;
      client.data.room = room;

      client.join(room);

      try {
        // Retrieve last messages
        const lastMessages = await this.chatService.getLastMessages(room);
        this.server.to(client.id).emit('last_messages', lastMessages);
      } catch (error) {
        this.logger.error(
          `Failed to fetch last messages for room ${room}:`,
          error,
        );
        this.server
          .to(client.id)
          .emit('error', { message: 'Failed to load message history' });
      }

      // Notify others
      client.broadcast.to(room).emit('user_joined', { username, room });
      this.logger.log(`User ${username} joined room ${room}`);
    } catch (error) {
      this.logger.error('Error in handleJoinRoom:', error);
      client.emit('error', {
        message:
          error instanceof WsException ? error.message : 'Failed to join room',
      });
    }
  }

  // 2) BROADCAST MESSAGE
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody() data: SendMessagePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { username, room, message } = data;
      if (!username || !room || !message) {
        throw new WsException('Invalid message payload');
      }

      const chatMessage: ChatMessage = {
        sender: username,
        room,
        message,
        timestamp: Date.now(),
      };

      // Store in Redis
      await this.chatService.storeMessage(chatMessage).catch((error) => {
        this.logger.error(`Failed to store message: ${error.message}`);
        throw new WsException('Failed to send message');
      });

      // Broadcast
      this.server.to(room).emit('receive_message', chatMessage);
      this.logger.debug(`Message sent in room ${room} by ${username}`);
    } catch (error) {
      this.logger.error('Error in handleSendMessage:', error);
      client.emit('error', {
        message:
          error instanceof WsException
            ? error.message
            : 'Failed to send message',
      });
    }
  }

  // 3) TYPING
  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody() data: TypingPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { username, room, isTyping } = data;
      if (!username || !room) {
        throw new WsException('Invalid typing notification payload');
      }

      client.broadcast.to(room).emit('user_typing', { username, isTyping });
    } catch (error) {
      this.logger.error('Error in handleTyping:', error);
    }
  }

  // 4) PRIVATE MESSAGING
  @SubscribeMessage('send_private_message')
  async handlePrivateMessage(
    @MessageBody() payload: PrivateMsgPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { from, to, message } = payload;
      if (!from || !to || !message) {
        throw new WsException('Invalid private message payload');
      }

      // Store the private message
      await this.chatService
        .storePrivateMessage(from, to, message)
        .catch((error) => {
          this.logger.error(
            `Failed to store private message: ${error.message}`,
          );
          throw new WsException('Failed to send private message');
        });

      // Get recipient's socket
      const recipientSocketId = await this.chatService.getUserSocket(to);
      if (!recipientSocketId) {
        client.emit('error', { message: 'User is offline' });
        return;
      }

      // Send to recipient
      this.server.to(recipientSocketId).emit('receive_private_message', {
        from,
        message,
        timestamp: Date.now(),
      });

      // Confirm to sender
      client.emit('private_message_sent', {
        to,
        message,
        timestamp: Date.now(),
      });

      this.logger.debug(`Private message sent from ${from} to ${to}`);
    } catch (error) {
      this.logger.error('Error in handlePrivateMessage:', error);
      client.emit('error', {
        message:
          error instanceof WsException
            ? error.message
            : 'Failed to send private message',
      });
    }
  }

  // 5) PAGINATION: fetch older messages
  @SubscribeMessage('fetch_older_messages')
  async handleFetchOlderMessages(
    @MessageBody() data: FetchOlderPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { room, pageSize, pageIndex } = data;
      if (!room || !pageSize) {
        throw new WsException('Invalid pagination parameters');
      }

      const olderMsgs = await this.chatService
        .getMessagesPage(room, pageSize, pageIndex)
        .catch((error) => {
          this.logger.error(`Failed to fetch messages: ${error.message}`);
          throw new WsException('Failed to fetch messages');
        });

      this.server.to(client.id).emit('older_messages', olderMsgs);
    } catch (error) {
      this.logger.error('Error in handleFetchOlderMessages:', error);
      client.emit('error', {
        message:
          error instanceof WsException
            ? error.message
            : 'Failed to fetch messages',
      });
    }
  }
}
