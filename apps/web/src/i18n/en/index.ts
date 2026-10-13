import { auth } from "./auth";
import { common } from "./common";
import { explore } from "./explore";
import { format } from "./format";
import { home } from "./home";
import { labels } from "./labels";
import { nav } from "./nav";
import { settings } from "./settings";
import { social } from "./social";
import { titles } from "./titles";
import { trips } from "./trips";

/** English is the source catalog: its shape is the `Messages` type every other language must match. */
export const en = { common, labels, format, nav, titles, auth, home, social, explore, trips, settings };
