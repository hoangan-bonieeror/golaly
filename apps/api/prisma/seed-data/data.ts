/**
 * ⚠️ DEVELOPMENT / DEMO DATA ONLY (spec §54).
 * Plain data consumed by ../seed.ts. Deterministic UUIDs keep demo URLs stable
 * across re-seeds. Never loaded in production (seed.ts refuses NODE_ENV=production).
 */
import type {
  Comment,
  Destination,
  ItineraryItem,
  ItineraryItemType,
  Notification,
  Place,
  Post,
  Trip,
  TripDay,
  TripInvitation,
  TripMember,
  User,
} from "@triply/shared";
import { seedId } from "./ids";

export interface DB {
  users: User[];
  follows: { followerId: string; followingId: string }[];
  destinations: Destination[];
  places: Place[];
  /** place id → TRIPLY category key (taxonomy). */
  placeCategories: Record<string, string>;
  trips: Trip[];
  members: TripMember[];
  invitations: TripInvitation[];
  days: TripDay[];
  items: ItineraryItem[];
  posts: Post[];
  comments: Comment[];
  likes: { userId: string; postId: string }[];
  savedTrips: { userId: string; tripId: string }[];
  savedPosts: { userId: string; postId: string }[];
  savedPlaces: { userId: string; placeId: string }[];
  notifications: Notification[];
  reports: { id: string; reporterId: string; target: string; targetId: string; reason: string; createdAt: string }[];
}

const u = (k: string) => seedId(`user:${k}`);
const d = (k: string) => seedId(`dest:${k}`);
const p = (k: string) => seedId(`place:${k}`);
const t = (k: string) => seedId(`trip:${k}`);

// Timestamps are relative to load time so the demo always looks "fresh".
const NOW = new Date().toISOString();
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * 3600_000).toISOString();

// ── Users ────────────────────────────────────────────────────────────────
const users: User[] = [
  { id: u("an"), username: "an.nguyen", displayName: "An", bio: "Plans the trip, carries the snacks. Pittsburg, CA ↔ Saigon.", avatarHue: 172, homeBase: "Pittsburg, CA", travelerType: "FRIENDS", interests: ["FOOD", "CITY", "PHOTOGRAPHY"] },
  { id: u("sarah"), username: "sarahwanders", displayName: "Sarah", bio: "Slow travel, street food, long train rides. 34 countries and counting.", avatarHue: 14, homeBase: "Lisbon", travelerType: "SOLO", interests: ["FOOD", "CULTURE", "NATURE"] },
  { id: u("minh"), username: "minh.tran", displayName: "Minh", bio: "Road trips > flights. Always the designated driver.", avatarHue: 210, homeBase: "San Jose, CA", travelerType: "FRIENDS", interests: ["ADVENTURE", "NATURE"] },
  { id: u("linh"), username: "linh.pham", displayName: "Linh", bio: "Café hopper & film camera person.", avatarHue: 330, homeBase: "Oakland, CA", travelerType: "COUPLE", interests: ["PHOTOGRAPHY", "SHOPPING"] },
  { id: u("nam"), username: "nam.le", displayName: "Nam", bio: "Here for the ramen.", avatarHue: 45, homeBase: "Sacramento, CA", travelerType: "FRIENDS", interests: ["FOOD"] },
];

