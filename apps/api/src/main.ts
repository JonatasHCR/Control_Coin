import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter.js';
import { MoneyInterceptor } from './common/interceptors/money.interceptor.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new DomainExceptionFilter());
  app.useGlobalInterceptors(new MoneyInterceptor());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(JSON.stringify({ msg: 'api.listening', port }));
}

void bootstrap();
