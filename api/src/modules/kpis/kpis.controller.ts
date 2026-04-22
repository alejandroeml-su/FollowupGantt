import { Controller, Get, Query } from '@nestjs/common';
import { KpisService } from './kpis.service';

@Controller('kpis')
export class KpisController {
  constructor(private readonly service: KpisService) {}
  @Get('summary') summary(@Query('project_id') p?: string) { return this.service.summary(p); }
}