// ── Destinations ─────────────────────────────────────────────────────────
const destinations: Destination[] = [
  { id: d("tokyo"), slug: "tokyo", name: "Tokyo", country: "Japan", lat: 35.68, lng: 139.76, blurb: "Neon nights, quiet shrines and the best convenience stores on earth.", palette: ["#1f3b73", "#e8657a"] },
  { id: d("kyoto"), slug: "kyoto", name: "Kyoto", country: "Japan", lat: 35.01, lng: 135.77, blurb: "Temples, tea houses and lantern-lit alleys.", palette: ["#5b2a3c", "#e7a35b"] },
  { id: d("osaka"), slug: "osaka", name: "Osaka", country: "Japan", lat: 34.69, lng: 135.5, blurb: "Japan's kitchen — eat until you drop.", palette: ["#2b2d42", "#ef8354"] },
  { id: d("hanoi"), slug: "hanoi", name: "Hanoi", country: "Vietnam", lat: 21.03, lng: 105.85, blurb: "Old Quarter chaos, egg coffee and lakeside mornings.", palette: ["#7a2e1f", "#f2b134"] },
  { id: d("halong"), slug: "ha-long-bay", name: "Hạ Long Bay", country: "Vietnam", lat: 20.91, lng: 107.18, blurb: "Limestone karsts rising out of emerald water.", palette: ["#0f5257", "#9fd8cb"] },
  { id: d("hoian"), slug: "hoi-an", name: "Hội An", country: "Vietnam", lat: 15.88, lng: 108.33, blurb: "Lanterns, tailors and riverside sunsets.", palette: ["#a4471f", "#f5cd5b"] },
  { id: d("saigon"), slug: "ho-chi-minh-city", name: "Ho Chi Minh City", country: "Vietnam", lat: 10.78, lng: 106.7, blurb: "Scooters, rooftop bars and the best bánh mì.", palette: ["#3d1e6d", "#f26b4e"] },
  { id: d("sf"), slug: "san-francisco", name: "San Francisco", country: "USA", lat: 37.77, lng: -122.42, blurb: "Fog, hills and sourdough.", palette: ["#1d3557", "#e76f51"] },
  { id: d("bigsur"), slug: "big-sur", name: "Big Sur", country: "USA", lat: 36.27, lng: -121.81, blurb: "Cliffs, redwoods and Highway 1.", palette: ["#264653", "#e9c46a"] },
  { id: d("la"), slug: "los-angeles", name: "Los Angeles", country: "USA", lat: 34.05, lng: -118.24, blurb: "Tacos, beaches and golden-hour everything.", palette: ["#6a2c70", "#f9a03f"] },
  { id: d("lisbon"), slug: "lisbon", name: "Lisbon", country: "Portugal", lat: 38.72, lng: -9.14, blurb: "Trams, tiles and pastel de nata.", palette: ["#1b4965", "#f4a259"] },
  { id: d("porto"), slug: "porto", name: "Porto", country: "Portugal", lat: 41.15, lng: -8.61, blurb: "Riverside port cellars and blue azulejos.", palette: ["#283d3b", "#c44536"] },
];

