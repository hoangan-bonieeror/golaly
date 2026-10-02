import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { changeRoleSchema, createInvitationSchema, type CreateInvitationInput } from "@triply/shared";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { Errors, ZodPipe } from "../../common/http";
import { TripsModule } from "../trips/trips.controller";
import { MembersService } from "./members.service";

const Uuid = new ParseUUIDPipe();
/** Tokens are opaque base64url strings; reject anything else before touching the DB. */
function tokenParam(token: string) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw Errors.notFound("That invitation");
  return { token };
}

@Controller()
export class MembersController {
  constructor(private readonly svc: MembersService) {}

  @Get("trips/:id/members")
  members(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.svc.members(id, requireUser(me));
  }

  @Post("trips/:id/invitations")
  invite(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(createInvitationSchema)) body: CreateInvitationInput) {
    return this.svc.invite(id, requireUser(me), body);
  }

  @Delete("trips/:id/invitations/:invitationId")
  @HttpCode(200)
  revoke(@Param("id", Uuid) id: string, @Param("invitationId", Uuid) invitationId: string, @ViewerId() me: string | null) {
    return this.svc.revoke(id, invitationId, requireUser(me));
  }

  @Patch("trips/:id/members/:userId")
  changeRole(
    @Param("id", Uuid) id: string,
    @Param("userId", Uuid) userId: string,
    @ViewerId() me: string | null,
    @Body(new ZodPipe(changeRoleSchema)) body: { role: "EDITOR" | "VIEWER" },
  ) {
    return this.svc.changeRole(id, userId, requireUser(me), body.role);
  }

  @Delete("trips/:id/members/:userId")
  @HttpCode(200)
  remove(@Param("id", Uuid) id: string, @Param("userId", Uuid) userId: string, @ViewerId() me: string | null) {
    return this.svc.remove(id, userId, requireUser(me));
  }

  // Invitation by id — for invitees arriving from an in-app notification (bound to their email).
  @Get("invitations/id/:invitationId")
  byId(@Param("invitationId", Uuid) invitationId: string, @ViewerId() me: string | null) {
    return this.svc.lookup({ id: invitationId }, requireUser(me));
  }

  @Post("invitations/id/:invitationId/accept")
  @HttpCode(200)
  acceptById(@Param("invitationId", Uuid) invitationId: string, @ViewerId() me: string | null) {
    return this.svc.accept({ id: invitationId }, requireUser(me));
  }

  @Post("invitations/id/:invitationId/reject")
  @HttpCode(200)
  rejectById(@Param("invitationId", Uuid) invitationId: string, @ViewerId() me: string | null) {
    return this.svc.reject({ id: invitationId }, requireUser(me));
  }

  // Invitation by token — invite links and emails (spec §16).
  @Public()
  @Get("invitations/:token")
  lookup(@Param("token") token: string, @ViewerId() me: string | null) {
    return this.svc.lookup(tokenParam(token), me);
  }

  @Post("invitations/:token/accept")
  @HttpCode(200)
  accept(@Param("token") token: string, @ViewerId() me: string | null) {
    return this.svc.accept(tokenParam(token), requireUser(me));
  }

  @Post("invitations/:token/reject")
  @HttpCode(200)
  reject(@Param("token") token: string, @ViewerId() me: string | null) {
    return this.svc.reject(tokenParam(token), requireUser(me));
  }
}

@Module({ imports: [TripsModule], controllers: [MembersController], providers: [MembersService] })
export class MembersModule {}
