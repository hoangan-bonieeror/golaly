import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import {
  createItemSchema,
  reorderItemSchema,
  updateDaySchema,
  updateItemSchema,
  type CreateItemInput,
  type ReorderItemInput,
  type UpdateItemInput,
} from "@triply/shared";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { TripsModule } from "../trips/trips.controller";
import { ItineraryService } from "./itinerary.service";

const Uuid = new ParseUUIDPipe();

@Controller()
export class ItineraryController {
  constructor(private readonly svc: ItineraryService) {}

  @Public()
  @Get("trips/:id/days")
  days(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.svc.days(id, me);
  }

  @Post("trips/:id/days")
  addDay(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.svc.addDay(id, requireUser(me));
  }

  @Patch("trips/:id/days/:dayId")
  updateDay(@Param("id", Uuid) id: string, @Param("dayId", Uuid) dayId: string, @ViewerId() me: string | null, @Body(new ZodPipe(updateDaySchema)) body: { title: string | null }) {
    return this.svc.updateDay(id, dayId, requireUser(me), body.title);
  }

  @Delete("trips/:id/days/:dayId")
  @HttpCode(200)
  deleteDay(@Param("id", Uuid) id: string, @Param("dayId", Uuid) dayId: string, @ViewerId() me: string | null) {
    return this.svc.deleteDay(id, dayId, requireUser(me));
  }

  @Post("days/:dayId/items")
  addItem(@Param("dayId", Uuid) dayId: string, @ViewerId() me: string | null, @Body(new ZodPipe(createItemSchema)) body: CreateItemInput) {
    return this.svc.addItem(dayId, requireUser(me), body);
  }

  @Patch("items/:itemId")
  updateItem(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null, @Body(new ZodPipe(updateItemSchema)) body: UpdateItemInput) {
    return this.svc.updateItem(itemId, requireUser(me), body);
  }

  @Delete("items/:itemId")
  @HttpCode(200)
  deleteItem(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null) {
    return this.svc.deleteItem(itemId, requireUser(me));
  }

  @Post("items/:itemId/duplicate")
  duplicate(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null) {
    return this.svc.duplicateItem(itemId, requireUser(me));
  }

  @Post("items/:itemId/reorder")
  @HttpCode(200)
  reorder(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null, @Body(new ZodPipe(reorderItemSchema)) body: ReorderItemInput) {
    return this.svc.reorder(itemId, requireUser(me), body);
  }
}

@Module({ imports: [TripsModule], controllers: [ItineraryController], providers: [ItineraryService], exports: [ItineraryService] })
export class ItineraryModule {}