// ── Places ───────────────────────────────────────────────────────────────
type PlaceSeed = [key: string, name: string, cat: ItineraryItemType, dest: string, address: string, lat: number, lng: number, rating?: number];
const placeSeeds: PlaceSeed[] = [
  ["hnd", "Haneda Airport (HND)", "FLIGHT", "tokyo", "Ōta City, Tokyo", 35.5494, 139.7798],
  ["shinjuku-hotel", "Hotel Gracery Shinjuku", "HOTEL", "tokyo", "1-19-1 Kabukichō, Shinjuku", 35.6955, 139.7016, 4.4],
  ["ichiran", "Ichiran Shibuya", "RESTAURANT", "tokyo", "1-22-7 Jinnan, Shibuya", 35.6614, 139.7008, 4.5],
  ["shibuya", "Shibuya Crossing", "PLACE", "tokyo", "Shibuya City, Tokyo", 35.6595, 139.7005, 4.7],
  ["meiji", "Meiji Jingu", "PLACE", "tokyo", "1-1 Yoyogikamizonochō, Shibuya", 35.6764, 139.6993, 4.7],
  ["omoide", "Omoide Yokochō", "RESTAURANT", "tokyo", "1-2 Nishishinjuku, Shinjuku", 35.6933, 139.6996, 4.4],
  ["sensoji", "Sensō-ji", "PLACE", "tokyo", "2-3-1 Asakusa, Taitō", 35.7148, 139.7967, 4.6],
  ["teamlab", "teamLab Planets", "ACTIVITY", "tokyo", "6-1-16 Toyosu, Kōtō", 35.6491, 139.7898, 4.6],
  ["tsukiji", "Tsukiji Outer Market", "RESTAURANT", "tokyo", "4-16-2 Tsukiji, Chūō", 35.6654, 139.7707, 4.4],
  ["shinkansen", "Tokyo Station — Nozomi to Kyoto", "TRANSPORTATION", "tokyo", "Marunouchi, Chiyoda", 35.6812, 139.7671],
  ["fushimi", "Fushimi Inari Taisha", "PLACE", "kyoto", "68 Fukakusa Yabunouchichō, Fushimi", 34.9671, 135.7727, 4.8],
  ["arashiyama", "Arashiyama Bamboo Grove", "PLACE", "kyoto", "Sagaogurayama, Ukyō", 35.0170, 135.6713, 4.5],
  ["kinkakuji", "Kinkaku-ji", "PLACE", "kyoto", "1 Kinkakujichō, Kita", 35.0394, 135.7292, 4.6],
  ["nishiki", "Nishiki Market", "RESTAURANT", "kyoto", "Nakagyō Ward, Kyoto", 35.0050, 135.7649, 4.3],
  ["gion", "Gion & Hanamikoji", "PLACE", "kyoto", "Gionmachi Minamigawa, Higashiyama", 35.0037, 135.7751, 4.5],
  ["kyoto-ryokan", "Ryokan Yachiyo", "HOTEL", "kyoto", "34 Fukuchichō, Nanzenji", 35.0105, 135.7905, 4.6],
  ["dotonbori", "Dōtonbori", "PLACE", "osaka", "Chūō Ward, Osaka", 34.6687, 135.5013, 4.5],
  ["kuromon", "Kuromon Market", "RESTAURANT", "osaka", "2-4-1 Nipponbashi, Chūō", 34.6655, 135.5066, 4.2],
  ["osaka-castle", "Osaka Castle", "PLACE", "osaka", "1-1 Ōsakajō, Chūō", 34.6873, 135.5262, 4.5],
  ["kix", "Kansai Airport (KIX)", "FLIGHT", "osaka", "Izumisano, Osaka", 34.4320, 135.2304],

  ["hoan-kiem", "Hoàn Kiếm Lake", "PLACE", "hanoi", "Hoàn Kiếm, Hà Nội", 21.0288, 105.8525, 4.6],
  ["cafe-giang", "Café Giảng (egg coffee)", "RESTAURANT", "hanoi", "39 Nguyễn Hữu Huân", 21.0335, 105.8545, 4.5],
  ["bun-cha", "Bún Chả Hương Liên", "RESTAURANT", "hanoi", "24 Lê Văn Hưu", 21.0177, 105.8538, 4.3],
  ["train-street", "Train Street", "PLACE", "hanoi", "Trần Phú, Hoàn Kiếm", 21.0289, 105.8445, 4.2],
  ["old-quarter-hotel", "La Siesta Classic Ma May", "HOTEL", "hanoi", "94 Mã Mây, Hoàn Kiếm", 21.0354, 105.8535, 4.7],
  ["halong-cruise", "Overnight cruise, Lan Hạ Bay", "ACTIVITY", "halong", "Tuần Châu Harbour", 20.9218, 107.0102, 4.6],
  ["dan-ang", "Đà Nẵng Airport (DAD)", "FLIGHT", "hoian", "Đà Nẵng", 16.0439, 108.1994],
  ["ancient-town", "Hội An Ancient Town", "PLACE", "hoian", "Minh An, Hội An", 15.8770, 108.3275, 4.7],
  ["tailor", "BeBe Tailor", "ACTIVITY", "hoian", "11 Hoàng Diệu, Hội An", 15.8775, 108.3300, 4.6],
  ["banh-mi-phuong", "Bánh Mì Phượng", "RESTAURANT", "hoian", "2B Phan Châu Trinh", 15.8794, 108.3317, 4.4],
  ["an-bang", "An Bàng Beach", "PLACE", "hoian", "Cẩm An, Hội An", 15.9142, 108.3416, 4.5],
  // Hội An around the old town: enough variety for Explore's category filters.
  ["hoian-market", "Hội An Central Market", "PLACE", "hoian", "Trần Phú, Minh An", 15.8768, 108.3322, 4.3],
  ["mot", "Mót Hội An", "RESTAURANT", "hoian", "150 Trần Phú, Minh An", 15.8773, 108.3294, 4.5],
  ["roastery", "Hoi An Roastery", "RESTAURANT", "hoian", "135 Trần Phú, Minh An", 15.8771, 108.3301, 4.5],
  ["cao-lau", "Cao Lầu Thanh", "RESTAURANT", "hoian", "26 Thái Phiên, Minh An", 15.8807, 108.3307, 4.4],
  ["phuc-kien", "Phúc Kiến Assembly Hall", "PLACE", "hoian", "46 Trần Phú, Minh An", 15.8772, 108.3307, 4.6],
  ["hoian-museum", "Hội An Museum", "PLACE", "hoian", "10B Trần Hưng Đạo, Minh An", 15.8796, 108.3302, 4.2],
  ["tra-que", "Trà Quế Vegetable Village", "ACTIVITY", "hoian", "Cẩm Hà, Hội An", 15.8987, 108.3329, 4.5],
  ["coconut-forest", "Bảy Mẫu Coconut Forest", "ACTIVITY", "hoian", "Cẩm Thanh, Hội An", 15.8783, 108.3693, 4.4],
  ["white-marble", "White Marble Wine Bar", "ACTIVITY", "hoian", "98 Lê Lợi, Minh An", 15.8771, 108.3290, 4.4],
  ["nam-hai", "Four Seasons Resort The Nam Hai", "HOTEL", "hoian", "Điện Dương, Điện Bàn", 15.9480, 108.2974, 4.8],
  ["cong-caphe", "Cộng Cà Phê Nhà Thờ", "RESTAURANT", "hanoi", "27 Nhà Thờ, Hoàn Kiếm", 21.0287, 105.8494, 4.4],
  ["temple-literature", "Temple of Literature", "PLACE", "hanoi", "58 Quốc Tử Giám, Đống Đa", 21.0277, 105.8355, 4.6],
  ["ben-thanh", "Bến Thành Market", "PLACE", "saigon", "Lê Lợi, Quận 1", 10.7725, 106.6980, 4.1],
  ["war-museum", "War Remnants Museum", "PLACE", "saigon", "28 Võ Văn Tần, Quận 3", 10.7795, 106.6921, 4.6],
  ["cu-chi", "Củ Chi Tunnels", "ACTIVITY", "saigon", "Phú Hiệp, Củ Chi", 11.1437, 106.4630, 4.4],
  ["com-tam", "Cơm Tấm Ba Ghiền", "RESTAURANT", "saigon", "84 Đặng Văn Ngữ, Phú Nhuận", 10.7954, 106.6720, 4.4],

  ["ggb", "Golden Gate Bridge", "PLACE", "sf", "Golden Gate Bridge, SF", 37.8199, -122.4783, 4.8],
  ["ferry-bldg", "Ferry Building Marketplace", "RESTAURANT", "sf", "1 Ferry Building, SF", 37.7955, -122.3937, 4.6],
  ["bixby", "Bixby Creek Bridge", "PLACE", "bigsur", "CA-1, Big Sur", 36.3715, -121.9017, 4.8],
  ["mcway", "McWay Falls", "PLACE", "bigsur", "Julia Pfeiffer Burns SP", 36.1580, -121.6722, 4.8],
  ["nepenthe", "Nepenthe", "RESTAURANT", "bigsur", "48510 CA-1, Big Sur", 36.2222, -121.7597, 4.4],
  ["santa-monica", "Santa Monica Pier", "PLACE", "la", "200 Santa Monica Pier", 34.0094, -118.4973, 4.5],
  ["griffith", "Griffith Observatory", "PLACE", "la", "2800 E Observatory Rd", 34.1184, -118.3004, 4.8],

  ["belem", "Pastéis de Belém", "RESTAURANT", "lisbon", "R. de Belém 84-92", 38.6975, -9.2032, 4.6],
  ["alfama", "Alfama & Miradouro de Santa Luzia", "PLACE", "lisbon", "Alfama, Lisboa", 38.7118, -9.1301, 4.7],
  ["tram28", "Tram 28", "TRANSPORTATION", "lisbon", "Martim Moniz, Lisboa", 38.7155, -9.1365, 4.3],
  ["ribeira", "Ribeira", "PLACE", "porto", "Ribeira, Porto", 41.1405, -8.6131, 4.7],
  ["livraria", "Livraria Lello", "PLACE", "porto", "R. das Carmelitas 144", 41.1469, -8.6149, 4.4],
];

