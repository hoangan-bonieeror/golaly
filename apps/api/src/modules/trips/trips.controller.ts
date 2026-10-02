import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { createTripSchema, updateTripSchema, type UpdateTripInput } from "@triply/shared";
import { z } from "zod";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { TripAccessService } from "./trip-access.service";
import { TripsService } from "./trips.service";

const listQuery = z.object({ filter: z.enum(["all", "mine", "shared", "past"]).default("all") });

@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  create(@ViewerId() me: string | null, @Body(new ZodPipe(createTripSchema)) body: z.infer<typeof createTripSchema>) {
    return this.trips.create(requireUser(me), body);
  }

  /** GET /trips — trips the viewer owns or is a member of. */
  @Get()
  list(@ViewerId() me: string | null, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.trips.mine(requireUser(me), q.filter);
  }

  @Get("saved")
  saved(@ViewerId() me: string | null) {
    return this.trips.saved(requireUser(me));
  }

  @Public()
  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.trips.detail(id, me);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(updateTripSchema)) body: UpdateTripInput) {
    return this.trips.update(id, requireUser(me), body);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    await this.trips.remove(id, requireUser(me));
    return { ok: true };
  }

  @Post(":id/fork")
  fork(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.trips.fork(id, requireUser(me));
  }

  @Post(":id/save")
  save(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.trips.setSaved(id, requireUser(me), true);
  }

  @Delete(":id/save")
  unsave(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.trips.setSaved(id, requireUser(me), false);
  }
}

@Module({ controllers: [TripsController], providers: [TripsService, TripAccessService], exports: [TripsService, TripAccessService] })
export class TripsModule {}
