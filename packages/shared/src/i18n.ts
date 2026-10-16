/**
 * Languages TRIPLY's interface is available in, and the copy the API and the web share:
 * server messages (errors, validation) and notification sentences.
 *
 * Server messages are authored in English at the throw site (readable code, English logs) and
 * localised on the way out: the API's exception filter and the web's form validation both call
 * `localizeMessage`. Anything not in the table stays in English, so a missing entry degrades
 * gracefully instead of breaking.
 */
export const LOCALES = ["en", "vi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "triply-locale";
/** Header the web sends with every API call (Accept-Language stays for place-name language). */
export const LOCALE_HEADER = "x-triply-locale";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", vi: "Tiếng Việt" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** First supported language in an Accept-Language header ("vi-VN,vi;q=0.9,en;q=0.8" → "vi"). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const tags = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { base: (tag ?? "").split("-")[0], q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((t) => t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return tags.map((t) => t.base).find(isLocale) ?? DEFAULT_LOCALE;
}

// ── Server messages ────────────────────────────────────────────────────────

const VI_EXACT: Record<string, string> = {
  // Generic (exception filter fallbacks)
  "That request didn't look right.": "Yêu cầu này có vẻ không hợp lệ.",
  "Please log in to continue.": "Vui lòng đăng nhập để tiếp tục.",
  "You don't have permission to do that.": "Bạn không có quyền làm việc này.",
  "We couldn't find that.": "Không tìm thấy nội dung này.",
  "That conflicts with something that already exists.": "Nội dung này trùng với một mục đã có.",
  "That file is too large.": "Tệp quá lớn.",
  "Some fields need attention.": "Một vài trường cần được sửa.",
  "You're doing that a bit too fast. Please wait a moment and try again.": "Bạn thao tác hơi nhanh. Vui lòng đợi một chút rồi thử lại.",
  "Something went wrong. Please try again.": "Đã có lỗi xảy ra. Vui lòng thử lại.",
  "You no longer have permission to edit this trip.": "Bạn không còn quyền chỉnh sửa chuyến đi này.",
  "Request blocked for your security. Please refresh the page and try again.": "Yêu cầu bị chặn để bảo vệ bạn. Hãy tải lại trang rồi thử lại.",

  // Auth & account
  "That email and password don't match.": "Email và mật khẩu không khớp.",
  "An account with that email already exists.": "Đã có tài khoản dùng email này.",
  "That username is taken.": "Tên người dùng này đã có người dùng.",
  "Your current password isn't right.": "Mật khẩu hiện tại không đúng.",
  "That password isn't right.": "Mật khẩu không đúng.",
  "Type your username exactly to confirm.": "Hãy gõ chính xác tên người dùng của bạn để xác nhận.",
  "This confirmation link has expired. Send yourself a new one from the app.": "Liên kết xác nhận đã hết hạn. Hãy gửi lại liên kết mới từ ứng dụng.",
  "This reset link has expired. Request a new one.": "Liên kết đặt lại mật khẩu đã hết hạn. Hãy yêu cầu liên kết mới.",
  "Enter a valid email address.": "Hãy nhập một địa chỉ email hợp lệ.",
  "Enter your password.": "Hãy nhập mật khẩu.",
  "Use at least 8 characters for your password.": "Mật khẩu cần ít nhất 8 ký tự.",
  "That password is too easy to guess. Try a few unrelated words.": "Mật khẩu này quá dễ đoán. Hãy thử ghép vài từ không liên quan.",
  "Don't use your username or email in your password.": "Đừng dùng tên người dùng hoặc email trong mật khẩu.",
  "This password has appeared in a data breach, so attackers try it first. Choose a different one.":
    "Mật khẩu này đã từng bị lộ trong một vụ rò rỉ dữ liệu nên sẽ bị thử đầu tiên. Hãy chọn mật khẩu khác.",
  "Passwords are limited to 128 characters.": "Mật khẩu tối đa 128 ký tự.",
  "Usernames are 3–24 characters: letters, numbers, dots or underscores.": "Tên người dùng dài 3–24 ký tự, gồm chữ, số, dấu chấm hoặc gạch dưới.",
  "Display name can't be empty.": "Tên hiển thị không được để trống.",
  "Bio is limited to 160 characters.": "Giới thiệu tối đa 160 ký tự.",
  "You can't follow yourself.": "Bạn không thể tự theo dõi chính mình.",

  // Trips & itinerary
  "Give your trip a name (at least 2 characters).": "Hãy đặt tên cho chuyến đi (ít nhất 2 ký tự).",
  "Each destination can only be added once.": "Mỗi điểm đến chỉ được thêm một lần.",
  "End date can't be before the start date.": "Ngày kết thúc không được trước ngày bắt đầu.",
  "End time should be after the start time.": "Giờ kết thúc phải sau giờ bắt đầu.",
  "Use the format YYYY-MM-DD.": "Dùng định dạng YYYY-MM-DD.",
  "Use the format HH:mm.": "Dùng định dạng HH:mm.",
  "Add a title for this item.": "Hãy thêm tiêu đề cho mục này.",
  "A trip needs at least one day.": "Chuyến đi cần ít nhất một ngày.",
  "Items can only move within the same trip.": "Chỉ có thể di chuyển mục trong cùng một chuyến đi.",
  "One of those destinations doesn't exist.": "Một trong các điểm đến không tồn tại.",
  "This trip is private.": "Chuyến đi này ở chế độ riêng tư.",
  "Only the trip owner can do that.": "Chỉ chủ chuyến đi mới làm được việc này.",
  "Only trip members can see who's on this trip.": "Chỉ thành viên mới xem được ai tham gia chuyến đi.",
  "Private trips can't be saved — you're already a member.": "Không thể lưu chuyến đi riêng tư — bạn đã là thành viên.",
  "This is already your trip.": "Đây đã là chuyến đi của bạn.",
  "Only public trips can be remixed.": "Chỉ có thể remix chuyến đi công khai.",
  "The creator hasn't allowed remixing this trip.": "Người tạo không cho phép remix chuyến đi này.",
  "You can only share your own trips.": "Bạn chỉ có thể chia sẻ chuyến đi của chính mình.",
  "Make the trip Public or Link-only before sharing it.": "Hãy chuyển chuyến đi sang Công khai hoặc Chỉ người có link trước khi chia sẻ.",
  "Make the trip Public or Link-only before publishing this post.": "Hãy chuyển chuyến đi sang Công khai hoặc Chỉ người có link trước khi đăng bài này.",
  "Upload the cover photo first.": "Hãy tải ảnh bìa lên trước.",
  "That location is out of range.": "Vị trí nằm ngoài phạm vi cho phép.",
  "Use “lat,lng”.": "Dùng định dạng “vĩ độ,kinh độ”.",

  // Members & invitations
  "That person already has a pending invite.": "Người này đã có lời mời đang chờ.",
  "That person is already on this trip.": "Người này đã ở trong chuyến đi.",
  "The owner's role can't be changed.": "Không thể đổi vai trò của chủ chuyến đi.",
  "The owner can't be removed.": "Không thể xoá chủ chuyến đi.",
  "Owners can't leave their own trip — delete it instead.": "Chủ chuyến đi không thể rời chuyến — hãy xoá chuyến đi thay vào đó.",
  "This invitation has already been used.": "Lời mời này đã được sử dụng.",
  "This invitation has expired.": "Lời mời này đã hết hạn.",
  "This invitation was cancelled by the trip owner.": "Chủ chuyến đi đã huỷ lời mời này.",
  "This invitation was sent to a different email address. Log in with that account to accept it.":
    "Lời mời này được gửi tới một email khác. Hãy đăng nhập bằng tài khoản đó để chấp nhận.",
  "Confirm your email address first — we sent you a link when you signed up. Then open this invitation again.":
    "Hãy xác nhận email trước — chúng tôi đã gửi liên kết khi bạn đăng ký. Sau đó mở lại lời mời này.",

  // Social, photos, places
  "Give your post a title.": "Hãy đặt tiêu đề cho bài viết.",
  "Write something first.": "Hãy viết gì đó trước đã.",
  "Comments are limited to 1,000 characters.": "Bình luận tối đa 1.000 ký tự.",
  "Comments are turned off for this trip.": "Chuyến đi này đã tắt bình luận.",
  "You can't comment on a draft.": "Không thể bình luận bài nháp.",
  "You can only delete your own comments.": "Bạn chỉ có thể xoá bình luận của mình.",
  "You can only delete your own posts.": "Bạn chỉ có thể xoá bài viết của mình.",
  "You can only edit your own posts.": "Bạn chỉ có thể sửa bài viết của mình.",
  "Upload the photo first.": "Hãy tải ảnh lên trước.",
  "Upload your photos first.": "Hãy tải ảnh lên trước.",
  "Choose a photo to upload.": "Hãy chọn một ảnh để tải lên.",
  "That photo isn't in that post.": "Ảnh này không thuộc bài viết đó.",
  "That photo is already on this place.": "Ảnh này đã có ở địa điểm này.",
  "That file isn't a valid image.": "Tệp này không phải ảnh hợp lệ.",
  "Use a JPEG, PNG or WebP image.": "Hãy dùng ảnh JPEG, PNG hoặc WebP.",
  "Confirm your email address to share photos on place pages.": "Hãy xác nhận email để chia sẻ ảnh trên trang địa điểm.",
  "That place doesn't exist or has closed.": "Địa điểm này không tồn tại hoặc đã đóng cửa.",
  "That place was merged into another one; edit that one instead.": "Địa điểm này đã được gộp vào một địa điểm khác; hãy sửa địa điểm đó.",
  "That page link is invalid.": "Liên kết trang không hợp lệ.",
  "Unknown category.": "Danh mục không xác định.",

  // Directions
  "Directions aren't set up on this server.": "Máy chủ này chưa bật tính năng chỉ đường.",
  "No route found between these points. You may be too far from a road or path.": "Không tìm thấy đường giữa hai điểm này. Có thể bạn đang ở quá xa đường đi.",
  "That's too far for this way of travelling. Try another mode.": "Quãng đường quá xa cho cách di chuyển này. Hãy thử cách khác.",
  "The directions service is busy. Try again in a minute.": "Dịch vụ chỉ đường đang bận. Hãy thử lại sau một phút.",
  "Couldn't reach the directions service. Try again.": "Không kết nối được dịch vụ chỉ đường. Hãy thử lại.",

  // Flexible plans: pool, votes, members' dates
  "That place is already in the pool.": "Địa điểm này đã có trong kho ý tưởng.",
  "Notes belong on a day; the pool is for places and activities.": "Ghi chú thuộc về một ngày; kho ý tưởng dành cho địa điểm và hoạt động.",
  "Pool ideas can't be duplicated; plan it into a day first.": "Không thể nhân bản ý tưởng trong kho; hãy xếp nó vào một ngày trước.",
  "Only the trip owner can change other members' dates.": "Chỉ chủ chuyến đi mới đổi được ngày của thành viên khác.",
  "The leaving date should be on or after the arrival date.": "Ngày rời đi phải cùng hoặc sau ngày đến.",

  // After the trip: what happened, photos, expenses
  "Some of those items aren't on this trip any more. Refresh and try again.": "Một vài mục không còn trong chuyến đi này. Hãy tải lại rồi thử lại.",
  "Only people on this trip can be going.": "Chỉ những người trong chuyến đi mới có thể được chọn.",
  "Use an HH:mm time.": "Nhập giờ theo dạng HH:mm.",
  "Use a YYYY-MM-DD date.": "Nhập ngày theo dạng YYYY-MM-DD.",
  "That photo is already on this stop.": "Ảnh này đã có ở điểm dừng này.",
  "Only whoever added a photo, or the trip owner, can remove it.": "Chỉ người đã thêm ảnh hoặc chủ chuyến đi mới xoá được ảnh.",
  "Everyone on an expense has to be on the trip.": "Mọi người trong khoản chi đều phải là thành viên chuyến đi.",
  "Choose who shares it.": "Hãy chọn những người cùng chia.",
  "Say what it was for.": "Hãy ghi khoản chi này cho việc gì.",
  "Enter an amount above zero.": "Hãy nhập số tiền lớn hơn 0.",
  "That amount is too large.": "Số tiền quá lớn.",
  "Amounts are whole numbers of the currency's smallest unit.": "Số tiền phải là số nguyên theo đơn vị nhỏ nhất của tiền tệ.",
  "Each person can only appear once.": "Mỗi người chỉ xuất hiện một lần.",
  "The shares have to add up to the total.": "Tổng các phần phải bằng số tiền của khoản chi.",
  "Choose two different people.": "Hãy chọn hai người khác nhau.",
  "Pick a currency from the list.": "Hãy chọn một loại tiền trong danh sách.",
  "The currency can't change once expenses are recorded.": "Không đổi được loại tiền khi chuyến đi đã có khoản chi.",
  "That stop isn't on this trip.": "Điểm dừng này không thuộc chuyến đi.",
  "Only whoever added or paid an expense, or the trip owner, can change it.": "Chỉ người đã thêm hoặc đã trả khoản chi, hoặc chủ chuyến đi, mới sửa được.",
  "Both people have to be on the trip.": "Cả hai người đều phải là thành viên chuyến đi.",
  "Only the two people involved, or the trip owner, can undo a repayment.": "Chỉ hai người liên quan hoặc chủ chuyến đi mới huỷ được khoản trả lại.",
  "Confirm your e-mail address before inviting people by e-mail — or share an invite link.": "Hãy xác nhận email của bạn trước khi mời qua email — hoặc chia sẻ link mời.",
  "You've sent a lot of e-mail invitations today. Share an invite link instead, or try again tomorrow.": "Hôm nay bạn đã gửi rất nhiều lời mời qua email. Hãy chia sẻ link mời, hoặc thử lại vào ngày mai.",
  "That address has had enough invitations today. Try again tomorrow.": "Địa chỉ này đã nhận đủ lời mời trong hôm nay. Hãy thử lại vào ngày mai.",
  "Too many wrong passwords. You've been signed out of this device.": "Nhập sai mật khẩu quá nhiều lần. Bạn đã bị đăng xuất khỏi thiết bị này.",
  "Only the person paying, the person paid, or the trip owner can record a repayment.": "Chỉ người trả, người nhận hoặc chủ chuyến đi mới ghi được khoản trả lại.",
};