/** TRIPLY category (taxonomy key) per seed place; the rest get their item type's default. */
const placeCategoryKeys: Record<string, string> = {
  hnd: "transport.airport", kix: "transport.airport", "dan-ang": "transport.airport",
  "shinjuku-hotel": "lodging.hotel", "kyoto-ryokan": "lodging.guesthouse", "old-quarter-hotel": "lodging.hotel", "nam-hai": "lodging.resort",
  ichiran: "food.noodles", omoide: "food.street_food", tsukiji: "shopping.market", nishiki: "shopping.market", kuromon: "shopping.market",
  "cafe-giang": "drink.cafe", "cong-caphe": "drink.cafe", roastery: "drink.cafe", mot: "drink.juice",
  "bun-cha": "food.vietnamese", "banh-mi-phuong": "food.street_food", "cao-lau": "food.noodles", "com-tam": "food.vietnamese",
  "ferry-bldg": "shopping.market", nepenthe: "food.restaurant", belem: "food.bakery",
  shibuya: "sights.landmark", meiji: "culture.pagoda", sensoji: "culture.pagoda", fushimi: "culture.pagoda", kinkakuji: "culture.pagoda",
  "phuc-kien": "culture.pagoda", "temple-literature": "sights.historic", gion: "sights.old_town", "ancient-town": "sights.old_town",
  alfama: "sights.viewpoint", ribeira: "sights.old_town", dotonbori: "sights.landmark", "osaka-castle": "sights.historic",
  arashiyama: "nature.park", "an-bang": "nature.beach", "hoan-kiem": "nature.lake", mcway: "nature.waterfall", bixby: "sights.viewpoint",
  ggb: "sights.landmark", "santa-monica": "sights.landmark", griffith: "sights.viewpoint", "train-street": "sights.landmark",
  "war-museum": "culture.museum", "hoian-museum": "culture.museum", livraria: "shopping.souvenir",
  "hoian-market": "shopping.market", "ben-thanh": "shopping.market", tailor: "shopping.tailor",
  teamlab: "culture.gallery", "halong-cruise": "activity.tour", "cu-chi": "sights.historic", "tra-que": "activity.cooking_class",
  "coconut-forest": "activity.tour", "white-marble": "nightlife.bar",
  shinkansen: "transport.train_station", tram28: "transport.train_station",
};

