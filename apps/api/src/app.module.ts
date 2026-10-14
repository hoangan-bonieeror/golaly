import { DirectionsModule } from "./modules/directions/directions";
import { ExpensesModule } from "./modules/expenses/expenses";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard, Public } from "./common/auth";
import { AllExceptionsFilter } from "./common/http";
import { env } from "./config/env";
import { PrismaModule, PrismaService } from "./prisma/prisma.service";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit";
import { TripEventsModule } from "./modules/activity/trip-events";
import { AuthModule } from "./modules/auth/auth.module";
import { ItineraryModule } from "./modules/itinerary/itinerary.controller";
import { MailModule } from "./modules/mail/mail";
import { MediaModule } from "./modules/media/media";
import { MembersModule } from "./modules/members/members.controller";
import { NotificationsModule } from "./modules/notifications/notifications";
import { RealtimeModule } from "./modules/realtime/realtime";
import { PlacesModule } from "./modules/places/places";
import { SearchModule } from "./modules/search/search";
import { SearchIndexModule } from "./modules/search/search-index";
import { SocialModule } from "./modules/social/social.controller";
import { TripsModule } from "./modules/trips/trips.controller";
import { UsersModule } from "./modules/users/users.controller";

@Controller("health")
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
}

@Module({
  imports: [
    JwtModule.register({ global: true, secret: env.JWT_SECRET }),
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: env.RATE_LIMIT_PER_MIN }]),
    PrismaModule,
    RealtimeModule,
    NotificationsModule,
    AuditModule,
    TripEventsModule,
    MailModule,
    SearchIndexModule,
    UsersModule,
    AuthModule,
    TripsModule,
    ItineraryModule,
    MembersModule,
    SearchModule,
    PlacesModule,
    SocialModule,
    MediaModule,
    AdminModule,
    DirectionsModule,
    ExpensesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