/** `${what} couldn't be found.` — by subject. */
const VI_NOT_FOUND: Record<string, string> = {
  That: "Không tìm thấy nội dung này.",
  "That trip": "Không tìm thấy chuyến đi này.",
  "That day": "Không tìm thấy ngày này.",
  "That item (someone may have removed it)": "Không tìm thấy mục này (có thể ai đó đã xoá).",
  "That member": "Không tìm thấy thành viên này.",
  "That invitation": "Không tìm thấy lời mời này.",
  "That post": "Không tìm thấy bài viết này.",
  "That comment": "Không tìm thấy bình luận này.",
  "That photo": "Không tìm thấy ảnh này.",
  "That place": "Không tìm thấy địa điểm này.",
  "That destination": "Không tìm thấy điểm đến này.",
  "That traveler": "Không tìm thấy người dùng này.",
  "That content": "Không tìm thấy nội dung này.",
  "That area": "Không tìm thấy khu vực này.",
  "That expense": "Không tìm thấy khoản chi này.",
  "That repayment": "Không tìm thấy khoản trả lại này.",
};

const VI_PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^(.+) couldn't be found\.$/, (_, what) => VI_NOT_FOUND[what] ?? "Không tìm thấy nội dung này."],
  [/^Too many failed attempts\. Try again in (\d+) minutes?, or reset your password\.$/, (_, n) => `Đăng nhập sai quá nhiều lần. Hãy thử lại sau ${n} phút, hoặc đặt lại mật khẩu.`],
  [/^Trips can be up to (\d+) days long\.$/, (_, n) => `Chuyến đi dài tối đa ${n} ngày.`],
  [/^Day (\d+)(?: and (\d+) more)? still has plans\. Move or delete them before shortening the trip\.$/, (_, d, more) =>
    `Ngày ${d}${more ? ` và ${more} ngày khác` : ""} vẫn còn lịch trình. Hãy chuyển hoặc xoá trước khi rút ngắn chuyến đi.`],
  [/^A trip's pool holds up to (\d+) ideas\. Plan some into days or remove a few first\.$/, (_, n) => `Kho ý tưởng của một chuyến đi chứa tối đa ${n} mục. Hãy xếp bớt vào các ngày hoặc xoá vài mục trước.`],
  [/^A stop can have up to (\d+) photos\.$/, (_, n) => `Mỗi điểm dừng có tối đa ${n} ảnh.`],
  [/^A trip can have up to (\d+) expenses\.$/, (_, n) => `Mỗi chuyến đi có tối đa ${n} khoản chi.`],
  [/^Photos can be up to (\d+) MB\.$/, (_, n) => `Ảnh tối đa ${n} MB.`],
  [/^Images need to be at least (\d+)×(\d+) pixels\.$/, (_, a, b) => `Ảnh cần ít nhất ${a}×${b} pixel.`],
  [/^Images can be at most (\d+) pixels on a side and ([\d.]+) megapixels\.$/, (_, a, b) => `Ảnh tối đa ${a} pixel mỗi cạnh và ${b} megapixel.`],
  [/^You've uploaded (\d+) photos today — that's the daily limit\. Try again tomorrow\.$/, (_, n) => `Hôm nay bạn đã tải lên ${n} ảnh — đó là giới hạn mỗi ngày. Hãy thử lại vào ngày mai.`],
  [/^You've shared (\d+) place photos today — that's the daily limit\.$/, (_, n) => `Hôm nay bạn đã chia sẻ ${n} ảnh địa điểm — đó là giới hạn mỗi ngày.`],
  [
    /^You've reached today's limit of (\d+) (posts|comments|reports)\. (Try again tomorrow|Confirm your email to raise it)\.$/,
    (_, n, what, tail) =>
      `Bạn đã đạt giới hạn ${n} ${{ posts: "bài viết", comments: "bình luận", reports: "báo cáo" }[what as "posts"]} hôm nay. ${tail === "Try again tomorrow" ? "Hãy thử lại vào ngày mai." : "Xác nhận email để được tăng giới hạn."}`,
  ],
];

