import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Res } from "@nestjs/common";
import { updateProfileSchema, type UpdateProfileInput } from "@triply/shared";
import type { Response } from "express";
import { z } from "zod";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { clearAuthCookies } from "../../common/cookies";
import { UsersService } from "./users.service";

const deleteAccountSchema = z.object({ password: z.string().min(1, "Enter your password to confirm.") });

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
  async remove(@ViewerId() me: string | null, @Body(new ZodPipe(deleteAccountSchema)) body: { password: string }, @Res({ passthrough: true }) res: Response) {
    await this.users.deleteAccount(requireUser(me), body.password);
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

  @Post(":handle/follow")
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
