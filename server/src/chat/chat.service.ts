import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { ConfigService } from '@nestjs/config';

export interface ChatMessage {
  sender: string;
  room: string;
  message: string;
  timestamp: number;
}

@Injectable()
export class ChatService implements OnModuleInit {
  private redisClient: RedisClientType;
  private readonly logger = new Logger(ChatService.name);
  private isShuttingDown = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      const redisHost = this.configService.get<string>(
        'REDIS_HOST',
        'localhost',
      );
      const redisPort = this.configService.get<string>('REDIS_PORT', '6379');
      const connectTimeout = this.configService.get<number>(
        'REDIS_CONNECT_TIMEOUT',
        5000,
      );
      const retryAttempts = this.configService.get<number>(
        'REDIS_RETRY_ATTEMPTS',
        5,
      );

      this.redisClient = createClient({
        url: `redis://${redisHost}:${redisPort}`,
        socket: {
          connectTimeout,
          reconnectStrategy: (retries: number) => {
            if (this.isShuttingDown) return false;
            if (retries >= retryAttempts) {
              this.logger.error(
                `Failed to connect to Redis after ${retries} attempts`,
              );
              return false;
            }
            return Math.min(retries * 100, 3000); // exponential backoff with max delay of 3s
          },
        },
      });

      // Handle Redis events
      this.redisClient.on('error', (err) => {
        this.logger.error('Redis client error:', err);
      });

      this.redisClient.on('connect', () => {
        this.logger.log('Connected to Redis');
      });

      this.redisClient.on('reconnecting', () => {
        this.logger.warn('Reconnecting to Redis');
      });

      await this.redisClient.connect();
    } catch (error) {
      this.logger.error('Failed to initialize Redis client:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      this.isShuttingDown = true;
      if (this.redisClient) {
        await this.redisClient.quit();
        this.logger.log('Redis connection closed');
      }
    } catch (error) {
      this.logger.error('Error while closing Redis connection:', error);
      throw error;
    }
  }

  // USER → SOCKET MAPPING for PRIVATE MESSAGING
  async setUserSocket(username: string, socketId: string): Promise<void> {
    try {
      if (!username || !socketId) {
        throw new Error('Username and socketId are required');
      }
      await this.redisClient.set(`user_sockets:${username}`, socketId);
      this.logger.debug(`Socket mapping set for user ${username}`);
    } catch (error) {
      this.logger.error(
        `Failed to set socket mapping for user ${username}:`,
        error,
      );
      throw error;
    }
  }

  async getUserSocket(username: string): Promise<string | null> {
    try {
      if (!username) {
        throw new Error('Username is required');
      }
      const socketId = await this.redisClient.get(`user_sockets:${username}`);
      if (!socketId) {
        this.logger.debug(`No socket found for user ${username}`);
      }
      return socketId;
    } catch (error) {
      this.logger.error(`Failed to get socket for user ${username}:`, error);
      throw error;
    }
  }

  async removeUserSocket(username: string): Promise<void> {
    try {
      if (!username) {
        throw new Error('Username is required');
      }
      await this.redisClient.del(`user_sockets:${username}`);
      this.logger.debug(`Socket mapping removed for user ${username}`);
    } catch (error) {
      this.logger.error(
        `Failed to remove socket mapping for user ${username}:`,
        error,
      );
      throw error;
    }
  }

  // ROOM MESSAGES
  async storeMessage(msg: ChatMessage): Promise<void> {
    try {
      if (!msg.room || !msg.sender || !msg.message) {
        throw new Error('Invalid message format');
      }
      const key = `room:${msg.room}`;
      await this.redisClient.rPush(key, JSON.stringify(msg));
      this.logger.debug(`Message stored in room ${msg.room}`);
    } catch (error) {
      this.logger.error(`Failed to store message in room ${msg.room}:`, error);
      throw error;
    }
  }

  async getLastMessages(room: string): Promise<ChatMessage[]> {
    try {
      if (!room) {
        throw new Error('Room name is required');
      }
      const key = `room:${room}`;
      const length = await this.redisClient.lLen(key);
      if (length === 0) return [];

      const start = Math.max(length - 10, 0);
      const end = length - 1;
      const items = await this.redisClient.lRange(key, start, end);

      return items
        .map((jsonStr) => {
          try {
            return JSON.parse(jsonStr) as ChatMessage;
          } catch (error) {
            this.logger.error(`Failed to parse message: ${jsonStr}`, error);
            return null;
          }
        })
        .filter((msg): msg is ChatMessage => msg !== null);
    } catch (error) {
      this.logger.error(`Failed to get last messages for room ${room}:`, error);
      throw error;
    }
  }

  async getMessagesPage(
    room: string,
    pageSize: number,
    pageIndex: number,
  ): Promise<ChatMessage[]> {
    try {
      if (!room || pageSize <= 0 || pageIndex < 0) {
        throw new Error('Invalid pagination parameters');
      }

      const key = `room:${room}`;
      const length = await this.redisClient.lLen(key);
      if (length === 0) return [];

      const skipFromRight = pageIndex * pageSize;
      const end = length - 1 - skipFromRight;
      if (end < 0) return [];

      const start = Math.max(end - (pageSize - 1), 0);
      const items = await this.redisClient.lRange(key, start, end);

      return items
        .map((jsonStr) => {
          try {
            return JSON.parse(jsonStr) as ChatMessage;
          } catch (error) {
            this.logger.error(`Failed to parse message: ${jsonStr}`, error);
            return null;
          }
        })
        .filter((msg): msg is ChatMessage => msg !== null);
    } catch (error) {
      this.logger.error(`Failed to get messages page for room ${room}:`, error);
      throw error;
    }
  }

  // PRIVATE MESSAGES
  async storePrivateMessage(
    from: string,
    to: string,
    message: string,
  ): Promise<void> {
    try {
      if (!from || !to || !message) {
        throw new Error('From, to, and message are required');
      }

      const key = `PM:${from}:${to}`;
      const msgObj = { from, to, message, timestamp: Date.now() };
      await this.redisClient.rPush(key, JSON.stringify(msgObj));
      this.logger.debug(`Private message stored from ${from} to ${to}`);
    } catch (error) {
      this.logger.error(
        `Failed to store private message from ${from} to ${to}:`,
        error,
      );
      throw error;
    }
  }
}
