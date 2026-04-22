import { Module } from '@nestjs/common';
import { ItilController } from './itil.controller';
import { ItilService } from './itil.service';

@Module({ controllers: [ItilController], providers: [ItilService] })
export class ItilModule {}
