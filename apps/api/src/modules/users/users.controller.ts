import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Res } from "@nestjs/common";
import { updateProfileSchema, type UpdateProfileInput } from "@triply/shared";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser, Public, ViewerId, requireUser, type AuthUser } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { clearAuthCookies } from "../../common/cookies";
import { Throttle } from "@nestjs/throttler";
import { AUTH_LIMIT } from "../auth/auth";
import { UsersService } from "./users.service";

const deleteAccountSchema = z.object({ password: z.string().max(128).optional(), username: z.string().max(40).optional() });

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  me(@ViewerId() me: string | null) {
    return this.users.me(requireUser(me));
  }

  @Patch("me")
  update(@ViewerId() me: string | null, @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput) {
    return this.users.updateProfile(requireUser(me), body);
  }

  @Delete("me")
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async remove(@CurrentUser() user: AuthUser | null, @Body(new ZodPipe(deleteAccountSchema)) body: { password?: string; username?: string }, @Res({ passthrough: true }) res: Response) {
    await this.users.deleteAccount(requireUser(user?.id ?? null), body, user?.sessionId);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Public()
  @Get(":handle")
  profile(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.profile(handle, me);
  }

  @Public()
  @Get(":handle/trips")
  trips(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.trips(handle, me);
  }

  @Public()
  @Get(":handle/posts")
  posts(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.posts(handle, me);
  }

  @Public()
  @Get(":handle/followers")
  followers(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.followList(handle, "followers", me);
  }

  @Public()
  @Get(":handle/following")
  following(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.followList(handle, "following", me);
  }

  @Post(":handle/follow")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  follow(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.follow(requireUser(me), handle, true);
  }

  @Delete(":handle/follow")
  unfollow(@Param("handle") handle: string, @ViewerId() me: string | null) {
    return this.users.follow(requireUser(me), handle, false);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
