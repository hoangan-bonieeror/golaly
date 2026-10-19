import { DirectionsModule } from "./modules/directions/directions";
import { ExpensesModule } from "./modules/expenses/expenses";
import { NextModule } from "./modules/next/next";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { ClientIpThrottlerGuard } from "./common/client-ip";
import { AuthGuard, Public } from "./common/auth";
import { AllExceptionsFilter } from "./common/http";
import { env } from "./config/env";
import { PrismaModule, PrismaService } from "./prisma/prisma.service";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit";
import { ProductEventsModule } from "./modules/activity/product-events";
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

/**
 * `GET /health` — the process is up. No database query: the host's health checks (every few seconds) and uptime
 * pings would otherwise keep a serverless database from ever scaling to zero, using up its free compute hours.
 * `GET /health/db` — also checks the database (after a deploy, or by hand).
 */
@Controller("health")
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  health() {
    return { status: "ok" };
  }

  @Public()
  @Get("db")
  async db() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", db: "ok" };
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
    ProductEventsModule,
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
    NextModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
