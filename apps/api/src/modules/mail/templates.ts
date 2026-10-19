import type { Locale } from "@triply/shared";

/**
 * Transactional email copy, in the recipient's interface language (their saved choice, else the
 * language of the request that triggered the email). Plain text on purpose: it renders everywhere.
 */
type Mail = { subject: string; text: string };

export const mails = {
  verifyEmail(locale: Locale, url: string): Mail {
    return locale === "vi"
      ? {
          subject: "Xác nhận email Golaly của bạn",
          text: `Chào mừng bạn đến với Golaly! Hãy xác nhận đây là email của bạn bằng cách mở liên kết này trong vòng 48 giờ:\n\n${url}\n\nNếu bạn không tạo tài khoản, hãy bỏ qua email này.`,
        }
      : {
          subject: "Confirm your Golaly email",
          text: `Welcome to Golaly! Confirm this is your email address by opening this link within 48 hours:\n\n${url}\n\nIf you didn't create an account, you can ignore this email.`,
        };
  },

  resetPassword(locale: Locale, url: string): Mail {
    return locale === "vi"
      ? {
          subject: "Đặt lại mật khẩu Golaly",
          text: `Ai đó vừa yêu cầu đặt lại mật khẩu Golaly của bạn. Nếu đó là bạn, hãy mở liên kết này trong vòng 30 phút:\n\n${url}\n\nNếu không phải bạn, hãy bỏ qua email này.`,
        }
      : {
          subject: "Reset your Golaly password",
          text: `Someone asked to reset your Golaly password. If it was you, open this link within 30 minutes:\n\n${url}\n\nIf it wasn't you, you can ignore this email.`,
        };
  },

  invitation(locale: Locale, p: { inviter: string; trip: string; role: "EDITOR" | "VIEWER"; url: string }): Mail {
    return locale === "vi"
      ? {
          subject: `${p.inviter} mời bạn tham gia “${p.trip}” trên Golaly`,
          text: `${p.inviter} mời bạn ${p.role === "EDITOR" ? "cùng lên kế hoạch" : "xem"} “${p.trip}”.\n\nMở lời mời (hiệu lực 7 ngày):\n${p.url}\n`,
        }
      : {
          subject: `${p.inviter} invited you to “${p.trip}” on Golaly`,
          text: `${p.inviter} invited you to ${p.role === "EDITOR" ? "help plan" : "view"} “${p.trip}”.\n\nOpen the invitation (valid for 7 days):\n${p.url}\n`,
        };
  },
};
