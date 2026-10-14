import type { Messages } from "../types";
import { after } from "./after";
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

/** Vietnamese catalog — must match `Messages` exactly (a missing or extra key fails the typecheck). */
export const vi: Messages = { common, labels, format, nav, titles, auth, home, social, explore, trips, settings, after };
