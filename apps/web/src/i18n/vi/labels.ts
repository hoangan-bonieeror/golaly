import type { Messages } from "../types";

export const labels: Messages["labels"] = {
  role: { OWNER: "Chủ chuyến đi", EDITOR: "Người chỉnh sửa", VIEWER: "Người xem" },
  roleWithArticle: { OWNER: "chủ chuyến đi", EDITOR: "người chỉnh sửa", VIEWER: "người xem" },
  visibility: {
    PRIVATE: { label: "Riêng tư", hint: "Chỉ thành viên mới xem được chuyến đi này." },
    LINK_ONLY: { label: "Chỉ người có link", hint: "Ai có liên kết đều xem được. Không hiện trong Khám phá." },
    PUBLIC: { label: "Công khai", hint: "Hiện trong Khám phá, tìm kiếm và trang cá nhân của bạn." },
  },
  itemType: { PLACE: "Địa điểm", RESTAURANT: "Nhà hàng", HOTEL: "Khách sạn", FLIGHT: "Chuyến bay", TRANSPORTATION: "Di chuyển", ACTIVITY: "Hoạt động", NOTE: "Ghi chú" },
  travelerType: { SOLO: "Một mình", COUPLE: "Cặp đôi", FRIENDS: "Bạn bè", FAMILY: "Gia đình", ALL: "Đủ kiểu" },
  interest: { FOOD: "Ẩm thực", NATURE: "Thiên nhiên", BEACH: "Biển", CITY: "Thành phố", CULTURE: "Văn hoá", ADVENTURE: "Phiêu lưu", SHOPPING: "Mua sắm", PHOTOGRAPHY: "Nhiếp ảnh" },
  legMode: { Walk: "Đi bộ", Transit: "Xe công cộng", Drive: "Lái xe", Fly: "Bay" },
};
