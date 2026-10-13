import type { Messages } from "../types";

export const home: Messages["home"] = {
  greeting: { morning: "Chào buổi sáng", afternoon: "Chào buổi chiều", evening: "Chào buổi tối" },
  greetingName: (greeting, name) => `${greeting}, ${name}`,
  title: "Tiếp theo đi đâu?",
  guestPitch: "Lên kế hoạch cùng bạn bè và remix lịch trình từ những người đi thật.",
  getStarted: "Bắt đầu",
  trendingDestinations: "Điểm đến thịnh hành",
  trending: "Thịnh hành",
  all: "Tất cả",
  feed: "Bảng tin",
  forYou: "Dành cho bạn",
  following: "Đang theo dõi",
  emptyFollowing: {
    title: "Chưa có gì ở đây",
    body: "Theo dõi những người có chuyến đi bạn thích, câu chuyện của họ sẽ hiện ở đây.",
    action: "Tìm người để theo dõi",
  },
  emptyForYou: { title: "Chia sẻ hành trình đầu tiên của bạn.", body: "Bài viết từ cộng đồng sẽ hiện ở đây.", action: "Bài viết mới" },
  recommendedTrips: "Chuyến đi gợi ý",
  continuePlanning: "Tiếp tục lên kế hoạch",
  destinationTbd: "Chưa chọn điểm đến",
};
