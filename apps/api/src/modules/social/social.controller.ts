import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
  createCommentSchema,
  createPostSchema,
  createReportSchema,
  pageQuerySchema,
  updatePostSchema,
  type CreateReportInput,
} from "@triply/shared";
import { z } from "zod";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { SocialService } from "./social.service";

const Uuid = new ParseUUIDPipe();
const feedQuery = pageQuerySchema.extend({ mode: z.enum(["for-you", "following"]).default("for-you") });

@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Public()
  @Get("feed")
  feed(@ViewerId() me: string | null, @Query(new ZodPipe(feedQuery)) q: z.infer<typeof feedQuery>) {
    return this.social.feed(me, q.mode, q.cursor, q.limit);
  }

  @Post("posts")
  create(@ViewerId() me: string | null, @Body(new ZodPipe(createPostSchema)) body: z.infer<typeof createPostSchema>) {
    return this.social.create(requireUser(me), body);
  }

  @Get("posts/saved")
  saved(@ViewerId() me: string | null) {
    return this.social.savedPosts(requireUser(me));
  }

  @Public()
  @Get("posts/:id")
  get(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.get(id, me);
  }

  @Patch("posts/:id")
  update(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(updatePostSchema)) body: z.infer<typeof updatePostSchema>) {
    return this.social.update(id, requireUser(me), body);
  }

  @Delete("posts/:id")
  @HttpCode(200)
  remove(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.remove(id, requireUser(me));
  }

  @Post("posts/:id/like")
  like(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.setLiked(id, requireUser(me), true);
  }

  @Delete("posts/:id/like")
  unlike(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.setLiked(id, requireUser(me), false);
  }

  @Post("posts/:id/save")
  save(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.setSaved(id, requireUser(me), true);
  }

  @Delete("posts/:id/save")
  unsave(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.setSaved(id, requireUser(me), false);
  }

  @Public()
  @Get("posts/:id/comments")
  comments(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.comments(id, me);
  }

  @Post("posts/:id/comments")
  comment(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(createCommentSchema)) body: { body: string }) {
    return this.social.addComment(id, requireUser(me), body.body);
  }

  @Delete("comments/:id")
  @HttpCode(200)
  deleteComment(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.social.deleteComment(id, requireUser(me));
  }

  @Post("reports")
  report(@ViewerId() me: string | null, @Body(new ZodPipe(createReportSchema)) body: CreateReportInput) {
    return this.social.report(requireUser(me), body);
  }
}

@Module({ controllers: [SocialController], providers: [SocialService] })
export class SocialModule {}
