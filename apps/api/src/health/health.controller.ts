import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

/**
 * /health/ready failing on an unreachable database is deliberate: an app that
 * cannot answer correctly must take itself out of rotation rather than serve
 * wrong numbers (ARCH04).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('database unreachable');
    }
  }

  @Get('jobs')
  async jobs() {
    // The alert that matters fires on ABSENCE — a job silent for over a day.
    return this.prisma.$queryRaw`
      SELECT job_name, MAX(finished_at) AS last_success
        FROM job_run WHERE status = 'SUCCESS' GROUP BY job_name`;
  }
}
