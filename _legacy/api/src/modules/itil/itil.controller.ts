import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ItilService } from './itil.service';

@Controller('itil')
export class ItilController {
  constructor(private readonly service: ItilService) {}

  @Get('tickets') findAll() { return this.service.findAll(); }
  @Post('tickets') create(@Body() b: any) { return this.service.create(b); }
  @Patch('tickets/:id') update(@Param('id') id: string, @Body() b: any) { return this.service.update(id, b); }
  @Delete('tickets/:id') remove(@Param('id') id: string) { return this.service.remove(id); }
  @Get('sla-policies') sla() { return this.service.slaPolicies(); }
}