const places: Place[] = placeSeeds.map(([key, name, category, dest, address, lat, lng, rating]) => ({
  id: p(key),
  name,
  category,
  destinationId: d(dest),
  address,
  lat,
  lng,
  rating,
}));

// ── Trips + itineraries ─────────────────────────────────────────────────
type ItemSeed = [time: string, type: ItineraryItemType, title: string, placeKey?: string, notes?: string, end?: string];
type DaySeed = { title?: string; items: ItemSeed[] };

const days: TripDay[] = [];
const items: ItineraryItem[] = [];

function addDate(iso: string | undefined, n: number) {
  if (!iso) return undefined;
  const dt = new Date(iso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function buildItinerary(tripKey: string, startDate: string | undefined, plan: DaySeed[], editor: string) {
  plan.forEach((day, i) => {
    const dayId = seedId(`day:${tripKey}:${i}`);
    days.push({ id: dayId, tripId: t(tripKey), dayNumber: i + 1, date: addDate(startDate, i), title: day.title });
    day.items.forEach(([time, type, title, placeKey, notes, end], j) => {
      items.push({
        id: seedId(`item:${tripKey}:${i}:${j}`),
        dayId,
        type,
        title,
        placeId: placeKey ? p(placeKey) : undefined,
        startTime: time || undefined,
        endTime: end,
        notes,
        sortOrder: j,
        updatedBy: u(placeKey === "teamlab" ? "minh" : editor),
        updatedAt: ago(30 + i),
      });
    });
  });
}

const trips: Trip[] = [
  {
    id: t("japan"), ownerId: u("an"), title: "Japan — 7 Days",
    description: "Four friends, one rail pass. Tokyo → Kyoto → Osaka with way too much ramen.",
    destinationIds: [d("tokyo"), d("kyoto"), d("osaka")], startDate: "2027-03-10", endDate: "2027-03-16",
    visibility: "PRIVATE", allowComments: true, allowFork: true, estimatedBudget: 2200, currency: "USD",
    cover: ["#1f3b73", "#e8657a"], forkCount: 0, saveCount: 0, createdAt: ago(400), updatedAt: ago(5),
  },
  {
    id: t("vietnam"), ownerId: u("sarah"), title: "Vietnam — 10 Days, North to South",
    description: "The classic route without the rush: Hanoi street food, a night on Lan Hạ Bay, tailors in Hội An and Saigon's buzz.",
    destinationIds: [d("hanoi"), d("halong"), d("hoian"), d("saigon")], startDate: "2026-02-03", endDate: "2026-02-12",
    visibility: "PUBLIC", allowComments: true, allowFork: true, estimatedBudget: 1400, currency: "USD",
    cover: ["#0f5257", "#f2b134"], forkCount: 212, saveCount: 1840, createdAt: ago(2000), updatedAt: ago(300),
  },
  {
    id: t("california"), ownerId: u("minh"), title: "California Road Trip",
    description: "SF to LA the slow way down Highway 1. Five days, one playlist, zero regrets.",
    destinationIds: [d("sf"), d("bigsur"), d("la")], startDate: "2026-06-12", endDate: "2026-06-16",
    visibility: "PUBLIC", allowComments: true, allowFork: true, estimatedBudget: 900, currency: "USD",
    cover: ["#264653", "#e9c46a"], forkCount: 87, saveCount: 640, createdAt: ago(2600), updatedAt: ago(900),
  },
  {
    id: t("kyoto"), ownerId: u("sarah"), title: "Kyoto Slow Weekend",
    description: "Three unhurried days of shrines at dawn, matcha everything and ryokan dinners.",
    destinationIds: [d("kyoto")], startDate: "2025-11-21", endDate: "2025-11-23",
    visibility: "PUBLIC", allowComments: true, allowFork: true, estimatedBudget: 750, currency: "USD",
    cover: ["#5b2a3c", "#e7a35b"], forkCount: 154, saveCount: 1210, createdAt: ago(5000), updatedAt: ago(4000),
  },
  {
    id: t("portugal"), ownerId: u("linh"), title: "Lisbon & Porto in 5 Days",
    description: "Pastel de nata quality control across two cities.",
    destinationIds: [d("lisbon"), d("porto")], startDate: "2026-05-02", endDate: "2026-05-06",
    visibility: "PUBLIC", allowComments: true, allowFork: false, estimatedBudget: 1100, currency: "USD",
    cover: ["#1b4965", "#f4a259"], forkCount: 0, saveCount: 410, createdAt: ago(3100), updatedAt: ago(2900),
  },
];

buildItinerary("japan", "2027-03-10", [
  { title: "Arrive Tokyo", items: [
    ["09:00", "FLIGHT", "Arrive Tokyo (HND)", "hnd", "Get Suica cards at the airport"],
    ["11:00", "HOTEL", "Hotel check-in", "shinjuku-hotel", "Bags only — room ready at 14:00"],
    ["13:00", "RESTAURANT", "Lunch — ramen", "ichiran"],
    ["15:00", "PLACE", "Shibuya Crossing", "shibuya"],
    ["19:00", "RESTAURANT", "Dinner at Omoide Yokochō", "omoide", "Cash only stalls"],
  ]},
  { title: "Old & new Tokyo", items: [
    ["08:00", "PLACE", "Meiji Jingu at opening", "meiji"],
    ["11:00", "RESTAURANT", "Tsukiji Outer Market", "tsukiji"],
    ["14:00", "PLACE", "Sensō-ji & Asakusa", "sensoji"],
    ["18:30", "ACTIVITY", "teamLab Planets", "teamlab", "Tickets booked for 18:30 slot"],
  ]},
  { title: "Tokyo → Kyoto", items: [
    ["09:30", "TRANSPORTATION", "Shinkansen to Kyoto", "shinkansen", "Reserve seats on the right (Fuji side)"],
    ["13:00", "HOTEL", "Check in — ryokan", "kyoto-ryokan"],
    ["17:00", "PLACE", "Evening walk in Gion", "gion"],
  ]},
  { title: "Kyoto", items: [
    ["06:30", "PLACE", "Fushimi Inari before the crowds", "fushimi"],
    ["12:00", "RESTAURANT", "Nishiki Market lunch", "nishiki"],
    ["15:00", "PLACE", "Kinkaku-ji", "kinkakuji"],
  ]},
  { title: "Arashiyama", items: [
    ["07:30", "PLACE", "Bamboo Grove", "arashiyama"],
    ["", "NOTE", "Free afternoon — split up & meet for dinner"],
  ]},
  { title: "Osaka", items: [
    ["10:00", "PLACE", "Osaka Castle", "osaka-castle"],
    ["13:00", "RESTAURANT", "Kuromon Market", "kuromon"],
    ["19:00", "PLACE", "Dōtonbori night food crawl", "dotonbori"],
  ]},
  { title: "Fly home", items: [["11:00", "FLIGHT", "Depart KIX", "kix"]] },
], "an");

buildItinerary("vietnam", "2026-02-03", [
  { title: "Hanoi Old Quarter", items: [
    ["10:00", "HOTEL", "Check in, Old Quarter", "old-quarter-hotel"],
    ["12:00", "RESTAURANT", "Bún chả for lunch", "bun-cha", "The one Obama ate at — still worth it"],
    ["16:00", "PLACE", "Sunset around Hoàn Kiếm Lake", "hoan-kiem"],
    ["20:00", "RESTAURANT", "Egg coffee at Café Giảng", "cafe-giang"],
  ]},
  { title: "Hanoi", items: [
    ["09:00", "PLACE", "Train Street", "train-street", "Check train times the night before"],
    ["", "NOTE", "Afternoon: walk the 36 streets with no plan"],
  ]},
  { title: "Lan Hạ Bay cruise", items: [["08:00", "ACTIVITY", "Overnight cruise", "halong-cruise", "Kayaking + cave visit included"]] },
  { title: "Back to Hanoi", items: [["12:00", "TRANSPORTATION", "Shuttle to Hanoi", "halong-cruise"]] },
  { title: "Fly to Hội An", items: [
    ["10:00", "FLIGHT", "HAN → DAD", "dan-ang"],
    ["17:30", "PLACE", "Ancient Town at lantern hour", "ancient-town"],
  ]},
  { title: "Hội An", items: [
    ["09:00", "ACTIVITY", "Tailor fitting", "tailor", "Order on day 1, fittings on day 2–3"],
    ["12:00", "RESTAURANT", "Bánh Mì Phượng", "banh-mi-phuong"],
  ]},
  { title: "Beach day", items: [["10:00", "PLACE", "An Bàng Beach", "an-bang"]] },
  { title: "Saigon", items: [
    ["14:00", "PLACE", "Bến Thành Market", "ben-thanh"],
    ["19:00", "RESTAURANT", "Cơm tấm dinner", "com-tam"],
  ]},
  { title: "History day", items: [
    ["08:00", "ACTIVITY", "Củ Chi Tunnels (half day)", "cu-chi"],
    ["15:00", "PLACE", "War Remnants Museum", "war-museum"],
  ]},
  { title: "Fly home", items: [["", "NOTE", "Last bánh mì on the way to the airport"]] },
], "sarah");

buildItinerary("california", "2026-06-12", [
  { title: "San Francisco", items: [
    ["10:00", "RESTAURANT", "Ferry Building brunch", "ferry-bldg"],
    ["16:00", "PLACE", "Golden Gate Bridge walk", "ggb"],
  ]},
  { title: "Down Highway 1", items: [
    ["11:00", "PLACE", "Bixby Creek Bridge", "bixby"],
    ["13:30", "RESTAURANT", "Lunch with a view at Nepenthe", "nepenthe"],
    ["16:00", "PLACE", "McWay Falls", "mcway"],
  ]},
  { title: "Central Coast", items: [["", "NOTE", "Elephant seals at Piedras Blancas — pull over at the vista point"]] },
  { title: "Los Angeles", items: [
    ["17:00", "PLACE", "Santa Monica Pier sunset", "santa-monica"],
  ]},
  { title: "LA", items: [["20:00", "PLACE", "Griffith Observatory at night", "griffith"]] },
], "minh");

buildItinerary("kyoto", "2025-11-21", [
  { title: "Higashiyama", items: [
    ["15:00", "HOTEL", "Ryokan check-in", "kyoto-ryokan"],
    ["17:00", "PLACE", "Gion at dusk", "gion"],
  ]},
  { title: "Dawn shrines", items: [
    ["06:00", "PLACE", "Fushimi Inari", "fushimi"],
    ["12:00", "RESTAURANT", "Nishiki Market", "nishiki"],
    ["15:00", "PLACE", "Kinkaku-ji", "kinkakuji"],
  ]},
  { title: "Arashiyama", items: [["07:00", "PLACE", "Bamboo Grove", "arashiyama"]] },
], "sarah");

buildItinerary("portugal", "2026-05-02", [
  { title: "Lisbon", items: [
    ["10:00", "TRANSPORTATION", "Ride Tram 28", "tram28"],
    ["13:00", "PLACE", "Alfama viewpoints", "alfama"],
  ]},
  { title: "Belém", items: [["11:00", "RESTAURANT", "Pastéis de Belém", "belem"]] },
  { title: "Train to Porto", items: [["", "NOTE", "Alfa Pendular from Santa Apolónia — 3h"]] },
  { title: "Porto", items: [
    ["10:00", "PLACE", "Livraria Lello", "livraria"],
    ["18:00", "PLACE", "Ribeira at sunset", "ribeira"],
  ]},
  { title: "Fly home", items: [] },
], "linh");

const members: TripMember[] = [
  { tripId: t("japan"), userId: u("an"), role: "OWNER", joinedAt: ago(400) },
  { tripId: t("japan"), userId: u("minh"), role: "EDITOR", joinedAt: ago(380) },
  { tripId: t("japan"), userId: u("linh"), role: "VIEWER", joinedAt: ago(370) },
  { tripId: t("japan"), userId: u("nam"), role: "VIEWER", joinedAt: ago(300) },
  { tripId: t("vietnam"), userId: u("sarah"), role: "OWNER", joinedAt: ago(2000) },
  { tripId: t("california"), userId: u("minh"), role: "OWNER", joinedAt: ago(2600) },
  { tripId: t("california"), userId: u("an"), role: "VIEWER", joinedAt: ago(2500) },
  { tripId: t("kyoto"), userId: u("sarah"), role: "OWNER", joinedAt: ago(5000) },
  { tripId: t("portugal"), userId: u("linh"), role: "OWNER", joinedAt: ago(3100) },
];

const invitations: TripInvitation[] = [
  {
    id: seedId("inv:japan:sarah"), tripId: t("japan"), email: "sarah@triply.dev", role: "VIEWER",
    token: "demo-k7Pq2xVb9LmN4sRt8WzA1cYe", expiresAt: ago(-24 * 6), invitedBy: u("an"),
  },
];

// ── Social ───────────────────────────────────────────────────────────────
const posts: Post[] = [
  {
    id: seedId("post:vietnam"), userId: u("sarah"), tripId: t("vietnam"), destinationId: d("hoian"),
    title: "10 days, north to south — my Vietnam route",
    body: "Everyone asked for the itinerary, so here it is — every stop, every bowl of bún chả. Use it, remix it, and tell me what you changed.",
    photos: [["#0f5257", "#f2b134"], ["#a4471f", "#f5cd5b"], ["#7a2e1f", "#f2b134"]],
    visibility: "PUBLIC", likeCount: 2431, commentCount: 3, createdAt: ago(20),
  },
  {
    id: seedId("post:california"), userId: u("minh"), tripId: t("california"), destinationId: d("bigsur"),
    title: "Highway 1 in five days",
    body: "Pull over at every vista point. Trust me. Full route with gas and food stops inside.",
    photos: [["#264653", "#e9c46a"], ["#1d3557", "#e76f51"]],
    visibility: "PUBLIC", likeCount: 812, commentCount: 1, createdAt: ago(44),
  },
  {
    id: seedId("post:kyoto"), userId: u("sarah"), tripId: t("kyoto"), destinationId: d("kyoto"),
    title: "Kyoto, slowly",
    body: "Fushimi Inari at 6am is a different world. A gentle 3-day plan for people who hate rushing.",
    photos: [["#5b2a3c", "#e7a35b"]],
    visibility: "PUBLIC", likeCount: 1204, commentCount: 0, createdAt: ago(70),
  },
  {
    id: seedId("post:portugal"), userId: u("linh"), tripId: t("portugal"), destinationId: d("lisbon"),
    title: "Rated every pastel de nata in Lisbon",
    body: "Spoiler: Belém wins, but Manteigaria is close. Itinerary attached.",
    photos: [["#1b4965", "#f4a259"], ["#283d3b", "#c44536"]],
    visibility: "PUBLIC", likeCount: 377, commentCount: 0, createdAt: ago(96),
  },
];

const comments: Comment[] = [
  { id: seedId("c1"), postId: seedId("post:vietnam"), userId: u("linh"), body: "Saving this for spring! Was the cruise worth it?", createdAt: ago(18) },
  { id: seedId("c2"), postId: seedId("post:vietnam"), userId: u("sarah"), body: "100% — book Lan Hạ instead of Hạ Long proper, far fewer boats.", createdAt: ago(17) },
  { id: seedId("c3"), postId: seedId("post:vietnam"), userId: u("nam"), body: "Bún chả Hương Liên 🙌", createdAt: ago(10) },
  { id: seedId("c4"), postId: seedId("post:california"), userId: u("an"), body: "Still the best road trip we've done.", createdAt: ago(40) },
];

const notifications: Notification[] = [
  { id: seedId("n1"), userId: u("an"), actorId: u("minh"), type: "TRIP_ITEM_ADDED", tripId: t("japan"), text: "added “teamLab Planets” to Day 2 of Japan — 7 Days", createdAt: ago(5) },
  { id: seedId("n2"), userId: u("an"), actorId: u("sarah"), type: "FOLLOW", text: "started following you", createdAt: ago(26) },
  { id: seedId("n3"), userId: u("an"), actorId: u("linh"), type: "COMMENT", postId: seedId("post:california"), text: "commented on Highway 1 in five days", createdAt: ago(39), readAt: ago(30) },
  { id: seedId("n4"), userId: u("minh"), actorId: u("an"), type: "TRIP_MEMBER_ROLE_CHANGED", tripId: t("japan"), text: "made you an Editor on Japan — 7 Days", createdAt: ago(380) },
  { id: seedId("n5"), userId: u("sarah"), actorId: u("an"), type: "TRIP_INVITE", tripId: t("japan"), invitationToken: invitations[0].token, text: "invited you to view Japan — 7 Days", createdAt: ago(2) },
];

export function createSeed(): DB {
  return structuredClone({
    users,
    follows: [
      { followerId: u("an"), followingId: u("sarah") },
      { followerId: u("an"), followingId: u("minh") },
      { followerId: u("sarah"), followingId: u("an") },
      { followerId: u("minh"), followingId: u("an") },
      { followerId: u("linh"), followingId: u("sarah") },
    ],
    destinations,
    places,
    placeCategories: Object.fromEntries(Object.entries(placeCategoryKeys).map(([k, v]) => [p(k), v])),
    trips,
    members,
    invitations,
    days,
    items,
    posts,
    comments,
    likes: [{ userId: u("an"), postId: seedId("post:kyoto") }],
    savedTrips: [{ userId: u("an"), tripId: t("kyoto") }],
    savedPosts: [],
    savedPlaces: [{ userId: u("an"), placeId: p("fushimi") }],
    notifications,
    reports: [],
  });
}

export const DEMO_USER_IDS = { an: u("an"), sarah: u("sarah"), minh: u("minh"), linh: u("linh"), nam: u("nam") };
