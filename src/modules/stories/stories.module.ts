import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { EventsModule } from '@modules/events/events.module';
import { GigsModule } from '@modules/gigs/gigs.module';
import { MeetingsModule } from '@modules/meetings/meetings.module';
import { RewardsModule } from '@modules/rewards/rewards.module';
import { TestimonialsModule } from '@modules/testimonials/testimonials.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminStoriesController } from './controllers/admin-stories.controller';
import { AdminStoryDesignsController } from './controllers/admin-story-designs.controller';
import { AdminStoryTemplatesController } from './controllers/admin-story-templates.controller';
import { AdminStoryFestivalsController } from './controllers/admin-story-festivals.controller';
import { AdminStorySamplesController } from './controllers/admin-story-samples.controller';
import { StoriesController } from './controllers/stories.controller';
import { StoryDesignRepository } from './repositories/story-design.repository';
import { StoryTemplateRepository } from './repositories/story-template.repository';
import { StoryFestivalRepository } from './repositories/story-festival.repository';
import { StorySampleRepository } from './repositories/story-sample.repository';
import { StoryStatRepository } from './repositories/story-stat.repository';
import { StoryRepository } from './repositories/story.repository';
import { StoryDesign, StoryDesignSchema } from './schemas/story-design.schema';
import {
  StoryFestival,
  StoryFestivalSchema,
} from './schemas/story-festival.schema';
import { StorySample, StorySampleSchema } from './schemas/story-sample.schema';
import {
  StoryTemplateRow,
  StoryTemplateSchema,
} from './schemas/story-template.schema';
import { StoryStat, StoryStatSchema } from './schemas/story-stat.schema';
import { Story, StorySchema } from './schemas/story.schema';
import { AdminStoriesService } from './services/admin-stories.service';
import { StoriesService } from './services/stories.service';
import { StoryDesignsService } from './services/story-designs.service';
import { StoryTemplatesService } from './services/story-templates.service';
import { StoryFestivalsService } from './services/story-festivals.service';
import { StorySamplesService } from './services/story-samples.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Story.name, schema: StorySchema },
      { name: StoryStat.name, schema: StoryStatSchema },
      { name: StoryFestival.name, schema: StoryFestivalSchema },
      { name: StorySample.name, schema: StorySampleSchema },
      { name: StoryDesign.name, schema: StoryDesignSchema },
      { name: StoryTemplateRow.name, schema: StoryTemplateSchema },
    ]),
    AccessModule,
    AgentsModule,
    EventsModule,
    GigsModule,
    MeetingsModule,
    RewardsModule,
    TestimonialsModule,
    UploadsModule,
  ],
  controllers: [
    StoriesController,
    AdminStoriesController,
    AdminStoryFestivalsController,
    AdminStoryDesignsController,
    AdminStoryTemplatesController,
    AdminStorySamplesController,
  ],
  providers: [
    StoryRepository,
    StoryStatRepository,
    StoryFestivalRepository,
    StorySampleRepository,
    StoryDesignRepository,
    StoryTemplateRepository,
    StoriesService,
    StoryFestivalsService,
    StorySamplesService,
    StoryDesignsService,
    StoryTemplatesService,
    AdminStoriesService,
  ],
})
export class StoriesModule {}
