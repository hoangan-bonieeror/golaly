/** Home: greeting, feed, recommendations. */
export const home = {
  greeting: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
  greetingName: (greeting: string, name: string) => `${greeting}, ${name}`,
  title: "Where to next?",
  guestPitch: "Plan trips with friends and remix itineraries from real travelers.",
  getStarted: "Get started",
  trendingDestinations: "Trending destinations",
  trending: "Trending",
  all: "All",
  feed: "Feed",
  forYou: "For You",
  following: "Following",
  emptyFollowing: {
    title: "Nothing here yet",
    body: "Follow travelers whose trips you love and their stories will show up here.",
    action: "Find travelers",
  },
  emptyForYou: { title: "Share your first journey.", body: "Posts from travelers will appear here.", action: "New post" },
  recommendedTrips: "Recommended trips",
  continuePlanning: "Continue planning",
  destinationTbd: "Destination TBD",
};
