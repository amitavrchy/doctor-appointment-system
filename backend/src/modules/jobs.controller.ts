import { Controller, Get, Post, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { JobsService } from './jobs.service';
@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private jobs: JobsService) {}
  private admin(actor: Actor) {
    if (actor.globalRole !== 'SUPER_ADMIN')
      throw new ForbiddenException('Platform administrator required');
  }
  @Get() get(@CurrentUser() actor: Actor) {
    this.admin(actor);
    return this.jobs.monitor();
  }
  @Post(':id/retry') retry(@CurrentUser() actor: Actor, @Param('id') id: string) {
    this.admin(actor);
    return this.jobs.retry(id);
  }
}
