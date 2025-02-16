import { NestFactory } from '@nestjs/core';
import { RedisIoAdapter } from './adapters/redis-io.adapter';
import { ChatModule } from './chat/chat.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ChatModule);

  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // TODO: Fix this later, for now use it this way
  app.enableCors({
    origin: '*',
  });

  const port = 3000;
  await app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}
bootstrap();
