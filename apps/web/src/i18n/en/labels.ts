/** Labels for shared enums (roles, visibility, item types, profile choices). */
export const labels = {
  role: { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" },
  roleWithArticle: { OWNER: "the owner", EDITOR: "an Editor", VIEWER: "a Viewer" },
  visibility: {
    PRIVATE: { label: "Private", hint: "Only members can see this trip." },
    LINK_ONLY: { label: "Link only", hint: "Anyone with the link can view. Not listed in Explore." },
    PUBLIC: { label: "Public", hint: "Discoverable in Explore, search and your profile." },
  },
  itemType: { PLACE: "Place", RESTAURANT: "Restaurant", HOTEL: "Hotel", FLIGHT: "Flight", TRANSPORTATION: "Transport", ACTIVITY: "Activity", NOTE: "Note" },
  travelerType: { SOLO: "Solo", COUPLE: "Couple", FRIENDS: "Friends", FAMILY: "Family", ALL: "A bit of everything" },
  interest: { FOOD: "Food", NATURE: "Nature", BEACH: "Beach", CITY: "City", CULTURE: "Culture", ADVENTURE: "Adventure", SHOPPING: "Shopping", PHOTOGRAPHY: "Photography" },
  legMode: { Walk: "Walk", Transit: "Transit", Drive: "Drive", Fly: "Fly" },
};
