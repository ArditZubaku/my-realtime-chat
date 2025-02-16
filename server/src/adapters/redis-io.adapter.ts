import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, Inject, Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, RedisClientType } from 'redis';
import { ServerOptions } from 'socket.io';
import { ConfigService } from '@nestjs/config';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: RedisClientType;
  private subClient: RedisClientType;
  private readonly configService: ConfigService;
  private readonly logger = new Logger(RedisIoAdapter.name);
  private isShuttingDown = false;

  constructor(private app: INestApplicationContext) {
    super(app);
    this.configService = app.get(ConfigService);
  }

  public async connectToRedis(): Promise<void> {
    try {
      const redisHost = this.configService.getOrThrow<string>(
        'REDIS_HOST',
        'localhost',
      );
      const redisPort = this.configService.getOrThrow<number>(
        'REDIS_PORT',
        6379,
      );
      const connectTimeout = this.configService.get<number>(
        'REDIS_CONNECT_TIMEOUT',
        5000,
      );
      const retryAttempts = this.configService.get<number>(
        'REDIS_RETRY_ATTEMPTS',
        5,
      );

      const clientOptions = {
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
      };

      this.pubClient = createClient(clientOptions);
      this.subClient = this.pubClient.duplicate();

      // Handle connection events for pub client
      this.pubClient.on('error', (err) => {
        this.logger.error('Redis pub client error:', err);
      });
      this.pubClient.on('connect', () => {
        this.logger.log('Redis pub client connected');
      });
      this.pubClient.on('reconnecting', () => {
        this.logger.warn('Redis pub client reconnecting');
      });

      // Handle connection events for sub client
      this.subClient.on('error', (err) => {
        this.logger.error('Redis sub client error:', err);
      });
      this.subClient.on('connect', () => {
        this.logger.log('Redis sub client connected');
      });
      this.subClient.on('reconnecting', () => {
        this.logger.warn('Redis sub client reconnecting');
      });

      await Promise.all([
        this.pubClient.connect().catch((err) => {
          throw new Error(`Failed to connect pub client: ${err.message}`);
        }),
        this.subClient.connect().catch((err) => {
          throw new Error(`Failed to connect sub client: ${err.message}`);
        }),
      ]);

      this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
      throw new Error(`Redis connection failed: ${error.message}`);
    }
  }

  async close(): Promise<void> {
    this.isShuttingDown = true;
    try {
      const closePromises = [];

      if (this.pubClient) {
        closePromises.push(
          this.pubClient.quit().catch((err) => {
            this.logger.error('Error closing pub client:', err);
          }),
        );
      }

      if (this.subClient) {
        closePromises.push(
          this.subClient.quit().catch((err) => {
            this.logger.error('Error closing sub client:', err);
          }),
        );
      }

      await Promise.all(closePromises);
      this.logger.log('Redis connections closed successfully');
    } catch (error) {
      this.logger.error('Error while closing Redis connections:', error);
      throw new Error(`Failed to close Redis connections: ${error.message}`);
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    try {
      const server = super.createIOServer(port, options);

      if (!this.adapterConstructor) {
        throw new Error(
          'Redis adapter is not initialized (call connectToRedis first)',
        );
      }

      server.adapter(this.adapterConstructor);

      server.engine.on('connection_error', (err) => {
        this.logger.error('Socket.IO connection error:', err);
      });

      return server;
    } catch (error) {
      this.logger.error('Failed to create Socket.IO server:', error);
      throw new Error(`Socket.IO server creation failed: ${error.message}`);
    }
  }
}
