import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import {
  itemAssigneesSchema,
  type ItemAssigneesInput,
  createItemSchema,
  reorderItemSchema,
  updateDaySchema,
  updateItemSchema,
  voteSchema,
  itemPhotoSchema,
  itemStatusBatchSchema,
  type CreateItemInput,
  type ItemStatusBatchInput,
  type ReorderItemInput,
  type UpdateItemInput,
  type VoteInput,
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

  /** The trip's place pool: ideas not yet on a day. */
  @Public()
  @Get("trips/:id/pool")
  pool(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.svc.pool(id, me);
  }

  @Post("trips/:id/pool")
  addToPool(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(createItemSchema)) body: CreateItemInput) {
    return this.svc.addToPool(id, requireUser(me), body);
  }

  @Patch("trips/:id/items/status")
  setStatuses(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(itemStatusBatchSchema)) body: ItemStatusBatchInput) {
    return this.svc.setStatuses(id, requireUser(me), body);
  }

  @Put("items/:id/assignees")
  setAssignees(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(itemAssigneesSchema)) body: ItemAssigneesInput) {
    return this.svc.setAssignees(id, requireUser(me), body);
  }

  @Post("items/:itemId/photos")
  addPhoto(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null, @Body(new ZodPipe(itemPhotoSchema)) body: { mediaId: string }) {
    return this.svc.addPhoto(itemId, requireUser(me), body.mediaId);
  }

  @Delete("item-photos/:photoId")
  @HttpCode(200)
  removePhoto(@Param("photoId", Uuid) photoId: string, @ViewerId() me: string | null) {
    return this.svc.removePhoto(photoId, requireUser(me));
  }

  @Put("items/:itemId/vote")
  vote(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null, @Body(new ZodPipe(voteSchema)) body: VoteInput) {
    return this.svc.vote(itemId, requireUser(me), body.level);
  }

  @Delete("items/:itemId/vote")
  @HttpCode(200)
  unvote(@Param("itemId", Uuid) itemId: string, @ViewerId() me: string | null) {
    return this.svc.unvote(itemId, requireUser(me));
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