/** A server/validation message in the given language (English when there's no translation). */
export function localizeMessage(message: string, locale: Locale): string {
  if (locale === "en" || !message) return message;
  const exact = VI_EXACT[message];
  if (exact) return exact;
  for (const [re, fn] of VI_PATTERNS) {
    const m = message.match(re);
    if (m) return fn(...m);
  }
  return message;
}

// ── Notifications ──────────────────────────────────────────────────────────

/**
 * What a notification says, stored as data so each reader sees it in their own language.
 * The sentence follows the actor's name: "Minh · added “Ramen” to Day 2 of Japan".
 */
export type NotificationMessage =
  | { k: "follow" }
  | { k: "like"; post: string }
  | { k: "comment"; post: string }
  | { k: "trip_saved"; trip: string }
  | { k: "trip_forked"; trip: string }
  | { k: "item_added"; item: string; day: number; trip: string }
  | { k: "pool_added"; item: string; trip: string }
  | { k: "item_updated"; item: string; trip: string }
  | { k: "invited"; role: "EDITOR" | "VIEWER"; trip: string }
  | { k: "joined"; role: "EDITOR" | "VIEWER"; trip: string }
  | { k: "role_changed"; role: "EDITOR" | "VIEWER"; trip: string };

export function notificationText(m: NotificationMessage, locale: Locale): string {
  if (locale === "vi") {
    const role = "role" in m ? (m.role === "EDITOR" ? "Người chỉnh sửa" : "Người xem") : "";
    switch (m.k) {
      case "follow": return "đã bắt đầu theo dõi bạn";
      case "like": return `đã thích bài viết ${m.post} của bạn`;
      case "comment": return `đã bình luận về ${m.post}`;
      case "trip_saved": return `đã lưu chuyến đi ${m.trip} của bạn`;
      case "trip_forked": return `đã remix chuyến đi ${m.trip} của bạn`;
      case "item_added": return `đã thêm “${m.item}” vào Ngày ${m.day} của ${m.trip}`;
      case "pool_added": return `đã gợi ý “${m.item}” cho ${m.trip}`;
      case "item_updated": return `đã cập nhật “${m.item}” trong ${m.trip}`;
      case "invited": return `đã mời bạn ${m.role === "EDITOR" ? "cùng lên kế hoạch" : "xem"} ${m.trip}`;
      case "joined": return `đã tham gia ${m.trip} với vai trò ${role}`;
      case "role_changed": return `đã đặt bạn làm ${role} trong ${m.trip}`;
    }
  }
  const role = "role" in m ? (m.role === "EDITOR" ? "an Editor" : "a Viewer") : "";
  switch (m.k) {
    case "follow": return "started following you";
    case "like": return `liked your post ${m.post}`;
    case "comment": return `commented on ${m.post}`;
    case "trip_saved": return `saved your trip ${m.trip}`;
    case "trip_forked": return `remixed your trip ${m.trip}`;
    case "item_added": return `added “${m.item}” to Day ${m.day} of ${m.trip}`;
    case "pool_added": return `suggested “${m.item}” for ${m.trip}`;
    case "item_updated": return `updated “${m.item}” in ${m.trip}`;
    case "invited": return `invited you to ${m.role === "EDITOR" ? "edit" : "view"} ${m.trip}`;
    case "joined": return `joined ${m.trip} as ${role}`;
    case "role_changed": return `made you ${role} on ${m.trip}`;
  }
}
