/** Interface language: localised errors, the account's saved language, notifications and emails per reader. */
import { MailService } from "../src/modules/mail/mail";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const VI = { "X-Triply-Locale": "vi" };

describe("interface language", () => {
  it("answers errors and field messages in the requested language; English stays the default", async () => {
    const bad = { email: "not-an-email", username: "x", password: "short" };
    const en = await t.anon().post("/auth/register", bad);
    expect(en.status).toBe(422);
    expect(en.body.fields.email).toBe("Enter a valid email address.");

    const vi = await t.anon().post("/auth/register", bad).set(VI);
    expect(vi.status).toBe(422);
    expect(vi.body.fields.email).toBe("Hãy nhập một địa chỉ email hợp lệ.");
    expect(vi.body.fields.password).toBe("Mật khẩu cần ít nhất 8 ký tự.");
    expect(vi.body.message).toBe(vi.body.fields.email);

    // Without the header, Accept-Language decides; templated messages are translated too.
    const missing = await t.anon().get("/trips/00000000-0000-4000-8000-000000000000").set("Accept-Language", "vi-VN,vi;q=0.9");
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("Không tìm thấy chuyến đi này.");
  });

  it("saves the language on the account and rejects unsupported ones", async () => {
    const u = await t.register("lang");
    expect((await u.get("/users/me")).body.locale).toBeNull();
    const r = await u.patch("/users/me", { locale: "vi" });
    expect(r.status).toBe(200);
    expect(r.body.locale).toBe("vi");
    expect((await u.patch("/users/me", { locale: "fr" })).status).toBe(422);
  });

  it("builds each notification in the reader's language from stored data", async () => {
    const a = await t.register("ntfa");
    const b = await t.register("ntfb");
    expect((await a.post(`/users/${b.username}/follow`)).status).toBeLessThan(300);
    const en = (await b.get("/notifications")).body.items[0];
    expect(en.text).toBe("started following you");
    const vi = (await b.get("/notifications").set(VI)).body.items[0];
    expect(vi.text).toBe("đã bắt đầu theo dõi bạn");
  });

  it("seeded notifications are stored as messages too", async () => {
    const an = await t.as("an@triply.dev");
    const texts = (await an.get("/notifications").set(VI)).body.items.map((n: { text: string }) => n.text);
    expect(texts).toContain("đã bắt đầu theo dõi bạn");
    expect(texts).toContain("đã thêm “teamLab Planets” vào Ngày 2 của Japan — 7 Days");
  });

  it("writes emails in the recipient's saved language", async () => {
    const mail = t.app.get(MailService);
    const sent = jest.spyOn(mail, "send").mockResolvedValue(undefined);
    try {
      const u = await t.register("mailvi");
      await u.patch("/users/me", { locale: "vi" });
      // The request itself is English: the account's language wins.
      expect((await t.anon().post("/auth/forgot-password", { email: u.email })).status).toBeLessThan(300);
      const msg = sent.mock.calls.at(-1)![0];
      expect(msg.subject).toBe("Đặt lại mật khẩu TRIPLY");
      expect(msg.text).toContain("/reset-password?token=");
    } finally {
      sent.mockRestore();
    }
  });
});
